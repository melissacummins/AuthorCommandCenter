import { supabase } from '../../lib/supabase';

// BookFunnel fires a webhook for every newsletter opt-in. The serverless
// receiver (api/bookfunnel/webhook.ts) writes events with the service-role key;
// the app reads/updates them under the owner's session and RLS scopes
// everything to auth.uid(). See migration 072_bookfunnel_subscribers.sql.

// One captured webhook. Most fields are best-effort extractions from BookFunnel's
// payload and may be null; `raw` always holds the full payload verbatim.
export interface BookFunnelEvent {
  id: string;
  event_type: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  page: string | null;
  book: string | null;
  occurred_at: string | null;
  raw: Record<string, unknown>;
  handled: boolean;
  received_at: string;
}

// Resolve the current user's id from the active Supabase session. Mirrors how
// the rest of the app scopes data to the signed-in member (the page passes the
// id from useAuth, but these helpers don't take it so they can be called
// directly without threading it through).
async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const id = data.user?.id;
  if (!id) throw new Error('Not signed in');
  return id;
}

// A long, unguessable secret the public webhook validates on every request.
// Two UUIDs (dashes stripped) give ~64 hex chars.
function generateSecret(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
}

// Return the user's existing webhook secret, creating the settings row (and a
// fresh secret) on first use. Idempotent: once a secret exists it's reused so
// the URL the user pasted into BookFunnel keeps working.
export async function getOrCreateWebhookSecret(): Promise<string> {
  const userId = await currentUserId();

  const { data: existing, error } = await supabase
    .from('bookfunnel_settings')
    .select('webhook_secret')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (existing?.webhook_secret) return existing.webhook_secret as string;

  const webhook_secret = generateSecret();
  const { data: created, error: upsertError } = await supabase
    .from('bookfunnel_settings')
    .upsert({ user_id: userId, webhook_secret }, { onConflict: 'user_id' })
    .select('webhook_secret')
    .single();
  if (upsertError) throw upsertError;
  return (created as { webhook_secret: string }).webhook_secret;
}

// Recent captured events, newest first. Capped so a busy funnel doesn't pull
// the whole history into the page.
export async function listEvents(): Promise<BookFunnelEvent[]> {
  const { data, error } = await supabase
    .from('bookfunnel_events')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as BookFunnelEvent[];
}

export async function setHandled(id: string, handled: boolean): Promise<void> {
  const { error } = await supabase
    .from('bookfunnel_events')
    .update({ handled })
    .eq('id', id);
  if (error) throw error;
}

// Clear the "new subscribers waiting" alert in one shot.
export async function markAllHandled(): Promise<void> {
  const { error } = await supabase
    .from('bookfunnel_events')
    .update({ handled: true })
    .eq('handled', false);
  if (error) throw error;
}

export async function deleteEvent(id: string): Promise<void> {
  const { error } = await supabase
    .from('bookfunnel_events')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
