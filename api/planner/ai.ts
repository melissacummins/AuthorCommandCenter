// Planner AI endpoint — the single server-side place that holds the Claude API
// key and talks to Anthropic on behalf of a signed-in user. Future planner AI
// features (free-day suggestion, phase triage, smart picks) all POST here.
//
// Required env vars on Vercel:
//   ANTHROPIC_API_KEY         - your Claude API key (server-side only)
//   SUPABASE_URL              - same as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY - server-side only, used to verify the caller
import { createClient } from '@supabase/supabase-js';

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

// Models we allow the client to request; everything else falls back to default.
const ALLOWED_MODELS = new Set(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8']);
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_OUTPUT_TOKENS = 1500;

function bearer(req: VercelRequest): string | null {
  const raw = req.headers['authorization'] ?? req.headers['Authorization'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.toLowerCase().startsWith('bearer ')) return null;
  return v.slice(7);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) { res.status(500).json({ error: 'Server is missing Supabase configuration.' }); return; }
  if (!apiKey) {
    res.status(503).json({ error: 'AI is not configured yet — add the ANTHROPIC_API_KEY environment variable in Vercel.' });
    return;
  }

  // Authenticate the caller against Supabase.
  const token = bearer(req);
  if (!token) { res.status(401).json({ error: 'Missing authorization.' }); return; }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) { res.status(401).json({ error: 'Invalid session.' }); return; }

  const body = (req.body ?? {}) as { prompt?: string; system?: string; model?: string; max_tokens?: number };
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) { res.status(400).json({ error: 'Missing prompt.' }); return; }
  const model = body.model && ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
  const maxTokens = Math.min(Math.max(Number(body.max_tokens) || 1024, 64), MAX_OUTPUT_TOKENS);

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(body.system ? { system: body.system } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      res.status(502).json({ error: `Claude request failed (${r.status}).`, detail: detail.slice(0, 500) });
      return;
    }
    const data = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim();
    res.status(200).json({ text, model });
  } catch (e) {
    res.status(502).json({ error: (e as Error)?.message ?? 'Could not reach Claude.' });
  }
}
