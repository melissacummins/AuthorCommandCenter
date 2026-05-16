// Media generator: kicks off a Fal.AI generation for the authenticated
// caller. Verifies the user's Supabase JWT, enforces the monthly spend
// cap (if any), proxies the request to Fal with the server-only API
// key, and inserts a row in media_generations either completed (image
// models, which return synchronously) or pending (video models, which
// run via Fal's queue and need a follow-up poll via /api/media/status).
//
// Required env vars (server-side only):
//   SUPABASE_URL                — same value as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   — service role, never shipped to browser
//   FAL_KEY                     — Fal.AI API key

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type VercelRequest = {
  method?: string;
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

interface ModelDef {
  id: string;
  endpoint: string;
  kind: 'image' | 'video';
  isAsync: boolean;
  acceptsInputImage: boolean;
  supportsCustomSize: boolean;
  estimatedCostCents: number;
}

// Server-side copy of the curated model catalogue. Kept in sync with
// src/modules/media/lib/models.ts — anything not in this list is
// rejected so a client can't ask us to call an arbitrary Fal endpoint.
const MODELS: Record<string, ModelDef> = {
  'nano-banana':          { id: 'nano-banana',          endpoint: 'fal-ai/nano-banana',                                kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 4 },
  'nano-banana-edit':     { id: 'nano-banana-edit',     endpoint: 'fal-ai/nano-banana/edit',                           kind: 'image', isAsync: false, acceptsInputImage: true,  supportsCustomSize: false, estimatedCostCents: 4 },
  'flux-dev':             { id: 'flux-dev',             endpoint: 'fal-ai/flux/dev',                                   kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 3 },
  'ideogram-v3':          { id: 'ideogram-v3',          endpoint: 'fal-ai/ideogram/v3',                                kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 6 },
  'gpt-image-1':          { id: 'gpt-image-1',          endpoint: 'fal-ai/gpt-image-1',                                kind: 'image', isAsync: false, acceptsInputImage: true,  supportsCustomSize: true,  estimatedCostCents: 7 },
  'recraft-v3':           { id: 'recraft-v3',           endpoint: 'fal-ai/recraft-v3',                                 kind: 'image', isAsync: false, acceptsInputImage: false, supportsCustomSize: true,  estimatedCostCents: 5 },
  'kling-video':          { id: 'kling-video',          endpoint: 'fal-ai/kling-video/v2/master/text-to-video',        kind: 'video', isAsync: true,  acceptsInputImage: false, supportsCustomSize: false, estimatedCostCents: 140 },
  'kling-image-to-video': { id: 'kling-image-to-video', endpoint: 'fal-ai/kling-video/v2/master/image-to-video',       kind: 'video', isAsync: true,  acceptsInputImage: true,  supportsCustomSize: false, estimatedCostCents: 140 },
  'ltx-video':            { id: 'ltx-video',            endpoint: 'fal-ai/ltx-video',                                  kind: 'video', isAsync: true,  acceptsInputImage: false, supportsCustomSize: false, estimatedCostCents: 20 },
};

interface GenerateRequestBody {
  model: string;
  prompt: string;
  style_preset_id?: string | null;
  full_prompt?: string;
  width?: number;
  height?: number;
  source_image_url?: string | null;
  collection_id?: string | null;
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

function buildFalPayload(model: ModelDef, body: GenerateRequestBody): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    prompt: body.full_prompt ?? body.prompt,
  };

  if (model.supportsCustomSize && body.width && body.height) {
    // Most Fal image endpoints take image_size as either a named preset
    // or an object {width, height}. The object form is universally
    // accepted by the models in our catalogue.
    payload.image_size = { width: body.width, height: body.height };
  }

  if (model.acceptsInputImage && body.source_image_url) {
    // Different endpoints use different field names. Send both — Fal
    // ignores unknown fields, so this keeps us compatible across the
    // catalogue without per-model branching.
    payload.image_url = body.source_image_url;
    payload.image_urls = [body.source_image_url];
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

function extractSyncOutputUrl(data: FalSyncResponse): { url: string | null; width: number | null; height: number | null } {
  if (data.images && data.images.length > 0 && data.images[0].url) {
    return {
      url: data.images[0].url,
      width: data.images[0].width ?? null,
      height: data.images[0].height ?? null,
    };
  }
  if (data.image?.url) {
    return { url: data.image.url, width: data.image.width ?? null, height: data.image.height ?? null };
  }
  if (data.video?.url) {
    return { url: data.video.url, width: null, height: null };
  }
  return { url: null, width: null, height: null };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const falKey = process.env.FAL_KEY;
  if (!supabaseUrl || !serviceKey || !falKey) {
    res.status(500).json({ error: 'Service not configured (missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or FAL_KEY)' });
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
  const model = MODELS[body.model];
  if (!model) {
    res.status(400).json({ error: `Unknown model: ${body.model}` });
    return;
  }
  if (model.acceptsInputImage && !body.source_image_url && body.model === 'nano-banana-edit') {
    res.status(400).json({ error: 'Nano Banana edit requires a source image.' });
    return;
  }

  // Spend cap check. If the next generation would push us past the
  // cap, refuse and let the UI surface the message.
  const [spent, cap] = await Promise.all([
    getMonthlySpendCents(supabase, userId),
    getMonthlyCapCents(supabase, userId),
  ]);
  if (cap > 0 && spent + model.estimatedCostCents > cap) {
    res.status(402).json({
      error: 'Monthly spend cap reached',
      spent_cents: spent,
      cap_cents: cap,
      estimated_cost_cents: model.estimatedCostCents,
    });
    return;
  }

  const fullPrompt = body.full_prompt?.trim() || body.prompt;
  const falPayload = buildFalPayload(model, { ...body, full_prompt: fullPrompt });

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
      source_image_url: body.source_image_url ?? null,
      fal_model_endpoint: model.endpoint,
      cost_cents: model.estimatedCostCents,
      status: 'pending',
    })
    .select()
    .single();

  if (insertErr || !inserted) {
    res.status(500).json({ error: 'Failed to record generation', detail: insertErr?.message });
    return;
  }

  const generationId = inserted.id as string;

  // Sync path — image models. Hit the direct endpoint and wait.
  if (!model.isAsync) {
    const falRes = await fetch(`https://fal.run/${model.endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(falPayload),
    });

    const falJson = (await falRes.json().catch(() => ({}))) as FalSyncResponse & { detail?: unknown };
    if (!falRes.ok) {
      await supabase.from('media_generations').update({
        status: 'failed',
        error_message: typeof falJson.detail === 'string' ? falJson.detail : `Fal HTTP ${falRes.status}`,
      }).eq('id', generationId);
      res.status(502).json({ error: 'Fal request failed', detail: falJson.detail ?? falJson, status: falRes.status });
      return;
    }

    const { url, width, height } = extractSyncOutputUrl(falJson);
    if (!url) {
      await supabase.from('media_generations').update({
        status: 'failed',
        error_message: 'Fal response did not include an output URL',
      }).eq('id', generationId);
      res.status(502).json({ error: 'No output URL in Fal response' });
      return;
    }

    const { data: updated } = await supabase
      .from('media_generations')
      .update({
        status: 'completed',
        output_url: url,
        thumbnail_url: url,
        width: width ?? body.width ?? null,
        height: height ?? body.height ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', generationId)
      .select()
      .single();

    res.status(200).json({ generation: updated ?? inserted });
    return;
  }

  // Async path — video models. Submit to the Fal queue and store the
  // request_id; the client will poll /api/media/status until done.
  const queueRes = await fetch(`https://queue.fal.run/${model.endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(falPayload),
  });

  const queueJson = (await queueRes.json().catch(() => ({}))) as FalQueueResponse & { detail?: unknown };
  if (!queueRes.ok || !queueJson.request_id) {
    await supabase.from('media_generations').update({
      status: 'failed',
      error_message: typeof queueJson.detail === 'string' ? queueJson.detail : `Fal queue HTTP ${queueRes.status}`,
    }).eq('id', generationId);
    res.status(502).json({ error: 'Fal queue submission failed', detail: queueJson.detail ?? queueJson });
    return;
  }

  const { data: queued } = await supabase
    .from('media_generations')
    .update({ fal_request_id: queueJson.request_id })
    .eq('id', generationId)
    .select()
    .single();

  res.status(202).json({ generation: queued ?? inserted });
}
