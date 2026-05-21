import { supabase } from '../../lib/supabase';
import type {
  TrackedBook,
  TrackedBookInsert,
  TrackedBookUpdate,
  QuarterlyUpdate,
  QuarterlyUpdateInsert,
  BookBundle,
  BundleMember,
  CostLineItem,
} from './types';
import { normalizeQuarterSortKey } from './types';
import type { ParsedBook } from './import';

function sumCostBreakdown(items: CostLineItem[] | undefined): number {
  if (!items || items.length === 0) return 0;
  return items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

export async function listTrackedBooks(userId: string): Promise<TrackedBook[]> {
  const { data, error } = await supabase
    .from('tracked_books')
    .select('*')
    .eq('user_id', userId)
    .order('status', { ascending: true })
    .order('launch_date', { ascending: false, nullsFirst: false })
    .order('title', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TrackedBook[];
}

export async function createTrackedBook(userId: string, input: TrackedBookInsert): Promise<TrackedBook> {
  const dev_cost = input.dev_cost ?? sumCostBreakdown(input.cost_breakdown);
  const { data, error } = await supabase
    .from('tracked_books')
    .insert({
      user_id: userId,
      title: input.title,
      launch_date: input.launch_date ?? null,
      dev_cost,
      cost_breakdown: input.cost_breakdown ?? [],
      status: input.status ?? 'active',
      catalog_book_id: input.catalog_book_id ?? null,
      klaviyo_list_id: input.klaviyo_list_id ?? null,
      notes: input.notes ?? null,
      legacy_id: input.legacy_id ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as TrackedBook;
}

export async function updateTrackedBook(id: string, patch: TrackedBookUpdate): Promise<TrackedBook> {
  const next: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  if (patch.cost_breakdown && patch.dev_cost === undefined) {
    next.dev_cost = sumCostBreakdown(patch.cost_breakdown);
  }
  const { data, error } = await supabase
    .from('tracked_books')
    .update(next)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as TrackedBook;
}

export async function deleteTrackedBook(id: string): Promise<void> {
  const { error } = await supabase.from('tracked_books').delete().eq('id', id);
  if (error) throw error;
}


export async function listQuarterlyUpdates(userId: string, bookId?: string): Promise<QuarterlyUpdate[]> {
  let q = supabase
    .from('quarterly_updates')
    .select('*')
    .eq('user_id', userId)
    .order('sort_key', { ascending: true });
  if (bookId) q = q.eq('tracked_book_id', bookId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as QuarterlyUpdate[];
}

// Add a quarterly update and recompute the parent book's
// cumulative_profit + payoff fields atomically (from the client's
// perspective). Returns the updated book + new entry.
export async function addQuarterlyUpdate(
  userId: string,
  input: QuarterlyUpdateInsert,
): Promise<{ entry: QuarterlyUpdate; book: TrackedBook }> {
  const sort_key = normalizeQuarterSortKey(input.quarter_label);
  const { data: entry, error: insertErr } = await supabase
    .from('quarterly_updates')
    .insert({
      user_id: userId,
      tracked_book_id: input.tracked_book_id,
      quarter_label: input.quarter_label,
      sort_key,
      profit: input.profit,
    })
    .select('*')
    .single();
  if (insertErr) throw insertErr;
  const book = await recomputeBookPayoff(userId, input.tracked_book_id);
  return { entry: entry as QuarterlyUpdate, book };
}

export async function deleteQuarterlyUpdate(userId: string, id: string, bookId: string): Promise<TrackedBook> {
  const { error } = await supabase.from('quarterly_updates').delete().eq('id', id);
  if (error) throw error;
  return recomputeBookPayoff(userId, bookId);
}

// Walk a book's quarterly updates in chronological order. Find the
// first one whose running total clears dev_cost — that's the payoff
// quarter. We also derive months_to_payoff from launch_date when both
// are present.
export async function recomputeBookPayoff(userId: string, bookId: string): Promise<TrackedBook> {
  const { data: bookRow, error: bookErr } = await supabase
    .from('tracked_books')
    .select('*')
    .eq('id', bookId)
    .eq('user_id', userId)
    .single();
  if (bookErr) throw bookErr;
  const book = bookRow as TrackedBook;

  const { data: updatesRows, error: updatesErr } = await supabase
    .from('quarterly_updates')
    .select('*')
    .eq('tracked_book_id', bookId)
    .eq('user_id', userId)
    .order('sort_key', { ascending: true });
  if (updatesErr) throw updatesErr;
  const updates = (updatesRows ?? []) as QuarterlyUpdate[];

  let running = 0;
  let payoffLabel: string | null = null;
  let payoffSortKey: string | null = null;
  for (const u of updates) {
    running += Number(u.profit) || 0;
    if (payoffLabel === null && book.dev_cost > 0 && running >= book.dev_cost) {
      payoffLabel = u.quarter_label;
      payoffSortKey = u.sort_key;
    }
  }

  let payoff_date: string | null = null;
  let months_to_payoff: number | null = null;
  if (payoffSortKey) {
    payoff_date = sortKeyToDate(payoffSortKey);
    if (payoff_date && book.launch_date) {
      months_to_payoff = monthsBetween(book.launch_date, payoff_date);
    }
  }

  const next = {
    cumulative_profit: running,
    status: (payoffLabel ? 'paid_off' : 'active') as 'active' | 'paid_off',
    payoff_quarter: payoffLabel,
    payoff_date,
    months_to_payoff,
    updated_at: new Date().toISOString(),
  };
  const { data: updatedRow, error: upErr } = await supabase
    .from('tracked_books')
    .update(next)
    .eq('id', bookId)
    .select('*')
    .single();
  if (upErr) throw upErr;
  return updatedRow as TrackedBook;
}

// Turn a normalized sort key back into a YYYY-MM-DD payoff date.
//   "2024-Q4"   -> "2024-12-31"
//   "2024-12-31"-> "2024-12-31"
function sortKeyToDate(sortKey: string): string | null {
  const quarter = sortKey.match(/^(\d{4})-Q([1-4])$/);
  if (quarter) {
    const year = quarter[1];
    const lastDayByQuarter: Record<string, string> = { '1': '03-31', '2': '06-30', '3': '09-30', '4': '12-31' };
    return `${year}-${lastDayByQuarter[quarter[2]]}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(sortKey)) return sortKey;
  return null;
}

function monthsBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}


// Bundles

export async function listBundles(userId: string): Promise<BookBundle[]> {
  const { data, error } = await supabase
    .from('book_bundles')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BookBundle[];
}

export async function createBundle(userId: string, name: string, description?: string | null): Promise<BookBundle> {
  const { data, error } = await supabase
    .from('book_bundles')
    .insert({ user_id: userId, name, description: description ?? null })
    .select('*')
    .single();
  if (error) throw error;
  return data as BookBundle;
}

export async function updateBundle(id: string, patch: { name?: string; description?: string | null }): Promise<BookBundle> {
  const { data, error } = await supabase
    .from('book_bundles')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as BookBundle;
}

export async function deleteBundle(id: string): Promise<void> {
  const { error } = await supabase.from('book_bundles').delete().eq('id', id);
  if (error) throw error;
}

export async function listBundleMembers(userId: string): Promise<BundleMember[]> {
  const { data, error } = await supabase
    .from('tracked_book_bundle_members')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as BundleMember[];
}

export async function addBookToBundle(userId: string, bundleId: string, trackedBookId: string): Promise<void> {
  const { error } = await supabase
    .from('tracked_book_bundle_members')
    .upsert({ user_id: userId, bundle_id: bundleId, tracked_book_id: trackedBookId });
  if (error) throw error;
}

export async function removeBookFromBundle(bundleId: string, trackedBookId: string): Promise<void> {
  const { error } = await supabase
    .from('tracked_book_bundle_members')
    .delete()
    .eq('bundle_id', bundleId)
    .eq('tracked_book_id', trackedBookId);
  if (error) throw error;
}


// Idempotent legacy import. For each parsed book we upsert by
// (user_id, legacy_id) — re-running the import updates existing rows
// instead of duplicating them. Quarterly updates are wiped and rebuilt
// for any book that has them, since the legacy export is the source of
// truth.
export interface ImportResult {
  booksWritten: number;
  updatesWritten: number;
  booksUpdated: number;
  booksInserted: number;
}

export async function importLegacyBooks(
  userId: string,
  parsed: ParsedBook[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  let booksWritten = 0;
  let updatesWritten = 0;
  let booksUpdated = 0;
  let booksInserted = 0;

  for (let i = 0; i < parsed.length; i += 1) {
    const { book, updates } = parsed[i];

    let row: TrackedBook | null = null;
    if (book.legacy_id != null) {
      const { data: existing } = await supabase
        .from('tracked_books')
        .select('*')
        .eq('user_id', userId)
        .eq('legacy_id', book.legacy_id)
        .maybeSingle();
      if (existing) {
        const { data: updated, error: upErr } = await supabase
          .from('tracked_books')
          .update({
            title: book.title,
            launch_date: book.launch_date ?? null,
            dev_cost: book.dev_cost ?? sumCostBreakdown(book.cost_breakdown),
            cost_breakdown: book.cost_breakdown ?? [],
            status: book.status ?? 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', (existing as TrackedBook).id)
          .select('*')
          .single();
        if (upErr) throw upErr;
        row = updated as TrackedBook;
        booksUpdated += 1;
      }
    }
    if (!row) {
      row = await createTrackedBook(userId, book);
      booksInserted += 1;
    }
    booksWritten += 1;

    // Replace quarterly updates for this book. Cheaper than diffing, and
    // the legacy export is authoritative on quarterly profit.
    await supabase.from('quarterly_updates').delete().eq('tracked_book_id', row.id).eq('user_id', userId);
    if (updates.length > 0) {
      const rows = updates.map(u => ({
        user_id: userId,
        tracked_book_id: row!.id,
        quarter_label: u.quarter_label,
        sort_key: normalizeQuarterSortKey(u.quarter_label),
        profit: u.profit,
      }));
      const { error: insErr } = await supabase.from('quarterly_updates').insert(rows);
      if (insErr) throw insErr;
      updatesWritten += rows.length;
    }

    await recomputeBookPayoff(userId, row.id);

    if (onProgress) onProgress(i + 1, parsed.length);
  }

  return { booksWritten, updatesWritten, booksUpdated, booksInserted };
}
