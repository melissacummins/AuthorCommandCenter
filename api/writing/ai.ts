// Writing AI endpoint (bring-your-own-key, two providers). One Vercel
// function, action-routed, folding key management for both providers plus
// completions into a single file — same reasoning as api/planner/ai.ts and
// api/audiobook/index.ts (deployments cap the number of serverless functions).
//
// Provider 1: Anthropic — reuses user_anthropic_keys, the exact table and
// salt api/planner/ai.ts already writes to, so a customer who set their
// Claude key in Settings for the Planner also has it here for free.
// Provider 2: OpenRouter — new user_openrouter_keys table, same encryption
// secret, different salt. OpenRouter's single OpenAI-compatible endpoint
// lets any customer of the (sellable) Command Center bring whichever model
// they want with one key, not just Anthropic's.
//
// Routes (all require the caller's Supabase bearer token):
//   GET    /api/writing/ai?action=key&provider=anthropic|openrouter
//                                               — { has_key, hint, updated_at }
//   POST   /api/writing/ai?action=key&provider=… { key } — encrypt + store
//   DELETE /api/writing/ai?action=key&provider=… — remove the stored key
//   POST   /api/writing/ai { provider, prompt, system?, model?, max_tokens? }
//                                               — complete using that provider's key
//
// Required env vars on Vercel:
//   ANTHROPIC_KEY_ENCRYPTION_SECRET - same secret the planner uses (encrypts/decrypts both key tables)
//   SUPABASE_URL                    - same as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY       - server-side only, verifies the caller
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export const maxDuration = 60;

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

type Provider = 'anthropic' | 'openrouter';

// Anthropic — reuse exactly what the planner stores so the user only enters
// their Claude key once. Table + salt MUST match api/planner/ai.ts.
const ANTHROPIC_KEY_TABLE = 'user_anthropic_keys';
const ANTHROPIC_KEY_SALT = 'planner-anthropic-key-v1';
const ANTHROPIC_ALLOWED_MODELS = new Set(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8']);
const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-6';

// OpenRouter — its own table, same master secret, different salt.
const OPENROUTER_KEY_TABLE = 'user_openrouter_keys';
const OPENROUTER_KEY_SALT = 'writing-openrouter-key-v1';
const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';

const MAX_OUTPUT_TOKENS = 4096;

function bearer(req: VercelRequest): string | null {
  const raw = req.headers['authorization'] ?? req.headers['Authorization'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.toLowerCase().startsWith('bearer ')) return null;
  return v.slice(7);
}

function headerValue(req: VercelRequest, name: string): string | null {
  const v = req.headers[name];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
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

function deriveKey(secret: string, salt: string): Buffer { return scryptSync(secret, salt, 32); }

function encryptKey(plain: string, secret: string, salt: string): { encrypted: string; nonce: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { encrypted: ciphertext.toString('base64'), nonce: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

function decryptKey(row: { encrypted_key: string; nonce: string; auth_tag: string }, secret: string, salt: string): string | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, salt), Buffer.from(row.nonce, 'base64'));
    decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.encrypted_key, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
}

async function resolveStoredKey(supabase: SupabaseClient, table: string, userId: string, secret: string, salt: string): Promise<string | null> {
  const { data } = await supabase.from(table).select('encrypted_key, nonce, auth_tag').eq('user_id', userId).maybeSingle();
  if (!data?.encrypted_key || !data.nonce || !data.auth_tag) return null;
  return decryptKey(data, secret, salt);
}

function providerConfig(provider: Provider) {
  return provider === 'anthropic'
    ? { table: ANTHROPIC_KEY_TABLE, salt: ANTHROPIC_KEY_SALT, prefix: 'sk-ant-', name: 'Anthropic' }
    : { table: OPENROUTER_KEY_TABLE, salt: OPENROUTER_KEY_SALT, prefix: 'sk-or-', name: 'OpenRouter' };
}

async function callAnthropic(apiKey: string, prompt: string, system: string | undefined, model: string | undefined, maxTokens: number) {
  const finalModel = model && ANTHROPIC_ALLOWED_MODELS.has(model) ? model : ANTHROPIC_DEFAULT_MODEL;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: finalModel,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    return { ok: false as const, status: r.status === 401 ? 400 : 502, error: r.status === 401
      ? 'Your Anthropic key was rejected — check it in Settings → API Keys.'
      : `Claude request failed (${r.status}).`, detail: detail.slice(0, 500) };
  }
  const data = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim();
  return { ok: true as const, text, model: finalModel };
}

async function callOpenRouter(
  apiKey: string, prompt: string, system: string | undefined, model: string | undefined, maxTokens: number, referer: string,
) {
  const finalModel = model?.trim() || OPENROUTER_DEFAULT_MODEL;
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: prompt },
  ];
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'http-referer': referer,
      'x-title': 'Author Command Center — Writing',
    },
    body: JSON.stringify({ model: finalModel, messages, max_tokens: maxTokens }),
  });
  if (!r.ok) {
    const detail = await r.text();
    return { ok: false as const, status: r.status === 401 ? 400 : 502, error: r.status === 401
      ? 'Your OpenRouter key was rejected — check it in Settings → API Keys.'
      : `OpenRouter request failed (${r.status}).`, detail: detail.slice(0, 500) };
  }
  const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (data.error) return { ok: false as const, status: 502, error: data.error.message || 'OpenRouter returned an error.' };
  const text = (data.choices?.[0]?.message?.content ?? '').trim();
  return { ok: true as const, text, model: finalModel };
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

  const action = queryParam(req, 'action') ?? '';

  // ---- Key management (action=key&provider=…) ----
  if (action === 'key') {
    const providerParam = queryParam(req, 'provider');
    if (providerParam !== 'anthropic' && providerParam !== 'openrouter') {
      res.status(400).json({ error: 'Missing or invalid provider (expected "anthropic" or "openrouter").' });
      return;
    }
    const { table, salt, prefix, name } = providerConfig(providerParam);

    if (req.method === 'GET') {
      const { data } = await supabase.from(table).select('key_hint, updated_at').eq('user_id', userId).maybeSingle();
      res.status(200).json({ has_key: !!data, hint: data?.key_hint ?? null, updated_at: data?.updated_at ?? null });
      return;
    }
    if (req.method === 'DELETE') {
      await supabase.from(table).delete().eq('user_id', userId);
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method === 'POST') {
      const rawKey = (() => { const b = parseBody<{ key?: unknown }>(req); return typeof b.key === 'string' ? b.key.trim() : ''; })();
      if (!rawKey.startsWith(prefix) || rawKey.length < 20) {
        res.status(400).json({ error: `${name} keys start with "${prefix}" — paste the full key.` });
        return;
      }
      const { encrypted, nonce, authTag } = encryptKey(rawKey, masterSecret, salt);
      const hint = `…${rawKey.slice(-4)}`;
      const { error: upErr } = await supabase.from(table).upsert({
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

  const body = parseBody<{ provider?: unknown; prompt?: unknown; system?: unknown; model?: unknown; max_tokens?: unknown }>(req);
  const provider: Provider = body.provider === 'openrouter' ? 'openrouter' : 'anthropic';
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) { res.status(400).json({ error: 'Missing prompt.' }); return; }
  const system = typeof body.system === 'string' ? body.system : undefined;
  const model = typeof body.model === 'string' ? body.model : undefined;
  const maxTokens = Math.min(Math.max(Number(body.max_tokens) || 1024, 64), MAX_OUTPUT_TOKENS);

  const { table, salt, name } = providerConfig(provider);
  const apiKey = await resolveStoredKey(supabase, table, userId, masterSecret, salt);
  if (!apiKey) {
    res.status(412).json({ error: `No ${name} API key on file — add yours in Settings → API Keys to use AI features.` });
    return;
  }

  try {
    const result = provider === 'anthropic'
      ? await callAnthropic(apiKey, prompt, system, model, maxTokens)
      : await callOpenRouter(apiKey, prompt, system, model, maxTokens, headerValue(req, 'origin') || `https://${headerValue(req, 'host') || 'author-command-center.app'}`);
    if (!result.ok) { res.status(result.status).json({ error: result.error, detail: 'detail' in result ? result.detail : undefined }); return; }
    res.status(200).json({ text: result.text, model: result.model });
  } catch (e) {
    res.status(502).json({ error: (e as Error)?.message ?? `Could not reach ${name}.` });
  }
}
