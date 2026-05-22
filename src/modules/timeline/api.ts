import { supabase } from '../../lib/supabase';
import type { Book } from '../catalog/types';
import type { Promotion } from '../promotions/types';
import type { NewsletterEvent } from '../newsletters/types';
import type { TimelineEvent, TimelineRange, TimelineSummary } from './types';

// Daily-metrics column groupings. Keep in sync with migration 001's
// book_daily_metrics definition. Custom categories (custom_amounts
// JSONB) are merged onto whichever side they belong to via
// profit_categories.type ('ad' or 'revenue').
const REVENUE_COLUMNS = [
  'amazon_rev', 'shopify_rev', 'd2d_rev', 'google_rev', 'kobo_rev', 'kobo_plus_rev',
] as const;
const AD_COLUMNS = ['pnr_ads', 'contemp_ads', 'traffic_ads', 'misc_ads'] as const;
const REVENUE_LABELS: Record<string, string> = {
  amazon_rev:    'Amazon',
  shopify_rev:   'Shopify',
  d2d_rev:       'D2D',
  google_rev:    'Google',
  kobo_rev:      'Kobo',
  kobo_plus_rev: 'Kobo Plus',
};

interface DailyRow {
  date: string;
  pnr_ads: number; contemp_ads: number; traffic_ads: number; misc_ads: number;
  shopify_rev: number; amazon_rev: number; d2d_rev: number;
  google_rev: number; kobo_rev: number; kobo_plus_rev: number;
  custom_amounts: Record<string, number> | null;
}

interface ProfitCategoryRow {
  id: string;
  type: 'ad' | 'revenue';
  name: string;
  legacy_column: string | null;
  is_custom: boolean;
}

// Public-facing source labels with their values for one day. Used by
// the chart's stacked-bar renderer.
export function revenueLabel(key: string): string {
  return REVENUE_LABELS[key] ?? key;
}

// Look up the Profit-module book_products row whose title matches the
// given Catalog book (case-insensitive, trimmed). Returns null when
// no match exists — Profit hasn't tracked that book yet.
//
// Title-match is the v1 link between Catalog and Profit. A proper FK
// can be added in a later PR without breaking Profit; this function
// becomes the place to swap in book_products.book_id once it's there.
async function findProfitBookId(userId: string, catalogTitle: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('book_products')
    .select('id, title')
    .eq('user_id', userId);
  if (error) throw error;
  const target = catalogTitle.trim().toLowerCase();
  return ((data ?? []) as Array<{ id: string; title: string }>)
    .find(r => (r.title ?? '').trim().toLowerCase() === target)?.id ?? null;
}

interface FetchInput {
  userId: string;
  book: Book;
  range: TimelineRange | null;
}

export interface TimelineData {
  events: TimelineEvent[];
  summary: TimelineSummary;
  // Daily rows pre-sorted asc so the chart can iterate directly.
  daily: Array<Extract<TimelineEvent, { kind: 'daily_revenue' }>>;
  // Pulled out from events for quick rendering of the event log.
  markers: Array<Exclude<TimelineEvent, { kind: 'daily_revenue' }>>;
}

// Fetch every event source for one book + range. Each subquery is
// independent so we parallelize them. Returns a single TimelineData
// the page can render without further joins.
export async function fetchTimeline({ userId, book, range }: FetchInput): Promise<TimelineData> {
  const [
    profitBookId,
    categories,
    promotions,
    newsletters,
    arcRows,
  ] = await Promise.all([
    findProfitBookId(userId, book.title),
    fetchProfitCategories(userId),
    fetchPromotions(userId, book.id, range),
    fetchNewsletters(userId, book.id, range),
    fetchArcEvents(userId, book.id, range),
  ]);

  const daily = profitBookId
    ? await fetchDailyMetrics(userId, profitBookId, range, categories)
    : [];

  const events: TimelineEvent[] = [
    ...daily,
    ...promotions,
    ...newsletters,
    ...arcRows,
    ...buildLaunchEvents(book, range),
  ];

  const markers = events.filter((e): e is Exclude<TimelineEvent, { kind: 'daily_revenue' }> => e.kind !== 'daily_revenue');
  markers.sort((a, b) => b.date.localeCompare(a.date)); // newest first for the log

  const summary: TimelineSummary = {
    revenue_total:     daily.reduce((s, d) => s + d.revenue_total, 0),
    ad_spend_total:    daily.reduce((s, d) => s + d.ad_spend, 0),
    net:               0,
    promo_count:       markers.filter(m => m.kind === 'promo').length,
    newsletter_count:  markers.filter(m => m.kind === 'newsletter').length,
    launch_count:      markers.filter(m => m.kind === 'launch').length,
    arc_event_count:   markers.filter(m => m.kind === 'arc').length,
  };
  summary.net = summary.revenue_total - summary.ad_spend_total;

  return { events, summary, daily, markers };
}

async function fetchProfitCategories(userId: string): Promise<ProfitCategoryRow[]> {
  const { data, error } = await supabase
    .from('profit_categories')
    .select('id, type, name, legacy_column, is_custom')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as ProfitCategoryRow[];
}

async function fetchDailyMetrics(
  userId: string,
  profitBookId: string,
  range: TimelineRange | null,
  categories: ProfitCategoryRow[],
): Promise<Array<Extract<TimelineEvent, { kind: 'daily_revenue' }>>> {
  let q = supabase
    .from('book_daily_metrics')
    .select('date, pnr_ads, contemp_ads, traffic_ads, misc_ads, shopify_rev, amazon_rev, d2d_rev, google_rev, kobo_rev, kobo_plus_rev, custom_amounts')
    .eq('user_id', userId)
    .eq('book_id', profitBookId)
    .order('date', { ascending: true });
  if (range) q = q.gte('date', range.start).lte('date', range.end);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as DailyRow[];

  const customAdIds   = new Set(categories.filter(c => c.type === 'ad'      && c.is_custom).map(c => c.id));
  const customRevIds  = new Set(categories.filter(c => c.type === 'revenue' && c.is_custom).map(c => c.id));
  const customLabels: Record<string, string> = Object.fromEntries(categories.filter(c => c.is_custom).map(c => [c.id, c.name]));

  return rows.map(r => {
    const sources: Record<string, number> = {};
    for (const k of REVENUE_COLUMNS) if (r[k]) sources[REVENUE_LABELS[k]] = Number(r[k]);
    let revenue = REVENUE_COLUMNS.reduce((s, k) => s + Number(r[k] ?? 0), 0);
    let adSpend = AD_COLUMNS.reduce((s, k) => s + Number(r[k] ?? 0), 0);
    for (const [id, amount] of Object.entries(r.custom_amounts ?? {})) {
      const n = Number(amount) || 0;
      if (customAdIds.has(id))  adSpend += n;
      if (customRevIds.has(id)) {
        revenue += n;
        if (n) sources[customLabels[id] ?? 'Custom'] = (sources[customLabels[id] ?? 'Custom'] ?? 0) + n;
      }
    }
    return {
      kind: 'daily_revenue' as const,
      date: r.date,
      sources,
      revenue_total: revenue,
      ad_spend: adSpend,
    };
  });
}

async function fetchPromotions(
  userId: string,
  bookId: string,
  range: TimelineRange | null,
): Promise<Array<Extract<TimelineEvent, { kind: 'promo' }>>> {
  let q = supabase
    .from('promotions')
    .select('*')
    .eq('user_id', userId)
    .eq('book_id', bookId)
    .order('starts_on', { ascending: false });
  if (range) q = q.gte('starts_on', range.start).lte('starts_on', range.end);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Promotion[]).map(p => ({
    kind: 'promo' as const,
    date: p.starts_on,
    promotion: p,
  }));
}

async function fetchNewsletters(
  userId: string,
  bookId: string,
  range: TimelineRange | null,
): Promise<Array<Extract<TimelineEvent, { kind: 'newsletter' }>>> {
  // Step 1: junction rows for this book — gives us the event ids
  // that should appear on this book's timeline.
  const { data: links, error: linkErr } = await supabase
    .from('newsletter_event_books')
    .select('newsletter_event_id')
    .eq('user_id', userId)
    .eq('book_id', bookId);
  if (linkErr) throw linkErr;
  const eventIds = (links ?? []).map((l: { newsletter_event_id: string }) => l.newsletter_event_id);
  if (eventIds.length === 0) return [];

  let q = supabase
    .from('newsletter_events')
    .select('*')
    .eq('user_id', userId)
    .in('id', eventIds)
    .order('sent_at', { ascending: false });
  if (range) q = q.gte('sent_at', `${range.start}T00:00:00`).lte('sent_at', `${range.end}T23:59:59`);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as NewsletterEvent[]).map(e => ({
    kind: 'newsletter' as const,
    date: e.sent_at.slice(0, 10),
    event: e,
  }));
}

async function fetchArcEvents(
  userId: string,
  bookId: string,
  range: TimelineRange | null,
): Promise<Array<Extract<TimelineEvent, { kind: 'arc' }>>> {
  let q = supabase
    .from('arc_reader_books')
    .select('relationship, recorded_at, reader:arc_readers!reader_id(name)')
    .eq('user_id', userId)
    .eq('book_id', bookId)
    .order('recorded_at', { ascending: false });
  if (range) q = q.gte('recorded_at', `${range.start}T00:00:00`).lte('recorded_at', `${range.end}T23:59:59`);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Array<{
    relationship: 'applied' | 'received' | 'reviewed';
    recorded_at: string;
    reader: { name: string } | null;
  }>).map(r => ({
    kind: 'arc' as const,
    date: r.recorded_at.slice(0, 10),
    reader_name: r.reader?.name ?? '(unknown reader)',
    relationship: r.relationship,
  }));
}

function buildLaunchEvents(
  book: Book,
  range: TimelineRange | null,
): Array<Extract<TimelineEvent, { kind: 'launch' }>> {
  const out: Array<Extract<TimelineEvent, { kind: 'launch' }>> = [];
  function inRange(d: string): boolean {
    if (!range) return true;
    return d >= range.start && d <= range.end;
  }
  if (book.publish_date && inRange(book.publish_date)) {
    out.push({ kind: 'launch', date: book.publish_date, book_title: book.title, phase: 'publish' });
  }
  if (book.pre_order_date && inRange(book.pre_order_date)) {
    out.push({ kind: 'launch', date: book.pre_order_date, book_title: book.title, phase: 'pre_order' });
  }
  return out;
}
