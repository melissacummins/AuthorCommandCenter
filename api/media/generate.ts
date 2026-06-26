// Media generator: kicks off a Fal.AI generation for the authenticated
// caller. Verifies the user's Supabase JWT, enforces the monthly spend
// cap (if any), proxies the request to Fal with the server-only API
// key, and inserts a row in media_generations either completed (image
// models, which return synchronously) or pending (video models, which
// run via Fal's queue and need a follow-up poll via /api/media/status).
//
// Required env vars (server-side only):
//   SUPABASE_URL                  — same value as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY     — service role, never shipped to browser
//   FAL_KEY_ENCRYPTION_SECRET     — master secret for decrypting user-stored Fal keys
//   FAL_KEY (optional)            — fallback Fal key used only when the
//                                   caller hasn't stored their own. Leave
//                                   unset in a multi-tenant deployment.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDecipheriv, scryptSync } from 'node:crypto';

type VercelRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => VercelResponse;
  json: (body: unknown) => void;
  send: (body: string) => void;
  end: () => void;
};

// How a model accepts size. Mirrors the SizeHandling type on the
// client side (src/modules/media/lib/models.ts) so they stay in sync.
type SizeHandling =
  | { type: 'pixels' }
  | { type: 'pixelsStringSnap16' }
  | { type: 'aspectRatio'; ratios: string[] }
  | { type: 'preserveInput' }
  | { type: 'fixed' };

interface ModelDef {
  id: string;
  endpoint: string;
  kind: 'image' | 'video';
  isAsync: boolean;
  acceptsInputImage: boolean;
  editEndpoint?: string;
  editCostCents?: number;
  supportsCustomSize: boolean;
  // Size handling. Defaults to { type: 'pixels' } when unspecified —
  // standard Fal {width, height} payload. Set explicitly per model in
  // the MODELS map below to override.
  size?: SizeHandling;
  estimatedCostCents: number;
}

const NANO_BANANA_ASPECTS = [
  '1:1', '4:5', '5:4', '3:4', '4:3', '2:3', '3:2', '9:16', '16:9', '21:9',
  '1:4', '4:1', '1:8', '8:1',
];
const FLUX_KONTEXT_ASPECTS = [
  '21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:21',
];
const IMAGEN_ASPECTS = ['1:1', '9:16', '16:9', '3:4', '4:3'];

// Server-side copy of the curated model catalogue. Kept in sync with
// src/modules/media/lib/models.ts. When the requested model id is not
// in this map we fall through to media_custom_models so users can run
// any fal-ai/* endpoint they've added themselves.
const MODELS: Record<string, ModelDef> = {
  // Image generation
  'nano-banana':          { id: 'nano-banana',          endpoint: 'fal-ai/nano-banana',                              kind: 'image', isAsync: false, acceptsInputImage: false, editEndpoint: 'fal-ai/nano-banana/edit',       supportsCustomSize: true,  estimatedCostCents: 4,   size: { type: 'aspectRatio', ratios: NANO_BANANA_ASPECTS } },
  'flux-pro-v11':         { id: 'flux-pro-v11',         endpoint: 'fal-ai/flux-pro/v1.1',                            kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 5   },
  'flux-schnell':         { id: 'flux-schnell',         endpoint: 'fal-ai/flux/schnell',                             kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 1   },
  'ideogram-v4':          { id: 'ideogram-v4',          endpoint: 'ideogram/v4',                                     kind: 'image', isAsync: false, acceptsInputImage: false,                                                  supportsCustomSize: true,  estimatedCostCents: 6   },
  'ideogram-v3':          { id: 'ideogram-v3',          endpoint: 'fal-ai/ideogram/v3',                              kind: 'image', isAsync: false, acceptsInputImage: false, editEndpoint: 'fal-ai/ideogram/v3/edit',       supportsCustomSize: true,  estimatedCostCents: 6   },
  'imagen4':              { id: 'imagen4',              endpoint: 'fal-ai/imagen4/preview',                          kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 5,   size: { type: 'aspectRatio', ratios: IMAGEN_ASPECTS } },
  'gpt-image-2':          { id: 'gpt-image-2',          endpoint: 'openai/gpt-image-2',                              kind: 'image', isAsync: false, acceptsInputImage: false, editEndpoint: 'openai/gpt-image-2/edit',        editCostCents: 45, supportsCustomSize: true,  estimatedCostCents: 25,  size: { type: 'pixelsStringSnap16' } },
  'recraft-v3':           { id: 'recraft-v3',           endpoint: 'fal-ai/recraft-v3',                               kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 5   },
  'flux-dev':             { id: 'flux-dev',             endpoint: 'fal-ai/flux/dev',                                 kind: 'image', isAsync: false, acceptsInputImage: false, editEndpoint: 'fal-ai/flux/dev/image-to-image', supportsCustomSize: true,  estimatedCostCents: 3   },
  'flux-pro-ultra':       { id: 'flux-pro-ultra',       endpoint: 'fal-ai/flux-pro/v1.1-ultra',                      kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 8,   size: { type: 'aspectRatio', ratios: FLUX_KONTEXT_ASPECTS } },
  'flux-lora':            { id: 'flux-lora',            endpoint: 'fal-ai/flux-lora',                                kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 4   },
  'imagen3':              { id: 'imagen3',              endpoint: 'fal-ai/imagen3',                                  kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 4,   size: { type: 'aspectRatio', ratios: IMAGEN_ASPECTS } },
  'ideogram-v2':          { id: 'ideogram-v2',          endpoint: 'fal-ai/ideogram/v2',                              kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 5   },
  'ideogram-v2-turbo':    { id: 'ideogram-v2-turbo',    endpoint: 'fal-ai/ideogram/v2-turbo',                        kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 3   },
  'sd35-large':           { id: 'sd35-large',           endpoint: 'fal-ai/stable-diffusion-v35-large',               kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 4   },
  'sd35-medium':          { id: 'sd35-medium',          endpoint: 'fal-ai/stable-diffusion-v35-medium',              kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 2   },
  'sana':                 { id: 'sana',                 endpoint: 'fal-ai/sana',                                     kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 1   },
  'bria-t2i':             { id: 'bria-t2i',             endpoint: 'fal-ai/bria/text-to-image/base',                  kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 4   },
  'photon-1':             { id: 'photon-1',             endpoint: 'fal-ai/luma-photon',                              kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 4   },
  'hidream':              { id: 'hidream',              endpoint: 'fal-ai/hidream-i1-full',                          kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 4   },
  'qwen-image':           { id: 'qwen-image',           endpoint: 'fal-ai/qwen-image',                               kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 3   },

  // Image editing
  'nano-banana-edit':     { id: 'nano-banana-edit',     endpoint: 'fal-ai/nano-banana/edit',                         kind: 'image', isAsync: false, acceptsInputImage: true,  supportsCustomSize: true,  estimatedCostCents: 4,   size: { type: 'aspectRatio', ratios: NANO_BANANA_ASPECTS } },
  'flux-kontext':         { id: 'flux-kontext',         endpoint: 'fal-ai/flux-pro/kontext',                         kind: 'image', isAsync: false, acceptsInputImage: true,  supportsCustomSize: true,  estimatedCostCents: 6,   size: { type: 'aspectRatio', ratios: FLUX_KONTEXT_ASPECTS } },
  'ideogram-v3-edit':     { id: 'ideogram-v3-edit',     endpoint: 'fal-ai/ideogram/v3/edit',                         kind: 'image', isAsync: false, acceptsInputImage: true,  supportsCustomSize: false, estimatedCostCents: 6   },
  'flux-i2i':             { id: 'flux-i2i',             endpoint: 'fal-ai/flux/dev/image-to-image',                  kind: 'image', isAsync: false, acceptsInputImage: true,  supportsCustomSize: true,  estimatedCostCents: 3   },
  'bria-eraser':          { id: 'bria-eraser',          endpoint: 'fal-ai/bria/eraser',                              kind: 'image', isAsync: false, acceptsInputImage: true,  supportsCustomSize: false, estimatedCostCents: 4,   size: { type: 'preserveInput' } },
  'birefnet-bg-remove':   { id: 'birefnet-bg-remove',   endpoint: 'fal-ai/birefnet',                                 kind: 'image', isAsync: false, acceptsInputImage: true,  supportsCustomSize: false, estimatedCostCents: 1,   size: { type: 'preserveInput' } },
  'clarity-upscaler':     { id: 'clarity-upscaler',     endpoint: 'fal-ai/clarity-upscaler',                         kind: 'image', isAsync: false, acceptsInputImage: true,  supportsCustomSize: false, estimatedCostCents: 3,   size: { type: 'preserveInput' } },
  'aura-sr':              { id: 'aura-sr',              endpoint: 'fal-ai/aura-sr',                                  kind: 'image', isAsync: false, acceptsInputImage: true,  supportsCustomSize: false, estimatedCostCents: 2,   size: { type: 'preserveInput' } },

  // Video
  'kling-video':          { id: 'kling-video',          endpoint: 'fal-ai/kling-video/v2/master/text-to-video',      kind: 'video', isAsync: true,  acceptsInputImage: false, supportsCustomSize: false, estimatedCostCents: 140 },
  'kling-image-to-video': { id: 'kling-image-to-video', endpoint: 'fal-ai/kling-video/v2/master/image-to-video',     kind: 'video', isAsync: true,  acceptsInputImage: true,  supportsCustomSize: false, estimatedCostCents: 140 },
  'veo3-fast':            { id: 'veo3-fast',            endpoint: 'fal-ai/veo3/fast',                                kind: 'video', isAsync: true,  acceptsInputImage: false, supportsCustomSize: false, estimatedCostCents: 200 },
  'ltx-video':            { id: 'ltx-video',            endpoint: 'fal-ai/ltx-video-13b-distilled',                  kind: 'video', isAsync: true,  acceptsInputImage: false, supportsCustomSize: false, estimatedCostCents: 20  },
  'kling-v16-std':        { id: 'kling-v16-std',        endpoint: 'fal-ai/kling-video/v1.6/standard/text-to-video',  kind: 'video', isAsync: true,  acceptsInputImage: false, supportsCustomSize: false, estimatedCostCents: 35  },
  'wan-t2v':              { id: 'wan-t2v',              endpoint: 'fal-ai/wan/v2.2-5b/text-to-video',                kind: 'video', isAsync: true,  acceptsInputImage: false, supportsCustomSize: false, estimatedCostCents: 60  },
  'wan-i2v':              { id: 'wan-i2v',              endpoint: 'fal-ai/wan/v2.2-5b/image-to-video',               kind: 'video', isAsync: true,  acceptsInputImage: true,  supportsCustomSize: false, estimatedCostCents: 60  },
  'minimax-hailuo-02':    { id: 'minimax-hailuo-02',    endpoint: 'fal-ai/minimax/hailuo-02',                        kind: 'video', isAsync: true,  acceptsInputImage: false, supportsCustomSize: false, estimatedCostCents: 80  },
  'hunyuan-video':        { id: 'hunyuan-video',        endpoint: 'fal-ai/hunyuan-video',                            kind: 'video', isAsync: true,  acceptsInputImage: false, supportsCustomSize: false, estimatedCostCents: 80  },
};

// Loads a user's custom model definition. Anything outside the curated
// MODELS map falls through to here so users can run any fal-ai/*
// endpoint they've added in their settings. We still require the
// endpoint to start with `fal-ai/` (also enforced by a DB check
// constraint) to keep this from becoming an SSRF tool.
async function loadCustomModel(supabase: SupabaseClient, userId: string, modelId: string): Promise<ModelDef | null> {
  const { data } = await supabase
    .from('media_custom_models')
    .select('id, label, endpoint, kind, is_async, accepts_input_image, supports_custom_size, estimated_cost_cents')
    .eq('user_id', userId)
    .eq('id', modelId)
    .maybeSingle();
  if (!data) return null;
  if (typeof data.endpoint !== 'string' || !data.endpoint.startsWith('fal-ai/')) return null;
  return {
    id: data.id as string,
    endpoint: data.endpoint as string,
    kind: data.kind as 'image' | 'video',
    isAsync: !!data.is_async,
    acceptsInputImage: !!data.accepts_input_image,
    supportsCustomSize: !!data.supports_custom_size,
    estimatedCostCents: (data.estimated_cost_cents as number) ?? 5,
  };
}

interface GenerateRequestBody {
  model: string;
  prompt: string;
  style_preset_id?: string | null;
  full_prompt?: string;
  width?: number;
  height?: number;
  source_image_url?: string | null;
  source_image_urls?: string[];
  num_images?: number;
  collection_id?: string | null;
  quality?: string;
  // Ideogram v3 rendering_speed: 'TURBO' | 'DEFAULT' | 'QUALITY'.
  // Only used when the request routes through Ideogram direct.
  rendering_speed?: string;
}

// Hard ceiling on a single batch regardless of what the client asks
// for — guards against a malformed request running up a huge bill.
const MAX_BATCH = 10;

type GptImage1Quality = 'low' | 'medium' | 'high' | 'auto';
// Via Fal — includes Fal's markup over OpenAI's pass-through rate.
const GPT_IMAGE_1_GENERATE_CENTS: Record<GptImage1Quality, number> = { low: 3,  medium: 10, high: 25, auto: 25 };
const GPT_IMAGE_1_EDIT_CENTS:     Record<GptImage1Quality, number> = { low: 12, medium: 30, high: 45, auto: 45 };
// Via OpenAI direct — meaningfully cheaper because no markup.
// Source: OpenAI gpt-image-2 pricing (per output @ 1024×1024):
//   low ~$0.006 / medium ~$0.053 / high ~$0.211. Edit adds an
//   input-image token cost (~$0.02–0.03). Conservative round-ups.
const GPT_IMAGE_1_OPENAI_GENERATE_CENTS: Record<GptImage1Quality, number> = { low: 1, medium: 6,  high: 22, auto: 22 };
const GPT_IMAGE_1_OPENAI_EDIT_CENTS:     Record<GptImage1Quality, number> = { low: 3, medium: 9,  high: 25, auto: 25 };

function normalizeQuality(q: unknown): GptImage1Quality {
  return q === 'low' || q === 'medium' || q === 'high' || q === 'auto' ? q : 'auto';
}

function gptImage1CostCents(quality: GptImage1Quality, isEdit: boolean, provider: 'fal' | 'openai' = 'fal'): number {
  if (provider === 'openai') {
    return (isEdit ? GPT_IMAGE_1_OPENAI_EDIT_CENTS : GPT_IMAGE_1_OPENAI_GENERATE_CENTS)[quality];
  }
  return (isEdit ? GPT_IMAGE_1_EDIT_CENTS : GPT_IMAGE_1_GENERATE_CENTS)[quality];
}

// Ideogram v3 has three rendering speeds with very different per-image
// pricing. Via Fal direct is roughly equivalent to Ideogram's "Default"
// rate plus markup; via Ideogram direct you can pick Turbo for ~2×
// cheaper or Quality for higher fidelity Fal doesn't expose.
type IdeogramRenderingSpeed = 'TURBO' | 'DEFAULT' | 'QUALITY';

function normalizeIdeogramSpeed(s: unknown): IdeogramRenderingSpeed {
  return s === 'TURBO' || s === 'QUALITY' ? s : 'DEFAULT';
}

// Per-image costs in cents @ 1024×1024. Edit adds a small input-image
// cost (~$0.02). Conservative round-ups.
const IDEOGRAM_DIRECT_GENERATE_CENTS: Record<IdeogramRenderingSpeed, number> = {
  TURBO: 3, DEFAULT: 6, QUALITY: 10,
};
const IDEOGRAM_DIRECT_EDIT_CENTS: Record<IdeogramRenderingSpeed, number> = {
  TURBO: 5, DEFAULT: 8, QUALITY: 12,
};

function ideogramCostCents(speed: IdeogramRenderingSpeed, isEdit: boolean): number {
  return (isEdit ? IDEOGRAM_DIRECT_EDIT_CENTS : IDEOGRAM_DIRECT_GENERATE_CENTS)[speed];
}

function authHeader(req: VercelRequest): string | null {
  const raw = req.headers['authorization'] ?? req.headers['Authorization'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.toLowerCase().startsWith('bearer ')) return null;
  return v.slice(7);
}

function startOfMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function getMonthlySpendCents(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('media_generations')
    .select('cost_cents')
    .eq('user_id', userId)
    .gte('created_at', startOfMonthIso());
  if (error) return 0;
  return (data ?? []).reduce((sum: number, row: { cost_cents: number | null }) => sum + (row.cost_cents ?? 0), 0);
}

async function getMonthlyCapCents(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data } = await supabase
    .from('media_settings')
    .select('monthly_cap_cents')
    .eq('user_id', userId)
    .maybeSingle();
  if (data && typeof data.monthly_cap_cents === 'number') return data.monthly_cap_cents;
  return 2000; // matches DB default
}

// Generic helper for both Fal and OpenAI keys — they live in
// parallel tables with the same shape, encrypted under different
// scrypt salts. Returns null when no key is configured.
async function resolveBYOKKey(
  supabase: SupabaseClient,
  userId: string,
  table: 'user_fal_keys' | 'user_openai_keys' | 'user_ideogram_keys',
  scryptSalt: string,
): Promise<string | null> {
  const masterSecret = process.env.FAL_KEY_ENCRYPTION_SECRET;
  if (!masterSecret || masterSecret.length < 32) return null;
  const { data } = await supabase
    .from(table)
    .select('encrypted_key, nonce, auth_tag')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data?.encrypted_key || !data.nonce || !data.auth_tag) return null;
  try {
    const key = scryptSync(masterSecret, scryptSalt, 32);
    const iv = Buffer.from(data.nonce, 'base64');
    const ciphertext = Buffer.from(data.encrypted_key, 'base64');
    const authTag = Buffer.from(data.auth_tag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

async function resolveOpenaiKey(supabase: SupabaseClient, userId: string): Promise<string | null> {
  return resolveBYOKKey(supabase, userId, 'user_openai_keys', 'media-openai-key-v1');
}

// Mark a generation as failed and return the updated row. Used by
// every sync failure path so the response can include the full row
// (with the descriptive error_message) — the client uses that to
// surface a failed card in history immediately instead of waiting
// for the user to refresh.
async function failGeneration(
  supabase: SupabaseClient,
  generationId: string,
  errorMessage: string,
): Promise<unknown | null> {
  const { data } = await supabase
    .from('media_generations')
    .update({
      status: 'failed',
      error_message: errorMessage,
      cost_cents: 0,
    })
    .eq('id', generationId)
    .select()
    .single();
  return data ?? null;
}

async function resolveIdeogramKey(supabase: SupabaseClient, userId: string): Promise<string | null> {
  return resolveBYOKKey(supabase, userId, 'user_ideogram_keys', 'media-ideogram-key-v1');
}

// Pulls the caller's stored Fal key (decrypted) or falls back to the
// platform FAL_KEY env var. Returns null when neither is available so
// the handler can surface a friendly "add your key" error.
export async function resolveFalKey(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const stored = await resolveBYOKKey(supabase, userId, 'user_fal_keys', 'media-fal-key-v1');
  return stored ?? process.env.FAL_KEY ?? null;
}

// Turns Fal's various error shapes into a single readable string.
// Fal returns:
//   - a plain string (older endpoints / 404s)
//   - an array of Pydantic validation errors: [{loc, msg, type}, ...]
//   - an object with `message` or nested error
function formatFalError(detail: unknown, status: number): string {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((d) => {
        if (d && typeof d === 'object') {
          const o = d as { loc?: unknown; msg?: unknown };
          const loc = Array.isArray(o.loc) ? o.loc.filter((x) => x !== 'body').join('.') : '';
          const msg = typeof o.msg === 'string' ? o.msg : JSON.stringify(d);
          return loc ? `${loc}: ${msg}` : msg;
        }
        return String(d);
      })
      .join('; ');
  }
  if (detail && typeof detail === 'object') {
    const o = detail as { message?: unknown; error?: unknown };
    if (typeof o.message === 'string') return o.message;
    if (typeof o.error === 'string') return o.error;
    try { return JSON.stringify(detail); } catch { /* fall through */ }
  }
  return `Fal HTTP ${status}`;
}

// gpt-image-2 / OpenAI direct enforces one real constraint: both
// dimensions must be divisible by 16. (The OpenAI error literally says
// so.) Fal's `openai/gpt-image-2` wrapper snaps for you transparently,
// which is why "1080x1350" appears to work via Fal but 502s via direct.
// We mirror Fal's behavior — snap to the nearest multiple of 16 in
// each dimension. Aspect ratio is preserved to within a fraction of a
// percent (e.g. 1080×1350 → 1088×1344 is still 4:5).
function gptImage2Size(width: number, height: number): string {
  if (!width || !height) return 'auto';
  const snap16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  return `${snap16(width)}x${snap16(height)}`;
}


// Pick the closest supported aspect ratio for an aspect_ratio-style
// model. Uses log-space distance so the comparison is proportional
// (3:4 is closer to 4:5 than to 2:3, even though linear distance
// would call them similar).
function closestAspectRatio(width: number | undefined, height: number | undefined, supported: string[]): string {
  if (!width || !height) return 'auto';
  const target = width / height;
  let best = supported[0] ?? 'auto';
  let bestDiff = Infinity;
  for (const ratio of supported) {
    const [w, h] = ratio.split(':').map((n) => parseInt(n, 10));
    if (!w || !h) continue;
    const diff = Math.abs(Math.log(target) - Math.log(w / h));
    if (diff < bestDiff) { bestDiff = diff; best = ratio; }
  }
  return best;
}

function buildFalPayload(model: ModelDef, body: GenerateRequestBody, numImages: number): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    prompt: body.full_prompt ?? body.prompt,
  };

  // Per-model size handling. Default to 'pixels' (the standard Fal
  // {width, height} payload) when the model entry doesn't override.
  const sizeKind = model.size?.type ?? 'pixels';
  switch (sizeKind) {
    case 'pixels':
      if (model.supportsCustomSize && body.width && body.height) {
        payload.image_size = { width: body.width, height: body.height };
      }
      break;
    case 'pixelsStringSnap16':
      payload.image_size = body.width && body.height
        ? gptImage2Size(body.width, body.height)
        : 'auto';
      break;
    case 'aspectRatio': {
      const ratios = (model.size as { type: 'aspectRatio'; ratios: string[] }).ratios;
      payload.aspect_ratio = closestAspectRatio(body.width, body.height, ratios);
      break;
    }
    case 'preserveInput':
    case 'fixed':
      // Don't send a size — let the model do what it does.
      break;
  }

  // GPT Image 1 has a `quality` parameter that swings cost by ~10×.
  // Pass it through so the user can pick Low for cheap drafts.
  if (model.id === 'gpt-image-2') {
    payload.quality = normalizeQuality(body.quality);
  }

  // Batch count — only meaningful for image generation. Fal ignores
  // unknown fields, but we still skip it for video to be safe.
  if (model.kind === 'image' && numImages > 1) {
    payload.num_images = numImages;
  }

  if (model.acceptsInputImage || model.editEndpoint) {
    const refs = (body.source_image_urls && body.source_image_urls.length > 0)
      ? body.source_image_urls
      : (body.source_image_url ? [body.source_image_url] : []);
    if (refs.length > 0) {
      // Different endpoints use different field names. Send both — Fal
      // ignores unknown fields, so this keeps us compatible across the
      // catalogue without per-model branching.
      payload.image_url = refs[0];
      payload.image_urls = refs;
    }
  }

  return payload;
}

interface FalImageOutput {
  url?: string;
  width?: number;
  height?: number;
}

interface FalSyncResponse {
  images?: FalImageOutput[];
  image?: FalImageOutput;
  video?: { url?: string };
  output?: unknown;
}

interface FalQueueResponse {
  request_id?: string;
  status?: string;
  status_url?: string;
}

interface ExtractedOutput {
  url: string;
  width: number | null;
  height: number | null;
}

// Pulls every output image (or the single video) from a Fal response.
function extractSyncOutputs(data: FalSyncResponse): ExtractedOutput[] {
  const outputs: ExtractedOutput[] = [];
  if (data.images && data.images.length > 0) {
    for (const img of data.images) {
      if (img.url) outputs.push({ url: img.url, width: img.width ?? null, height: img.height ?? null });
    }
  }
  if (outputs.length === 0 && data.image?.url) {
    outputs.push({ url: data.image.url, width: data.image.width ?? null, height: data.image.height ?? null });
  }
  if (outputs.length === 0 && data.video?.url) {
    outputs.push({ url: data.video.url, width: null, height: null });
  }
  return outputs;
}

// ============================================================
// OpenAI direct provider — gpt-image-2 only.
// ============================================================

interface OpenaiImageResponse {
  data?: { b64_json?: string; url?: string }[];
  error?: { message?: string; type?: string };
}

// Same snap-to-16 logic as the Fal path. OpenAI's image API requires
// both dimensions divisible by 16; without this, 1080×1350 (a 4:5
// aspect that the user has confirmed works via Fal's wrapper) gets
// rejected by /v1/images/generations.
function openaiSizeFromDimensions(width?: number, height?: number): string {
  if (!width || !height) return 'auto';
  const snap16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  return `${snap16(width)}x${snap16(height)}`;
}

// Parse any "WIDTHxHEIGHT" we sent back out, so the history row records
// the actual generated dimensions when OpenAI doesn't echo them.
function sizeToDimensions(size: string): { width: number; height: number } | null {
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m) return null;
  const width = parseInt(m[1], 10);
  const height = parseInt(m[2], 10);
  if (!width || !height) return null;
  return { width, height };
}

async function uploadBase64ToOutputs(
  supabase: SupabaseClient,
  userId: string,
  b64: string,
): Promise<string | null> {
  const buffer = Buffer.from(b64, 'base64');
  const path = `${userId}/openai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const { error: upErr } = await supabase.storage
    .from('media-outputs')
    .upload(path, buffer, { contentType: 'image/png', upsert: false });
  if (upErr) return null;
  const { data: pub } = supabase.storage.from('media-outputs').getPublicUrl(path);
  return pub.publicUrl ?? null;
}

interface OpenaiCallArgs {
  openaiKey: string;
  prompt: string;
  size: string;
  quality: GptImage1Quality;
  numImages: number;
  inputImageUrls: string[]; // empty for generate, otherwise edit
}

interface OpenaiCallOk { ok: true; b64s: string[] }
interface OpenaiCallErr { ok: false; error: string }
type OpenaiCallResult = OpenaiCallOk | OpenaiCallErr;

async function callOpenaiImage(args: OpenaiCallArgs): Promise<OpenaiCallResult> {
  const { openaiKey, prompt, size, quality, numImages, inputImageUrls } = args;
  const isEdit = inputImageUrls.length > 0;

  let res: Response;
  if (isEdit) {
    const form = new FormData();
    form.append('model', 'gpt-image-2');
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', quality);
    form.append('n', String(numImages));
    // Fetch each input image (may be a signed Supabase URL or a public
    // URL from a previous output) and attach as a Blob. gpt-image-2's
    // edit endpoint accepts multiple images via image[].
    for (const url of inputImageUrls) {
      const imgRes = await fetch(url);
      if (!imgRes.ok) return { ok: false, error: `Could not fetch reference image (${imgRes.status}).` };
      const blob = await imgRes.blob();
      form.append('image[]', blob, 'input.png');
    }
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}` },
      body: form,
    });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt,
        size,
        quality,
        n: numImages,
      }),
    });
  }

  const json = (await res.json().catch(() => ({}))) as OpenaiImageResponse;
  if (!res.ok) {
    const msg = json.error?.message ?? `OpenAI HTTP ${res.status}`;
    return { ok: false, error: msg };
  }
  const b64s = (json.data ?? []).map((d) => d.b64_json).filter((b): b is string => typeof b === 'string');
  if (b64s.length === 0) return { ok: false, error: 'OpenAI response did not include image data.' };
  return { ok: true, b64s };
}

// ============================================================
// Ideogram direct provider — v3 generate / edit only.
// ============================================================

interface IdeogramCallArgs {
  ideogramKey: string;
  prompt: string;
  aspectRatio: string;           // e.g. 'ASPECT_1_1', 'ASPECT_16_9'
  renderingSpeed: IdeogramRenderingSpeed;
  numImages: number;
  inputImageUrls: string[];      // empty → generate; non-empty → edit
  // Which Ideogram model version to call. v4 generate-only; v3 has
  // generate + edit. v4 also renamed `prompt` → `text_prompt`.
  version: 'v3' | 'v4';
}

// Map (width, height) → Ideogram's ASPECT_* enum. Falls back to 1:1.
function ideogramAspectFromDimensions(width?: number, height?: number): string {
  if (!width || !height) return 'ASPECT_1_1';
  if (width === height) return 'ASPECT_1_1';
  if (width > height) {
    const r = width / height;
    if (r >= 2.3) return 'ASPECT_21_9';
    if (r >= 1.7) return 'ASPECT_16_9';
    if (r >= 1.4) return 'ASPECT_3_2';
    return 'ASPECT_4_3';
  }
  const r = height / width;
  if (r >= 2.3) return 'ASPECT_9_21';
  if (r >= 1.7) return 'ASPECT_9_16';
  if (r >= 1.4) return 'ASPECT_2_3';
  return 'ASPECT_3_4';
}

interface IdeogramImageResult {
  url?: string;
  width?: number;
  height?: number;
}
interface IdeogramResponse {
  data?: IdeogramImageResult[];
  detail?: string;
}

async function callIdeogramImage(
  args: IdeogramCallArgs,
): Promise<{ ok: true; images: IdeogramImageResult[] } | { ok: false; error: string }> {
  const { ideogramKey, prompt, aspectRatio, renderingSpeed, numImages, inputImageUrls, version } = args;
  const isEdit = inputImageUrls.length > 0;
  // v4 is generate-only at the API level today; an edit request on
  // ideogram-v4 falls back to the v3 edit endpoint silently. The
  // catalog already nudges users toward ideogram-v3 for editing.
  const endpoint = isEdit
    ? 'https://api.ideogram.ai/v1/ideogram-v3/edit'
    : `https://api.ideogram.ai/v1/ideogram-${version}/generate`;
  // v4 renamed the text prompt field; v3 still uses `prompt`.
  const promptField = version === 'v4' && !isEdit ? 'text_prompt' : 'prompt';

  let res: Response;
  if (isEdit) {
    // Edit takes multipart form-data with the image file.
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('rendering_speed', renderingSpeed);
    form.append('num_images', String(numImages));
    // Fetch the reference image and attach as a Blob.
    const imgRes = await fetch(inputImageUrls[0]);
    if (!imgRes.ok) return { ok: false, error: `Could not fetch reference image (${imgRes.status}).` };
    const blob = await imgRes.blob();
    form.append('image', blob, 'input.png');
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Api-Key': ideogramKey },
      body: form,
    });
  } else {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Api-Key': ideogramKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        [promptField]: prompt,
        aspect_ratio: aspectRatio,
        rendering_speed: renderingSpeed,
        num_images: numImages,
      }),
    });
  }

  const json = (await res.json().catch(() => ({}))) as IdeogramResponse;
  if (!res.ok) {
    const msg = typeof json.detail === 'string' ? json.detail : `Ideogram HTTP ${res.status}`;
    return { ok: false, error: msg };
  }
  const images = (json.data ?? []).filter((d) => typeof d.url === 'string');
  if (images.length === 0) return { ok: false, error: 'Ideogram response did not include image URLs.' };
  return { ok: true, images };
}

// Download an Ideogram-hosted image URL and re-upload to our outputs
// bucket so we have a stable URL even if Ideogram's CDN URLs expire.
async function copyUrlToOutputs(
  supabase: SupabaseClient,
  userId: string,
  url: string,
): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const path = `${userId}/ideogram-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const { error } = await supabase.storage
      .from('media-outputs')
      .upload(path, buffer, { contentType: 'image/png', upsert: false });
    if (error) return null;
    const { data: pub } = supabase.storage.from('media-outputs').getPublicUrl(path);
    return pub.publicUrl ?? null;
  } catch {
    return null;
  }
}

// Parse a query param off req.url since the lightweight VercelRequest
// shape above doesn't expose req.query.
function queryParam(req: VercelRequest, name: string): string | null {
  if (!req.url) return null;
  try {
    return new URL(req.url, 'http://placeholder.local').searchParams.get(name);
  } catch {
    return null;
  }
}

// Run Florence-2's detailed-caption endpoint against an image URL to
// produce a Midjourney/SD-style descriptor the user can seed their
// prompt with. Used by the `?action=describe` branch below.
async function describeImageWithFal(falKey: string, imageUrl: string): Promise<{ caption: string } | { error: string; status: number }> {
  const res = await fetch('https://fal.run/fal-ai/florence-2-large/detailed-caption', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${falKey}` },
    body: JSON.stringify({ image_url: imageUrl }),
  });
  const data = (await res.json().catch(() => ({}))) as { results?: unknown; detail?: unknown };
  if (!res.ok) {
    return { error: formatFalError(data.detail ?? data, res.status), status: res.status };
  }
  // Florence-2 returns { results: "<caption>" } for the simple caption tasks.
  // Defensive: also handle object shapes (e.g. {results: {caption: "..."}})
  // since Fal occasionally evolves these wrappers.
  let caption = '';
  if (typeof data.results === 'string') caption = data.results;
  else if (data.results && typeof data.results === 'object') {
    const r = data.results as Record<string, unknown>;
    if (typeof r.caption === 'string') caption = r.caption;
    else if (typeof r['<DETAILED_CAPTION>'] === 'string') caption = r['<DETAILED_CAPTION>'] as string;
  }
  caption = caption.trim();
  if (!caption) return { error: 'Florence-2 returned no caption.', status: 502 };
  return { caption };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Service not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)' });
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

  const falKey = await resolveFalKey(supabase, userId);
  if (!falKey) {
    res.status(400).json({ error: 'No Fal API key configured. Add yours in Media settings to get started.', code: 'NO_FAL_KEY' });
    return;
  }

  // `?action=describe` — image-to-prompt via Florence-2. Returns the
  // caption without touching media_generations or the spend cap; this
  // is a cheap helper users invoke before a real generation.
  if (queryParam(req, 'action') === 'describe') {
    let describeBody: { image_url?: unknown };
    try {
      describeBody = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as { image_url?: unknown };
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
    const imageUrl = typeof describeBody?.image_url === 'string' ? describeBody.image_url.trim() : '';
    if (!imageUrl) {
      res.status(400).json({ error: 'image_url is required' });
      return;
    }
    const result = await describeImageWithFal(falKey, imageUrl);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(200).json({ caption: result.caption });
    return;
  }

  let body: GenerateRequestBody;
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as GenerateRequestBody;
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  if (!body || typeof body.prompt !== 'string' || !body.prompt.trim()) {
    res.status(400).json({ error: 'Prompt is required' });
    return;
  }
  const model: ModelDef | null = MODELS[body.model] ?? await loadCustomModel(supabase, userId, body.model);
  if (!model) {
    res.status(400).json({ error: `Unknown model: ${body.model}` });
    return;
  }
  const hasInputImage = !!body.source_image_url || (Array.isArray(body.source_image_urls) && body.source_image_urls.length > 0);
  if (model.acceptsInputImage && !hasInputImage && body.model === 'nano-banana-edit') {
    res.status(400).json({ error: 'Nano Banana edit requires a source image.' });
    return;
  }

  // How many images to produce this request. Only image generation
  // batches; video is always a single output.
  const requestedNum = Number.isFinite(body.num_images) ? Math.floor(body.num_images as number) : 1;
  const numImages = model.kind === 'image' ? Math.min(MAX_BATCH, Math.max(1, requestedNum)) : 1;

  // Provider selection.
  //   - GPT Image 2 → OpenAI direct if a key is configured (cheaper).
  //   - Ideogram v3 (generate + edit) or v4 (generate only) → Ideogram
  //     direct if a key is configured. Turbo is ~2× cheaper than Fal.
  //   - Everything else → Fal.
  const openaiKey = model.id === 'gpt-image-2' ? await resolveOpenaiKey(supabase, userId) : null;
  const isIdeogramV4 = model.id === 'ideogram-v4';
  const isIdeogramV3 = model.id === 'ideogram-v3' || model.id === 'ideogram-v3-edit';
  const isIdeogramDirect = isIdeogramV3 || isIdeogramV4;
  const ideogramKey = isIdeogramDirect ? await resolveIdeogramKey(supabase, userId) : null;
  const provider: 'openai' | 'ideogram' | 'fal' =
    openaiKey ? 'openai' : ideogramKey ? 'ideogram' : 'fal';

  // Edit endpoints typically cost more than text-to-image, so use
  // editCostCents when we'll route to one. Falls back to the regular
  // estimate when no per-mode price is configured. GPT Image 1's
  // cost also depends on the quality setting and which provider we use.
  const hasReference = !!body.source_image_url || (Array.isArray(body.source_image_urls) && body.source_image_urls.length > 0);
  const willEdit = (provider === 'openai' || provider === 'ideogram')
    ? hasReference
    : !!model.editEndpoint && hasReference;
  const ideogramSpeed = normalizeIdeogramSpeed(body.rendering_speed);
  const perImageCostCents = model.id === 'gpt-image-2'
    ? gptImage1CostCents(normalizeQuality(body.quality), willEdit, provider === 'openai' ? 'openai' : 'fal')
    : (isIdeogramDirect && provider === 'ideogram'
        ? ideogramCostCents(ideogramSpeed, willEdit)
        : ((willEdit && model.editCostCents) ? model.editCostCents : model.estimatedCostCents));
  const totalCostCents = perImageCostCents * numImages;

  // Spend cap check. If the next generation would push us past the
  // cap, refuse and let the UI surface the message.
  const [spent, cap] = await Promise.all([
    getMonthlySpendCents(supabase, userId),
    getMonthlyCapCents(supabase, userId),
  ]);
  if (cap > 0 && spent + totalCostCents > cap) {
    res.status(402).json({
      error: 'Monthly spend cap reached',
      spent_cents: spent,
      cap_cents: cap,
      estimated_cost_cents: totalCostCents,
    });
    return;
  }

  const firstSource = body.source_image_url ?? (body.source_image_urls?.[0] ?? null);
  const fullPrompt = body.full_prompt?.trim() || body.prompt;
  const falPayload = buildFalPayload(model, { ...body, full_prompt: fullPrompt }, numImages);

  // Dual-capability models (generation + editEndpoint): route to the
  // edit endpoint when the user attached a reference image, otherwise
  // use the plain generation endpoint. Pure-edit models have no
  // editEndpoint and always use their base endpoint.
  const effectiveEndpoint = (firstSource && model.editEndpoint) ? model.editEndpoint : model.endpoint;

  // Insert the row up front in 'pending' state. For sync models we
  // flip it to 'completed' as soon as Fal returns; for async (video)
  // models we record the request_id so the status endpoint can poll.
  const { data: inserted, error: insertErr } = await supabase
    .from('media_generations')
    .insert({
      user_id: userId,
      collection_id: body.collection_id ?? null,
      kind: model.kind,
      model: model.id,
      prompt: body.prompt,
      full_prompt: fullPrompt,
      style_preset_id: body.style_preset_id ?? null,
      width: body.width ?? null,
      height: body.height ?? null,
      source_image_url: firstSource,
      fal_model_endpoint: provider === 'openai'
        ? (willEdit ? 'openai/gpt-image-2/edit' : 'openai/gpt-image-2')
        : provider === 'ideogram'
          ? (willEdit ? 'ideogram/v3/edit' : `ideogram/${isIdeogramV4 ? 'v4' : 'v3'}/generate`)
          : effectiveEndpoint,
      cost_cents: perImageCostCents,
      status: 'pending',
    })
    .select()
    .single();

  if (insertErr || !inserted) {
    res.status(500).json({ error: 'Failed to record generation', detail: insertErr?.message });
    return;
  }

  const generationId = inserted.id as string;

  // OpenAI provider path — gpt-image-2 only. Calls OpenAI directly
  // (no Fal markup), receives base64 image data, uploads to our
  // outputs bucket, and fans out one row per returned image.
  if (provider === 'openai' && openaiKey) {
    const inputUrls = (body.source_image_urls && body.source_image_urls.length > 0)
      ? body.source_image_urls
      : (body.source_image_url ? [body.source_image_url] : []);
    const result = await callOpenaiImage({
      openaiKey,
      prompt: fullPrompt,
      size: body.width && body.height ? openaiSizeFromDimensions(body.width, body.height) : 'auto',
      quality: normalizeQuality(body.quality),
      numImages,
      inputImageUrls: inputUrls,
    });
    if (!result.ok) {
      const err = (result as OpenaiCallErr).error;
      const message = `${err} — you weren't charged.`;
      const failed = await failGeneration(supabase, generationId, message);
      res.status(502).json({ error: 'OpenAI request failed', detail: message, generation: failed });
      return;
    }

    // Upload every returned image to our outputs bucket so we have
    // stable public URLs (OpenAI's base64 isn't a URL).
    const uploadedUrls: string[] = [];
    for (const b64 of result.b64s) {
      const url = await uploadBase64ToOutputs(supabase, userId, b64);
      if (url) uploadedUrls.push(url);
    }
    if (uploadedUrls.length === 0) {
      const failed = await failGeneration(supabase, generationId, 'OpenAI returned images but they could not be stored.');
      res.status(500).json({ error: 'Failed to store OpenAI images', detail: 'OpenAI returned images but they could not be stored.', generation: failed });
      return;
    }

    const completedAt = new Date().toISOString();
    const dims = sizeToDimensions(body.width && body.height ? openaiSizeFromDimensions(body.width, body.height) : 'auto');
    const generations: unknown[] = [];

    const first = uploadedUrls[0];
    const { data: updated } = await supabase
      .from('media_generations')
      .update({
        status: 'completed',
        output_url: first,
        thumbnail_url: first,
        width: dims?.width ?? body.width ?? null,
        height: dims?.height ?? body.height ?? null,
        completed_at: completedAt,
      })
      .eq('id', generationId)
      .select()
      .single();
    if (updated) generations.push(updated);

    if (uploadedUrls.length > 1) {
      const extraRows = uploadedUrls.slice(1).map((url) => ({
        user_id: userId,
        collection_id: body.collection_id ?? null,
        kind: model.kind,
        model: model.id,
        prompt: body.prompt,
        full_prompt: fullPrompt,
        style_preset_id: body.style_preset_id ?? null,
        width: dims?.width ?? body.width ?? null,
        height: dims?.height ?? body.height ?? null,
        source_image_url: firstSource,
        fal_model_endpoint: willEdit ? 'openai/gpt-image-2/edit' : 'openai/gpt-image-2',
        cost_cents: perImageCostCents,
        status: 'completed' as const,
        output_url: url,
        thumbnail_url: url,
        completed_at: completedAt,
      }));
      const { data: extras } = await supabase
        .from('media_generations')
        .insert(extraRows)
        .select();
      if (extras) generations.push(...extras);
    }

    res.status(200).json({ generations: generations.length > 0 ? generations : [updated ?? inserted] });
    return;
  }

  // Ideogram direct path — v3 (generate + edit) or v4 (generate only).
  // Ideogram returns CDN-hosted image URLs that expire after a short
  // window, so we mirror them into our outputs bucket for stable URLs.
  if (provider === 'ideogram' && ideogramKey && isIdeogramDirect) {
    const inputUrls = (body.source_image_urls && body.source_image_urls.length > 0)
      ? body.source_image_urls
      : (body.source_image_url ? [body.source_image_url] : []);
    const result = await callIdeogramImage({
      ideogramKey,
      prompt: fullPrompt,
      aspectRatio: ideogramAspectFromDimensions(body.width, body.height),
      renderingSpeed: ideogramSpeed,
      numImages,
      inputImageUrls: inputUrls,
      version: isIdeogramV4 ? 'v4' : 'v3',
    });
    if (!result.ok) {
      const err = (result as { ok: false; error: string }).error;
      const message = `${err} — you weren't charged.`;
      const failed = await failGeneration(supabase, generationId, message);
      res.status(502).json({ error: 'Ideogram request failed', detail: message, generation: failed });
      return;
    }

    const mirrored: { url: string; width: number | null; height: number | null }[] = [];
    for (const img of result.images) {
      if (!img.url) continue;
      const ourUrl = await copyUrlToOutputs(supabase, userId, img.url);
      if (ourUrl) mirrored.push({ url: ourUrl, width: img.width ?? null, height: img.height ?? null });
    }
    if (mirrored.length === 0) {
      const failed = await failGeneration(supabase, generationId, 'Ideogram returned images but they could not be stored.');
      res.status(500).json({ error: 'Failed to store Ideogram images', detail: 'Ideogram returned images but they could not be stored.', generation: failed });
      return;
    }

    const completedAt = new Date().toISOString();
    const generations: unknown[] = [];
    const first = mirrored[0];
    const { data: updated } = await supabase
      .from('media_generations')
      .update({
        status: 'completed',
        output_url: first.url,
        thumbnail_url: first.url,
        width: first.width ?? body.width ?? null,
        height: first.height ?? body.height ?? null,
        completed_at: completedAt,
      })
      .eq('id', generationId)
      .select()
      .single();
    if (updated) generations.push(updated);

    if (mirrored.length > 1) {
      const extraRows = mirrored.slice(1).map((m) => ({
        user_id: userId,
        collection_id: body.collection_id ?? null,
        kind: model.kind,
        model: model.id,
        prompt: body.prompt,
        full_prompt: fullPrompt,
        style_preset_id: body.style_preset_id ?? null,
        width: m.width ?? body.width ?? null,
        height: m.height ?? body.height ?? null,
        source_image_url: firstSource,
        fal_model_endpoint: willEdit ? 'ideogram/v3/edit' : `ideogram/${isIdeogramV4 ? 'v4' : 'v3'}/generate`,
        cost_cents: perImageCostCents,
        status: 'completed' as const,
        output_url: m.url,
        thumbnail_url: m.url,
        completed_at: completedAt,
      }));
      const { data: extras } = await supabase
        .from('media_generations')
        .insert(extraRows)
        .select();
      if (extras) generations.push(...extras);
    }

    res.status(200).json({ generations: generations.length > 0 ? generations : [updated ?? inserted] });
    return;
  }

  // Sync path — image models. Hit the direct endpoint and wait.
  if (!model.isAsync) {
    const falRes = await fetch(`https://fal.run/${effectiveEndpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(falPayload),
    });

    const falJson = (await falRes.json().catch(() => ({}))) as FalSyncResponse & { detail?: unknown };
    if (!falRes.ok) {
      // Zero the cost on failure so a failed attempt doesn't eat the
      // monthly budget, and surface a clearer message for a missing
      // endpoint (Fal returns "Path / not found" with a 404).
      const friendly = falRes.status === 404
        ? `This model is unavailable at "${effectiveEndpoint}" (Fal returned 404). You weren't charged.`
        : `${formatFalError(falJson.detail, falRes.status)} — you weren't charged.`;
      const failed = await failGeneration(supabase, generationId, friendly);
      res.status(502).json({ error: 'Fal request failed', detail: friendly, status: falRes.status, generation: failed });
      return;
    }

    const outputs = extractSyncOutputs(falJson);
    if (outputs.length === 0) {
      const failed = await failGeneration(supabase, generationId, 'Fal response did not include an output URL');
      res.status(502).json({ error: 'No output URL in Fal response', detail: 'Fal response did not include an output URL', generation: failed });
      return;
    }

    const completedAt = new Date().toISOString();
    const generations: unknown[] = [];

    // First output reuses the row we already inserted.
    const first = outputs[0];
    const { data: updated } = await supabase
      .from('media_generations')
      .update({
        status: 'completed',
        output_url: first.url,
        thumbnail_url: first.url,
        width: first.width ?? body.width ?? null,
        height: first.height ?? body.height ?? null,
        completed_at: completedAt,
      })
      .eq('id', generationId)
      .select()
      .single();
    if (updated) generations.push(updated);

    // Remaining outputs become their own completed rows so each image
    // is independently downloadable / deletable in the history grid.
    // Cost is recorded per-image so the monthly spend total stays exact.
    if (outputs.length > 1) {
      const extraRows = outputs.slice(1).map((o) => ({
        user_id: userId,
        collection_id: body.collection_id ?? null,
        kind: model.kind,
        model: model.id,
        prompt: body.prompt,
        full_prompt: fullPrompt,
        style_preset_id: body.style_preset_id ?? null,
        width: o.width ?? body.width ?? null,
        height: o.height ?? body.height ?? null,
        source_image_url: firstSource,
        fal_model_endpoint: effectiveEndpoint,
        cost_cents: perImageCostCents,
        status: 'completed' as const,
        output_url: o.url,
        thumbnail_url: o.url,
        completed_at: completedAt,
      }));
      const { data: extras } = await supabase
        .from('media_generations')
        .insert(extraRows)
        .select();
      if (extras) generations.push(...extras);
    }

    res.status(200).json({ generations: generations.length > 0 ? generations : [updated ?? inserted] });
    return;
  }

  // Async path — video models. Submit to the Fal queue and store the
  // request_id; the client will poll /api/media/status until done.
  const queueRes = await fetch(`https://queue.fal.run/${effectiveEndpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(falPayload),
  });

  const queueJson = (await queueRes.json().catch(() => ({}))) as FalQueueResponse & { detail?: unknown };
  if (!queueRes.ok || !queueJson.request_id) {
    const friendly = queueRes.status === 404
      ? `This model is unavailable at "${effectiveEndpoint}" (Fal returned 404). You weren't charged.`
      : `${formatFalError(queueJson.detail, queueRes.status)} — you weren't charged.`;
    const failed = await failGeneration(supabase, generationId, friendly);
    res.status(502).json({ error: 'Fal queue submission failed', detail: friendly, generation: failed });
    return;
  }

  const { data: queued } = await supabase
    .from('media_generations')
    .update({ fal_request_id: queueJson.request_id })
    .eq('id', generationId)
    .select()
    .single();

  res.status(202).json({ generations: [queued ?? inserted] });
}
