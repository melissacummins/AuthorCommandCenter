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
import type { Book } from '../modules/catalog/types';
import { STATUS_LABELS } from '../modules/catalog/types';
import type { Manuscript } from '../modules/writing/types';
import { getProducts } from '../modules/inventory/api';
import { getSalesRates } from '../modules/inventory/api/salesRates';
import { getPendingByProduct } from '../modules/inventory/api/purchaseOrders';
import { calculateProductMetrics } from '../modules/inventory/utils';
import { calculateMetrics } from '../modules/profit-track/utils/calculations';
import { dailyRecordFromDb, profitCategoryFromDb } from '../modules/profit-track/utils/mappers';
import {
  deriveOpportunities,
  pipelinePercent,
  type AudiobookProjectLite,
  type Opportunity,
  type OpportunityDecision,
  type OpportunityDecisionValue,
} from './opportunities';

// ---------------------------------------------------------------------------
// Inventory alerts

export interface InventoryAlert {
  productId: string;
  name: string;
  sku: string;
  bookInventory: number;
  daysRemaining: number;
  reorderQty: number;
  reorderCost: number;
  status: 'REORDER NOW' | 'OUT OF STOCK';
}

/** Products at/below their reorder point, excluding do-not-reorder products
    and those already fully covered by a pending purchase order. Sorted most
    urgent first. */
export async function getInventoryAlerts(): Promise<InventoryAlert[]> {
  const [products, salesRates, pendingByProduct] = await Promise.all([
    getProducts(),
    getSalesRates(180),
    getPendingByProduct(),
  ]);

  const alerts: InventoryAlert[] = [];
  for (const p of products) {
    if (p.do_not_reorder) continue;
    const sku = (p.sku || '').trim().toUpperCase();
    const shopifyDaily = sku ? salesRates.get(sku)?.avgDaily : undefined;
    const m = calculateProductMetrics(p, products, shopifyDaily);
    if (m.status !== 'REORDER NOW' && m.status !== 'OUT OF STOCK') continue;
    const pending = pendingByProduct.get(p.id) ?? 0;
    if (m.reorderQty > 0 && pending >= m.reorderQty) continue; // already on order
    alerts.push({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      bookInventory: m.bookInventory,
      daysRemaining: m.daysRemaining,
      reorderQty: Math.max(0, m.reorderQty - pending),
      reorderCost: m.reorderCost,
      status: m.status,
    });
  }
  return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

// ---------------------------------------------------------------------------
// Month P&L

export interface MonthPnl {
  monthRevenue: number;
  monthAdSpend: number;
  monthNet: number;
  prevMonthNet: number;
  /** Latest daily-record date in range — the "as of" the widget must show,
      since Profit is manually entered. Null when nothing is entered yet. */
  lastEntryDate: string | null;
}

/** Current + previous month only — never the full history. */
export async function getMonthPnl(now: Date = new Date()): Promise<MonthPnl> {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const [recordsRes, categoriesRes] = await Promise.all([
    supabase.from('daily_records').select('*').gte('date', iso(prevFirst)).order('date'),
    supabase.from('profit_categories').select('*'),
  ]);
  if (recordsRes.error) throw recordsRes.error;
  if (categoriesRes.error) throw categoriesRes.error;

  const categories = (categoriesRes.data ?? []).map(profitCategoryFromDb);
  const records = (recordsRes.data ?? []).map(dailyRecordFromDb);
  const firstIso = iso(first);

  let monthRevenue = 0;
  let monthAdSpend = 0;
  let prevMonthNet = 0;
  let lastEntryDate: string | null = null;
  for (const r of records) {
    const m = calculateMetrics(r, categories);
    if (r.date >= firstIso) {
      monthRevenue += m.totalRevenue;
      monthAdSpend += m.totalAdSpend;
      if (!lastEntryDate || r.date > lastEntryDate) lastEntryDate = r.date;
    } else {
      prevMonthNet += m.totalRevenue - m.totalAdSpend;
    }
  }
  return { monthRevenue, monthAdSpend, monthNet: monthRevenue - monthAdSpend, prevMonthNet, lastEntryDate };
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
  if (decisionsRes.error) throw decisionsRes.error;

  const books = (booksRes.data ?? []) as Book[];
  const manuscripts = (manuscriptsRes.data ?? []) as Manuscript[];
  const audioProjects = (projectsRes.data ?? []) as AudiobookProjectLite[];
  const decisions = (decisionsRes.data ?? []) as OpportunityDecision[];
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
// Upcoming dates

export type UpcomingKind = 'release' | 'pre_order' | 'manuscript_due' | 'task';

export interface UpcomingItem {
  date: string; // YYYY-MM-DD
  label: string;
  kind: UpcomingKind;
  href: string;
}

export async function getUpcomingDates(userId: string, days = 14, now: Date = new Date()): Promise<UpcomingItem[]> {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayIso = iso(now);
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  const endIso = iso(end);

  const [booksRes, tasksRes] = await Promise.all([
    supabase
      .from('books')
      .select('id, title, publish_date, pre_order_date, manuscript_due_date')
      .eq('user_id', userId)
      .or(
        `and(publish_date.gte.${todayIso},publish_date.lte.${endIso}),` +
        `and(pre_order_date.gte.${todayIso},pre_order_date.lte.${endIso}),` +
        `and(manuscript_due_date.gte.${todayIso},manuscript_due_date.lte.${endIso})`,
      ),
    supabase
      .from('planner_tasks')
      .select('id, title, due_date')
      .eq('user_id', userId)
      .eq('done', false)
      .eq('kind', 'task')
      .eq('someday', false)
      .gte('due_date', todayIso)
      .lte('due_date', endIso)
      .order('due_date')
      .limit(30),
  ]);
  if (booksRes.error) throw booksRes.error;
  if (tasksRes.error) throw tasksRes.error;

  const items: UpcomingItem[] = [];
  const inRange = (d: string | null): d is string => !!d && d >= todayIso && d <= endIso;
  for (const b of booksRes.data ?? []) {
    if (inRange(b.publish_date)) {
      items.push({ date: b.publish_date, label: `“${b.title}” releases`, kind: 'release', href: '/catalog' });
    }
    if (inRange(b.pre_order_date)) {
      items.push({ date: b.pre_order_date, label: `“${b.title}” pre-order goes live`, kind: 'pre_order', href: '/catalog' });
    }
    if (inRange(b.manuscript_due_date)) {
      items.push({ date: b.manuscript_due_date, label: `“${b.title}” manuscript due`, kind: 'manuscript_due', href: '/writing' });
    }
  }
  for (const t of tasksRes.data ?? []) {
    items.push({ date: t.due_date as string, label: t.title, kind: 'task', href: '/planner' });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
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
  const [booksRes, projectsRes, decisionsRes] = await Promise.all([
    supabase.from('books').select('*').eq('user_id', userId),
    supabase.from('audiobook_projects').select('book_id, status').eq('user_id', userId),
    supabase.from('book_opportunity_decisions').select('book_id, opportunity_key, decision').eq('user_id', userId),
  ]);
  if (booksRes.error) throw booksRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (decisionsRes.error) throw decisionsRes.error;

  return deriveOpportunities(
    (booksRes.data ?? []) as Book[],
    (projectsRes.data ?? []) as AudiobookProjectLite[],
    (decisionsRes.data ?? []) as OpportunityDecision[],
  )
    .filter(o => o.decision !== 'dismissed')
    .slice(0, limit);
}

/** Full, ungated engine output for one book — the Catalog checklist tab. */
export async function getBookOpportunities(userId: string, bookId: string): Promise<Opportunity[]> {
  const [booksRes, projectsRes, decisionsRes] = await Promise.all([
    supabase.from('books').select('*').eq('user_id', userId),
    supabase.from('audiobook_projects').select('book_id, status').eq('user_id', userId),
    supabase.from('book_opportunity_decisions').select('book_id, opportunity_key, decision').eq('user_id', userId).eq('book_id', bookId),
  ]);
  if (booksRes.error) throw booksRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (decisionsRes.error) throw decisionsRes.error;

  return deriveOpportunities(
    (booksRes.data ?? []) as Book[],
    (projectsRes.data ?? []) as AudiobookProjectLite[],
    (decisionsRes.data ?? []) as OpportunityDecision[],
  ).filter(o => o.bookId === bookId);
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
