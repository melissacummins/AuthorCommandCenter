// Single dispatching handler for /api/klaviyo/{key|lists|campaigns}.
// Consolidated into one Vercel function to stay under the Hobby-tier
// 12-function limit; previously each action was its own file.
//
// All three actions share:
//   - Supabase service-role client + bearer-token user resolution
//   - AES-256-GCM crypto with KLAVIYO_KEY_ENCRYPTION_SECRET
//   - The 'marketing-klaviyo-key-v1' scrypt salt
//
// Adding a new action means: add a case in the switch + wire the
// client helper in src/lib/klaviyo.ts. The crypto helpers stay
// inlined here because Vercel doesn't reliably bundle api/_lib/*.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

type VercelRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
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

function deriveMasterKey(secret: string): Buffer {
  return scryptSync(secret, 'marketing-klaviyo-key-v1', 32);
}

function encryptKey(plain: string, masterSecret: string): { encrypted: string; nonce: string; authTag: string } {
  const key = deriveMasterKey(masterSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: ciphertext.toString('base64'),
    nonce: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

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
    const key = deriveMasterKey(masterSecret);
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

// Resolve the action segment from the dynamic route. Falls back to the
// URL path when Vercel hasn't populated req.query (occasionally happens
// in the local dev shim).
function getAction(req: VercelRequest): string | null {
  const fromQuery = req.query?.action;
  if (typeof fromQuery === 'string') return fromQuery;
  if (Array.isArray(fromQuery)) return fromQuery[0] ?? null;
  if (req.url) {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('klaviyo');
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const masterSecret = process.env.KLAVIYO_KEY_ENCRYPTION_SECRET;
  if (!supabaseUrl || !serviceKey || !masterSecret) {
    res.status(500).json({ error: 'Service not configured (missing KLAVIYO_KEY_ENCRYPTION_SECRET, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY)' });
    return;
  }
  if (masterSecret.length < 32) {
    res.status(500).json({ error: 'KLAVIYO_KEY_ENCRYPTION_SECRET must be at least 32 characters' });
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

  const action = getAction(req);
  switch (action) {
    case 'key':
      return handleKey(req, res, supabase, userId, masterSecret);
    case 'lists':
      return handleLists(req, res, supabase, userId);
    case 'campaigns':
      return handleCampaigns(req, res, supabase, userId);
    default:
      res.status(404).json({ error: `Unknown Klaviyo action: ${action ?? '(none)'}` });
  }
}

// ─── /api/klaviyo/key ──────────────────────────────────────────────
async function handleKey(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
  userId: string,
  masterSecret: string,
) {
  if (req.method === 'GET') {
    const { data } = await supabase
      .from('user_klaviyo_keys')
      .select('key_hint, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    res.status(200).json({
      has_key: !!data,
      hint: data?.key_hint ?? null,
      updated_at: data?.updated_at ?? null,
    });
    return;
  }

  if (req.method === 'DELETE') {
    await supabase.from('user_klaviyo_keys').delete().eq('user_id', userId);
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body: { key?: unknown };
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as { key?: unknown };
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const rawKey = typeof body?.key === 'string' ? body.key.trim() : '';
  if (rawKey.length < 16) {
    res.status(400).json({ error: 'Key looks too short — paste the full Klaviyo API key.' });
    return;
  }

  // Smoke-test against Klaviyo before storing so a bad paste gets
  // immediate feedback rather than failing later when the user tries
  // to load lists or campaigns.
  try {
    const probe = await fetch('https://a.klaviyo.com/api/accounts/', {
      method: 'GET',
      headers: {
        Authorization: `Klaviyo-API-Key ${rawKey}`,
        revision: '2024-10-15',
        accept: 'application/json',
      },
    });
    if (probe.status === 401 || probe.status === 403) {
      res.status(400).json({ error: 'Klaviyo rejected that key. Double-check you copied a Private API Key from Klaviyo → Settings → API Keys.' });
      return;
    }
    if (!probe.ok) {
      res.status(400).json({ error: `Could not verify key with Klaviyo (HTTP ${probe.status}).` });
      return;
    }
  } catch (err: any) {
    res.status(502).json({ error: 'Could not reach Klaviyo to verify the key.', detail: err?.message });
    return;
  }

  const { encrypted, nonce, authTag } = encryptKey(rawKey, masterSecret);
  const hint = rawKey.length > 4 ? `…${rawKey.slice(-4)}` : '…';

  const { error: upErr } = await supabase
    .from('user_klaviyo_keys')
    .upsert({
      user_id: userId,
      encrypted_key: encrypted,
      nonce,
      auth_tag: authTag,
      key_hint: hint,
      updated_at: new Date().toISOString(),
    });

  if (upErr) {
    res.status(500).json({ error: 'Failed to save key', detail: upErr.message });
    return;
  }

  res.status(200).json({ ok: true, hint });
}

// ─── /api/klaviyo/lists ────────────────────────────────────────────
async function handleLists(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
  userId: string,
) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const klaviyoKey = await resolveKlaviyoKey(supabase, userId);
  if (!klaviyoKey) {
    res.status(400).json({ error: 'No Klaviyo key stored. Add one in Settings.' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const singleListId = url.searchParams.get('list_id');

  try {
    if (singleListId) {
      const profilesRes = await fetch(
        `https://a.klaviyo.com/api/lists/${encodeURIComponent(singleListId)}/relationships/profiles/?page[size]=1`,
        {
          headers: {
            Authorization: `Klaviyo-API-Key ${klaviyoKey}`,
            revision: '2024-10-15',
            accept: 'application/json',
          },
        },
      );
      if (!profilesRes.ok) {
        res.status(profilesRes.status).json({ error: `Klaviyo returned ${profilesRes.status}` });
        return;
      }
      const profilesJson = await profilesRes.json() as { meta?: { total?: number } };
      res.status(200).json({ list_id: singleListId, profile_count: profilesJson?.meta?.total ?? null });
      return;
    }

    type ListItem = { id: string; name: string; created: string | null; updated: string | null };
    const lists: ListItem[] = [];
    // Klaviyo's Lists endpoint caps page[size] at 10; the cursor loop below
    // pages through all of them.
    let nextUrl: string | null = 'https://a.klaviyo.com/api/lists/?page[size]=10&sort=name';
    while (nextUrl) {
      const listsRes = await fetch(nextUrl, {
        headers: {
          Authorization: `Klaviyo-API-Key ${klaviyoKey}`,
          revision: '2024-10-15',
          accept: 'application/json',
        },
      });
      if (!listsRes.ok) {
        const text = await listsRes.text().catch(() => '');
        res.status(listsRes.status).json({ error: `Klaviyo returned ${listsRes.status}`, detail: text.slice(0, 500) });
        return;
      }
      const json = await listsRes.json() as {
        data?: Array<{ id: string; attributes?: { name?: string; created?: string; updated?: string } }>;
        links?: { next?: string | null };
      };
      for (const row of json.data ?? []) {
        lists.push({
          id: row.id,
          name: row.attributes?.name ?? '(unnamed)',
          created: row.attributes?.created ?? null,
          updated: row.attributes?.updated ?? null,
        });
      }
      nextUrl = json.links?.next ?? null;
    }
    res.status(200).json({ lists });
  } catch (err: any) {
    res.status(502).json({ error: 'Failed to reach Klaviyo', detail: err?.message });
  }
}

// ─── /api/klaviyo/campaigns ────────────────────────────────────────
async function handleCampaigns(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
  userId: string,
) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const klaviyoKey = await resolveKlaviyoKey(supabase, userId);
  if (!klaviyoKey) {
    res.status(400).json({ error: 'No Klaviyo key stored. Add one in Settings.' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const singleId = url.searchParams.get('campaign_id');

  interface KlaviyoCampaignAttrs {
    name?: string;
    subject_line?: string;
    status?: string;
    send_time?: string | null;
  }
  interface CampaignSummary {
    id: string;
    name: string;
    subject: string;
    status: string;
    sent_at: string | null;
    metrics: { sent: number; opened: number; clicked: number; unsubscribed: number } | null;
  }

  async function fetchCampaignMetrics(campaignId: string): Promise<CampaignSummary['metrics']> {
    try {
      const r = await fetch('https://a.klaviyo.com/api/campaign-values-reports/', {
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
      if (!r.ok) return null;
      const json = await r.json() as { data?: { attributes?: { results?: Array<{ statistics?: Record<string, number> }> } } };
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

  try {
    if (singleId) {
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
      const metrics = await fetchCampaignMetrics(singleId);
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
          metrics: null,
        });
      }
      nextUrl = json.links?.next ?? null;
    }
    res.status(200).json({ campaigns });
  } catch (err: any) {
    res.status(502).json({ error: 'Failed to reach Klaviyo', detail: err?.message });
  }
}
