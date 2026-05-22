// GET /api/klaviyo/campaigns — list the authenticated user's sent
// email campaigns from Klaviyo. Used by the Newsletter Events UI to
// pick a campaign and attach it to one or more books for the
// Timeline.
//
// Optional ?campaign_id=... returns just that one campaign with its
// performance metrics so the UI can refresh open/click counts on
// demand.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDecipheriv, scryptSync } from 'node:crypto';

type VercelRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
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

// Same shape as /api/klaviyo/lists — keep the helpers private to the
// file so each endpoint owns its decryption rather than reaching into
// a shared module that Vercel doesn't reliably bundle.
async function resolveKlaviyoKey(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const masterSecret = process.env.KLAVIYO_KEY_ENCRYPTION_SECRET;
  if (!masterSecret || masterSecret.length < 32) return null;
  const { data } = await supabase
    .from('user_klaviyo_keys')
    .select('encrypted_key, nonce, auth_tag')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data?.encrypted_key || !data.nonce || !data.auth_tag) return null;
  try {
    const key = scryptSync(masterSecret, 'marketing-klaviyo-key-v1', 32);
    const iv = Buffer.from(data.nonce, 'base64');
    const ciphertext = Buffer.from(data.encrypted_key, 'base64');
    const authTag = Buffer.from(data.auth_tag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    return null;
  }
}

interface KlaviyoCampaignAttrs {
  name?: string;
  subject_line?: string;
  status?: string;
  send_time?: string | null;
  send_options?: { recipient_type?: string } | null;
  audiences?: { included?: string[]; excluded?: string[] } | null;
  message?: unknown;
}

interface CampaignSummary {
  id: string;
  name: string;
  subject: string;
  status: string;
  sent_at: string | null;
  metrics: {
    sent: number;
    opened: number;
    clicked: number;
    unsubscribed: number;
  } | null;
}

// Pull campaign-level metrics for an email campaign. Klaviyo's
// reporting endpoint takes the campaign id and a list of statistic
// keys; we return the four we care about flattened. Errors fall
// through to null so a single broken campaign doesn't block the list.
async function fetchCampaignMetrics(klaviyoKey: string, campaignId: string): Promise<CampaignSummary['metrics']> {
  try {
    const res = await fetch(`https://a.klaviyo.com/api/campaign-values-reports/`, {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${klaviyoKey}`,
        revision: '2024-10-15',
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          type: 'campaign-values-report',
          attributes: {
            statistics: ['recipients', 'opens_unique', 'clicks_unique', 'unsubscribes'],
            conversion_metric_id: '',
            filter: `equals(campaign_id,"${campaignId}")`,
          },
        },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { data?: { attributes?: { results?: Array<{ statistics?: Record<string, number> }> } } };
    const stats = json.data?.attributes?.results?.[0]?.statistics ?? {};
    return {
      sent: Number(stats.recipients ?? 0),
      opened: Number(stats.opens_unique ?? 0),
      clicked: Number(stats.clicks_unique ?? 0),
      unsubscribed: Number(stats.unsubscribes ?? 0),
    };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Service not configured' });
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

  const klaviyoKey = await resolveKlaviyoKey(supabase, userId);
  if (!klaviyoKey) {
    res.status(400).json({ error: 'No Klaviyo key stored. Add one in Settings.' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const singleId = url.searchParams.get('campaign_id');

  try {
    if (singleId) {
      // Single-campaign refresh path used when the user hits the
      // "Refresh metrics" button on an attached newsletter.
      const metaRes = await fetch(`https://a.klaviyo.com/api/campaigns/${encodeURIComponent(singleId)}/`, {
        headers: {
          Authorization: `Klaviyo-API-Key ${klaviyoKey}`,
          revision: '2024-10-15',
          accept: 'application/json',
        },
      });
      if (!metaRes.ok) {
        res.status(metaRes.status).json({ error: `Klaviyo returned ${metaRes.status}` });
        return;
      }
      const metaJson = await metaRes.json() as { data?: { id: string; attributes?: KlaviyoCampaignAttrs } };
      const attrs = metaJson.data?.attributes ?? {};
      const metrics = await fetchCampaignMetrics(klaviyoKey, singleId);
      res.status(200).json({
        campaign: {
          id: singleId,
          name: attrs.name ?? '(unnamed)',
          subject: attrs.subject_line ?? '',
          status: attrs.status ?? 'unknown',
          sent_at: attrs.send_time ?? null,
          metrics,
        } satisfies CampaignSummary,
      });
      return;
    }

    // Full list. Filter to sent email campaigns — drafts and SMS
    // aren't useful for newsletter attribution. Klaviyo paginates so
    // we walk `links.next` until exhausted.
    const campaigns: CampaignSummary[] = [];
    let nextUrl: string | null =
      'https://a.klaviyo.com/api/campaigns/' +
      '?filter=equals(messages.channel,"email"),equals(status,"Sent")' +
      '&sort=-send_time&page[size]=50';
    while (nextUrl) {
      const listRes = await fetch(nextUrl, {
        headers: {
          Authorization: `Klaviyo-API-Key ${klaviyoKey}`,
          revision: '2024-10-15',
          accept: 'application/json',
        },
      });
      if (!listRes.ok) {
        const text = await listRes.text().catch(() => '');
        res.status(listRes.status).json({ error: `Klaviyo returned ${listRes.status}`, detail: text.slice(0, 500) });
        return;
      }
      const json = await listRes.json() as {
        data?: Array<{ id: string; attributes?: KlaviyoCampaignAttrs }>;
        links?: { next?: string | null };
      };
      for (const row of json.data ?? []) {
        const attrs = row.attributes ?? {};
        campaigns.push({
          id: row.id,
          name: attrs.name ?? '(unnamed)',
          subject: attrs.subject_line ?? '',
          status: attrs.status ?? 'unknown',
          sent_at: attrs.send_time ?? null,
          metrics: null, // metrics are pulled per-campaign on demand
        });
      }
      nextUrl = json.links?.next ?? null;
    }
    res.status(200).json({ campaigns });
  } catch (err: any) {
    res.status(502).json({ error: 'Failed to reach Klaviyo', detail: err?.message });
  }
}
