// Kicks off Pinterest OAuth 2.0 for the authenticated caller.
// Returns the redirect URL the browser should send the user to.
//
// We use a stateless signed `state` parameter
// (base64(payload) + "." + HMAC) so the callback can verify the flow
// belongs to this user without us needing a server-side session
// store. The payload carries the user id and a random nonce, signed
// with HMAC-SHA256 using SOCIAL_TOKEN_ENCRYPTION_SECRET.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SOCIAL_TOKEN_ENCRYPTION_SECRET   — master secret, ≥ 32 chars
//   PINTEREST_CLIENT_ID
//   PINTEREST_REDIRECT_URI           — must match the Pinterest dev portal exactly

import { createClient } from '@supabase/supabase-js';
import { createHmac, randomBytes } from 'node:crypto';

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

const PINTEREST_SCOPES = [
  'pins:read',
  'boards:read',
  'user_accounts:read',
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stateSecret = process.env.SOCIAL_TOKEN_ENCRYPTION_SECRET;
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const redirectUri = process.env.PINTEREST_REDIRECT_URI;

  if (!supabaseUrl || !serviceKey || !stateSecret || !clientId || !redirectUri) {
    res.status(500).json({ error: 'Service not configured (missing one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SOCIAL_TOKEN_ENCRYPTION_SECRET, PINTEREST_CLIENT_ID, PINTEREST_REDIRECT_URI)' });
    return;
  }
  if (stateSecret.length < 32) {
    res.status(500).json({ error: 'SOCIAL_TOKEN_ENCRYPTION_SECRET must be at least 32 characters' });
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

  const payload = {
    user_id: userId,
    nonce: randomBytes(16).toString('base64url'),
    issued_at: Math.floor(Date.now() / 1000),
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const signature = createHmac('sha256', stateSecret).update(payloadB64).digest('base64url');
  const state = `${payloadB64}.${signature}`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: PINTEREST_SCOPES.join(','),
    state,
  });

  const authorizeUrl = `https://www.pinterest.com/oauth/?${params.toString()}`;
  res.status(200).json({ authorize_url: authorizeUrl });
}
