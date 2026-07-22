// Client-injected ARC data core (MCP directive §1.5).
//
// These functions power the MCP connector (api/mcp.ts), so they MUST NOT
// import the browser Supabase singleton (src/lib/supabase.ts uses
// import.meta.env, which doesn't exist server-side). The MCP server passes a
// per-request client built from the caller's OAuth token, so every query here
// runs under that user's RLS. Column selection, ordering, and the junction
// join mirror src/modules/arcs/api.ts.

import type { SupabaseClient } from '@supabase/supabase-js';

// A book association for a reader, flattened from the arc_reader_books
// junction joined to books. relationship is 'applied' | 'received' | 'reviewed'.
export interface ReaderBookAssociation {
  book_id: string;
  book_title: string;
  relationship: string;
}

export interface ArcReaderItem {
  id: string;
  name: string;
  email: string | null;
  status: string;
  primary_sm: string | null;
  newsletter_subscribed: boolean;
  promo_team: boolean;
  books: ReaderBookAssociation[];
  updated_at: string;
}

// Nested select mirroring src/modules/arcs/api.ts READER_SELECT, projected to
// just the fields the connector surfaces.
const READER_SELECT =
  'id, name, email, status, primary_sm, newsletter_subscribed, promo_team, updated_at, ' +
  'reader_books:arc_reader_books(book_id, relationship, book:books!book_id(title))';

function flattenBooks(rows: unknown): ReaderBookAssociation[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((rb) => {
    const row = rb as { book_id: string; relationship: string; book?: { title?: string } | null };
    return {
      book_id: row.book_id,
      book_title: row.book?.title ?? '(deleted)',
      relationship: row.relationship,
    };
  });
}

/**
 * The user's ARC readers with identity, lifecycle status, and their book
 * associations. Ordered by name ascending — matches src/modules/arcs/api.ts
 * listArcReaders.
 */
export async function listArcReaders(client: SupabaseClient, userId: string): Promise<ArcReaderItem[]> {
  const { data, error } = await client
    .from('arc_readers')
    .select(READER_SELECT)
    .eq('user_id', userId)
    .order('name', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown[]).map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      id: r.id as string,
      name: r.name as string,
      email: (r.email as string | null) ?? null,
      status: r.status as string,
      primary_sm: (r.primary_sm as string | null) ?? null,
      newsletter_subscribed: Boolean(r.newsletter_subscribed),
      promo_team: Boolean(r.promo_team),
      books: flattenBooks(r.reader_books),
      updated_at: r.updated_at as string,
    };
  });
}

export interface ArcStats {
  total: number;
  byStatus: Record<string, number>;
}

/**
 * A small summary of the user's ARC program: total readers and a count of
 * readers per lifecycle status. Derived in JS from a single lightweight query.
 */
export async function getArcStats(client: SupabaseClient, userId: string): Promise<ArcStats> {
  const { data, error } = await client
    .from('arc_readers')
    .select('status')
    .eq('user_id', userId);
  if (error) throw error;
  const rows = data ?? [];
  const byStatus: Record<string, number> = {};
  for (const row of rows) {
    const status = ((row as { status: string }).status ?? 'unknown') as string;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }
  return { total: rows.length, byStatus };
}
