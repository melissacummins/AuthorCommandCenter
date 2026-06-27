// Google OAuth callback. The browser is redirected here by Google
// after the user approves the connection. We verify the signed state we
// issued in oauth-start, exchange the auth code for tokens, encrypt the
// long-lived refresh token, and upsert it into user_google_tokens.
//
// Because this is the redirect target, the user's Supabase session lives
// in the browser, not in this request. The signed `state` parameter
// carries the (verified) Supabase user id so we know which user the new
// tokens belong to.
//
// We persist ONLY the refresh token — access tokens are minted fresh on
// demand by /api/google/token. On success this serves a tiny HTML page
// that posts a message to the opener (the planner opens this in a popup
// and listens for that message) and closes.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GOOGLE_TOKEN_ENCRYPTION_SECRET   — master secret, ≥ 32 chars
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_OAUTH_REDIRECT_URI        — must match the Google Cloud Console client exactly

import { createClient } from '@supabase/supabase-js';
import { createCipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => VercelResponse;
  send: (body: string) => void;
  json: (body: unknown) => void;
  end: () => void;
};

function queryParam(req: VercelRequest, name: string): string | null {
  const v = req.query[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function deriveMasterKey(secret: string): Buffer {
  return scryptSync(secret, 'google-token-key-v1', 32);
}

function encrypt(plain: string, masterSecret: string): { encrypted: string; nonce: string; authTag: string } {
  const key = deriveMasterKey(masterSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: ciphertext.toString('base64'),
    nonce: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

interface StatePayload {
  user_id?: unknown;
  nonce?: unknown;
  issued_at?: unknown;
}

function verifyState(state: string, secret: string): { userId: string } | { error: string } {
  const parts = state.split('.');
  if (parts.length !== 2) return { error: 'Malformed state' };
  const [payloadB64, signature] = parts;
  const expected = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(signature, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { error: 'State signature invalid' };
  }
  let parsed: StatePayload;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as StatePayload;
  } catch {
    return { error: 'Malformed state payload' };
  }
  if (typeof parsed.user_id !== 'string') return { error: 'State missing user_id' };
  if (typeof parsed.issued_at !== 'number') return { error: 'State missing issued_at' };
  // 10-minute window for completing the OAuth dance.
  if (Math.floor(Date.now() / 1000) - parsed.issued_at > 600) {
    return { error: 'OAuth state expired — please reconnect' };
  }
  return { userId: parsed.user_id };
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  email?: string;
}

function respondHtml(res: VercelResponse, status: number, title: string, message: string, payload: Record<string, unknown>) {
  const safePayload = JSON.stringify(payload).replace(/</g, '\\u003c');
  const safeTitle = title.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
  const safeMessage = message.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#1e293b;padding:32px 40px;border-radius:16px;max-width:420px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.4)}
  h1{margin:0 0 8px;font-size:20px}
  p{margin:0;color:#94a3b8;font-size:14px;line-height:1.5}
</style></head>
<body><div class="card"><h1>${safeTitle}</h1><p>${safeMessage}</p></div>
<script>
(function(){
  var payload=${safePayload};
  try{ if(window.opener){ window.opener.postMessage({ type:'gcal-oauth', ...payload }, window.location.origin); } }catch(e){}
  setTimeout(function(){ try{ window.close(); }catch(e){} }, 1500);
})();
</script></body></html>`;
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const masterSecret = process.env.GOOGLE_TOKEN_ENCRYPTION_SECRET;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

  if (!supabaseUrl || !serviceKey || !masterSecret || !clientId || !clientSecret || !redirectUri) {
    respondHtml(res, 500, 'Configuration error', 'The Google Calendar connection isn\'t configured on the server yet. Check the env vars in Vercel.', { ok: false, error: 'not_configured' });
    return;
  }

  const error = queryParam(req, 'error');
  if (error) {
    const description = queryParam(req, 'error_description') ?? 'Google rejected the connection.';
    respondHtml(res, 200, 'Connection cancelled', description, { ok: false, error });
    return;
  }

  const code = queryParam(req, 'code');
  const state = queryParam(req, 'state');
  if (!code || !state) {
    respondHtml(res, 400, 'Missing parameters', 'Google didn\'t return an authorization code. Please try again.', { ok: false, error: 'missing_params' });
    return;
  }

  const verified = verifyState(state, masterSecret);
  if ('error' in verified) {
    respondHtml(res, 400, 'Connection rejected', verified.error, { ok: false, error: 'bad_state' });
    return;
  }
  const userId = verified.userId;

  // Exchange code for tokens. We only trust the redirect_uri from env,
  // never from the request.
  const tokenForm = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenForm.toString(),
  });
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as GoogleTokenResponse;

  if (!tokenRes.ok) {
    respondHtml(res, 502, 'Google declined the token request', tokenJson.error_description ?? tokenJson.error ?? 'Google didn\'t return tokens. Check the Vercel logs for the full response.', { ok: false, error: 'token_exchange_failed' });
    return;
  }

  if (!tokenJson.refresh_token) {
    // Google only returns a refresh token on first consent unless
    // prompt=consent is set (which we do), so this should be rare.
    respondHtml(res, 502, 'No refresh token returned', 'Google didn\'t return a refresh token. Remove this app from your Google account permissions (myaccount.google.com → Security → Third-party access), then reconnect.', { ok: false, error: 'no_refresh_token' });
    return;
  }

  // Best-effort: fetch the user's email for display. Failure is non-fatal.
  let googleEmail: string | null = null;
  if (tokenJson.access_token) {
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${tokenJson.access_token}` },
      });
      if (infoRes.ok) {
        const info = (await infoRes.json().catch(() => ({}))) as GoogleUserInfo;
        googleEmail = info.email ?? null;
      }
    } catch { /* non-fatal */ }
  }

  // Encrypt the refresh token before it touches the database.
  const refresh = encrypt(tokenJson.refresh_token, masterSecret);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const { error: upsertErr } = await supabase
    .from('user_google_tokens')
    .upsert({
      user_id: userId,
      encrypted_refresh_token: refresh.encrypted,
      refresh_token_nonce: refresh.nonce,
      refresh_token_auth_tag: refresh.authTag,
      scopes: tokenJson.scope ?? null,
      google_email: googleEmail,
      connected_at: now.toISOString(),
      updated_at: now.toISOString(),
    }, { onConflict: 'user_id' });

  if (upsertErr) {
    respondHtml(res, 500, 'Couldn\'t save the connection', upsertErr.message, { ok: false, error: 'persist_failed' });
    return;
  }

  respondHtml(res, 200, 'Google Calendar connected!', `Connected${googleEmail ? ` as ${googleEmail}` : ''}. You can close this window.`, {
    ok: true,
    google_email: googleEmail,
  });
}
