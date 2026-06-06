// Set / get / remove a user's BYOK API key (Fal or OpenAI). Stored
// encrypted with AES-256-GCM. Provider is selected by the `provider`
// query parameter — defaults to 'fal' for back-compat with the
// original Fal-only client.
//
// Endpoints:
//   GET    /api/media/key?provider=fal|openai           — { has_key, hint }
//   POST   /api/media/key?provider=fal|openai  { key }  — encrypts + stores
//   DELETE /api/media/key?provider=fal|openai           — removes the key
//
// Why merged: Vercel Hobby caps a deployment at 12 serverless
// functions. Splitting Fal and OpenAI into separate files put us at
// 13 and failed the deploy.

import { createClient } from '@supabase/supabase-js';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  end: () => void;
};

type Provider = 'fal' | 'openai' | 'ideogram';

interface ProviderConfig {
  table: 'user_fal_keys' | 'user_openai_keys' | 'user_ideogram_keys';
  scryptSalt: string;
  minLength: number;
  validate: (key: string) => string | null; // returns error message or null if ok
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  fal: {
    table: 'user_fal_keys',
    scryptSalt: 'media-fal-key-v1',
    minLength: 16,
    validate: (k) => (k.length < 16 ? 'Key looks too short — paste the full Fal API key.' : null),
  },
  openai: {
    table: 'user_openai_keys',
    scryptSalt: 'media-openai-key-v1',
    minLength: 20,
    validate: (k) => (k.length < 20 || !k.startsWith('sk-')
      ? 'OpenAI keys start with "sk-" — paste the full secret key from platform.openai.com.'
      : null),
  },
  ideogram: {
    table: 'user_ideogram_keys',
    scryptSalt: 'media-ideogram-key-v1',
    minLength: 20,
    validate: (k) => (k.length < 20 ? 'Ideogram keys are ~40+ chars — paste the full key from ideogram.ai/manage-api.' : null),
  },
};

function authHeader(req: VercelRequest): string | null {
  const raw = req.headers['authorization'] ?? req.headers['Authorization'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.toLowerCase().startsWith('bearer ')) return null;
  return v.slice(7);
}

function queryParam(req: VercelRequest, name: string): string | null {
  const v = req.query?.[name];
  if (Array.isArray(v)) return v[0] ?? null;
  if (typeof v === 'string') return v;
  // Fallback: parse from URL (in case the runtime didn't populate req.query).
  if (req.url) {
    try {
      const u = new URL(req.url, 'http://placeholder.local');
      return u.searchParams.get(name);
    } catch { /* ignore */ }
  }
  return null;
}

function resolveProvider(req: VercelRequest): Provider {
  const raw = queryParam(req, 'provider');
  if (raw === 'openai') return 'openai';
  if (raw === 'ideogram') return 'ideogram';
  return 'fal';
}

function deriveMasterKey(secret: string, salt: string): Buffer {
  return scryptSync(secret, salt, 32);
}

function encryptKey(plain: string, masterSecret: string, salt: string): { encrypted: string; nonce: string; authTag: string } {
  const key = deriveMasterKey(masterSecret, salt);
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

  const provider = resolveProvider(req);
  const cfg = PROVIDERS[provider];

  if (req.method === 'GET') {
    const { data } = await supabase
      .from(cfg.table)
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
    await supabase.from(cfg.table).delete().eq('user_id', userId);
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
  const validationError = cfg.validate(rawKey);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const { encrypted, nonce, authTag } = encryptKey(rawKey, masterSecret, cfg.scryptSalt);
  const hint = rawKey.length > 4 ? `…${rawKey.slice(-4)}` : '…';

  const { error: upErr } = await supabase
    .from(cfg.table)
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
