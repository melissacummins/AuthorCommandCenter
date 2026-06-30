// Planner AI endpoint (bring-your-own-key). Each user stores their own
// Anthropic API key, encrypted at rest; this one function both manages that key
// and runs completions with the caller's key — so no platform Claude key is
// needed and every customer is billed for their own usage.
//
// Routes (all require the caller's Supabase bearer token):
//   GET    /api/planner/ai?action=key          — { has_key, hint, updated_at }
//   POST   /api/planner/ai?action=key  { key }  — encrypt + store the user's key
//   DELETE /api/planner/ai?action=key           — remove the user's key
//   POST   /api/planner/ai  { prompt, system?, model?, max_tokens? }
//                                               — complete using the user's key
//
// Folded into a single file on purpose: Vercel caps serverless functions per
// deployment, and we're already near the limit.
//
// Required env vars on Vercel:
//   ANTHROPIC_KEY_ENCRYPTION_SECRET - random 32+ char secret (encrypts stored keys)
//   SUPABASE_URL                    - same as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY       - server-side only, verifies the caller
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

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

const KEY_TABLE = 'user_anthropic_keys';
const KEY_SALT = 'planner-anthropic-key-v1';

const ALLOWED_MODELS = new Set(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8']);
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_OUTPUT_TOKENS = 4096;

function bearer(req: VercelRequest): string | null {
  const raw = req.headers['authorization'] ?? req.headers['Authorization'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.toLowerCase().startsWith('bearer ')) return null;
  return v.slice(7);
}

function queryParam(req: VercelRequest, name: string): string | null {
  const v = req.query?.[name];
  if (Array.isArray(v)) return v[0] ?? null;
  if (typeof v === 'string') return v;
  if (req.url) {
    try { return new URL(req.url, 'http://placeholder.local').searchParams.get(name); } catch { /* ignore */ }
  }
  return null;
}

function parseBody<T>(req: VercelRequest): T {
  try { return (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as T; }
  catch { return {} as T; }
}

function deriveKey(secret: string): Buffer { return scryptSync(secret, KEY_SALT, 32); }

function encryptKey(plain: string, secret: string): { encrypted: string; nonce: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { encrypted: ciphertext.toString('base64'), nonce: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

function decryptKey(row: { encrypted_key: string; nonce: string; auth_tag: string }, secret: string): string | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(row.nonce, 'base64'));
    decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.encrypted_key, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
}

async function resolveUserKey(supabase: SupabaseClient, userId: string, secret: string): Promise<string | null> {
  const { data } = await supabase.from(KEY_TABLE).select('encrypted_key, nonce, auth_tag').eq('user_id', userId).maybeSingle();
  if (!data?.encrypted_key || !data.nonce || !data.auth_tag) return null;
  return decryptKey(data, secret);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const masterSecret = process.env.ANTHROPIC_KEY_ENCRYPTION_SECRET;
  if (!supabaseUrl || !serviceKey || !masterSecret) {
    res.status(500).json({ error: 'Service not configured (missing ANTHROPIC_KEY_ENCRYPTION_SECRET, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY).' });
    return;
  }
  if (masterSecret.length < 32) { res.status(500).json({ error: 'ANTHROPIC_KEY_ENCRYPTION_SECRET must be at least 32 characters.' }); return; }

  const token = bearer(req);
  if (!token) { res.status(401).json({ error: 'Missing authorization.' }); return; }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) { res.status(401).json({ error: 'Invalid session.' }); return; }
  const userId = userData.user.id;

  // ---- Key management (action=key) ----
  if (queryParam(req, 'action') === 'key') {
    if (req.method === 'GET') {
      const { data } = await supabase.from(KEY_TABLE).select('key_hint, updated_at').eq('user_id', userId).maybeSingle();
      res.status(200).json({ has_key: !!data, hint: data?.key_hint ?? null, updated_at: data?.updated_at ?? null });
      return;
    }
    if (req.method === 'DELETE') {
      await supabase.from(KEY_TABLE).delete().eq('user_id', userId);
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method === 'POST') {
      const rawKey = (() => { const b = parseBody<{ key?: unknown }>(req); return typeof b.key === 'string' ? b.key.trim() : ''; })();
      if (!rawKey.startsWith('sk-ant-') || rawKey.length < 20) {
        res.status(400).json({ error: 'Anthropic keys start with "sk-ant-" — paste the full key from console.anthropic.com.' });
        return;
      }
      const { encrypted, nonce, authTag } = encryptKey(rawKey, masterSecret);
      const hint = `…${rawKey.slice(-4)}`;
      const { error: upErr } = await supabase.from(KEY_TABLE).upsert({
        user_id: userId, encrypted_key: encrypted, nonce, auth_tag: authTag, key_hint: hint, updated_at: new Date().toISOString(),
      });
      if (upErr) { res.status(500).json({ error: 'Failed to save key.', detail: upErr.message }); return; }
      res.status(200).json({ ok: true, hint });
      return;
    }
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  // ---- Completion ----
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }

  const apiKey = await resolveUserKey(supabase, userId, masterSecret);
  if (!apiKey) {
    res.status(412).json({ error: 'No Anthropic API key on file — add yours in Settings → AI assistant to use AI features.' });
    return;
  }

  const body = parseBody<{
    prompt?: string; system?: string; model?: string; max_tokens?: number;
    images?: Array<{ data?: unknown; media_type?: unknown }>;
  }>(req);
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  // Optional vision input: photos to transcribe (e.g. a handwritten weekly
  // reset). Capped so the request body stays within serverless limits.
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter(i => i && typeof i.data === 'string')
    .slice(0, 8)
    .map(i => ({ data: i.data as string, media_type: typeof i.media_type === 'string' ? i.media_type : 'image/jpeg' }));
  if (!prompt && images.length === 0) { res.status(400).json({ error: 'Missing prompt.' }); return; }
  const model = body.model && ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
  const maxTokens = Math.min(Math.max(Number(body.max_tokens) || 1024, 64), MAX_OUTPUT_TOKENS);

  // Text-only stays a plain string; with images we send a content-block array
  // (images first, then the instruction) per Anthropic's vision format.
  const content = images.length === 0
    ? prompt
    : [
        ...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } })),
        { type: 'text', text: prompt || 'Transcribe this image.' },
      ];

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(body.system ? { system: body.system } : {}),
        messages: [{ role: 'user', content }],
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      // 401 from Anthropic means the user's stored key is bad/revoked.
      const msg = r.status === 401
        ? 'Your Anthropic key was rejected — check it in Settings → AI assistant.'
        : `Claude request failed (${r.status}).`;
      res.status(r.status === 401 ? 400 : 502).json({ error: msg, detail: detail.slice(0, 500) });
      return;
    }
    const data = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim();
    res.status(200).json({ text, model });
  } catch (e) {
    res.status(502).json({ error: (e as Error)?.message ?? 'Could not reach Claude.' });
  }
}
