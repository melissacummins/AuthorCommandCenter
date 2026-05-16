// Set or remove a user's Fal.AI API key. Stored encrypted with
// AES-256-GCM using a master secret from FAL_KEY_ENCRYPTION_SECRET.
// The encryption key is derived once via scrypt with a fixed salt —
// the secret itself is the entropy.
//
// Endpoints:
//   POST   /api/media/key  { key: string }   — encrypts and stores
//   DELETE /api/media/key                    — removes the user's key
//   GET    /api/media/key                    — returns { has_key, hint }

import { createClient } from '@supabase/supabase-js';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
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
  return scryptSync(secret, 'media-fal-key-v1', 32);
}

function encryptKey(plain: string, masterSecret: string): { encrypted: string; nonce: string; authTag: string } {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const masterSecret = process.env.FAL_KEY_ENCRYPTION_SECRET;
  if (!supabaseUrl || !serviceKey || !masterSecret) {
    res.status(500).json({ error: 'Service not configured (missing FAL_KEY_ENCRYPTION_SECRET, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY)' });
    return;
  }
  if (masterSecret.length < 32) {
    res.status(500).json({ error: 'FAL_KEY_ENCRYPTION_SECRET must be at least 32 characters' });
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

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('user_fal_keys')
      .select('key_hint, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    res.status(200).json({
      has_key: !!data,
      hint: data?.key_hint ?? null,
      updated_at: data?.updated_at ?? null,
    });
    return;
  }

  if (req.method === 'DELETE') {
    await supabase.from('user_fal_keys').delete().eq('user_id', userId);
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body: { key?: unknown };
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as { key?: unknown };
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const rawKey = typeof body?.key === 'string' ? body.key.trim() : '';
  if (rawKey.length < 16) {
    res.status(400).json({ error: 'Key looks too short — paste the full Fal API key.' });
    return;
  }

  const { encrypted, nonce, authTag } = encryptKey(rawKey, masterSecret);
  const hint = rawKey.length > 4 ? `…${rawKey.slice(-4)}` : '…';

  const { error: upErr } = await supabase
    .from('user_fal_keys')
    .upsert({
      user_id: userId,
      encrypted_key: encrypted,
      nonce,
      auth_tag: authTag,
      key_hint: hint,
      updated_at: new Date().toISOString(),
    });

  if (upErr) {
    res.status(500).json({ error: 'Failed to save key', detail: upErr.message });
    return;
  }

  res.status(200).json({ ok: true, hint });
}
