import { supabase } from '../../lib/supabase';
import type { ImportJson, ImportSummary, KdpBook, Keyword, Trope } from './types';
import type { ParsedCsv } from './utils';

export async function listTropes(userId: string): Promise<Trope[]> {
  const { data, error } = await supabase
    .from('tropes')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Trope[];
}

export async function listKeywords(userId: string): Promise<Keyword[]> {
  const { data, error } = await supabase
    .from('keywords')
    .select('*')
    .eq('user_id', userId)
    .order('text', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Keyword[];
}

export async function listKdpBooks(userId: string): Promise<KdpBook[]> {
  const { data, error } = await supabase
    .from('kdp_books')
    .select('*')
    .eq('user_id', userId)
    .order('title', { ascending: true });
  if (error) throw error;
  return (data ?? []) as KdpBook[];
}

export async function createTrope(userId: string, name: string, description = ''): Promise<Trope> {
  const { data, error } = await supabase
    .from('tropes')
    .insert({ user_id: userId, name, description })
    .select('*')
    .single();
  if (error) throw error;
  return data as Trope;
}

export async function updateTrope(id: string, patch: Partial<Pick<Trope, 'name' | 'description'>>): Promise<Trope> {
  const { data, error } = await supabase
    .from('tropes')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Trope;
}

export async function deleteTrope(id: string): Promise<void> {
  const { error } = await supabase.from('tropes').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteKeyword(id: string): Promise<void> {
  const { error } = await supabase.from('keywords').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteKeywords(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('keywords').delete().in('id', ids);
  if (error) throw error;
}

export async function moveKeywordsToTrope(ids: string[], newTropeId: string): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('keywords')
    .update({ trope_id: newTropeId })
    .in('id', ids);
  if (error) throw error;
}

// CSV import for one trope. For each parsed row we look up an existing
// keyword by (user_id, trope_id, text); if it exists we refresh the
// metrics, otherwise insert a new row. Re-uploads from Publisher
// Rocket are idempotent and just refresh the numbers.
export async function importTropeCsv(
  userId: string,
  tropeId: string,
  parsed: ParsedCsv,
): Promise<{ inserted: number; updated: number }> {
  if (parsed.rows.length === 0) return { inserted: 0, updated: 0 };

  // Find existing keywords for this trope keyed by lowercase text so we
  // can upsert without violating any unique constraint and without
  // duplicating "Curvy Girl" vs "curvy girl".
  const { data: existing, error: exErr } = await supabase
    .from('keywords')
    .select('id, text')
    .eq('user_id', userId)
    .eq('trope_id', tropeId);
  if (exErr) throw exErr;

  const existingByText = new Map<string, string>(); // lowered text -> id
  for (const e of existing ?? []) {
    existingByText.set((e.text ?? '').toLowerCase().trim(), e.id);
  }

  const toInsert: Record<string, unknown>[] = [];
  let updated = 0;

  for (const row of parsed.rows) {
    const key = row.text.toLowerCase().trim();
    const existingId = existingByText.get(key);
    const payload = {
      user_id: userId,
      trope_id: tropeId,
      text: row.text,
      search_volume: row.search_volume,
      search_volume_color: row.search_volume_color,
      competitive_score: row.competitive_score,
      competitive_score_color: row.competitive_score_color,
      competitors: row.competitors,
      avg_pages: row.avg_pages,
      avg_price: row.avg_price,
      avg_monthly_earnings: row.avg_monthly_earnings,
      last_updated: Date.now(),
    };
    if (existingId) {
      const { error } = await supabase.from('keywords').update(payload).eq('id', existingId);
      if (error) throw error;
      updated++;
    } else {
      toInsert.push(payload);
    }
  }

  for (let i = 0; i < toInsert.length; i += 200) {
    const batch = toInsert.slice(i, i + 200);
    const { error } = await supabase.from('keywords').insert(batch);
    if (error) throw error;
  }

  return { inserted: toInsert.length, updated };
}

// Merge `fromTropeIds` into `intoTropeId`: reassign all keywords and
// affected kdp_books.assigned_trope_ids entries, then delete the
// source tropes.
export async function mergeTropes(
  userId: string,
  fromTropeIds: string[],
  intoTropeId: string,
): Promise<void> {
  const sources = fromTropeIds.filter(id => id !== intoTropeId);
  if (sources.length === 0) return;

  // 1. Move keywords (dedupe by text within target trope).
  const { data: targetKws } = await supabase
    .from('keywords')
    .select('text')
    .eq('user_id', userId)
    .eq('trope_id', intoTropeId);
  const targetTexts = new Set<string>(
    (targetKws ?? []).map(k => (k.text ?? '').toLowerCase().trim()),
  );

  const { data: srcKws } = await supabase
    .from('keywords')
    .select('id, text')
    .eq('user_id', userId)
    .in('trope_id', sources);

  const toMove: string[] = [];
  const toDrop: string[] = [];
  for (const k of srcKws ?? []) {
    const key = (k.text ?? '').toLowerCase().trim();
    if (targetTexts.has(key)) toDrop.push(k.id);
    else {
      toMove.push(k.id);
      targetTexts.add(key);
    }
  }
  if (toMove.length > 0) await moveKeywordsToTrope(toMove, intoTropeId);
  if (toDrop.length > 0) await deleteKeywords(toDrop);

  // 2. Rewrite assigned_trope_ids on every kdp_books row that
  //    references any source trope.
  const { data: books } = await supabase
    .from('kdp_books')
    .select('id, assigned_trope_ids')
    .eq('user_id', userId);
  for (const b of books ?? []) {
    const ids: string[] = Array.isArray(b.assigned_trope_ids) ? b.assigned_trope_ids : [];
    if (!ids.some(id => sources.includes(id))) continue;
    const next = Array.from(new Set(ids.map(id => (sources.includes(id) ? intoTropeId : id))));
    const { error } = await supabase
      .from('kdp_books')
      .update({ assigned_trope_ids: next })
      .eq('id', b.id);
    if (error) throw error;
  }

  // 3. Delete the source tropes.
  const { error: delErr } = await supabase.from('tropes').delete().in('id', sources);
  if (delErr) throw delErr;
}

export async function updateKdpBook(
  id: string,
  patch: Partial<Pick<KdpBook, 'book_id' | 'title' | 'subtitle' | 'series' | 'amazon_categories' | 'assigned_trope_ids' | 'selected_keyword_ids'>>,
): Promise<KdpBook> {
  const { data, error } = await supabase
    .from('kdp_books')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as KdpBook;
}

// ============================================
// JSON IMPORT
// ============================================
// The user's old app uses short string IDs (e.g. "ktifmlp"). Our schema
// uses UUIDs. On import we keep the original short ID in external_id so
// re-imports are idempotent (upsert keyed on user_id + external_id), and
// we remap assigned_trope_ids / selected_keyword_ids to the new UUIDs at
// insert time.

export async function importJson(userId: string, raw: ImportJson): Promise<ImportSummary> {
  const summary: ImportSummary = {
    tropes: { inserted: 0, updated: 0 },
    keywords: { inserted: 0, updated: 0 },
    books: { inserted: 0, updated: 0 },
  };

  // ---- Tropes ----
  // Fetch existing rows that already have an external_id so we know what to update.
  const tropeExternalIds = raw.tropes.map(t => t.id);
  const { data: existingTropes } = await supabase
    .from('tropes')
    .select('id, external_id')
    .eq('user_id', userId)
    .in('external_id', tropeExternalIds.length ? tropeExternalIds : ['__none__']);

  const tropeIdMap = new Map<string, string>(); // external_id -> internal UUID
  for (const e of existingTropes ?? []) {
    if (e.external_id) tropeIdMap.set(e.external_id, e.id);
  }

  const tropesToInsert = raw.tropes
    .filter(t => !tropeIdMap.has(t.id))
    .map(t => ({
      user_id: userId,
      external_id: t.id,
      name: t.name,
      description: t.description ?? '',
    }));

  if (tropesToInsert.length > 0) {
    const { data, error } = await supabase
      .from('tropes')
      .insert(tropesToInsert)
      .select('id, external_id');
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.external_id) tropeIdMap.set(row.external_id, row.id);
    }
    summary.tropes.inserted = tropesToInsert.length;
  }

  // Update existing tropes' names/descriptions in case they changed.
  for (const t of raw.tropes) {
    const internalId = tropeIdMap.get(t.id);
    if (!internalId) continue;
    const exists = existingTropes?.find(e => e.external_id === t.id);
    if (!exists) continue;
    const { error } = await supabase
      .from('tropes')
      .update({ name: t.name, description: t.description ?? '' })
      .eq('id', internalId);
    if (error) throw error;
    summary.tropes.updated++;
  }

  // ---- Keywords ----
  const keywordExternalIds = raw.keywords.map(k => k.id);
  const { data: existingKeywords } = await supabase
    .from('keywords')
    .select('id, external_id')
    .eq('user_id', userId)
    .in('external_id', keywordExternalIds.length ? keywordExternalIds : ['__none__']);

  const keywordIdMap = new Map<string, string>();
  for (const e of existingKeywords ?? []) {
    if (e.external_id) keywordIdMap.set(e.external_id, e.id);
  }

  // Only keep keywords whose trope was successfully imported.
  const importableKeywords = raw.keywords.filter(k => tropeIdMap.has(k.tropeId));

  const keywordsToInsert = importableKeywords
    .filter(k => !keywordIdMap.has(k.id))
    .map(k => ({
      user_id: userId,
      external_id: k.id,
      text: k.text,
      trope_id: tropeIdMap.get(k.tropeId)!,
      search_volume: k.searchVolume ?? 0,
      search_volume_color: k.searchVolumeColor ?? '',
      competitive_score: k.competitiveScore ?? 0,
      competitive_score_color: k.competitiveScoreColor ?? '',
      competitors: k.competitors ?? 0,
      avg_pages: k.avgPages ?? 0,
      avg_price: k.avgPrice ?? 0,
      avg_monthly_earnings: k.avgMonthlyEarnings ?? 0,
      last_updated: k.lastUpdated ?? null,
    }));

  // Supabase has a payload limit; chunk inserts.
  for (let i = 0; i < keywordsToInsert.length; i += 200) {
    const batch = keywordsToInsert.slice(i, i + 200);
    const { data, error } = await supabase
      .from('keywords')
      .insert(batch)
      .select('id, external_id');
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.external_id) keywordIdMap.set(row.external_id, row.id);
    }
  }
  summary.keywords.inserted = keywordsToInsert.length;

  // Update existing keywords' metrics in chunks.
  const keywordUpdates = importableKeywords.filter(k => existingKeywords?.find(e => e.external_id === k.id));
  for (const k of keywordUpdates) {
    const internalId = keywordIdMap.get(k.id);
    if (!internalId) continue;
    const { error } = await supabase
      .from('keywords')
      .update({
        text: k.text,
        trope_id: tropeIdMap.get(k.tropeId)!,
        search_volume: k.searchVolume ?? 0,
        search_volume_color: k.searchVolumeColor ?? '',
        competitive_score: k.competitiveScore ?? 0,
        competitive_score_color: k.competitiveScoreColor ?? '',
        competitors: k.competitors ?? 0,
        avg_pages: k.avgPages ?? 0,
        avg_price: k.avgPrice ?? 0,
        avg_monthly_earnings: k.avgMonthlyEarnings ?? 0,
        last_updated: k.lastUpdated ?? null,
      })
      .eq('id', internalId);
    if (error) throw error;
    summary.keywords.updated++;
  }

  // ---- KDP Books ----
  const bookExternalIds = raw.books.map(b => b.id);
  const { data: existingKdpBooks } = await supabase
    .from('kdp_books')
    .select('id, external_id')
    .eq('user_id', userId)
    .in('external_id', bookExternalIds.length ? bookExternalIds : ['__none__']);

  const kdpBookIdMap = new Map<string, string>();
  for (const e of existingKdpBooks ?? []) {
    if (e.external_id) kdpBookIdMap.set(e.external_id, e.id);
  }

  // Attempt to auto-link to a catalog book by title (case-insensitive).
  const { data: catalogBooks } = await supabase
    .from('books')
    .select('id, title')
    .eq('user_id', userId);
  const catalogByTitle = new Map<string, string>();
  for (const cb of catalogBooks ?? []) {
    catalogByTitle.set((cb.title ?? '').toLowerCase().trim(), cb.id);
  }

  const remapTropes = (ids: string[] | undefined) =>
    (ids ?? []).map(id => tropeIdMap.get(id)).filter((v): v is string => Boolean(v));
  const remapKeywords = (ids: string[] | undefined) =>
    (ids ?? []).map(id => keywordIdMap.get(id)).filter((v): v is string => Boolean(v));

  for (const b of raw.books) {
    const existingId = kdpBookIdMap.get(b.id);
    const linkedBookId = catalogByTitle.get((b.title ?? '').toLowerCase().trim()) ?? null;
    const payload = {
      user_id: userId,
      external_id: b.id,
      title: b.title,
      subtitle: b.subtitle ?? null,
      series: b.series ?? '',
      amazon_categories: b.amazonCategories ?? '',
      assigned_trope_ids: remapTropes(b.assignedTropeIds),
      selected_keyword_ids: remapKeywords(b.selectedKeywordIds),
      book_id: linkedBookId,
    };

    if (existingId) {
      const { error } = await supabase
        .from('kdp_books')
        .update(payload)
        .eq('id', existingId);
      if (error) throw error;
      summary.books.updated++;
    } else {
      const { error } = await supabase.from('kdp_books').insert(payload);
      if (error) throw error;
      summary.books.inserted++;
    }
  }

  return summary;
}

// Fetch a map of catalog book_id -> count of selected keywords. Used by
// the Catalog overview so the "missing Amazon keywords" check can read
// from KDP Optimizer instead of forcing the user to enter keywords
// twice.
export async function fetchSelectedKeywordCountsByBook(
  userId: string,
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('kdp_books')
    .select('book_id, selected_keyword_ids')
    .eq('user_id', userId)
    .not('book_id', 'is', null);
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const row of data ?? []) {
    if (!row.book_id) continue;
    const ids = Array.isArray(row.selected_keyword_ids) ? row.selected_keyword_ids : [];
    out[row.book_id] = (out[row.book_id] ?? 0) + ids.length;
  }
  return out;
}
