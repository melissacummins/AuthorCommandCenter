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

// Parse a webhook body as JSON or URL-encoded form params, whichever parses.
// BookFunnel's "JSON" mode has a known connection bug, so authors use "PARAMS"
// (form) mode — we accept either without relying on the Content-Type header.
function parseBody(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (!text) return {};
  try {
    const j = JSON.parse(text);
    if (j && typeof j === 'object') return j as Record<string, unknown>;
  } catch { /* not JSON — try form params */ }
  try {
    const params = new URLSearchParams(text);
    const obj: Record<string, unknown> = {};
    for (const [k, v] of params) obj[k] = v;
    if (Object.keys(obj).length) return obj;
  } catch { /* ignore */ }
  // Last resort: keep the raw text so nothing is lost.
  return { _raw: text };
}

// Some senders append the data to the URL itself (one PARAMS-mode variant),
// alongside our auth params — collect everything except u and t.
function queryData(req: VercelRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'u' || k === 't') continue;
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
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

// Our secret is 64 hex chars. If BookFunnel's PARAMS mode appends data to the
// URL (corrupting the `t` value, e.g. "<secret>?email=…"), pull the secret back
// out so a mangled query still validates.
function extractSecret(t: string): string {
  const m = t.match(/[0-9a-f]{64}/i);
  return m ? m[0] : t;
}

function secretAccepted(token: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  return secretsMatch(token, stored) || secretsMatch(extractSecret(token), stored);
}

function makeClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    // Browser diagnostic: append &debug=1 to the webhook URL. Reports whether
    // the function can see this user's stored secret + tables — without ever
    // echoing the secret — so a failing setup can be pinpointed in a browser.
    if (queryParam(req, 'debug') === '1') {
      const u = queryParam(req, 'u');
      const t = queryParam(req, 't');
      const supabase = makeClient();
      if (!supabase) { res.status(200).json({ env_ok: false }); return; }
      let settings_row_found = false;
      let secret_matches = false;
      let events_table_ok = false;
      try {
        const { data } = await supabase.from('bookfunnel_settings').select('webhook_secret').eq('user_id', u).maybeSingle();
        settings_row_found = !!data?.webhook_secret;
        secret_matches = secretAccepted(t, data?.webhook_secret);
      } catch { /* table may not exist */ }
      try {
        const { error } = await supabase.from('bookfunnel_events').select('id').eq('user_id', u).limit(1);
        events_table_ok = !error;
      } catch { /* ignore */ }
      res.status(200).json({ env_ok: true, settings_row_found, secret_matches, events_table_ok, received_t_length: t.length });
      return;
    }
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

  const supabase = makeClient();
  if (!supabase) {
    res.status(500).send('Service not configured');
    return;
  }

  const { data: settings } = await supabase
    .from('bookfunnel_settings')
    .select('webhook_secret')
    .eq('user_id', userId)
    .maybeSingle();

  if (!secretAccepted(token, settings?.webhook_secret)) {
    res.status(403).send('Invalid webhook secret');
    return;
  }

  // Capture the payload whether BookFunnel sends a JSON body, a form-encoded
  // body (PARAMS mode), or appends the fields to the URL — merge all sources
  // (a body value wins over a same-named URL param).
  const rawBody = await readRawBody(req);
  const payload = { ...queryData(req), ...parseBody(rawBody.toString('utf8')) };
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
