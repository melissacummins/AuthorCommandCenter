import { supabase } from '../../lib/supabase';
import type {
  NewsletterEvent,
  NewsletterEventInsert,
  NewsletterEventUpdate,
} from './types';
import { getKlaviyoCampaign } from '../../lib/klaviyo';

// Nested select pulls the junction rows with each linked Catalog book
// for attribution. We project to a flat NewsletterEventBookLink[] so
// the UI doesn't have to dig through the nested shape.
const EVENT_SELECT = `
  *,
  attribution:newsletter_event_books(
    book_id,
    book:books!book_id(id, title, pen_name_id)
  )
`;

function flatten(raw: any): NewsletterEvent {
  const { attribution, ...rest } = raw;
  const books = Array.isArray(attribution)
    ? attribution.map((a: any) => ({
        book_id: a.book_id,
        book_title: a.book?.title ?? '(deleted)',
        pen_name_id: a.book?.pen_name_id ?? null,
      }))
    : [];
  return { ...rest, books } as NewsletterEvent;
}

export async function listNewsletterEvents(userId: string): Promise<NewsletterEvent[]> {
  const { data, error } = await supabase
    .from('newsletter_events')
    .select(EVENT_SELECT)
    .eq('user_id', userId)
    .order('sent_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(flatten);
}

// Attach a newsletter event to one or more books in a single
// transactional-ish flow: insert the event, then upsert junction rows
// for each book_id. The junction's composite PK makes the upsert
// idempotent so re-running doesn't duplicate.
export async function createNewsletterEvent(
  userId: string,
  input: NewsletterEventInsert,
): Promise<NewsletterEvent> {
  const { book_ids, ...eventFields } = input;
  const { data: created, error: insErr } = await supabase
    .from('newsletter_events')
    .insert({
      user_id: userId,
      klaviyo_campaign_id: eventFields.klaviyo_campaign_id ?? null,
      subject: eventFields.subject.trim(),
      sent_at: eventFields.sent_at,
      sent_count: eventFields.sent_count ?? 0,
      open_count: eventFields.open_count ?? 0,
      click_count: eventFields.click_count ?? 0,
      unsubscribe_count: eventFields.unsubscribe_count ?? 0,
      metrics_refreshed_at: eventFields.metrics_refreshed_at ?? null,
      notes: eventFields.notes ?? null,
    })
    .select('id')
    .single();
  if (insErr) throw insErr;
  const eventId = (created as { id: string }).id;

  if (book_ids.length > 0) {
    const junctionRows = book_ids.map(book_id => ({
      newsletter_event_id: eventId,
      book_id,
      user_id: userId,
    }));
    const { error: linkErr } = await supabase
      .from('newsletter_event_books')
      .upsert(junctionRows, { onConflict: 'newsletter_event_id,book_id', ignoreDuplicates: true });
    if (linkErr) throw linkErr;
  }

  return refetchEvent(userId, eventId);
}

export async function updateNewsletterEvent(
  userId: string,
  id: string,
  patch: NewsletterEventUpdate,
): Promise<NewsletterEvent> {
  const { book_ids, ...rest } = patch;
  if (Object.keys(rest).length > 0) {
    const { error: upErr } = await supabase
      .from('newsletter_events')
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (upErr) throw upErr;
  }
  if (book_ids !== undefined) {
    // Replace the attribution set wholesale — it's small (a handful of
    // books per event) so a delete + reinsert is simpler than diffing.
    await supabase.from('newsletter_event_books').delete().eq('newsletter_event_id', id);
    if (book_ids.length > 0) {
      const rows = book_ids.map(book_id => ({
        newsletter_event_id: id,
        book_id,
        user_id: userId,
      }));
      const { error: linkErr } = await supabase.from('newsletter_event_books').insert(rows);
      if (linkErr) throw linkErr;
    }
  }
  return refetchEvent(userId, id);
}

export async function deleteNewsletterEvent(id: string): Promise<void> {
  const { error } = await supabase.from('newsletter_events').delete().eq('id', id);
  if (error) throw error;
}

async function refetchEvent(userId: string, id: string): Promise<NewsletterEvent> {
  const { data, error } = await supabase
    .from('newsletter_events')
    .select(EVENT_SELECT)
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return flatten(data);
}

// Pull the latest metrics from Klaviyo for an event that was
// originally imported from a campaign, and update the local row.
// Manual entries (klaviyo_campaign_id IS NULL) skip — there's
// nothing remote to refresh.
export async function refreshNewsletterMetrics(
  userId: string,
  event: NewsletterEvent,
): Promise<NewsletterEvent> {
  if (!event.klaviyo_campaign_id) return event;
  const campaign = await getKlaviyoCampaign(event.klaviyo_campaign_id);
  if (!campaign?.metrics) return event;
  const { error } = await supabase
    .from('newsletter_events')
    .update({
      sent_count: campaign.metrics.sent,
      open_count: campaign.metrics.opened,
      click_count: campaign.metrics.clicked,
      unsubscribe_count: campaign.metrics.unsubscribed,
      metrics_refreshed_at: new Date().toISOString(),
    })
    .eq('id', event.id);
  if (error) throw error;
  return refetchEvent(userId, event.id);
}
