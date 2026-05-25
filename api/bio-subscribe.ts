// Public newsletter signup for the bio page. The bio page's email block
// posts { email, list } here. We resolve which author owns the page from
// the request host (same lookup as api/bio.ts), verify the list really
// belongs to one of that author's email blocks (so the endpoint can't be
// used to stuff arbitrary lists), decrypt the author's Klaviyo key, and
// subscribe the email with marketing consent.
import { createClient } from '@supabase/supabase-js';
import { createDecipheriv, scryptSync } from 'node:crypto';

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => VercelResponse;
  end: () => void;
};

function header(req: VercelRequest, name: string): string {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

// Mirrors the crypto in api/klaviyo/[action].ts (scrypt salt + AES-256-GCM).
function decryptKlaviyoKey(
  row: { encrypted_key: string; nonce: string; auth_tag: string },
  masterSecret: string,
): string | null {
  try {
    const key = scryptSync(masterSecret, 'marketing-klaviyo-key-v1', 32);
    const iv = Buffer.from(row.nonce, 'base64');
    const ciphertext = Buffer.from(row.encrypted_key, 'base64');
    const authTag = Buffer.from(row.auth_tag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const masterSecret = process.env.KLAVIYO_KEY_ENCRYPTION_SECRET;
  if (!supabaseUrl || !serviceKey || !masterSecret) {
    res.status(500).json({ error: 'Signup is not configured.' });
    return;
  }

  let body: { email?: unknown; list?: unknown };
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as { email?: unknown; list?: unknown };
  } catch {
    res.status(400).json({ error: 'Invalid request.' });
    return;
  }
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const listId = typeof body?.list === 'string' ? body.list.trim() : '';
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  if (!listId) {
    res.status(400).json({ error: 'This signup form is not finished being set up.' });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve the author from the host the form was served on.
  const host = header(req, 'host').toLowerCase().split(':')[0];
  let userId: string | null = null;
  if (host) {
    const { data } = await supabase
      .from('custom_domains')
      .select('user_id')
      .eq('domain', host)
      .eq('verified', true)
      .maybeSingle();
    if (data) userId = data.user_id;
  }
  if (!userId) userId = process.env.BIO_USER_ID || null;
  if (!userId) {
    res.status(404).json({ error: 'Unknown signup form.' });
    return;
  }

  // Only allow lists the author actually wired to a bio email block.
  const { data: block } = await supabase
    .from('bio_blocks')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'email')
    .eq('klaviyo_list_id', listId)
    .limit(1)
    .maybeSingle();
  if (!block) {
    res.status(400).json({ error: 'This signup form is no longer available.' });
    return;
  }

  const { data: keyRow } = await supabase
    .from('user_klaviyo_keys')
    .select('encrypted_key, nonce, auth_tag')
    .eq('user_id', userId)
    .maybeSingle();
  if (!keyRow?.encrypted_key || !keyRow.nonce || !keyRow.auth_tag) {
    res.status(400).json({ error: 'Signups are not available right now.' });
    return;
  }
  const klaviyoKey = decryptKlaviyoKey(keyRow, masterSecret);
  if (!klaviyoKey) {
    res.status(500).json({ error: 'Signups are not available right now.' });
    return;
  }

  try {
    const kRes = await fetch('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/', {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${klaviyoKey}`,
        revision: '2024-10-15',
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          type: 'profile-subscription-bulk-create-job',
          attributes: {
            profiles: {
              data: [{
                type: 'profile',
                attributes: {
                  email,
                  subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } },
                },
              }],
            },
          },
          relationships: { list: { data: { type: 'list', id: listId } } },
        },
      }),
    });
    if (!kRes.ok && kRes.status !== 202) {
      const detail = await kRes.text().catch(() => '');
      res.status(502).json({ error: 'Could not complete signup. Please try again.', detail: detail.slice(0, 300) });
      return;
    }
  } catch {
    res.status(502).json({ error: 'Could not reach the mailing list. Please try again.' });
    return;
  }

  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ ok: true });
}
