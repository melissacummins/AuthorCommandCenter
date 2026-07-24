// Scoped data layer for the Home dashboard (redesign directive §3.1).
//
// Ground rules baked in here:
//  - Every widget calls its own function so widgets load independently; a
//    slow or failing source never blocks siblings.
//  - Queries are SCOPED: current + previous month for P&L, next N days for
//    Upcoming, per-table LIMIT for the activity feed. Nothing here fetches a
//    table's full history (specifically NOT useProfitData, which pages
//    through every daily record ever).
//  - No UI in this file; Phase 2 builds the widgets on top of these.

import { supabase } from './supabase';
import { getInventoryAlertsCore, getMonthPnlCore, getUpcomingDatesCore } from './dashboardCore';
import type { Book } from '../modules/catalog/types';
import { STATUS_LABELS } from '../modules/catalog/types';
import type { Manuscript } from '../modules/writing/types';
import {
  deriveOpportunities,
  normalizePipelinePrefs,
  pipelinePercent,
  type AudiobookProjectLite,
  type Opportunity,
  type OpportunityDecision,
  type OpportunityDecisionValue,
  type PipelinePrefs,
} from './opportunities';
import { fetchSelectedKeywordCountsByBook } from '../modules/kdp-optimizer/api';

// ---------------------------------------------------------------------------
// Pipeline preferences — one JSONB blob per user in user_ui_preferences.
// Read by the opportunity engine to decide which suggestions to surface.

export async function getPipelinePrefs(userId: string): Promise<PipelinePrefs> {
  const { data, error } = await supabase
    .from('user_ui_preferences')
    .select('pipeline_prefs')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return normalizePipelinePrefs(null);
  return normalizePipelinePrefs(data?.pipeline_prefs ?? null);
}

export async function savePipelinePrefs(userId: string, prefs: PipelinePrefs): Promise<void> {
  const { error } = await supabase
    .from('user_ui_preferences')
    .upsert(
      { user_id: userId, pipeline_prefs: prefs, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Inventory alerts / Month P&L / Upcoming — implemented in dashboardCore.ts
// (client-injected so the MCP server reuses the exact same logic under the
// caller's RLS); these wrappers bind the browser singleton.

export type { InventoryAlert, MonthPnl, UpcomingItem, UpcomingKind } from './dashboardCore';

export function getInventoryAlerts() {
  return getInventoryAlertsCore(supabase);
}

export function getMonthPnl(now: Date = new Date()) {
  return getMonthPnlCore(supabase, now);
}

export function getUpcomingDates(userId: string, days = 14, now: Date = new Date()) {
  return getUpcomingDatesCore(supabase, userId, days, now);
}

// ---------------------------------------------------------------------------
// Open projects + resume

export interface OpenProject {
  book: Book;
  manuscript: Manuscript | null;
  pipelinePercent: number;
  wordCount: number;
  targetWordCount: number | null;
  updatedAt: string;
}

export interface ResumeCandidate {
  manuscriptId: string;
  title: string;
  status: Manuscript['status'];
  wordCount: number;
  targetWordCount: number | null;
  updatedAt: string;
}

export interface OpenProjectsResult {
  projects: OpenProject[];
  resume: ResumeCandidate[];
}

export async function getOpenProjects(userId: string): Promise<OpenProjectsResult> {
  const [booksRes, manuscriptsRes, projectsRes, decisionsRes] = await Promise.all([
    supabase
      .from('books')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['drafting', 'editing', 'pre_order'])
      .order('updated_at', { ascending: false }),
    supabase
      .from('manuscripts')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false }),
    supabase.from('audiobook_projects').select('book_id, status').eq('user_id', userId),
    supabase.from('book_opportunity_decisions').select('book_id, opportunity_key, decision').eq('user_id', userId),
  ]);
  if (booksRes.error) throw booksRes.error;
  if (manuscriptsRes.error) throw manuscriptsRes.error;
  if (projectsRes.error) throw projectsRes.error;
  // Decisions tolerate a missing table (migration 106 not applied yet) —
  // same convention as the Shopify sync surviving migration 104's absence.
  const books = (booksRes.data ?? []) as Book[];
  const manuscripts = (manuscriptsRes.data ?? []) as Manuscript[];
  const audioProjects = (projectsRes.data ?? []) as AudiobookProjectLite[];
  const decisions = decisionsRes.error ? [] : ((decisionsRes.data ?? []) as OpportunityDecision[]);
  const manuscriptByBook = new Map(
    manuscripts.filter(m => m.book_id).map(m => [m.book_id as string, m]),
  );

  const projects: OpenProject[] = books.map(book => {
    const ms = manuscriptByBook.get(book.id) ?? null;
    return {
      book,
      manuscript: ms,
      pipelinePercent: pipelinePercent(book, ms, audioProjects, decisions),
      wordCount: ms?.word_count ?? book.word_count ?? 0,
      targetWordCount: ms?.target_word_count ?? book.target_word_count ?? null,
      updatedAt: ms && ms.updated_at > book.updated_at ? ms.updated_at : book.updated_at,
    };
  });

  const resume: ResumeCandidate[] = manuscripts
    .filter(m => m.status !== 'final')
    .slice(0, 3)
    .map(m => ({
      manuscriptId: m.id,
      title: m.title,
      status: m.status,
      wordCount: m.word_count,
      targetWordCount: m.target_word_count,
      updatedAt: m.updated_at,
    }));

  return { projects, resume };
}

// ---------------------------------------------------------------------------
// Recent activity (derived — current state, recently changed; directive
// explicitly defers a real event log to Phase 5)

export interface ActivityItem {
  at: string; // ISO timestamp
  label: string;
  href: string;
}

export async function getRecentActivity(userId: string, limit = 8): Promise<ActivityItem[]> {
  const [booksRes, manuscriptsRes, posRes, tasksRes, arcRes] = await Promise.all([
    supabase
      .from('books')
      .select('id, title, status, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(limit),
    supabase
      .from('manuscripts')
      .select('id, title, status, word_count, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(limit),
    supabase
      .from('purchase_orders')
      .select('id, product_name, status, order_date, actual_arrival, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('planner_tasks')
      .select('id, title, done_at')
      .eq('user_id', userId)
      .eq('done', true)
      .not('done_at', 'is', null)
      .order('done_at', { ascending: false })
      .limit(limit),
    supabase
      .from('arc_readers')
      .select('id, name, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(limit),
  ]);

  const items: ActivityItem[] = [];
  if (!booksRes.error) {
    for (const b of booksRes.data ?? []) {
      items.push({
        at: b.updated_at,
        label: `“${b.title}” — ${STATUS_LABELS[b.status as keyof typeof STATUS_LABELS] ?? b.status}`,
        href: '/catalog',
      });
    }
  }
  if (!manuscriptsRes.error) {
    const msLabel: Record<string, string> = { draft: 'draft updated', revising: 'in revision', final: 'marked Final' };
    for (const m of manuscriptsRes.data ?? []) {
      items.push({
        at: m.updated_at,
        label: `“${m.title}” — manuscript ${msLabel[m.status] ?? m.status} (${Number(m.word_count).toLocaleString()} words)`,
        href: '/writing',
      });
    }
  }
  if (!posRes.error) {
    for (const po of posRes.data ?? []) {
      items.push({
        at: po.created_at,
        label: po.status === 'arrived'
          ? `PO for ${po.product_name} arrived`
          : `Ordered ${po.product_name}`,
        href: '/inventory',
      });
    }
  }
  if (!tasksRes.error) {
    for (const t of tasksRes.data ?? []) {
      items.push({ at: t.done_at as string, label: `Done: ${t.title}`, href: '/planner' });
    }
  }
  if (!arcRes.error) {
    for (const r of arcRes.data ?? []) {
      items.push({ at: r.updated_at, label: `ARC reader ${r.name} updated`, href: '/arcs' });
    }
  }

  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Opportunities

export async function getOpportunities(userId: string, limit = 5): Promise<Opportunity[]> {
  const [booksRes, projectsRes, decisionsRes, prefs, kdpKeywordCounts] = await Promise.all([
    supabase.from('books').select('*').eq('user_id', userId),
    supabase.from('audiobook_projects').select('book_id, status').eq('user_id', userId),
    supabase.from('book_opportunity_decisions').select('book_id, opportunity_key, decision').eq('user_id', userId),
    getPipelinePrefs(userId),
    fetchSelectedKeywordCountsByBook(userId).catch(() => ({} as Record<string, number>)),
  ]);
  if (booksRes.error) throw booksRes.error;
  if (projectsRes.error) throw projectsRes.error;

  return deriveOpportunities(
    (booksRes.data ?? []) as Book[],
    (projectsRes.data ?? []) as AudiobookProjectLite[],
    decisionsRes.error ? [] : ((decisionsRes.data ?? []) as OpportunityDecision[]),
    new Date(),
    { prefs, kdpKeywordCounts },
  )
    .filter(o => o.decision !== 'dismissed')
    .slice(0, limit);
}

/** Full, ungated engine output for one book — the Catalog checklist tab. */
export async function getBookOpportunities(userId: string, bookId: string): Promise<Opportunity[]> {
  const [booksRes, projectsRes, decisionsRes, prefs, kdpKeywordCounts] = await Promise.all([
    supabase.from('books').select('*').eq('user_id', userId),
    supabase.from('audiobook_projects').select('book_id, status').eq('user_id', userId),
    supabase.from('book_opportunity_decisions').select('book_id, opportunity_key, decision').eq('user_id', userId).eq('book_id', bookId),
    getPipelinePrefs(userId),
    fetchSelectedKeywordCountsByBook(userId).catch(() => ({} as Record<string, number>)),
  ]);
  if (booksRes.error) throw booksRes.error;
  if (projectsRes.error) throw projectsRes.error;

  return deriveOpportunities(
    (booksRes.data ?? []) as Book[],
    (projectsRes.data ?? []) as AudiobookProjectLite[],
    decisionsRes.error ? [] : ((decisionsRes.data ?? []) as OpportunityDecision[]),
    new Date(),
    { prefs, kdpKeywordCounts },
  ).filter(o => o.bookId === bookId);
}

export interface BookChecklist {
  opportunities: Opportunity[];
  pipelinePercent: number;
  decisions: OpportunityDecision[];
  /** Language codes of this book's existing translation children. */
  translationsDone: string[];
  /** Keywords selected for this book in the KDP Optimizer (0 when none/unlinked). */
  kdpKeywordCount: number;
  /** Set when the book itself is a translation — its checklist lives on the parent. */
  parentTitle: string | null;
}

/** Everything the Catalog checklist needs for one book in one call:
    the full engine output plus the pipeline percent. */
export async function getBookChecklist(userId: string, bookId: string): Promise<BookChecklist> {
  const [booksRes, manuscriptRes, projectsRes, decisionsRes, prefs, kdpKeywordCounts] = await Promise.all([
    supabase.from('books').select('*').eq('user_id', userId),
    supabase.from('manuscripts').select('*').eq('user_id', userId).eq('book_id', bookId).limit(1).maybeSingle(),
    supabase.from('audiobook_projects').select('book_id, status').eq('user_id', userId),
    supabase.from('book_opportunity_decisions').select('book_id, opportunity_key, decision').eq('user_id', userId).eq('book_id', bookId),
    getPipelinePrefs(userId),
    fetchSelectedKeywordCountsByBook(userId).catch(() => ({} as Record<string, number>)),
  ]);
  if (booksRes.error) throw booksRes.error;
  if (projectsRes.error) throw projectsRes.error;

  const books = (booksRes.data ?? []) as Book[];
  const book = books.find(b => b.id === bookId);
  if (!book) throw new Error('Book not found');
  const projects = (projectsRes.data ?? []) as AudiobookProjectLite[];
  const decisions = decisionsRes.error ? [] : ((decisionsRes.data ?? []) as OpportunityDecision[]);
  const manuscript = (manuscriptRes.error ? null : manuscriptRes.data) as Manuscript | null;

  return {
    opportunities: deriveOpportunities(books, projects, decisions, new Date(), { prefs, kdpKeywordCounts })
      .filter(o => o.bookId === bookId),
    pipelinePercent: pipelinePercent(book, manuscript, projects, decisions),
    decisions,
    translationsDone: books
      .filter(b => b.parent_book_id === bookId && b.language)
      .map(b => b.language as string),
    kdpKeywordCount: kdpKeywordCounts[bookId] ?? 0,
    parentTitle: book.parent_book_id
      ? books.find(b => b.id === book.parent_book_id)?.title ?? null
      : null,
  };
}

export async function setOpportunityDecision(
  userId: string,
  bookId: string,
  opportunityKey: string,
  decision: OpportunityDecisionValue,
): Promise<void> {
  const { error } = await supabase
    .from('book_opportunity_decisions')
    .upsert(
      { user_id: userId, book_id: bookId, opportunity_key: opportunityKey, decision },
      { onConflict: 'user_id,book_id,opportunity_key' },
    );
  if (error) throw error;
}

export async function clearOpportunityDecision(
  userId: string,
  bookId: string,
  opportunityKey: string,
): Promise<void> {
  const { error } = await supabase
    .from('book_opportunity_decisions')
    .delete()
    .eq('user_id', userId)
    .eq('book_id', bookId)
    .eq('opportunity_key', opportunityKey);
  if (error) throw error;
}
