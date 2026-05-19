// Wrappers around the /api/social/* endpoints. Reads of the
// social_accounts and social_posts tables go through the supabase
// client directly (RLS gates them); only the OAuth dance, syncs, and
// disconnect — which need the service role — go through these
// serverless handlers.

import { supabase } from '../../../lib/supabase';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return { 'Authorization': `Bearer ${token}` };
}

export async function startPinterestOAuth(): Promise<{ authorize_url: string }> {
  const headers = await authHeader();
  const res = await fetch('/api/social/pinterest/oauth-start', {
    method: 'POST',
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Failed to start OAuth (${res.status})`);
  }
  return data as { authorize_url: string };
}

export async function syncPinterest(accountId?: string): Promise<{
  ok: boolean;
  pins_seen: number;
  pins_upserted: number;
  pins_with_analytics_failures: number;
}> {
  const headers = await authHeader();
  const res = await fetch('/api/social/pinterest/sync', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(accountId ? { account_id: accountId } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Sync failed (${res.status})`);
  }
  return data as Awaited<ReturnType<typeof syncPinterest>>;
}

export async function disconnectAccount(accountId: string): Promise<void> {
  const headers = await authHeader();
  const res = await fetch('/api/social/disconnect', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data?.error === 'string' ? data.error : `Disconnect failed (${res.status})`);
  }
}
