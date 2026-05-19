// Disconnect a social account. Verifies the caller owns the row,
// then deletes it — ON DELETE CASCADE wipes the associated
// social_posts rows too.

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

function authHeader(req: VercelRequest): string | null {
  const raw = req.headers['authorization'] ?? req.headers['Authorization'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.toLowerCase().startsWith('bearer ')) return null;
  return v.slice(7);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
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

  let body: { account_id?: unknown };
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as { account_id?: unknown };
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }
  const accountId = typeof body.account_id === 'string' ? body.account_id : null;
  if (!accountId) {
    res.status(400).json({ error: 'account_id is required' });
    return;
  }

  const { error: deleteErr } = await supabase
    .from('social_accounts')
    .delete()
    .eq('id', accountId)
    .eq('user_id', userId);

  if (deleteErr) {
    res.status(500).json({ error: 'Failed to disconnect', detail: deleteErr.message });
    return;
  }

  res.status(200).json({ ok: true });
}
