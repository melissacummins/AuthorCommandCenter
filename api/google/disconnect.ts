// Disconnects Google Calendar for the authenticated caller. Best-effort
// revokes the refresh token at Google, then deletes the stored row so
// the client returns to a clean, unconnected state.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GOOGLE_TOKEN_ENCRYPTION_SECRET   — master secret, ≥ 32 chars

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const masterSecret = process.env.GOOGLE_TOKEN_ENCRYPTION_SECRET;

  if (!supabaseUrl || !serviceKey || !masterSecret) {
    res.status(500).json({ error: 'Service not configured (missing one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_TOKEN_ENCRYPTION_SECRET)' });
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

  const { data: row } = await supabase
    .from('user_google_tokens')
    .select('encrypted_refresh_token, refresh_token_nonce, refresh_token_auth_tag')
    .eq('user_id', userId)
    .maybeSingle();

  // Best-effort revoke at Google so the grant is fully torn down.
  if (row) {
    try {
      const refreshToken = decrypt(row.encrypted_refresh_token, row.refresh_token_nonce, row.refresh_token_auth_tag, masterSecret);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch { /* non-fatal — we still delete the row below */ }
  }

  await supabase.from('user_google_tokens').delete().eq('user_id', userId);

  res.status(200).json({ ok: true });
}
