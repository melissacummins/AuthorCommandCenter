// Dropbox OAuth 2.0 (backend / refresh-token flow), action-routed into a
// single serverless function to stay inside the Vercel function budget:
//
//   POST /api/dropbox/start       → { authorize_url } for the connect popup
//   GET  /api/dropbox/callback    → redirect target; exchanges the code,
//                                   encrypts + stores the refresh token,
//                                   then postMessages the opener and closes
//   POST /api/dropbox/token       → mints a short-lived access token for
//                                   client-direct uploads (also the
//                                   connection-status probe)
//   POST /api/dropbox/disconnect  → best-effort revoke + delete the row
//
// The design mirrors api/google/* exactly: stateless HMAC-signed `state`,
// AES-256-GCM refresh token at rest, access tokens never persisted, and
// client_secret never leaves the server. We reuse the Google master
// secret (GOOGLE_TOKEN_ENCRYPTION_SECRET) with a Dropbox-specific scrypt
// salt so the derived keys are independent.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GOOGLE_TOKEN_ENCRYPTION_SECRET   — master secret, ≥ 32 chars (shared)
//   DROPBOX_APP_KEY
//   DROPBOX_APP_SECRET
//   DROPBOX_OAUTH_REDIRECT_URI       — must match the Dropbox App Console exactly

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual,
} from 'node:crypto';

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
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

function authHeader(req: VercelRequest): string | null {
  const raw = req.headers['authorization'] ?? req.headers['Authorization'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.toLowerCase().startsWith('bearer ')) return null;
  return v.slice(7);
}

function deriveMasterKey(secret: string): Buffer {
  return scryptSync(secret, 'dropbox-token-key-v1', 32);
}

function encrypt(plain: string, masterSecret: string): { encrypted: string; nonce: string; authTag: string } {
  const key = deriveMasterKey(masterSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    encrypted: ciphertext.toString('base64'),
    nonce: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(encrypted: string, nonce: string, authTag: string, masterSecret: string): string {
  const key = deriveMasterKey(masterSecret);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
  return plain.toString('utf8');
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
  const expected = createHmac('sha256', secret).update(`dropbox:${payloadB64}`).digest('base64url');
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

interface DropboxTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function respondHtml(res: VercelResponse, status: number, title: string, message: string, payload: Record<string, unknown>) {
  const safePayload = JSON.stringify(payload).replace(/</g, '\\u003c');
  const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#1e293b;padding:32px 40px;border-radius:16px;max-width:420px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.4)}
  h1{margin:0 0 8px;font-size:20px}
  p{margin:0;color:#94a3b8;font-size:14px;line-height:1.5}
</style></head>
<body><div class="card"><h1>${esc(title)}</h1><p>${esc(message)}</p></div>
<script>
(function(){
  var payload=${safePayload};
  try{ if(window.opener){ window.opener.postMessage({ type:'dropbox-oauth', ...payload }, window.location.origin); } }catch(e){}
  setTimeout(function(){ try{ window.close(); }catch(e){} }, 1500);
})();
</script></body></html>`;
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
}

interface Env {
  supabaseUrl: string;
  serviceKey: string;
  masterSecret: string;
  appKey: string;
  appSecret: string;
  redirectUri: string;
}

function loadEnv(): Env | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const masterSecret = process.env.GOOGLE_TOKEN_ENCRYPTION_SECRET;
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const redirectUri = process.env.DROPBOX_OAUTH_REDIRECT_URI;
  if (!supabaseUrl || !serviceKey || !masterSecret || masterSecret.length < 32 || !appKey || !appSecret || !redirectUri) return null;
  return { supabaseUrl, serviceKey, masterSecret, appKey, appSecret, redirectUri };
}

function serviceClient(env: Env): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireUser(req: VercelRequest, supabase: SupabaseClient): Promise<string | null> {
  const token = authHeader(req);
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

// ---------------- start ----------------

async function handleStart(req: VercelRequest, res: VercelResponse, env: Env) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const supabase = serviceClient(env);
  const userId = await requireUser(req, supabase);
  if (!userId) { res.status(401).json({ error: 'Missing or invalid authorization' }); return; }

  const payload = {
    user_id: userId,
    nonce: randomBytes(16).toString('base64url'),
    issued_at: Math.floor(Date.now() / 1000),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', env.masterSecret).update(`dropbox:${payloadB64}`).digest('base64url');
  const state = `${payloadB64}.${signature}`;

  // token_access_type=offline makes Dropbox return a refresh token.
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.appKey,
    redirect_uri: env.redirectUri,
    token_access_type: 'offline',
    state,
  });
  res.status(200).json({ authorize_url: `https://www.dropbox.com/oauth2/authorize?${params.toString()}` });
}

// ---------------- callback ----------------

async function handleCallback(req: VercelRequest, res: VercelResponse, env: Env) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const error = queryParam(req, 'error');
  if (error) {
    const description = queryParam(req, 'error_description') ?? 'Dropbox rejected the connection.';
    respondHtml(res, 200, 'Connection cancelled', description, { ok: false, error });
    return;
  }

  const code = queryParam(req, 'code');
  const state = queryParam(req, 'state');
  if (!code || !state) {
    respondHtml(res, 400, 'Missing parameters', 'Dropbox didn\'t return an authorization code. Please try again.', { ok: false, error: 'missing_params' });
    return;
  }

  const verified = verifyState(state, env.masterSecret);
  if ('error' in verified) {
    respondHtml(res, 400, 'Connection rejected', verified.error, { ok: false, error: 'bad_state' });
    return;
  }

  const tokenForm = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: env.appKey,
    client_secret: env.appSecret,
    redirect_uri: env.redirectUri,
  });
  const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenForm.toString(),
  });
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as DropboxTokenResponse;

  if (!tokenRes.ok || !tokenJson.refresh_token) {
    respondHtml(res, 502, 'Dropbox declined the token request', tokenJson.error_description ?? tokenJson.error ?? 'Dropbox didn\'t return tokens. Check the Vercel logs for the full response.', { ok: false, error: 'token_exchange_failed' });
    return;
  }

  // Best-effort: fetch the account email for display. Failure is non-fatal.
  let dropboxEmail: string | null = null;
  if (tokenJson.access_token) {
    try {
      const acctRes = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenJson.access_token}` },
      });
      if (acctRes.ok) {
        const acct = (await acctRes.json().catch(() => ({}))) as { email?: string };
        dropboxEmail = acct.email ?? null;
      }
    } catch { /* non-fatal */ }
  }

  const refresh = encrypt(tokenJson.refresh_token, env.masterSecret);
  const supabase = serviceClient(env);
  const now = new Date().toISOString();
  const { error: upsertErr } = await supabase
    .from('user_dropbox_tokens')
    .upsert({
      user_id: verified.userId,
      encrypted_refresh_token: refresh.encrypted,
      refresh_token_nonce: refresh.nonce,
      refresh_token_auth_tag: refresh.authTag,
      dropbox_email: dropboxEmail,
      connected_at: now,
      updated_at: now,
    }, { onConflict: 'user_id' });

  if (upsertErr) {
    respondHtml(res, 500, 'Couldn\'t save the connection', upsertErr.message, { ok: false, error: 'persist_failed' });
    return;
  }

  respondHtml(res, 200, 'Dropbox connected!', `Connected${dropboxEmail ? ` as ${dropboxEmail}` : ''}. You can close this window.`, {
    ok: true,
    dropbox_email: dropboxEmail,
  });
}

// ---------------- token ----------------

async function handleToken(req: VercelRequest, res: VercelResponse, env: Env) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const supabase = serviceClient(env);
  const userId = await requireUser(req, supabase);
  if (!userId) { res.status(401).json({ error: 'Missing or invalid authorization' }); return; }

  const { data: row, error: rowErr } = await supabase
    .from('user_dropbox_tokens')
    .select('encrypted_refresh_token, refresh_token_nonce, refresh_token_auth_tag, dropbox_email')
    .eq('user_id', userId)
    .maybeSingle();

  if (rowErr) { res.status(500).json({ error: 'Could not load the connection' }); return; }
  if (!row) { res.status(200).json({ connected: false }); return; }

  let refreshToken: string;
  try {
    refreshToken = decrypt(row.encrypted_refresh_token, row.refresh_token_nonce, row.refresh_token_auth_tag, env.masterSecret);
  } catch {
    res.status(500).json({ error: 'Could not decrypt the stored token' });
    return;
  }

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: env.appKey,
    client_secret: env.appSecret,
  });
  const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as DropboxTokenResponse;

  if (!tokenRes.ok || !tokenJson.access_token) {
    // A revoked refresh token surfaces as invalid_grant. Drop the dead
    // row so the client cleanly falls back to the Connect button.
    if (tokenJson.error === 'invalid_grant') {
      await supabase.from('user_dropbox_tokens').delete().eq('user_id', userId);
      res.status(200).json({ connected: false });
      return;
    }
    res.status(502).json({ error: 'Dropbox declined the token refresh' });
    return;
  }

  // Bump updated_at to reflect last use. Best-effort.
  await supabase
    .from('user_dropbox_tokens')
    .update({ updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  res.status(200).json({
    connected: true,
    access_token: tokenJson.access_token,
    expires_in: tokenJson.expires_in ?? 14400,
    dropbox_email: row.dropbox_email ?? null,
  });
}

// ---------------- disconnect ----------------

async function handleDisconnect(req: VercelRequest, res: VercelResponse, env: Env) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const supabase = serviceClient(env);
  const userId = await requireUser(req, supabase);
  if (!userId) { res.status(401).json({ error: 'Missing or invalid authorization' }); return; }

  const { data: row } = await supabase
    .from('user_dropbox_tokens')
    .select('encrypted_refresh_token, refresh_token_nonce, refresh_token_auth_tag')
    .eq('user_id', userId)
    .maybeSingle();

  // Best-effort revoke at Dropbox so the grant is fully torn down.
  // /2/auth/token/revoke takes the token to revoke as the bearer; a
  // refresh token revokes the whole grant.
  if (row) {
    try {
      const refreshToken = decrypt(row.encrypted_refresh_token, row.refresh_token_nonce, row.refresh_token_auth_tag, env.masterSecret);
      const form = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: env.appKey,
        client_secret: env.appSecret,
      });
      const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const tokenJson = (await tokenRes.json().catch(() => ({}))) as DropboxTokenResponse;
      if (tokenJson.access_token) {
        await fetch('https://api.dropboxapi.com/2/auth/token/revoke', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tokenJson.access_token}` },
        });
      }
    } catch { /* non-fatal — we still delete the row below */ }
  }

  await supabase.from('user_dropbox_tokens').delete().eq('user_id', userId);
  res.status(200).json({ ok: true });
}

// ---------------- router ----------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const env = loadEnv();
  const action = queryParam(req, 'action');

  if (!env) {
    if (action === 'callback') {
      respondHtml(res, 500, 'Configuration error', 'The Dropbox connection isn\'t configured on the server yet. Check the env vars in Vercel.', { ok: false, error: 'not_configured' });
    } else {
      res.status(500).json({ error: 'Service not configured (missing one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_TOKEN_ENCRYPTION_SECRET (≥ 32 chars), DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_OAUTH_REDIRECT_URI)' });
    }
    return;
  }

  switch (action) {
    case 'start': return handleStart(req, res, env);
    case 'callback': return handleCallback(req, res, env);
    case 'token': return handleToken(req, res, env);
    case 'disconnect': return handleDisconnect(req, res, env);
    default:
      res.status(404).json({ error: `Unknown action: ${action ?? '(none)'}` });
  }
}
