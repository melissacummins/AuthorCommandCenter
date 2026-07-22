// Supabase data layer for the Writing module: manuscript + chapter CRUD, word
// count rollups (onto the manuscript row and, when linked, the Catalog book +
// its book_word_logs history), and the cross-module read API other modules
// use to consume manuscript text without touching these tables directly.

import { supabase } from '../../lib/supabase';
import { logWordCount, updateBook } from '../catalog/api';
import { countWords, htmlToPlainText } from './types';
import type { Manuscript, ManuscriptInsert, ManuscriptUpdate, ManuscriptChapter, ChapterDraft, ManuscriptRevision, ManuscriptChatMessage, ManuscriptWordLog } from './types';

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

// Save the manuscript's chapter breakdown atomically and non-destructively.
//
// This routes through the `save_manuscript_chapters` Postgres RPC (migration
// 111) which runs the ENTIRE save in one transaction: it snapshots the current
// chapters into manuscript_revisions first, then upserts the provided chapters
// by id, deletes only chapters genuinely removed from the set, and recomputes
// manuscripts.word_count + today's manuscript_word_logs row — all-or-nothing.
// This replaces the old client-side delete-all-then-reinsert, which had no
// client transaction and could lose every chapter if interrupted mid-save.
//
// Chapters carry an optional `id`: existing chapters (with an id) are updated
// in place, id-less drafts (e.g. an import scan) are inserted as new rows. The
// signature and ManuscriptChapter[] return shape are unchanged for callers.
//
// The RPC owns the manuscript-level rollup (manuscripts.word_count +
// manuscript_word_logs). The linked Catalog book rollup (books.word_count +
// book_word_logs) stays here in the client so it isn't double-counted.
export async function saveChapters(
  manuscriptId: string,
  userId: string,
  drafts: ChapterDraft[],
): Promise<ManuscriptChapter[]> {
  const p_chapters = drafts.map((d, i) => ({
    // ChapterDraft carries no id today (all inserts); forward-compatible with a
    // future editor payload that passes existing chapter ids for in-place edits.
    id: (d as { id?: string }).id ?? undefined,
    idx: i,
    title: d.title,
    content_html: d.content_html,
    word_count: countWords(d.content_html),
  }));
  const { data, error } = await supabase.rpc('save_manuscript_chapters', {
    p_manuscript_id: manuscriptId,
    p_chapters,
    p_day: todayISO(),
  });
  if (error) throw error;
  const chapters = (data ?? []) as ManuscriptChapter[];
  await syncLinkedBookWordCount(manuscriptId, userId, chapters);
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

// Append a new, empty chapter after the last one.
export async function addChapter(manuscriptId: string, userId: string, title = 'New chapter'): Promise<ManuscriptChapter> {
  const existing = await listChapters(manuscriptId);
  const nextIdx = existing.length ? Math.max(...existing.map(c => c.idx)) + 1 : 0;
  const { data, error } = await supabase
    .from('manuscript_chapters')
    .insert({ manuscript_id: manuscriptId, user_id: userId, idx: nextIdx, title, content_html: '', word_count: 0 })
    .select('*')
    .single();
  if (error) throw error;
  return data as ManuscriptChapter;
}

// Renumber a manuscript's chapters to match the given id order (drag-reorder).
export async function reorderChapters(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => supabase.from('manuscript_chapters').update({ idx: i }).eq('id', id)));
}

// Combine a chapter with the one that follows it: the next chapter's content
// is appended to this one's, then the next chapter row is deleted. Idx gaps
// left behind are fine — ordering is always by idx ascending, not contiguity.
export async function mergeChapterWithNext(chapter: ManuscriptChapter, next: ManuscriptChapter): Promise<ManuscriptChapter> {
  const merged = await updateChapter(chapter.id, {
    content_html: `${chapter.content_html}\n${next.content_html}`,
  });
  await deleteChapter(next.id, chapter.manuscript_id, chapter.user_id);
  return merged;
}

// Split a chapter into two at a block boundary: this chapter keeps `beforeHtml`,
// a new chapter is inserted right after it with `afterHtml`. Chapters after the
// split point are shifted up by one idx first to make room (temporary idx
// collisions during the shift are fine — there's no uniqueness constraint).
export async function splitChapter(
  chapter: ManuscriptChapter,
  userId: string,
  beforeHtml: string,
  afterHtml: string,
): Promise<ManuscriptChapter[]> {
  const { data: following, error: followingErr } = await supabase
    .from('manuscript_chapters')
    .select('id, idx')
    .eq('manuscript_id', chapter.manuscript_id)
    .gt('idx', chapter.idx);
  if (followingErr) throw followingErr;
  await Promise.all(
    (following ?? []).map(row => supabase.from('manuscript_chapters').update({ idx: (row.idx as number) + 1 }).eq('id', row.id as string)),
  );
  await updateChapter(chapter.id, { content_html: beforeHtml });
  const { error: insertErr } = await supabase.from('manuscript_chapters').insert({
    manuscript_id: chapter.manuscript_id,
    user_id: userId,
    idx: chapter.idx + 1,
    title: `${chapter.title} (cont.)`,
    content_html: afterHtml,
    word_count: countWords(afterHtml),
  });
  if (insertErr) throw insertErr;
  await syncWordCount(chapter.manuscript_id, userId);
  return listChapters(chapter.manuscript_id);
}

// ---- Revisions -------------------------------------------------------------

export async function listRevisions(chapterId: string): Promise<ManuscriptRevision[]> {
  const { data, error } = await supabase
    .from('manuscript_revisions')
    .select('*')
    .eq('chapter_id', chapterId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ManuscriptRevision[];
}

export async function createRevision(
  chapterId: string,
  userId: string,
  contentHtml: string,
  label: string | null,
): Promise<ManuscriptRevision> {
  const { data, error } = await supabase
    .from('manuscript_revisions')
    .insert({ chapter_id: chapterId, user_id: userId, content_html: contentHtml, word_count: countWords(contentHtml), label })
    .select('*')
    .single();
  if (error) throw error;
  return data as ManuscriptRevision;
}

// Restore replaces the chapter's current content with a past revision's, but
// snapshots the content being overwritten first — so a restore is itself
// reversible from the same version-history list.
export async function restoreRevision(
  chapter: ManuscriptChapter,
  userId: string,
  revision: ManuscriptRevision,
): Promise<ManuscriptChapter> {
  await createRevision(chapter.id, userId, chapter.content_html, 'Before restore');
  return updateChapter(chapter.id, { content_html: revision.content_html });
}

// Roll chapters' word counts up onto manuscripts.word_count, today's
// manuscript_word_logs row (unconditional — this is what makes Analytics
// work with no Catalog link at all, directive §8.2), and — if the
// manuscript is linked to a Catalog book — onto that book's word_count plus
// today's book_word_logs row. Reuses Catalog's existing word-log infra
// (src/modules/catalog/api.ts) rather than a parallel one.
async function syncWordCount(manuscriptId: string, userId: string, knownChapters?: ManuscriptChapter[]): Promise<void> {
  const chapters = knownChapters ?? (await listChapters(manuscriptId));
  const total = chapters.reduce((sum, c) => sum + (c.word_count ?? 0), 0);
  const manuscript = await updateManuscript(manuscriptId, { word_count: total });
  await upsertManuscriptWordLog(manuscriptId, userId, todayISO(), total).catch(() => undefined);
  if (manuscript.book_id) {
    await updateBook(manuscript.book_id, { word_count: total }).catch(() => undefined);
    await logWordCount(userId, manuscript.book_id, todayISO(), total).catch(() => undefined);
  }
}

// Roll a manuscript's total word count onto its linked Catalog book only
// (books.word_count + today's book_word_logs row). Used by saveChapters, where
// the manuscript-level rollup (manuscripts.word_count + manuscript_word_logs)
// is already handled atomically inside the save_manuscript_chapters RPC — so
// this deliberately does NOT re-touch the manuscript row and nothing is
// double-counted. No-op when the manuscript isn't linked to a book.
async function syncLinkedBookWordCount(manuscriptId: string, userId: string, chapters: ManuscriptChapter[]): Promise<void> {
  const manuscript = await getManuscript(manuscriptId);
  if (!manuscript?.book_id) return;
  const total = chapters.reduce((sum, c) => sum + (c.word_count ?? 0), 0);
  await updateBook(manuscript.book_id, { word_count: total }).catch(() => undefined);
  await logWordCount(userId, manuscript.book_id, todayISO(), total).catch(() => undefined);
}

// Local (not UTC) YYYY-MM-DD for "today", matching Catalog's own helper so a
// manuscript save and a Catalog edit on the same day land on the same row.
function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// ---- Manuscript word logs (Analytics — directive §8.2/§8.8) ---------------

export async function listManuscriptWordLogs(manuscriptId: string): Promise<ManuscriptWordLog[]> {
  const { data, error } = await supabase
    .from('manuscript_word_logs')
    .select('*')
    .eq('manuscript_id', manuscriptId)
    .order('day', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ManuscriptWordLog[];
}

async function upsertManuscriptWordLog(manuscriptId: string, userId: string, day: string, wordCount: number): Promise<void> {
  const { error } = await supabase
    .from('manuscript_word_logs')
    .upsert({ manuscript_id: manuscriptId, user_id: userId, day, word_count: wordCount }, { onConflict: 'manuscript_id,day' });
  if (error) throw error;
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

// ---- Manuscript chat -------------------------------------------------------
// One thread per manuscript (directive §6.3) — flat messages, no session table.

export async function listManuscriptChatMessages(manuscriptId: string): Promise<ManuscriptChatMessage[]> {
  const { data, error } = await supabase
    .from('manuscript_chats')
    .select('*')
    .eq('manuscript_id', manuscriptId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ManuscriptChatMessage[];
}

export async function addManuscriptChatMessage(
  manuscriptId: string,
  userId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<ManuscriptChatMessage> {
  const { data, error } = await supabase
    .from('manuscript_chats')
    .insert({ manuscript_id: manuscriptId, user_id: userId, role, content })
    .select('*')
    .single();
  if (error) throw error;
  return data as ManuscriptChatMessage;
}

export async function clearManuscriptChat(manuscriptId: string): Promise<void> {
  const { error } = await supabase.from('manuscript_chats').delete().eq('manuscript_id', manuscriptId);
  if (error) throw error;
}
