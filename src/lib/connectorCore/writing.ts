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
