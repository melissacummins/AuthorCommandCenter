// Polls the Fal.AI queue for an async (video) generation and updates
// the matching media_generations row when the job finishes. Called by
// the client every few seconds while a video is rendering.

import { createClient } from '@supabase/supabase-js';

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query: Record<string, string | string[] | undefined>;
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

function queryParam(req: VercelRequest, name: string): string | null {
  const v = req.query[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

interface FalQueueStatus {
  status?: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | string;
  response_url?: string;
  error?: unknown;
}

interface FalVideoOutput {
  video?: { url?: string };
  output?: { url?: string };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const falKey = process.env.FAL_KEY;
  if (!supabaseUrl || !serviceKey || !falKey) {
    res.status(500).json({ error: 'Service not configured' });
    return;
  }

  const token = authHeader(req);
  if (!token) {
    res.status(401).json({ error: 'Missing authorization' });
    return;
  }

  const generationId = queryParam(req, 'id');
  if (!generationId) {
    res.status(400).json({ error: 'Missing id query parameter' });
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

  const { data: gen, error: genErr } = await supabase
    .from('media_generations')
    .select('*')
    .eq('id', generationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (genErr || !gen) {
    res.status(404).json({ error: 'Generation not found' });
    return;
  }

  if (gen.status !== 'pending') {
    res.status(200).json({ generation: gen });
    return;
  }
  if (!gen.fal_request_id || !gen.fal_model_endpoint) {
    res.status(200).json({ generation: gen });
    return;
  }

  const statusUrl = `https://queue.fal.run/${gen.fal_model_endpoint}/requests/${gen.fal_request_id}/status`;
  const statusRes = await fetch(statusUrl, {
    headers: { 'Authorization': `Key ${falKey}` },
  });
  const statusJson = (await statusRes.json().catch(() => ({}))) as FalQueueStatus;

  if (!statusRes.ok) {
    res.status(502).json({ error: 'Fal status check failed', detail: statusJson });
    return;
  }

  if (statusJson.status === 'FAILED') {
    const { data: failed } = await supabase
      .from('media_generations')
      .update({
        status: 'failed',
        error_message: typeof statusJson.error === 'string' ? statusJson.error : 'Generation failed',
      })
      .eq('id', generationId)
      .select()
      .single();
    res.status(200).json({ generation: failed ?? gen });
    return;
  }

  if (statusJson.status !== 'COMPLETED') {
    // Still running. Return the unchanged row so the client can keep polling.
    res.status(200).json({ generation: gen });
    return;
  }

  // Completed — fetch the actual response payload.
  const responseUrl = statusJson.response_url ?? `https://queue.fal.run/${gen.fal_model_endpoint}/requests/${gen.fal_request_id}`;
  const resultRes = await fetch(responseUrl, {
    headers: { 'Authorization': `Key ${falKey}` },
  });
  const resultJson = (await resultRes.json().catch(() => ({}))) as FalVideoOutput;
  const url = resultJson.video?.url ?? resultJson.output?.url ?? null;

  if (!url) {
    const { data: failed } = await supabase
      .from('media_generations')
      .update({
        status: 'failed',
        error_message: 'No video URL in Fal response',
      })
      .eq('id', generationId)
      .select()
      .single();
    res.status(200).json({ generation: failed ?? gen });
    return;
  }

  const { data: completed } = await supabase
    .from('media_generations')
    .update({
      status: 'completed',
      output_url: url,
      thumbnail_url: url,
      completed_at: new Date().toISOString(),
    })
    .eq('id', generationId)
    .select()
    .single();

  res.status(200).json({ generation: completed ?? gen });
}
