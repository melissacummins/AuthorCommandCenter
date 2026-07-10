// Writing AI endpoint (bring-your-own-key, three providers). One Vercel
// function, action-routed, folding key management, dynamic model lists, and
// completions into a single file — same reasoning as api/planner/ai.ts and
// api/audiobook/index.ts (deployments cap the number of serverless functions).
//
// Provider 1: Anthropic — reuses user_anthropic_keys, the exact table and
// salt api/planner/ai.ts already writes to, so a customer who set their
// Claude key in Settings for the Planner also has it here for free.
// Provider 2: OpenRouter — user_openrouter_keys table, same encryption
// secret, different salt. OpenRouter's single OpenAI-compatible endpoint
// lets any customer of the (sellable) Command Center bring whichever model
// they want with one key, not just Anthropic's.
// Provider 3: OpenAI — reuses user_openai_keys (Media module). Encrypted
// with a DIFFERENT master secret/salt pair (FAL_KEY_ENCRYPTION_SECRET +
// 'media-openai-key-v1' — see api/media/key.ts) than the Anthropic/OpenRouter
// tables. Do not read this table with ANTHROPIC_KEY_ENCRYPTION_SECRET.
//
// Routes (all require the caller's Supabase bearer token):
//   GET    /api/writing/ai?action=key&provider=anthropic|openrouter
//                                               — { has_key, hint, updated_at }
//   POST   /api/writing/ai?action=key&provider=… { key } — encrypt + store
//   DELETE /api/writing/ai?action=key&provider=… — remove the stored key
//   GET    /api/writing/ai?action=models&provider=anthropic|openai
//                                               — [{ id, name }] proxied from the provider using the caller's own key
//   POST   /api/writing/ai { provider, prompt, system?, model?, max_tokens?,
//                             temperature?, top_p?, frequency_penalty?,
//                             presence_penalty?, repetition_penalty?,
//                             reasoning_effort?, caching? }
//                                               — complete using that provider's key
//
// Required env vars on Vercel:
//   ANTHROPIC_KEY_ENCRYPTION_SECRET - same secret the planner uses (encrypts/decrypts the anthropic + openrouter key tables)
//   FAL_KEY_ENCRYPTION_SECRET       - same secret the Media module uses (decrypts user_openai_keys — see api/media/key.ts)
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

type Provider = 'anthropic' | 'openrouter' | 'openai';
type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// Anthropic — reuse exactly what the planner stores so the user only enters
// their Claude key once. Table + salt MUST match api/planner/ai.ts.
const ANTHROPIC_KEY_TABLE = 'user_anthropic_keys';
const ANTHROPIC_KEY_SALT = 'planner-anthropic-key-v1';
const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-6';

// OpenRouter — its own table, same master secret as Anthropic, different salt.
const OPENROUTER_KEY_TABLE = 'user_openrouter_keys';
const OPENROUTER_KEY_SALT = 'writing-openrouter-key-v1';
const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';

// OpenAI — reuses the Media module's table, but that table is encrypted with
// a DIFFERENT master secret/salt pair. See api/media/key.ts PROVIDERS.openai.
const OPENAI_KEY_TABLE = 'user_openai_keys';
const OPENAI_KEY_SALT = 'media-openai-key-v1';
const OPENAI_DEFAULT_MODEL = 'gpt-4.1';

const MAX_OUTPUT_TOKENS = 4096;
const MAX_MODEL_ID_LENGTH = 100;

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

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
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

// Which env var holds the master secret for each provider's key table —
// OpenAI's is intentionally different from Anthropic/OpenRouter's (§8.7).
function providerConfig(provider: Provider) {
  if (provider === 'anthropic') return { table: ANTHROPIC_KEY_TABLE, salt: ANTHROPIC_KEY_SALT, secretEnv: 'ANTHROPIC_KEY_ENCRYPTION_SECRET', prefix: 'sk-ant-', name: 'Anthropic' };
  if (provider === 'openrouter') return { table: OPENROUTER_KEY_TABLE, salt: OPENROUTER_KEY_SALT, secretEnv: 'ANTHROPIC_KEY_ENCRYPTION_SECRET', prefix: 'sk-or-', name: 'OpenRouter' };
  return { table: OPENAI_KEY_TABLE, salt: OPENAI_KEY_SALT, secretEnv: 'FAL_KEY_ENCRYPTION_SECRET', prefix: 'sk-', name: 'OpenAI' };
}

// Sonnet 4.6 / Opus 4.6 (and Haiku) still accept temperature/top_p; Sonnet 5,
// Opus 4.7/4.8, Fable 5, and any unlisted/future dated id reject them (400).
// Directive §8.5 — defaults conservatively (strip) for unlisted models.
function anthropicRejectsSampling(model: string): boolean {
  const m = model.toLowerCase();
  if (/sonnet-4-6|opus-4-6/.test(m)) return false;
  if (/haiku/.test(m)) return false;
  return true;
}

function isOpenAiReasoningModel(model: string): boolean {
  return /^o\d|^gpt-5/i.test(model.trim());
}

interface GenParams {
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  reasoningEffort?: ReasoningEffort;
  cachingEnabled?: boolean;
}

async function callAnthropic(apiKey: string, prompt: string, system: string | undefined, model: string | undefined, maxTokens: number, params: GenParams) {
  const finalModel = model && model.trim() && model.trim().length <= MAX_MODEL_ID_LENGTH ? model.trim() : ANTHROPIC_DEFAULT_MODEL;
  const body: Record<string, unknown> = {
    model: finalModel,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) {
    body.system = params.cachingEnabled
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : system;
  }
  // Server strips defensively too, so a stale client can't 400 the request.
  if (!anthropicRejectsSampling(finalModel)) {
    if (params.temperature != null) body.temperature = params.temperature;
    if (params.topP != null) body.top_p = params.topP;
  }
  if (params.reasoningEffort) {
    body.output_config = { effort: params.reasoningEffort };
    // budget_tokens is removed on modern models (400) — effort only, no
    // token-budget knob. Fable is always-reasoning: omit `thinking` there.
    if (!finalModel.toLowerCase().includes('fable')) {
      body.thinking = { type: 'adaptive' };
    }
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text();
    return { ok: false as const, status: r.status === 401 ? 400 : 502, error: r.status === 401
      ? 'Your Anthropic key was rejected — check it in Settings → API Keys.'
      : `Claude request failed (${r.status}).`, detail: detail.slice(0, 500) };
  }
  const data = (await r.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  };
  if (data.usage?.cache_read_input_tokens) {
    console.log('[writing/ai] anthropic cache_read_input_tokens', data.usage.cache_read_input_tokens);
  }
  const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim();
  return { ok: true as const, text, model: finalModel };
}

async function callOpenAi(apiKey: string, prompt: string, system: string | undefined, model: string | undefined, maxTokens: number, params: GenParams) {
  const finalModel = model && model.trim() && model.trim().length <= MAX_MODEL_ID_LENGTH ? model.trim() : OPENAI_DEFAULT_MODEL;
  const reasoning = isOpenAiReasoningModel(finalModel);
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: prompt },
  ];
  const body: Record<string, unknown> = { model: finalModel, messages, max_completion_tokens: maxTokens };
  if (!reasoning) {
    if (params.temperature != null) body.temperature = params.temperature;
    if (params.topP != null) body.top_p = params.topP;
    if (params.frequencyPenalty != null) body.frequency_penalty = params.frequencyPenalty;
    if (params.presencePenalty != null) body.presence_penalty = params.presencePenalty;
  } else if (params.reasoningEffort) {
    body.reasoning_effort = params.reasoningEffort;
  }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text();
    return { ok: false as const, status: r.status === 401 ? 400 : 502, error: r.status === 401
      ? 'Your OpenAI key was rejected — check it in Settings → API Keys.'
      : `OpenAI request failed (${r.status}).`, detail: detail.slice(0, 500) };
  }
  const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (data.error) return { ok: false as const, status: 502, error: data.error.message || 'OpenAI returned an error.' };
  const text = (data.choices?.[0]?.message?.content ?? '').trim();
  return { ok: true as const, text, model: finalModel };
}

async function callOpenRouter(
  apiKey: string, prompt: string, system: string | undefined, model: string | undefined, maxTokens: number, referer: string, params: GenParams,
) {
  const finalModel = model?.trim() && model.trim().length <= MAX_MODEL_ID_LENGTH ? model.trim() : OPENROUTER_DEFAULT_MODEL;
  const isAnthropicModel = finalModel.startsWith('anthropic/');
  const messages = [
    ...(system
      ? [{ role: 'system', content: params.cachingEnabled && isAnthropicModel
          ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
          : system }]
      : []),
    { role: 'user', content: prompt },
  ];
  const body: Record<string, unknown> = { model: finalModel, messages, max_tokens: maxTokens };
  if (params.temperature != null) body.temperature = params.temperature;
  if (params.topP != null) body.top_p = params.topP;
  if (params.frequencyPenalty != null) body.frequency_penalty = params.frequencyPenalty;
  if (params.presencePenalty != null) body.presence_penalty = params.presencePenalty;
  if (params.repetitionPenalty != null) body.repetition_penalty = params.repetitionPenalty;
  if (params.reasoningEffort) body.reasoning = { effort: params.reasoningEffort };
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'http-referer': referer,
      'x-title': 'Author Command Center — Writing',
    },
    body: JSON.stringify(body),
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

// OpenAI's /v1/models returns every model on the account, including
// embeddings/audio/image/moderation ids that can't take a chat completion.
const OPENAI_CHAT_ID_RE = /^(gpt-|o\d|chatgpt-)/i;
const OPENAI_EXCLUDE_RE = /(embedding|whisper|tts|dall-e|moderation|realtime|audio|image|davinci|babbage|ada-)/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicSecret = process.env.ANTHROPIC_KEY_ENCRYPTION_SECRET;
  if (!supabaseUrl || !serviceKey || !anthropicSecret) {
    res.status(500).json({ error: 'Service not configured (missing ANTHROPIC_KEY_ENCRYPTION_SECRET, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY).' });
    return;
  }
  if (anthropicSecret.length < 32) { res.status(500).json({ error: 'ANTHROPIC_KEY_ENCRYPTION_SECRET must be at least 32 characters.' }); return; }

  const token = bearer(req);
  if (!token) { res.status(401).json({ error: 'Missing authorization.' }); return; }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) { res.status(401).json({ error: 'Invalid session.' }); return; }
  const userId = userData.user.id;

  const action = queryParam(req, 'action') ?? '';

  // ---- Key management (action=key&provider=…) — anthropic/openrouter only.
  // OpenAI reuses the Media module's key row/UI; nothing to manage here. ----
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
      const { encrypted, nonce, authTag } = encryptKey(rawKey, anthropicSecret, salt);
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

  // ---- Dynamic model lists (action=models&provider=…) — anthropic/openai,
  // proxied using the caller's own key. OpenRouter's list is public and
  // fetched client-side instead. ----
  if (action === 'models') {
    const providerParam = queryParam(req, 'provider');
    if (providerParam !== 'anthropic' && providerParam !== 'openai') {
      res.status(400).json({ error: 'Missing or invalid provider (expected "anthropic" or "openai").' });
      return;
    }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed.' }); return; }

    const { table, salt, secretEnv, name } = providerConfig(providerParam);
    const secret = process.env[secretEnv];
    if (!secret) { res.status(500).json({ error: `Service not configured (missing ${secretEnv}).` }); return; }

    const apiKey = await resolveStoredKey(supabase, table, userId, secret, salt);
    if (!apiKey) {
      res.status(412).json({ error: `No ${name} API key on file — add yours in Settings → API Keys to browse models.` });
      return;
    }

    try {
      if (providerParam === 'anthropic') {
        const r = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        });
        if (!r.ok) { res.status(r.status === 401 ? 400 : 502).json({ error: r.status === 401 ? 'Your Anthropic key was rejected.' : 'Could not load Anthropic models.' }); return; }
        const data = await r.json() as { data?: Array<{ id?: string; display_name?: string }> };
        const models = (data.data ?? [])
          .filter((m): m is { id: string; display_name?: string } => typeof m.id === 'string')
          .map(m => ({ id: m.id, name: m.display_name || m.id }));
        res.status(200).json(models);
        return;
      }
      const r = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${apiKey}` } });
      if (!r.ok) { res.status(r.status === 401 ? 400 : 502).json({ error: r.status === 401 ? 'Your OpenAI key was rejected.' : 'Could not load OpenAI models.' }); return; }
      const data = await r.json() as { data?: Array<{ id?: string }> };
      const models = (data.data ?? [])
        .filter((m): m is { id: string } => typeof m.id === 'string')
        .filter(m => OPENAI_CHAT_ID_RE.test(m.id) && !OPENAI_EXCLUDE_RE.test(m.id))
        .map(m => ({ id: m.id, name: m.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
      res.status(200).json(models);
    } catch (e) {
      res.status(502).json({ error: (e as Error)?.message ?? `Could not reach ${name}.` });
    }
    return;
  }

  // ---- Completion ----
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }

  const body = parseBody<{
    provider?: unknown; prompt?: unknown; system?: unknown; model?: unknown; max_tokens?: unknown;
    temperature?: unknown; top_p?: unknown; frequency_penalty?: unknown; presence_penalty?: unknown;
    repetition_penalty?: unknown; reasoning_effort?: unknown; caching?: unknown;
  }>(req);
  const provider: Provider = body.provider === 'openrouter' ? 'openrouter' : body.provider === 'openai' ? 'openai' : 'anthropic';
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) { res.status(400).json({ error: 'Missing prompt.' }); return; }
  const system = typeof body.system === 'string' ? body.system : undefined;
  const model = typeof body.model === 'string' ? body.model : undefined;
  const maxTokens = Math.min(Math.max(Number(body.max_tokens) || 1024, 64), MAX_OUTPUT_TOKENS);
  const reasoningEffort = typeof body.reasoning_effort === 'string' && ['low', 'medium', 'high', 'xhigh', 'max'].includes(body.reasoning_effort)
    ? body.reasoning_effort as ReasoningEffort
    : undefined;
  const params: GenParams = {
    temperature: numberOrUndefined(body.temperature),
    topP: numberOrUndefined(body.top_p),
    frequencyPenalty: numberOrUndefined(body.frequency_penalty),
    presencePenalty: numberOrUndefined(body.presence_penalty),
    repetitionPenalty: numberOrUndefined(body.repetition_penalty),
    reasoningEffort,
    cachingEnabled: body.caching === true,
  };

  const { table, salt, secretEnv, name } = providerConfig(provider);
  const secret = process.env[secretEnv];
  if (!secret) { res.status(500).json({ error: `Service not configured (missing ${secretEnv}).` }); return; }
  const apiKey = await resolveStoredKey(supabase, table, userId, secret, salt);
  if (!apiKey) {
    res.status(412).json({ error: `No ${name} API key on file — add yours in Settings → API Keys to use AI features.` });
    return;
  }

  try {
    const result = provider === 'anthropic'
      ? await callAnthropic(apiKey, prompt, system, model, maxTokens, params)
      : provider === 'openai'
      ? await callOpenAi(apiKey, prompt, system, model, maxTokens, params)
      : await callOpenRouter(apiKey, prompt, system, model, maxTokens, headerValue(req, 'origin') || `https://${headerValue(req, 'host') || 'author-command-center.app'}`, params);
    if (!result.ok) { res.status(result.status).json({ error: result.error, detail: 'detail' in result ? result.detail : undefined }); return; }
    res.status(200).json({ text: result.text, model: result.model });
  } catch (e) {
    res.status(502).json({ error: (e as Error)?.message ?? `Could not reach ${name}.` });
  }
}
