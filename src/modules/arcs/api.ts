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
import { impliedFunnelStatusFromReader, isFunnelStatus, NOTION_STATUS_MAP } from './types';

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

// ============================================
// Notion JSON import
// ============================================
// Shape we accept (matches what a Notion export → JSON looks like for
// this database). All fields optional except Name.
export interface NotionArcRow {
  // Common Notion-export keys are listed for autocomplete, but the importer
  // tolerates any header that matches a known alias (see HEADER_ALIASES).
  id?: string;
  Name?: string;
  'Email Address'?: string;
  'Primary SM'?: string;
  'IG profile link'?: string;
  'TT profile link'?: string;
  'Goodreads profile link'?: string;
  'Blog link'?: string;
  Status?: string;
  'Application for'?: string[] | string;
  Received?: string[] | string;
  Reviewed?: string[] | string;
  'Place to Review'?: string[] | string;
  'Join my newsletter?'?: boolean | string;
  'Join my Promo team'?: string[] | string | boolean;
  notes?: string;
  [extra: string]: unknown;
}

export interface ImportSummary {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

function toArr(v: string[] | string | undefined | null): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
  return String(v)
    .split(/[,;]\s*/)
    .map(s => s.trim())
    .filter(Boolean);
}

function toBool(v: boolean | string | string[] | undefined): boolean {
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.some(s => /^yes$/i.test(s));
  if (typeof v === 'string') return /^(yes|true|__yes__|1)$/i.test(v.trim());
  return false;
}

// Look a value up in a row by trying each alias in order. Falls back to a
// case-insensitive match, then a substring match (aliases >= 4 chars only,
// to avoid 'fb'/'tt'/'ig' colliding with unrelated columns).
function pickRaw(row: NotionArcRow, aliases: string[]): unknown {
  for (const a of aliases) {
    if (a in row && row[a] !== undefined && row[a] !== null && row[a] !== '') return row[a];
  }
  const keys = Object.keys(row);
  const lowered = keys.map(k => k.toLowerCase().trim());
  for (const a of aliases) {
    const al = a.toLowerCase().trim();
    const i = lowered.findIndex(k => k === al);
    if (i >= 0 && row[keys[i]] !== undefined && row[keys[i]] !== '') return row[keys[i]];
  }
  for (const a of aliases) {
    if (a.length < 4) continue;
    const al = a.toLowerCase().trim();
    const i = lowered.findIndex(k => k.includes(al));
    if (i >= 0 && row[keys[i]] !== undefined && row[keys[i]] !== '') return row[keys[i]];
  }
  return undefined;
}

function pickStr(row: NotionArcRow, aliases: string[]): string {
  const v = pickRaw(row, aliases);
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.join(', ').trim();
  return '';
}

function rowToInsert(row: NotionArcRow): ArcReaderInsert | null {
  const name = pickStr(row, ['Name', 'Full Name']);
  if (!name) return null;
  const statusStr = pickStr(row, ['Status']);
  const status = (statusStr && NOTION_STATUS_MAP[statusStr]) ?? 'new';
  return {
    name,
    email: pickStr(row, ['Email Address', 'Email']) || null,
    primary_sm: pickStr(row, ['Primary SM', 'Primary Social']) || null,
    ig_profile_url: pickStr(row, ['IG profile link', 'Instagram', 'Instagram profile link']) || null,
    tt_profile_url: pickStr(row, ['TT profile link', 'Tiktok', 'Tiktok profile link', 'TikTok']) || null,
    threads_profile_url: pickStr(row, ['Threads', 'Threads profile link']) || null,
    fb_profile_url: pickStr(row, ['Facebook', 'Facebook profile link', 'FB profile link']) || null,
    goodreads_profile_url: pickStr(row, ['Goodreads profile link', 'Goodreads']) || null,
    amazon_reviewer_url: pickStr(row, ['Amazon Reviewer profile link', 'Amazon Reviewer', 'Amazon']) || null,
    blog_url: pickStr(row, ['Blog link', 'Blog', 'Website']) || null,
    status,
    applied_for: toArr(pickRaw(row, ['Application for', 'Applied for']) as string | string[] | undefined),
    received: toArr(pickRaw(row, ['Received']) as string | string[] | undefined),
    reviewed: toArr(pickRaw(row, ['Reviewed']) as string | string[] | undefined),
    place_to_review: toArr(pickRaw(row, [
      'Place to Review',
      'Places to Review',
      'Where do you plan to post your review?',
      'Where will you review',
      'post your review',
    ]) as string | string[] | undefined),
    newsletter_subscribed: toBool(pickRaw(row, [
      'Join my newsletter?',
      'Would you like to join my newsletter?',
      'Newsletter',
    ]) as boolean | string | string[] | undefined),
    promo_team: toBool(pickRaw(row, ['Join my Promo team', 'Promo team']) as boolean | string | string[] | undefined),
    notes: (row.notes ?? '') as string || null,
    external_id: (row.id ?? '').toString() || null,
  };
}

export async function importNotionJson(
  userId: string,
  rows: NotionArcRow[],
): Promise<ImportSummary> {
  const summary: ImportSummary = { inserted: 0, updated: 0, skipped: 0, errors: [] };

  // Pull all existing rows once for fast dedupe lookup.
  const { data: existing, error: exErr } = await supabase
    .from('arc_readers')
    .select('id, external_id, email, name')
    .eq('user_id', userId);
  if (exErr) throw exErr;

  const byExt = new Map<string, string>();
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const e of existing ?? []) {
    if (e.external_id) byExt.set(e.external_id, e.id);
    if (e.email) byEmail.set(e.email.toLowerCase().trim(), e.id);
    if (e.name) byName.set(e.name.toLowerCase().trim(), e.id);
  }

  const toInsert: Array<ArcReaderInsert & { user_id: string }> = [];
  const toUpdate: Array<{ id: string; patch: ArcReaderInsert }> = [];

  for (const row of rows) {
    const payload = rowToInsert(row);
    if (!payload) {
      summary.skipped++;
      continue;
    }
    const extId = payload.external_id;
    let existingId =
      (extId && byExt.get(extId)) ||
      (payload.email && byEmail.get(payload.email.toLowerCase().trim())) ||
      byName.get(payload.name.toLowerCase().trim()) ||
      null;
    if (existingId) {
      toUpdate.push({ id: existingId, patch: payload });
    } else {
      toInsert.push({ ...payload, user_id: userId });
    }
  }

  // Batch insert
  for (let i = 0; i < toInsert.length; i += 200) {
    const batch = toInsert.slice(i, i + 200);
    const { error } = await supabase.from('arc_readers').insert(batch);
    if (error) {
      summary.errors.push(error.message);
      break;
    }
    summary.inserted += batch.length;
  }

  // Updates — one at a time so partial failures don't lose data.
  for (const u of toUpdate) {
    const { error } = await supabase.from('arc_readers').update(u.patch).eq('id', u.id);
    if (error) {
      summary.errors.push(`${u.patch.name}: ${error.message}`);
      continue;
    }
    summary.updated++;
  }

  return summary;
}

// ============================================
// CSV import (Notion CSV export)
// ============================================
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

export function parseNotionCsv(csv: string): NotionArcRow[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const rows: NotionArcRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length !== headers.length) continue;
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = cells[j];
    rows.push(obj as NotionArcRow);
  }
  return rows;
}

// ============================================
// Notes backfill (Notion Markdown export)
// ============================================
// Applies notes-only updates to existing arc_readers rows. Matches by
// name (case-insensitive, trimmed) since Notion's standard CSV export
// doesn't include page IDs, so most existing rows have external_id NULL.
// Returns matched / unmatched / skipped counts plus the list of names
// that didn't match.

export interface NotesBackfillEntry {
  name: string;
  notes: string;
}

export interface NotesBackfillSummary {
  matched: number;
  skippedEmpty: number;
  unmatched: string[];
  errors: string[];
}

export async function backfillNotesByName(
  userId: string,
  entries: NotesBackfillEntry[],
): Promise<NotesBackfillSummary> {
  const summary: NotesBackfillSummary = {
    matched: 0,
    skippedEmpty: 0,
    unmatched: [],
    errors: [],
  };

  // Skip empty notes — no point overwriting existing notes with blanks.
  const meaningful = entries.filter(e => {
    if (!e.name?.trim()) return false;
    if (!e.notes?.trim()) {
      summary.skippedEmpty++;
      return false;
    }
    return true;
  });
  if (meaningful.length === 0) return summary;

  // Pull all readers once for fast lookup.
  const { data: rows, error } = await supabase
    .from('arc_readers')
    .select('id, name')
    .eq('user_id', userId);
  if (error) throw error;
  const byName = new Map<string, string>();
  for (const r of rows ?? []) {
    if (r.name) byName.set(r.name.toLowerCase().trim(), r.id);
  }

  for (const entry of meaningful) {
    const id = byName.get(entry.name.toLowerCase().trim());
    if (!id) {
      summary.unmatched.push(entry.name);
      continue;
    }
    const { error: uErr } = await supabase
      .from('arc_readers')
      .update({ notes: entry.notes })
      .eq('id', id);
    if (uErr) {
      summary.errors.push(`${entry.name}: ${uErr.message}`);
      continue;
    }
    summary.matched++;
  }

  return summary;
}
