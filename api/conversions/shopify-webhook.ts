// Shopify webhook receiver for conversion attribution.
//
// Set up in Shopify admin: Settings > Notifications > Webhooks
//   Event: Order paid
//   URL:   https://<your-app>.vercel.app/api/conversions/shopify-webhook?u=<user_id>
//   Format: JSON
//
// Shopify will show a signing secret. Paste that into the Link Shortener
// settings drawer in the app — we verify it on every incoming request.
//
// Attribution:
//   1. If order.note_attributes contains 'click_id', use it (theme snippet path).
//   2. Otherwise parse landing_site URL for ?click_id=...
//   3. Otherwise fall back to recent click matching by referring_site within
//      the user's attribution_window_minutes (default 3 days).
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';

type VercelRequest = {
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  body?: unknown;
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

function header(req: VercelRequest, name: string): string {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function pickClickId(order: ShopifyOrder, paramName: string): string | null {
  const attrs = order.note_attributes ?? [];
  for (const attr of attrs) {
    if ((attr.name === paramName || attr.name === 'click_id') && attr.value) {
      return String(attr.value);
    }
  }
  if (order.landing_site) {
    try {
      const u = new URL(order.landing_site, 'https://placeholder.local');
      const v = u.searchParams.get(paramName) ?? u.searchParams.get('click_id');
      if (v) return v;
    } catch {
      // ignore
    }
  }
  return null;
}

interface ShopifyOrder {
  id?: number | string;
  order_number?: number | string;
  name?: string;
  total_price?: string;
  currency?: string;
  landing_site?: string;
  referring_site?: string;
  note_attributes?: Array<{ name: string; value: string }>;
  created_at?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const userIdParam = req.query.u;
  const userId = Array.isArray(userIdParam) ? userIdParam[0] : userIdParam;
  if (!userId) {
    res.status(400).send('Missing user id');
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
    .from('link_attribution_settings')
    .select('shopify_webhook_secret, click_id_param, attribution_window_minutes')
    .eq('user_id', userId)
    .maybeSingle();

  if (!settings?.shopify_webhook_secret) {
    res.status(403).send('No webhook secret configured for this user');
    return;
  }

  const rawBody = await readRawBody(req);
  const sigHeader = header(req, 'x-shopify-hmac-sha256');
  const expected = createHmac('sha256', settings.shopify_webhook_secret).update(rawBody).digest('base64');

  let signaturesMatch = false;
  try {
    const a = Buffer.from(sigHeader, 'base64');
    const b = Buffer.from(expected, 'base64');
    if (a.length === b.length) signaturesMatch = timingSafeEqual(a, b);
  } catch {
    signaturesMatch = false;
  }

  if (!signaturesMatch) {
    res.status(401).send('Invalid signature');
    return;
  }

  let order: ShopifyOrder;
  try {
    order = JSON.parse(rawBody.toString('utf8')) as ShopifyOrder;
  } catch {
    res.status(400).send('Invalid JSON');
    return;
  }

  const externalRef = String(order.id ?? order.name ?? order.order_number ?? '');
  if (!externalRef) {
    res.status(202).send('No order id; ignored');
    return;
  }

  const paramName = settings.click_id_param || 'click_id';
  const clickId = pickClickId(order, paramName);

  let linkId: string | null = null;
  let clickRowId: string | null = null;
  let source: 'shopify_clickid' | 'shopify_webhook' = 'shopify_webhook';

  if (clickId) {
    const { data: clickRow } = await supabase
      .from('link_clicks')
      .select('id, link_id, user_id')
      .eq('click_id', clickId)
      .eq('user_id', userId)
      .maybeSingle();
    if (clickRow) {
      linkId = clickRow.link_id;
      clickRowId = clickRow.id;
      source = 'shopify_clickid';
    }
  }

  // Fallback: match by referring_site host inside the attribution window.
  if (!linkId && order.referring_site) {
    let host = '';
    try {
      host = new URL(order.referring_site).host;
    } catch {
      host = '';
    }
    if (host) {
      const windowMin = settings.attribution_window_minutes ?? 4320;
      const since = new Date(Date.now() - windowMin * 60_000).toISOString();
      const { data: candidate } = await supabase
        .from('link_clicks')
        .select('id, link_id')
        .eq('user_id', userId)
        .gte('clicked_at', since)
        .ilike('referrer', `%${host}%`)
        .order('clicked_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (candidate) {
        linkId = candidate.link_id;
        clickRowId = candidate.id;
      }
    }
  }

  if (!linkId) {
    await supabase
      .from('link_attribution_settings')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('user_id', userId);
    res.status(202).send('No matching click; order acknowledged');
    return;
  }

  const value = Number(order.total_price ?? 0);
  const currency = order.currency || 'USD';

  const { error: insertError } = await supabase
    .from('link_conversions')
    .insert({
      link_id: linkId,
      user_id: userId,
      click_id: clickId,
      click_row_id: clickRowId,
      source,
      external_ref: externalRef,
      value,
      currency,
      occurred_at: order.created_at ?? new Date().toISOString(),
    });

  // Duplicate webhook deliveries are common — silently swallow uniqueness errors.
  if (insertError && !/duplicate|unique/i.test(insertError.message)) {
    res.status(500).send(insertError.message);
    return;
  }

  await supabase
    .from('link_attribution_settings')
    .update({ last_webhook_at: new Date().toISOString() })
    .eq('user_id', userId);

  res.status(200).send('ok');
}
