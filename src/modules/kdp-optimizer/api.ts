import { supabase } from '../../lib/supabase';
import type { ImportJson, ImportSummary, KdpBook, Keyword, Trope } from './types';
import { csvRowToKeywordPayload, parseCSV, toTitleCase, type KeywordRawData } from './utils';

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
// Import a Publisher Rocket CSV into a single trope. Upserts by
// (trope_id, lower(text)) so re-uploads from PR refresh metrics in
// place. Mirrors importKeywords from the standalone app.
export async function importTropeCsv(
  userId: string,
  tropeId: string,
  csvText: string,
): Promise<{ inserted: number; updated: number; rows: number }> {
  const rows = parseCSV(csvText).filter(r => r.Keyword?.trim());
  if (rows.length === 0) return { inserted: 0, updated: 0, rows: 0 };

  const { data: existing, error: exErr } = await supabase
    .from('keywords')
    .select('id, text')
    .eq('user_id', userId)
    .eq('trope_id', tropeId);
  if (exErr) throw exErr;
  const existingByText = new Map<string, string>();
  for (const e of existing ?? []) existingByText.set((e.text ?? '').toLowerCase().trim(), e.id);

  const toInsert: Record<string, unknown>[] = [];
  let updated = 0;

  for (const row of rows) {
    const key = row.Keyword.toLowerCase().trim();
    const payload = csvRowToKeywordPayload(row, userId, tropeId);
    const existingId = existingByText.get(key);
    if (existingId) {
      const { error } = await supabase.from('keywords').update(payload).eq('id', existingId);
      if (error) throw error;
      updated++;
    } else {
      toInsert.push(payload);
      existingByText.set(key, '__pending__');
    }
  }

  for (let i = 0; i < toInsert.length; i += 200) {
    const batch = toInsert.slice(i, i + 200);
    const { error } = await supabase.from('keywords').insert(batch);
    if (error) throw error;
  }
  return { inserted: toInsert.length, updated, rows: rows.length };
}

// Smart import — auto-categorize rows into existing tropes by longest
// trope name contained in the keyword text. Creates a new trope (named
// after the keyword in title case) if no match. Mirrors
// smartImportKeywords from the standalone app.
export async function smartImportKeywords(
  userId: string,
  csvText: string,
): Promise<{ inserted: number; updated: number; tropesCreated: number; rows: number }> {
  const raw = parseCSV(csvText).filter(r => r.Keyword?.trim());
  if (raw.length === 0) return { inserted: 0, updated: 0, tropesCreated: 0, rows: 0 };

  const { data: tropes } = await supabase
    .from('tropes')
    .select('id, name')
    .eq('user_id', userId);

  // Local working copies — we may add to them as we go.
  const tropeList: { id: string; name: string }[] = (tropes ?? []).map(t => ({ id: t.id, name: t.name as string }));

  // Process shorter keywords first so "Curvy Girl" can become a trope
  // before "Curvy Girl Romance" tries to match it.
  const sorted = [...raw].sort((a, b) => a.Keyword.length - b.Keyword.length);

  let tropesCreated = 0;
  // Group payloads by trope_id to batch insert/update efficiently.
  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; payload: Record<string, unknown> }[] = [];

  for (const row of sorted) {
    const text = row.Keyword.trim();
    const lower = text.toLowerCase();

    // Longest trope-name substring match.
    let matched = tropeList
      .filter(t => lower.includes(t.name.toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length)[0];

    if (!matched) {
      const newName = toTitleCase(text);
      const { data: created, error: cErr } = await supabase
        .from('tropes')
        .insert({ user_id: userId, name: newName, description: 'Auto-created from import' })
        .select('id, name')
        .single();
      if (cErr) throw cErr;
      matched = { id: created.id as string, name: created.name as string };
      tropeList.push(matched);
      tropesCreated++;
    }

    const payload = csvRowToKeywordPayload(row, userId, matched.id);

    // Look up existing within trope by text — one round-trip per row;
    // fine for a few hundred rows.
    const { data: existingKw } = await supabase
      .from('keywords')
      .select('id')
      .eq('user_id', userId)
      .eq('trope_id', matched.id)
      .ilike('text', text)
      .maybeSingle();

    if (existingKw?.id) updates.push({ id: existingKw.id, payload });
    else inserts.push(payload);
  }

  for (let i = 0; i < inserts.length; i += 200) {
    const batch = inserts.slice(i, i + 200);
    const { error } = await supabase.from('keywords').insert(batch);
    if (error) throw error;
  }
  for (const u of updates) {
    const { error } = await supabase.from('keywords').update(u.payload).eq('id', u.id);
    if (error) throw error;
  }

  return { inserted: inserts.length, updated: updates.length, tropesCreated, rows: raw.length };
}

export async function copyKeywordToTrope(userId: string, keywordId: string, targetTropeId: string): Promise<void> {
  const { data: original, error: oErr } = await supabase
    .from('keywords')
    .select('*')
    .eq('id', keywordId)
    .single();
  if (oErr) throw oErr;
  if (original.trope_id === targetTropeId) return;

  const { data: existing } = await supabase
    .from('keywords')
    .select('id')
    .eq('user_id', userId)
    .eq('trope_id', targetTropeId)
    .ilike('text', original.text)
    .maybeSingle();

  const { id: _id, created_at: _ca, external_id: _xi, ...rest } = original;
  const payload = { ...rest, trope_id: targetTropeId };
  if (existing?.id) {
    const { error } = await supabase.from('keywords').update(payload).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('keywords').insert(payload);
    if (error) throw error;
  }
}

// Merge tropes into a target by NAME. Creates the target if it doesn't
// exist; reassigns every keyword from the sources to it (deduping by
// lowercased text); rewrites kdp_books.assigned_trope_ids; deletes
// the now-empty sources. Mirrors upstream mergeTropes(targetTropeName,
// sourceTropeIds).
export async function mergeTropes(
  userId: string,
  targetTropeName: string,
  sourceTropeIds: string[],
): Promise<{ targetTropeId: string }> {
  if (!targetTropeName.trim() || sourceTropeIds.length === 0) {
    throw new Error('mergeTropes: need a target name and at least one source.');
  }

  // 1. Resolve or create target trope.
  const { data: existing } = await supabase
    .from('tropes')
    .select('id, name')
    .eq('user_id', userId)
    .ilike('name', targetTropeName.trim());
  let targetId: string;
  if (existing && existing.length > 0) {
    targetId = existing[0].id as string;
  } else {
    const { data: created, error: cErr } = await supabase
      .from('tropes')
      .insert({ user_id: userId, name: targetTropeName.trim(), description: 'Merged Category' })
      .select('id')
      .single();
    if (cErr) throw cErr;
    targetId = created.id as string;
  }

  const sources = sourceTropeIds.filter(id => id !== targetId);
  if (sources.length === 0) return { targetTropeId: targetId };

  // 2. Dedupe keywords as we move them.
  const { data: targetKws } = await supabase
    .from('keywords')
    .select('text')
    .eq('user_id', userId)
    .eq('trope_id', targetId);
  const targetTexts = new Set<string>((targetKws ?? []).map(k => (k.text ?? '').toLowerCase().trim()));

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
  if (toMove.length > 0) await moveKeywordsToTrope(toMove, targetId);
  if (toDrop.length > 0) await deleteKeywords(toDrop);

  // 3. Rewrite kdp_books.assigned_trope_ids referencing any source.
  const { data: books } = await supabase
    .from('kdp_books')
    .select('id, assigned_trope_ids')
    .eq('user_id', userId);
  for (const b of books ?? []) {
    const ids: string[] = Array.isArray(b.assigned_trope_ids) ? b.assigned_trope_ids : [];
    if (!ids.some(id => sources.includes(id))) continue;
    const next = Array.from(new Set(ids.map(id => (sources.includes(id) ? targetId : id))));
    const { error } = await supabase
      .from('kdp_books')
      .update({ assigned_trope_ids: next })
      .eq('id', b.id);
    if (error) throw error;
  }

  // 4. Delete the source tropes.
  const { error: delErr } = await supabase.from('tropes').delete().in('id', sources);
  if (delErr) throw delErr;

  return { targetTropeId: targetId };
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

// Fetch the KDP record linked to a given catalog book plus its
// selected keyword rows. Used by the Catalog book form to surface
// keywords pulled from KDP without forcing the user to enter them
// twice.
export async function fetchKdpDataForCatalogBook(
  userId: string,
  catalogBookId: string,
): Promise<{ kdpBook: KdpBook; keywords: Keyword[] } | null> {
  const { data: kdpRow, error: kdpErr } = await supabase
    .from('kdp_books')
    .select('*')
    .eq('user_id', userId)
    .eq('book_id', catalogBookId)
    .maybeSingle();
  if (kdpErr) throw kdpErr;
  if (!kdpRow) return null;
  const ids: string[] = Array.isArray(kdpRow.selected_keyword_ids) ? kdpRow.selected_keyword_ids : [];
  if (ids.length === 0) return { kdpBook: kdpRow as KdpBook, keywords: [] };

  const { data: kws, error: kwErr } = await supabase
    .from('keywords')
    .select('*')
    .eq('user_id', userId)
    .in('id', ids);
  if (kwErr) throw kwErr;
  return { kdpBook: kdpRow as KdpBook, keywords: (kws ?? []) as Keyword[] };
}
