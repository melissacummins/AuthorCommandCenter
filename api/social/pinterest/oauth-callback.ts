// Pinterest OAuth callback. The browser is redirected here by
// Pinterest after the user approves the connection. We verify the
// signed state we issued in oauth-start, exchange the auth code for
// access + refresh tokens, fetch the user's Pinterest account info,
// and upsert an encrypted row in social_accounts.
//
// Because this is the redirect target, the user's Supabase session
// lives in the browser, not in this request. The signed `state`
// parameter carries the (verified) Supabase user id so we know which
// user the new tokens belong to.
//
// On success this serves a tiny HTML page that calls
// window.close() and posts a message to the opener — the social
// module opens this in a popup and listens for that message.

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
  return scryptSync(secret, 'social-token-key-v1', 32);
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

interface PinterestTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
}

interface PinterestUserAccount {
  account_type?: string;
  id?: string;
  username?: string;
  profile_image?: string;
  website_url?: string;
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
  try{ if(window.opener){ window.opener.postMessage({ type:'social-oauth', ...payload }, window.location.origin); } }catch(e){}
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
  const masterSecret = process.env.SOCIAL_TOKEN_ENCRYPTION_SECRET;
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
  const redirectUri = process.env.PINTEREST_REDIRECT_URI;

  if (!supabaseUrl || !serviceKey || !masterSecret || !clientId || !clientSecret || !redirectUri) {
    respondHtml(res, 500, 'Configuration error', 'The Pinterest connection isn\'t configured on the server yet. Check the env vars in Vercel.', { ok: false, error: 'not_configured' });
    return;
  }

  const error = queryParam(req, 'error');
  if (error) {
    const description = queryParam(req, 'error_description') ?? 'Pinterest rejected the connection.';
    respondHtml(res, 200, 'Connection cancelled', description, { ok: false, error });
    return;
  }

  const code = queryParam(req, 'code');
  const state = queryParam(req, 'state');
  if (!code || !state) {
    respondHtml(res, 400, 'Missing parameters', 'Pinterest didn\'t return an authorization code. Please try again.', { ok: false, error: 'missing_params' });
    return;
  }

  const verified = verifyState(state, masterSecret);
  if ('error' in verified) {
    respondHtml(res, 400, 'Connection rejected', verified.error, { ok: false, error: 'bad_state' });
    return;
  }
  const userId = verified.userId;

  // Exchange code for tokens.
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenForm = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const tokenRes = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenForm.toString(),
  });
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as PinterestTokenResponse & { message?: string };

  if (!tokenRes.ok || !tokenJson.access_token) {
    respondHtml(res, 502, 'Pinterest declined the token request', tokenJson.message ?? 'Pinterest didn\'t return an access token. Check the Vercel logs for the full response.', { ok: false, error: 'token_exchange_failed' });
    return;
  }

  // Look up the connected account so we have something nice to display.
  const accountRes = await fetch('https://api.pinterest.com/v5/user_account', {
    headers: { 'Authorization': `Bearer ${tokenJson.access_token}` },
  });
  const accountJson = (await accountRes.json().catch(() => ({}))) as PinterestUserAccount;

  const externalAccountId = accountJson.id ?? accountJson.username ?? userId;
  const username = accountJson.username ?? null;

  // Encrypt tokens.
  const access = encrypt(tokenJson.access_token, masterSecret);
  const refresh = tokenJson.refresh_token ? encrypt(tokenJson.refresh_token, masterSecret) : null;

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const accessExpiresAt = tokenJson.expires_in
    ? new Date(now.getTime() + tokenJson.expires_in * 1000).toISOString()
    : null;
  const refreshExpiresAt = tokenJson.refresh_token_expires_in
    ? new Date(now.getTime() + tokenJson.refresh_token_expires_in * 1000).toISOString()
    : null;

  const { error: upsertErr } = await supabase
    .from('social_accounts')
    .upsert({
      user_id: userId,
      platform: 'pinterest',
      external_account_id: externalAccountId,
      username,
      display_name: username,
      profile_image_url: accountJson.profile_image ?? null,
      encrypted_access_token: access.encrypted,
      access_token_nonce: access.nonce,
      access_token_auth_tag: access.authTag,
      encrypted_refresh_token: refresh?.encrypted ?? null,
      refresh_token_nonce: refresh?.nonce ?? null,
      refresh_token_auth_tag: refresh?.authTag ?? null,
      access_token_expires_at: accessExpiresAt,
      refresh_token_expires_at: refreshExpiresAt,
      scopes: tokenJson.scope ? tokenJson.scope.split(/[,\s]+/).filter(Boolean) : [],
      connected_at: now.toISOString(),
      last_sync_error: null,
    }, { onConflict: 'user_id,platform,external_account_id' });

  if (upsertErr) {
    respondHtml(res, 500, 'Couldn\'t save the connection', upsertErr.message, { ok: false, error: 'persist_failed' });
    return;
  }

  respondHtml(res, 200, 'Pinterest connected!', `Connected as ${username ? '@' + username : externalAccountId}. You can close this window.`, {
    ok: true,
    platform: 'pinterest',
    username,
  });
}
