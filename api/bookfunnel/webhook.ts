// BookFunnel new-subscriber webhook receiver.
//
// Set up in BookFunnel: Dashboard > Integrations > Add Integration >
//   Platform: "BookFunnel API"  (create an API key)
//   Webhook URL: https://<your-app>.vercel.app/api/bookfunnel/webhook?u=<user_id>&t=<secret>
//   Format: JSON
//   Event:  new_subscriber  (book_claimed is captured too if you send it)
//
// The app's BookFunnel page generates the full URL (with your user id + a
// per-user secret) for you to paste in — we validate `t` against the stored
// secret on every request.
//
// We don't yet know BookFunnel's exact payload shape, so we store the FULL raw
// body and only best-effort extract email / name / page / book. The first real
// events reveal what's actually available.
//
// Env (server-side only):
//   SUPABASE_URL                - same as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   - bypasses RLS to write the event
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

type VercelRequest = {
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  on: (event: string, listener: (chunk: Buffer) => void) => void;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => VercelResponse;
  send: (body: string) => void;
  json: (body: unknown) => void;
  end: () => void;
};

export const config = { api: { bodyParser: false } };

function queryParam(req: VercelRequest, name: string): string {
  const v = req.query[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function secretsMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

// Parse JSON, falling back to form-urlencoded; always returns a plain object.
function parsePayload(raw: string, contentType: string): Record<string, unknown> {
  const text = raw.trim();
  if (!text) return {};
  if (!contentType.includes('urlencoded')) {
    try { return JSON.parse(text) as Record<string, unknown>; } catch { /* try form */ }
  }
  try {
    const params = new URLSearchParams(text);
    const obj: Record<string, unknown> = {};
    for (const [k, v] of params) obj[k] = v;
    if (Object.keys(obj).length) return obj;
  } catch { /* ignore */ }
  // Last resort: keep the raw text so nothing is lost.
  return { _raw: text };
}

// Flatten one level of common nesting so lookups find fields whether BookFunnel
// sends them at the top level or under subscriber/contact/data/payload.
function flatten(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && ['subscriber', 'contact', 'data', 'payload', 'reader'].includes(k.toLowerCase())) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) out[k2.toLowerCase()] = v2;
    }
    out[k.toLowerCase()] = v;
  }
  return out;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return null;
}

function pick(flat: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const found = str(flat[k]);
    if (found) return found;
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // A browser GET is handy for confirming the URL is live.
  if (req.method === 'GET') {
    res.status(200).send('BookFunnel webhook endpoint is live. Configure it in BookFunnel to receive new_subscriber events.');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const userId = queryParam(req, 'u');
  const token = queryParam(req, 't');
  if (!userId || !token) {
    res.status(400).send('Missing u or t');
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).send('Service not configured');
    return;
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: settings } = await supabase
    .from('bookfunnel_settings')
    .select('webhook_secret')
    .eq('user_id', userId)
    .maybeSingle();

  if (!settings?.webhook_secret || !secretsMatch(token, settings.webhook_secret)) {
    res.status(403).send('Invalid webhook secret');
    return;
  }

  const rawBody = await readRawBody(req);
  const contentType = (Array.isArray(req.headers['content-type']) ? req.headers['content-type'][0] : req.headers['content-type']) ?? '';
  const payload = parsePayload(rawBody.toString('utf8'), contentType);
  const flat = flatten(payload);

  // Event type can arrive as a field or as the integration's configured event.
  const eventHeader = (Array.isArray(req.headers['x-bookfunnel-event']) ? req.headers['x-bookfunnel-event'][0] : req.headers['x-bookfunnel-event']) ?? '';
  const eventType =
    pick(flat, ['event', 'event_type', 'type', 'action']) ||
    (eventHeader ? String(eventHeader) : null) ||
    'unknown';

  const email = pick(flat, ['email', 'email_address', 'emailaddress', 'subscriber_email']);
  const firstName = pick(flat, ['first_name', 'firstname', 'first', 'fname', 'given_name']);
  const lastName = pick(flat, ['last_name', 'lastname', 'last', 'lname', 'family_name', 'surname']);
  const page = pick(flat, ['page', 'page_name', 'landing_page', 'landing_page_name', 'optin_page', 'opt_in_page', 'form', 'form_name', 'source']);
  const book = pick(flat, ['book', 'book_title', 'title', 'book_name']);
  const occurredAt = pick(flat, ['occurred_at', 'timestamp', 'created_at', 'date', 'subscribed_at', 'time']);

  const { error: insertError } = await supabase
    .from('bookfunnel_events')
    .insert({
      user_id: userId,
      event_type: eventType,
      email,
      first_name: firstName,
      last_name: lastName,
      page,
      book,
      occurred_at: occurredAt && !Number.isNaN(Date.parse(occurredAt)) ? occurredAt : null,
      raw: payload,
    });

  if (insertError) {
    res.status(500).send(insertError.message);
    return;
  }

  await supabase
    .from('bookfunnel_settings')
    .update({ last_event_at: new Date().toISOString() })
    .eq('user_id', userId);

  res.status(200).send('ok');
}
