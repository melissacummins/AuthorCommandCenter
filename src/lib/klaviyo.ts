// Client wrapper for /api/klaviyo/*. All calls forward the user's
// Supabase access token so the serverless handler can authenticate
// and decrypt the user's stored Klaviyo key.

import { supabase } from './supabase';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return { Authorization: `Bearer ${token}` };
}

export interface KlaviyoKeyStatus {
  has_key: boolean;
  hint: string | null;
  updated_at: string | null;
}

export async function getKlaviyoKeyStatus(): Promise<KlaviyoKeyStatus> {
  const headers = await authHeader();
  const res = await fetch('/api/klaviyo/key', { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Key status failed (${res.status})`);
  return data as KlaviyoKeyStatus;
}

export async function setKlaviyoKey(key: string): Promise<KlaviyoKeyStatus> {
  const headers = await authHeader();
  const res = await fetch('/api/klaviyo/key', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Failed to save key (${res.status})`);
  return { has_key: true, hint: data.hint ?? null, updated_at: new Date().toISOString() };
}

export async function removeKlaviyoKey(): Promise<void> {
  const headers = await authHeader();
  const res = await fetch('/api/klaviyo/key', { method: 'DELETE', headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data?.error === 'string' ? data.error : `Failed to remove key (${res.status})`);
  }
}

export interface KlaviyoList {
  id: string;
  name: string;
  created: string | null;
  updated: string | null;
}

export async function listKlaviyoLists(): Promise<KlaviyoList[]> {
  const headers = await authHeader();
  const res = await fetch('/api/klaviyo/lists', { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Failed to load lists (${res.status})`);
  return (data?.lists ?? []) as KlaviyoList[];
}

export async function getKlaviyoListCount(listId: string): Promise<number | null> {
  const headers = await authHeader();
  const res = await fetch(`/api/klaviyo/lists?list_id=${encodeURIComponent(listId)}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Failed to load list (${res.status})`);
  return typeof data?.profile_count === 'number' ? data.profile_count : null;
}
