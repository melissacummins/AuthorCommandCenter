// Mints a short-lived Google access token for the authenticated caller.
//
// The browser calls this whenever it needs to hit the Calendar REST API.
// We load the caller's stored (encrypted) refresh token, decrypt it
// server-side, and exchange it for a fresh access token. The refresh
// token and client_secret NEVER leave the server — the client only ever
// receives the short-lived access token.
//
// Also doubles as the connection-status probe: with no stored row it
// returns { connected: false } so the planner can render the Connect
// button without prompting.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GOOGLE_TOKEN_ENCRYPTION_SECRET   — master secret, ≥ 32 chars
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET

import { createClient } from '@supabase/supabase-js';
import { createDecipheriv, scryptSync } from 'node:crypto';

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  end: () => void;
};

function authHeader(req: VercelRequest): string | null {
  const raw = req.headers['authorization'] ?? req.headers['Authorization'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.toLowerCase().startsWith('bearer ')) return null;
  return v.slice(7);
}

function deriveMasterKey(secret: string): Buffer {
  return scryptSync(secret, 'google-token-key-v1', 32);
}

function decrypt(encrypted: string, nonce: string, authTag: string, masterSecret: string): string {
  const key = deriveMasterKey(masterSecret);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
  return plain.toString('utf8');
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const masterSecret = process.env.GOOGLE_TOKEN_ENCRYPTION_SECRET;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!supabaseUrl || !serviceKey || !masterSecret || !clientId || !clientSecret) {
    res.status(500).json({ error: 'Service not configured (missing one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_TOKEN_ENCRYPTION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)' });
    return;
  }

  const token = authHeader(req);
  if (!token) {
    res.status(401).json({ error: 'Missing authorization' });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  const userId = userData.user.id;

  const { data: row, error: rowErr } = await supabase
    .from('user_google_tokens')
    .select('encrypted_refresh_token, refresh_token_nonce, refresh_token_auth_tag, google_email')
    .eq('user_id', userId)
    .maybeSingle();

  if (rowErr) {
    res.status(500).json({ error: 'Could not load the connection' });
    return;
  }
  if (!row) {
    res.status(200).json({ connected: false });
    return;
  }

  let refreshToken: string;
  try {
    refreshToken = decrypt(row.encrypted_refresh_token, row.refresh_token_nonce, row.refresh_token_auth_tag, masterSecret);
  } catch {
    res.status(500).json({ error: 'Could not decrypt the stored token' });
    return;
  }

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as GoogleTokenResponse;

  if (!tokenRes.ok || !tokenJson.access_token) {
    // A revoked/expired refresh token surfaces as invalid_grant. Drop the
    // dead row so the client cleanly falls back to the Connect button.
    if (tokenJson.error === 'invalid_grant') {
      await supabase.from('user_google_tokens').delete().eq('user_id', userId);
      res.status(200).json({ connected: false });
      return;
    }
    res.status(502).json({ error: 'Google declined the token refresh' });
    return;
  }

  // Bump updated_at to reflect last use. Best-effort.
  await supabase
    .from('user_google_tokens')
    .update({ updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  res.status(200).json({
    connected: true,
    access_token: tokenJson.access_token,
    expires_in: tokenJson.expires_in ?? 3600,
    google_email: row.google_email ?? null,
  });
}
