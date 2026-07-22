// Client-injected data core for the Writing domain (manuscripts + chapters).
//
// These functions power the MCP connector (api/mcp.ts). Like dashboardCore.ts,
// they MUST NOT import the browser Supabase singleton (src/lib/supabase.ts uses
// import.meta.env, which doesn't exist server-side), must not import React, and
// must not use import.meta. The MCP server passes a per-request client built
// from the caller's OAuth token, so every query here runs under that user's
// RLS. Every query also filters by user_id explicitly to match the app.
//
// Tables (supabase/migrations/095_writing_manuscripts.sql):
//   manuscripts          — id, user_id, book_id, title, status, source_filename,
//                          word_count, created_at, updated_at
//   manuscript_chapters  — id, manuscript_id, user_id, idx, title, content_html,
//                          word_count, created_at, updated_at (ordered by idx ASC)

import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Result shapes (plain, JSON-serializable)

export interface ManuscriptSummary {
  id: string;
  title: string;
  status: string;
  word_count: number;
  book_id: string | null;
  source_filename: string | null;
  updated_at: string;
}

export interface ChapterMeta {
  id: string;
  idx: number;
  title: string;
  word_count: number;
}

export interface ManuscriptDetail {
  id: string;
  title: string;
  status: string;
  word_count: number;
  book_id: string | null;
  source_filename: string | null;
  created_at: string;
  updated_at: string;
  chapterCount: number;
  chapters: ChapterMeta[];
}

export interface ChapterDetail {
  id: string;
  manuscript_id: string;
  idx: number;
  title: string;
  content_html: string;
  word_count: number;
  created_at: string;
  updated_at: string;
}

export interface ManuscriptPlainText {
  manuscriptId: string;
  title: string;
  text: string;
  wordCount: number;
}

// ---------------------------------------------------------------------------
// HTML → plain text (dependency-free; mirrors modules/writing/types.ts).
// Block-ish tags become newlines so paragraphs/breaks stay readable, all other
// tags are stripped, then a small set of common entities is decoded.

function stripHtml(html: string): string {
  const text = (html ?? '')
    .replace(/<(p|div|br|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

// ---------------------------------------------------------------------------
// Manuscripts

/** All of the user's manuscripts, newest first. */
export async function listManuscripts(
  client: SupabaseClient,
  userId: string,
): Promise<ManuscriptSummary[]> {
  const { data, error } = await client
    .from('manuscripts')
    .select('id, title, status, word_count, book_id, source_filename, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ManuscriptSummary[];
}

/** One manuscript's metadata plus its chapter list (idx ASC, no content_html).
    Returns null when the manuscript doesn't exist / isn't the user's. */
export async function getManuscript(
  client: SupabaseClient,
  userId: string,
  manuscriptId: string,
): Promise<ManuscriptDetail | null> {
  const { data: manuscript, error: mErr } = await client
    .from('manuscripts')
    .select('id, title, status, word_count, book_id, source_filename, created_at, updated_at')
    .eq('user_id', userId)
    .eq('id', manuscriptId)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!manuscript) return null;

  const { data: chapterRows, error: cErr } = await client
    .from('manuscript_chapters')
    .select('id, idx, title, word_count')
    .eq('user_id', userId)
    .eq('manuscript_id', manuscriptId)
    .order('idx', { ascending: true });
  if (cErr) throw cErr;

  const chapters = (chapterRows ?? []) as ChapterMeta[];
  const totalWordCount = chapters.reduce((sum, c) => sum + (c.word_count ?? 0), 0);

  return {
    id: manuscript.id as string,
    title: manuscript.title as string,
    status: manuscript.status as string,
    // Prefer the summed chapter total; fall back to the stored rollup.
    word_count: chapters.length ? totalWordCount : ((manuscript.word_count as number) ?? 0),
    book_id: (manuscript.book_id as string | null) ?? null,
    source_filename: (manuscript.source_filename as string | null) ?? null,
    created_at: manuscript.created_at as string,
    updated_at: manuscript.updated_at as string,
    chapterCount: chapters.length,
    chapters,
  };
}

// ---------------------------------------------------------------------------
// Chapters

/** One chapter including its content_html. Returns null when not found. */
export async function getChapter(
  client: SupabaseClient,
  userId: string,
  chapterId: string,
): Promise<ChapterDetail | null> {
  const { data, error } = await client
    .from('manuscript_chapters')
    .select('id, manuscript_id, idx, title, content_html, word_count, created_at, updated_at')
    .eq('user_id', userId)
    .eq('id', chapterId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as ChapterDetail;
}

/** Whole manuscript as plain text: every chapter (idx ASC) with its title as a
    separator, HTML stripped to readable text. Returns null when the manuscript
    doesn't exist / isn't the user's. */
export async function getManuscriptPlainText(
  client: SupabaseClient,
  userId: string,
  manuscriptId: string,
): Promise<ManuscriptPlainText | null> {
  const { data: manuscript, error: mErr } = await client
    .from('manuscripts')
    .select('id, title')
    .eq('user_id', userId)
    .eq('id', manuscriptId)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!manuscript) return null;

  const { data: chapterRows, error: cErr } = await client
    .from('manuscript_chapters')
    .select('idx, title, content_html')
    .eq('user_id', userId)
    .eq('manuscript_id', manuscriptId)
    .order('idx', { ascending: true });
  if (cErr) throw cErr;

  const text = (chapterRows ?? [])
    .map(c => {
      const heading = (c.title as string) || 'Untitled chapter';
      return `=== ${heading} ===\n\n${stripHtml(c.content_html as string)}`;
    })
    .join('\n\n');

  return {
    manuscriptId: manuscript.id as string,
    title: manuscript.title as string,
    text,
    wordCount: countWords(text),
  };
}

// ---------------------------------------------------------------------------
// WRITE helpers (dependency-free; mirror src/modules/writing)
// ---------------------------------------------------------------------------

// Word count from HTML — strip tags, count whitespace-delimited runs. Mirrors
// countWords() in src/modules/writing/types.ts so a chapter added from Cowork
// counts identically to one added in the app. (The stripHtml/countWords pair
// above is for read-side plain-text extraction and intentionally left alone.)
function countWordsHtml(html: string): number {
  const text = (html ?? '').replace(/<[^>]+>/g, ' ');
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

// Escape the HTML-significant characters in plain text before wrapping it in
// tags, so stray & < > in prose don't produce broken markup.
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Turn caller-supplied content into content_html. If it already looks like HTML
// (contains a tag), store it verbatim so formatting from a rich source survives.
// Otherwise treat it as plain text: escape it, then wrap each blank-line-
// separated paragraph in <p>…</p> (single newlines inside a paragraph become
// <br>). Matches the shape the app's DOCX import produces.
function contentToHtml(content: string): string {
  const raw = content ?? '';
  if (/<[a-z][^>]*>/i.test(raw)) return raw;
  const paragraphs = raw
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
  if (paragraphs.length === 0) return '';
  return paragraphs
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

// Local (not UTC) YYYY-MM-DD for "today", matching src/modules/writing/api.ts's
// todayISO() so a Cowork append and an in-app edit on the same day land on the
// same manuscript_word_logs row.
function todayISOLocal(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// WRITE functions
// ---------------------------------------------------------------------------

/** Create a new, empty manuscript for the user (status 'draft', word_count 0).
    Mirrors src/modules/writing/api.ts::createManuscript's row shape. */
export async function createManuscript(
  client: SupabaseClient,
  userId: string,
  args: { title: string; bookId?: string },
): Promise<ManuscriptSummary> {
  const { data, error } = await client
    .from('manuscripts')
    .insert({
      user_id: userId,
      title: args.title,
      status: 'draft',
      word_count: 0,
      book_id: args.bookId ?? null,
    })
    .select('id, title, status, word_count, book_id, source_filename, updated_at')
    .single();
  if (error) throw error;
  return data as ManuscriptSummary;
}

/** APPEND-ONLY: add one finished chapter to the end of a manuscript.
 *
 * This is the safe way to add a chapter from Cowork. It is strictly additive —
 * it computes the next idx as (max existing idx) + 1 and INSERTs a single new
 * manuscript_chapters row. It NEVER deletes or modifies existing chapters, and
 * never touches the destructive save_manuscript_chapters / delete-all paths.
 *
 * After inserting, it recomputes manuscripts.word_count as the SUM of the
 * manuscript's chapter word_counts and upserts today's manuscript_word_logs row
 * (ON CONFLICT (manuscript_id, day)), mirroring the app's syncWordCount rollup.
 *
 * Deliberately does NOT touch a linked Catalog book (books.word_count /
 * book_word_logs): the in-app path does that cross-module write, but we keep
 * the connector additive and single-module to avoid surprising cross-writes.
 */
export async function appendManuscriptChapter(
  client: SupabaseClient,
  userId: string,
  args: { manuscriptId: string; title: string; content: string },
): Promise<ChapterDetail> {
  // 1. Verify the manuscript belongs to the user.
  const { data: manuscript, error: mErr } = await client
    .from('manuscripts')
    .select('id')
    .eq('id', args.manuscriptId)
    .eq('user_id', userId)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!manuscript) throw new Error(`Manuscript not found: ${args.manuscriptId}`);

  // 2. Compute the next idx from existing chapters (append after the last).
  const { data: idxRows, error: idxErr } = await client
    .from('manuscript_chapters')
    .select('idx')
    .eq('user_id', userId)
    .eq('manuscript_id', args.manuscriptId)
    .order('idx', { ascending: false })
    .limit(1);
  if (idxErr) throw idxErr;
  const nextIdx = idxRows && idxRows.length ? (idxRows[0].idx as number) + 1 : 0;

  // 3. Build content_html + word_count the same way the app does.
  const contentHtml = contentToHtml(args.content);
  const wordCount = countWordsHtml(contentHtml);

  // 4. INSERT the new chapter (id defaults). Strictly additive — no deletes.
  const { data: inserted, error: insErr } = await client
    .from('manuscript_chapters')
    .insert({
      manuscript_id: args.manuscriptId,
      user_id: userId,
      idx: nextIdx,
      title: args.title,
      content_html: contentHtml,
      word_count: wordCount,
    })
    .select('id, manuscript_id, idx, title, content_html, word_count, created_at, updated_at')
    .single();
  if (insErr) throw insErr;
  const chapter = inserted as ChapterDetail;

  // 5. Recompute manuscripts.word_count = SUM(chapter word_counts).
  const { data: allChapters, error: sumErr } = await client
    .from('manuscript_chapters')
    .select('word_count')
    .eq('user_id', userId)
    .eq('manuscript_id', args.manuscriptId);
  if (sumErr) throw sumErr;
  const total = (allChapters ?? []).reduce((sum, c) => sum + ((c.word_count as number) ?? 0), 0);

  const { error: updErr } = await client
    .from('manuscripts')
    .update({ word_count: total })
    .eq('id', args.manuscriptId)
    .eq('user_id', userId);
  if (updErr) throw updErr;

  // 6. Upsert today's manuscript_word_logs row (Analytics day rollup).
  const { error: logErr } = await client
    .from('manuscript_word_logs')
    .upsert(
      { manuscript_id: args.manuscriptId, user_id: userId, day: todayISOLocal(), word_count: total },
      { onConflict: 'manuscript_id,day' },
    );
  if (logErr) throw logErr;

  return chapter;
}
