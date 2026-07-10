// Supabase data layer for the Writing module: manuscript + chapter CRUD, word
// count rollups (onto the manuscript row and, when linked, the Catalog book +
// its book_word_logs history), and the cross-module read API other modules
// use to consume manuscript text without touching these tables directly.

import { supabase } from '../../lib/supabase';
import { logWordCount, updateBook } from '../catalog/api';
import { countWords, htmlToPlainText } from './types';
import type { Manuscript, ManuscriptInsert, ManuscriptUpdate, ManuscriptChapter, ChapterDraft } from './types';

// ---- Manuscripts ----

export async function listManuscripts(userId: string): Promise<Manuscript[]> {
  const { data, error } = await supabase
    .from('manuscripts')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Manuscript[];
}

export async function getManuscript(id: string): Promise<Manuscript | null> {
  const { data, error } = await supabase.from('manuscripts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Manuscript) ?? null;
}

export async function createManuscript(userId: string, input: ManuscriptInsert): Promise<Manuscript> {
  const { data, error } = await supabase
    .from('manuscripts')
    .insert({ user_id: userId, ...input })
    .select('*')
    .single();
  if (error) throw error;
  return data as Manuscript;
}

export async function updateManuscript(id: string, patch: ManuscriptUpdate): Promise<Manuscript> {
  const { data, error } = await supabase.from('manuscripts').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data as Manuscript;
}

export async function deleteManuscript(id: string): Promise<void> {
  const { error } = await supabase.from('manuscripts').delete().eq('id', id);
  if (error) throw error;
}

// Change (or clear) a manuscript's linked Catalog book and refresh the word
// count rollup against the new link.
export async function attachBook(manuscriptId: string, userId: string, bookId: string | null): Promise<Manuscript> {
  const updated = await updateManuscript(manuscriptId, { book_id: bookId });
  await syncWordCount(manuscriptId, userId);
  return updated;
}

// ---- Chapters ----

export async function listChapters(manuscriptId: string): Promise<ManuscriptChapter[]> {
  const { data, error } = await supabase
    .from('manuscript_chapters')
    .select('*')
    .eq('manuscript_id', manuscriptId)
    .order('idx', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ManuscriptChapter[];
}

// Replace the manuscript's whole chapter breakdown with an accepted import
// scan — clears any prior chapters (their revisions cascade), inserts the new
// ones in order, and rolls the total word count up onto the manuscript row
// (and the linked Catalog book, if any).
export async function saveChapters(
  manuscriptId: string,
  userId: string,
  drafts: ChapterDraft[],
): Promise<ManuscriptChapter[]> {
  await supabase.from('manuscript_chapters').delete().eq('manuscript_id', manuscriptId);
  let chapters: ManuscriptChapter[] = [];
  if (drafts.length) {
    const rows = drafts.map((d, i) => ({
      manuscript_id: manuscriptId,
      user_id: userId,
      idx: i,
      title: d.title,
      content_html: d.content_html,
      word_count: countWords(d.content_html),
    }));
    const { data, error } = await supabase
      .from('manuscript_chapters')
      .insert(rows)
      .select('*')
      .order('idx', { ascending: true });
    if (error) throw error;
    chapters = (data ?? []) as ManuscriptChapter[];
  }
  await syncWordCount(manuscriptId, userId, chapters);
  return chapters;
}

export async function updateChapter(id: string, patch: Partial<ManuscriptChapter>): Promise<ManuscriptChapter> {
  const finalPatch = patch.content_html != null ? { ...patch, word_count: countWords(patch.content_html) } : patch;
  const { data, error } = await supabase.from('manuscript_chapters').update(finalPatch).eq('id', id).select('*').single();
  if (error) throw error;
  const updated = data as ManuscriptChapter;
  await syncWordCount(updated.manuscript_id, updated.user_id);
  return updated;
}

export async function deleteChapter(id: string, manuscriptId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('manuscript_chapters').delete().eq('id', id);
  if (error) throw error;
  await syncWordCount(manuscriptId, userId);
}

// Roll chapters' word counts up onto manuscripts.word_count, and — if the
// manuscript is linked to a Catalog book — onto that book's word_count plus
// today's book_word_logs row. Reuses Catalog's existing word-log infra
// (src/modules/catalog/api.ts) rather than a parallel one.
async function syncWordCount(manuscriptId: string, userId: string, knownChapters?: ManuscriptChapter[]): Promise<void> {
  const chapters = knownChapters ?? (await listChapters(manuscriptId));
  const total = chapters.reduce((sum, c) => sum + (c.word_count ?? 0), 0);
  const manuscript = await updateManuscript(manuscriptId, { word_count: total });
  if (manuscript.book_id) {
    await updateBook(manuscript.book_id, { word_count: total }).catch(() => undefined);
    await logWordCount(userId, manuscript.book_id, todayISO(), total).catch(() => undefined);
  }
}

// Local (not UTC) YYYY-MM-DD for "today", matching Catalog's own helper so a
// manuscript save and a Catalog edit on the same day land on the same row.
function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// ---- Cross-module read API ------------------------------------------------
// The reason this module exists: other modules (Marketing, KDP Optimizer,
// Cross-Sell, ARCs, Audiobook) read a manuscript's text through these
// functions instead of querying manuscripts/manuscript_chapters directly.

export async function getManuscriptForBook(userId: string, bookId: string): Promise<Manuscript | null> {
  const { data, error } = await supabase
    .from('manuscripts')
    .select('*')
    .eq('user_id', userId)
    .eq('book_id', bookId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Manuscript) ?? null;
}

export async function getManuscriptChapters(userId: string, manuscriptId: string): Promise<ManuscriptChapter[]> {
  const { data, error } = await supabase
    .from('manuscript_chapters')
    .select('*')
    .eq('user_id', userId)
    .eq('manuscript_id', manuscriptId)
    .order('idx', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ManuscriptChapter[];
}

// Plain text of a manuscript (or a subset of its chapters), chapters joined
// with a titled separator. No truncation here — callers truncate to whatever
// budget fits their use case (AI context, export, etc.).
export async function getManuscriptPlainText(
  userId: string,
  manuscriptId: string,
  opts?: { chapterIds?: string[] },
): Promise<string> {
  let chapters = await getManuscriptChapters(userId, manuscriptId);
  if (opts?.chapterIds) {
    const wanted = new Set(opts.chapterIds);
    chapters = chapters.filter(c => wanted.has(c.id));
  }
  return chapters
    .map(c => `=== ${c.title || 'Untitled chapter'} ===\n\n${htmlToPlainText(c.content_html)}`)
    .join('\n\n');
}
