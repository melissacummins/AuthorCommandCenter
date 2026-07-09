import { supabase } from '../../lib/supabase';
import type {
  ArcReader,
  ArcReaderInsert,
  ArcReaderUpdate,
  ArcStatus,
  ReaderBook,
  ReaderBookRelationship,
  UnmatchedTitles,
} from './types';
import { impliedFunnelStatusFromReader, isFunnelStatus } from './types';

// Nested select that hydrates each reader with its junction rows joined
// to the linked Catalog book. We project to the fields the UI needs so
// the payload stays small even for readers with long histories.
const READER_SELECT = `
  *,
  reader_books:arc_reader_books(
    id,
    reader_id,
    book_id,
    relationship,
    recorded_at,
    book:books!book_id(id, title, pen_name_id)
  )
`;

// Reshape the joined Supabase response into the flat ReaderBook the
// rest of the app expects (book_title + pen_name_id pulled to top).
function flattenReaderBooks(rows: any[]): ReaderBook[] {
  return rows.map(rb => ({
    id: rb.id,
    reader_id: rb.reader_id,
    book_id: rb.book_id,
    relationship: rb.relationship,
    recorded_at: rb.recorded_at,
    book_title: rb.book?.title ?? '(deleted)',
    pen_name_id: rb.book?.pen_name_id ?? null,
  }));
}

function flattenReader(raw: any): ArcReader {
  const { reader_books, ...rest } = raw;
  return {
    ...rest,
    reader_books: Array.isArray(reader_books) ? flattenReaderBooks(reader_books) : [],
  } as ArcReader;
}

export async function listArcReaders(userId: string): Promise<ArcReader[]> {
  const { data, error } = await supabase
    .from('arc_readers')
    .select(READER_SELECT)
    .eq('user_id', userId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(flattenReader);
}

export async function getArcReader(id: string): Promise<ArcReader | null> {
  const { data, error } = await supabase
    .from('arc_readers')
    .select(READER_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? flattenReader(data) : null;
}

export async function createArcReader(userId: string, input: ArcReaderInsert): Promise<ArcReader> {
  // Pull the title arrays off the insert — those map to junction rows
  // and we resolve them after the reader exists.
  const { applied_for = [], received = [], reviewed = [], ...rest } = input;
  const { data, error } = await supabase
    .from('arc_readers')
    .insert({
      ...rest,
      // Keep the legacy TEXT[] columns populated for now as a safety
      // net during the cutover. They aren't read by new UI code but
      // any in-flight backups or external consumers still see them.
      applied_for,
      received,
      reviewed,
      user_id: userId,
    })
    .select('id')
    .single();
  if (error) throw error;
  const readerId = (data as { id: string }).id;

  await linkReaderBooksFromTitles(userId, readerId, { applied: applied_for, received, reviewed });

  const reader = await getArcReader(readerId);
  if (!reader) throw new Error('Reader vanished immediately after insert');
  return reader;
}

// Strict allowlist of arc_readers columns we let the client update.
// Anything not in this set (notably the joined `reader_books` rows and
// the `unmatched_titles` JSONB, which are managed via dedicated
// endpoints) is dropped before the UPDATE — passing them through
// would 400 with "could not find the 'reader_books' column".
const ARC_READER_UPDATABLE: ReadonlyArray<keyof ArcReaderUpdate> = [
  'name', 'email', 'primary_sm',
  'ig_profile_url', 'tt_profile_url', 'threads_profile_url',
  'fb_profile_url', 'goodreads_profile_url', 'amazon_reviewer_url',
  'blog_url',
  'status',
  'applied_for', 'received', 'reviewed',
  'place_to_review',
  'newsletter_subscribed', 'promo_team',
  'notes',
  'external_id',
];

function sanitizeReaderPatch(patch: ArcReaderUpdate): Partial<ArcReaderUpdate> {
  const clean: Record<string, unknown> = {};
  for (const key of ARC_READER_UPDATABLE) {
    if (key in patch) clean[key] = (patch as Record<string, unknown>)[key];
  }
  return clean as Partial<ArcReaderUpdate>;
}

export async function updateArcReader(id: string, patch: ArcReaderUpdate): Promise<ArcReader> {
  const { data, error } = await supabase
    .from('arc_readers')
    .update(sanitizeReaderPatch(patch))
    .eq('id', id)
    .select('id')
    .single();
  if (error) throw error;
  const reader = await getArcReader((data as { id: string }).id);
  if (!reader) throw new Error('Reader vanished immediately after update');
  return reader;
}

export async function deleteArcReader(id: string): Promise<void> {
  const { error } = await supabase.from('arc_readers').delete().eq('id', id);
  if (error) throw error;
}

export async function bulkUpdateStatus(ids: string[], status: ArcStatus): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('arc_readers')
    .update({ status })
    .in('id', ids);
  if (error) throw error;
}

// ============================================
// Per-reader book history (arc_reader_books junction)
// ============================================

// Add a single book to a reader's history under the given relationship.
// Idempotent: the unique (reader_id, book_id, relationship) constraint
// makes duplicate inserts a no-op. After the write we recompute the
// reader's funnel status from its full junction set.
export async function addReaderBook(
  userId: string,
  readerId: string,
  bookId: string,
  relationship: ReaderBookRelationship,
): Promise<void> {
  const { error } = await supabase.from('arc_reader_books').upsert(
    { user_id: userId, reader_id: readerId, book_id: bookId, relationship },
    { onConflict: 'reader_id,book_id,relationship', ignoreDuplicates: true },
  );
  if (error) throw error;
  await recomputeReaderFunnel(readerId);
}

export async function removeReaderBook(
  readerId: string,
  bookId: string,
  relationship: ReaderBookRelationship,
): Promise<void> {
  const { error } = await supabase
    .from('arc_reader_books')
    .delete()
    .eq('reader_id', readerId)
    .eq('book_id', bookId)
    .eq('relationship', relationship);
  if (error) throw error;
  await recomputeReaderFunnel(readerId);
}

// Refetch a reader's full junction, derive the implied funnel status,
// and update arc_readers.status if it's currently a funnel status.
// Non-funnel statuses (didnt_review, special_circumstances, etc.) are
// explicit user decisions — we leave them alone.
async function recomputeReaderFunnel(readerId: string): Promise<void> {
  const reader = await getArcReader(readerId);
  if (!reader) return;
  if (!isFunnelStatus(reader.status)) return;
  const implied = impliedFunnelStatusFromReader(reader);
  if (implied !== reader.status) {
    await supabase.from('arc_readers').update({ status: implied }).eq('id', readerId);
  }
}

// Add or remove the same book under the same relationship for many
// readers at once. Mirrors the old bulkUpdateBookField but writes
// through the junction instead of TEXT[].
export async function bulkUpdateReaderBook(
  userId: string,
  readerIds: string[],
  bookId: string,
  relationship: ReaderBookRelationship,
  action: 'add' | 'remove',
): Promise<{ changed: number; unchanged: number }> {
  if (readerIds.length === 0 || !bookId) return { changed: 0, unchanged: 0 };

  if (action === 'add') {
    const rows = readerIds.map(reader_id => ({
      user_id: userId,
      reader_id,
      book_id: bookId,
      relationship,
    }));
    const { error, count } = await supabase
      .from('arc_reader_books')
      .upsert(rows, { onConflict: 'reader_id,book_id,relationship', ignoreDuplicates: true, count: 'exact' });
    if (error) throw error;
    await Promise.all(readerIds.map(recomputeReaderFunnel));
    const changed = count ?? readerIds.length;
    return { changed, unchanged: readerIds.length - changed };
  }

  const { error } = await supabase
    .from('arc_reader_books')
    .delete()
    .in('reader_id', readerIds)
    .eq('book_id', bookId)
    .eq('relationship', relationship);
  if (error) throw error;
  await Promise.all(readerIds.map(recomputeReaderFunnel));
  // Postgres delete doesn't easily tell us per-row whether anything
  // matched without a separate count query; we return readerIds.length
  // as an upper bound and let the UI re-fetch for the true state.
  return { changed: readerIds.length, unchanged: 0 };
}

// Title-to-junction reconciliation. Called from createArcReader and
// from the Notion import path: for each title in the legacy arrays,
// find a matching Catalog book and insert a junction row. Anything
// that can't be matched lands in arc_readers.unmatched_titles for the
// UI to surface.
export async function linkReaderBooksFromTitles(
  userId: string,
  readerId: string,
  titles: { applied?: string[]; received?: string[]; reviewed?: string[] },
): Promise<void> {
  const allTitles = Array.from(new Set([
    ...(titles.applied ?? []),
    ...(titles.received ?? []),
    ...(titles.reviewed ?? []),
  ])).map(t => t.trim()).filter(Boolean);
  if (allTitles.length === 0) return;

  // Pull the candidate Catalog books in one query and match
  // case-insensitively on the client.
  const { data: catalogBooks, error: booksErr } = await supabase
    .from('books')
    .select('id, title')
    .eq('user_id', userId);
  if (booksErr) throw booksErr;
  const titleToId = new Map<string, string>();
  for (const b of (catalogBooks ?? []) as Array<{ id: string; title: string }>) {
    titleToId.set(b.title.trim().toLowerCase(), b.id);
  }

  const junctionRows: Array<{
    user_id: string;
    reader_id: string;
    book_id: string;
    relationship: ReaderBookRelationship;
  }> = [];
  const unmatched: UnmatchedTitles = { applied: [], received: [], reviewed: [] };

  function bucket(rel: ReaderBookRelationship, list: string[] | undefined) {
    if (!list) return;
    for (const raw of list) {
      const t = raw.trim();
      if (!t) continue;
      const hit = titleToId.get(t.toLowerCase());
      if (hit) {
        junctionRows.push({ user_id: userId, reader_id: readerId, book_id: hit, relationship: rel });
      } else {
        unmatched[rel]!.push(t);
      }
    }
  }
  bucket('applied', titles.applied);
  bucket('received', titles.received);
  bucket('reviewed', titles.reviewed);

  if (junctionRows.length > 0) {
    const { error } = await supabase
      .from('arc_reader_books')
      .upsert(junctionRows, { onConflict: 'reader_id,book_id,relationship', ignoreDuplicates: true });
    if (error) throw error;
  }

  const totalUnmatched =
    (unmatched.applied?.length ?? 0) +
    (unmatched.received?.length ?? 0) +
    (unmatched.reviewed?.length ?? 0);
  if (totalUnmatched > 0) {
    // Merge with anything already in unmatched_titles so successive
    // imports don't overwrite each other's leftovers.
    const { data: existing } = await supabase
      .from('arc_readers')
      .select('unmatched_titles')
      .eq('id', readerId)
      .maybeSingle();
    const prev = (existing as { unmatched_titles?: UnmatchedTitles } | null)?.unmatched_titles ?? {};
    const merged: UnmatchedTitles = {
      applied:  Array.from(new Set([...(prev.applied  ?? []), ...(unmatched.applied  ?? [])])),
      received: Array.from(new Set([...(prev.received ?? []), ...(unmatched.received ?? [])])),
      reviewed: Array.from(new Set([...(prev.reviewed ?? []), ...(unmatched.reviewed ?? [])])),
    };
    await supabase.from('arc_readers').update({ unmatched_titles: merged }).eq('id', readerId);
  }
}

// Clear a specific unmatched title from a reader. Used by the UI when
// the user either links the title to a Catalog book (via addReaderBook)
// or dismisses it.
export async function dismissUnmatchedTitle(
  readerId: string,
  relationship: ReaderBookRelationship,
  title: string,
): Promise<void> {
  const { data } = await supabase
    .from('arc_readers')
    .select('unmatched_titles')
    .eq('id', readerId)
    .maybeSingle();
  const cur = (data as { unmatched_titles?: UnmatchedTitles } | null)?.unmatched_titles ?? {};
  const next: UnmatchedTitles = {
    applied:  (cur.applied  ?? []).filter(t => relationship !== 'applied'  || t !== title),
    received: (cur.received ?? []).filter(t => relationship !== 'received' || t !== title),
    reviewed: (cur.reviewed ?? []).filter(t => relationship !== 'reviewed' || t !== title),
  };
  await supabase.from('arc_readers').update({ unmatched_titles: next }).eq('id', readerId);
}

