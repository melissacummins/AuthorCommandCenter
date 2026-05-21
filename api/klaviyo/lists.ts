// GET /api/klaviyo/lists — returns the authenticated user's Klaviyo
// lists (id + name + subscriber count). Uses the user's stored encrypted
// API key; never exposes the key itself to the client.
//
// Optional query param ?list_id=... returns just the subscriber count
// for that one list, used by per-book attachments to avoid pulling the
// full catalogue.

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
  const singleListId = url.searchParams.get('list_id');

  try {
    if (singleListId) {
      // Single-list profile count via the relationships endpoint.
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

    // Full list catalogue. Klaviyo paginates at 100 — we collect all of
    // them with the cursor links. Author lists rarely exceed a few
    // dozen, so this is fine.
    type ListItem = { id: string; name: string; created: string | null; updated: string | null };
    const lists: ListItem[] = [];
    let nextUrl: string | null = 'https://a.klaviyo.com/api/lists/?page[size]=100&sort=name';
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
