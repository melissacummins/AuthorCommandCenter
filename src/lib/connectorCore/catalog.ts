// Client-injected Catalog data core (MCP directive §1.5).
//
// These functions power the MCP connector (api/mcp.ts), so they MUST NOT
// import the browser Supabase singleton (src/lib/supabase.ts uses
// import.meta.env, which doesn't exist server-side). The MCP server passes a
// per-request client built from the caller's OAuth token, so every query here
// runs under that user's RLS. Column selection, ordering, and filters mirror
// src/modules/catalog/api.ts and src/lib/penNames.ts.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OpportunityDecisionValue } from '../opportunities';

// The subset of book columns shown in the Catalog list view. Kept narrow so
// list payloads stay small; getBook returns the full row.
const BOOK_LIST_COLUMNS =
  'id, title, subtitle, series, series_position, status, language, ' +
  'parent_book_id, publish_date, pre_order_date, ' +
  'ebook_price, paperback_price, hardcover_price, audiobook_price, ' +
  'created_at, updated_at';

export interface BookListItem {
  id: string;
  title: string;
  subtitle: string | null;
  series: string | null;
  series_position: number | null;
  status: string;
  language: string | null;
  parent_book_id: string | null;
  publish_date: string | null;
  pre_order_date: string | null;
  ebook_price: number | null;
  paperback_price: number | null;
  hardcover_price: number | null;
  audiobook_price: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * All of the user's books with the key fields shown in the Catalog list.
 * Ordered series (nulls last), then series_position (nulls last), then
 * created_at descending — matching src/modules/catalog/api.ts listBooks.
 */
export async function listBooks(client: SupabaseClient, userId: string): Promise<BookListItem[]> {
  const { data, error } = await client
    .from('books')
    .select(BOOK_LIST_COLUMNS)
    .eq('user_id', userId)
    .order('series', { ascending: true, nullsFirst: false })
    .order('series_position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BookListItem[];
}

/** One full book row for the user, or null when not found. */
export async function getBook(
  client: SupabaseClient,
  userId: string,
  bookId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client
    .from('books')
    .select('*')
    .eq('user_id', userId)
    .eq('id', bookId)
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

export interface PenNameItem {
  id: string;
  name: string;
  color: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** The user's pen names, ordered by name — mirrors src/lib/penNames.ts. */
export async function listPenNames(client: SupabaseClient, userId: string): Promise<PenNameItem[]> {
  const { data, error } = await client
    .from('pen_names')
    .select('id, name, color, notes, created_at, updated_at')
    .eq('user_id', userId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as PenNameItem[];
}

// ---------------------------------------------------------------------------
// WRITE: record an opportunity decision
//
// UPSERT on (user_id, book_id, opportunity_key) — see the
// book_opportunity_decisions table (supabase/migrations/106…): the
// decision CHECK constraint only allows 'dismissed' | 'planned', matching the
// OpportunityDecisionValue union in src/lib/opportunities.ts. Mirrors
// setOpportunityDecision in src/lib/dashboard.ts, but client-injected. We
// validate the value up front so a bad enum fails before hitting the DB.

const OPPORTUNITY_DECISION_VALUES: readonly OpportunityDecisionValue[] = ['dismissed', 'planned'];

export async function setOpportunityDecision(
  client: SupabaseClient,
  userId: string,
  args: { bookId: string; opportunityKey: string; decision: string },
): Promise<void> {
  if (!args.bookId) throw new Error('setOpportunityDecision: bookId is required');
  if (!args.opportunityKey) throw new Error('setOpportunityDecision: opportunityKey is required');
  if (!OPPORTUNITY_DECISION_VALUES.includes(args.decision as OpportunityDecisionValue)) {
    throw new Error(
      `setOpportunityDecision: invalid decision '${args.decision}' ` +
        `(expected ${OPPORTUNITY_DECISION_VALUES.map((v) => `'${v}'`).join(' | ')})`,
    );
  }

  const { error } = await client.from('book_opportunity_decisions').upsert(
    {
      user_id: userId,
      book_id: args.bookId,
      opportunity_key: args.opportunityKey,
      decision: args.decision,
    },
    { onConflict: 'user_id,book_id,opportunity_key' },
  );
  if (error) throw error;
}
