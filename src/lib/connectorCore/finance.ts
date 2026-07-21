// Client-injected finance data core (MCP directive §1.5).
//
// Mirrors src/lib/dashboardCore.ts: every function takes a Supabase client as
// its first argument and NEVER imports the browser singleton (src/lib/supabase.ts
// uses import.meta.env, which doesn't exist server-side). The MCP server passes a
// per-request client built from the caller's OAuth token, so every query here runs
// under that user's RLS. We still filter by user_id explicitly where the table has
// it, matching the app's own query code.
//
// Math is never reinvented — we reuse the pure profit-track mappers/calculators the
// dashboard already relies on (calculateMetrics, dailyRecordFromDb, profitCategoryFromDb).

import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateMetrics } from '../../modules/profit-track/utils/calculations';
import { dailyRecordFromDb, profitCategoryFromDb } from '../../modules/profit-track/utils/mappers';
import type { DailyRecord, ProfitCategory } from '../../modules/profit-track/types';

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// First-of-month N months before `now` (N = 0 → current month's first).
const monthsAgoFirst = (now: Date, n: number) =>
  new Date(now.getFullYear(), now.getMonth() - n, 1);

async function fetchCategories(client: SupabaseClient, userId: string): Promise<ProfitCategory[]> {
  const { data, error } = await client
    .from('profit_categories')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map(profitCategoryFromDb);
}

// ---------------------------------------------------------------------------
// Daily records (with computed metrics)

export interface DailyRecordWithMetrics extends DailyRecord {
  totalRevenue: number;
  totalAdSpend: number;
  net: number;
}

/** Daily profit records for the user, each enriched with computed totals.
    Defaults to the last 90 days; pass `opts.fromDate` (YYYY-MM-DD) to override
    the lower bound. Ordered by date ascending. */
export async function listDailyRecords(
  client: SupabaseClient,
  userId: string,
  opts?: { fromDate?: string },
): Promise<DailyRecordWithMetrics[]> {
  let fromDate = opts?.fromDate;
  if (!fromDate) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    fromDate = isoDay(cutoff);
  }

  const [recordsRes, categories] = await Promise.all([
    client
      .from('daily_records')
      .select('*')
      .eq('user_id', userId)
      .gte('date', fromDate)
      .order('date'),
    fetchCategories(client, userId),
  ]);
  if (recordsRes.error) throw recordsRes.error;

  return (recordsRes.data ?? []).map((row) => {
    const record = dailyRecordFromDb(row);
    const m = calculateMetrics(record, categories);
    return {
      ...record,
      totalRevenue: m.totalRevenue,
      totalAdSpend: m.totalAdSpend,
      net: m.netRevenue,
    };
  });
}

// ---------------------------------------------------------------------------
// Profit categories

/** The user's custom + system profit categories (revenue and ad buckets). */
export async function listProfitCategories(
  client: SupabaseClient,
  userId: string,
): Promise<ProfitCategory[]> {
  return fetchCategories(client, userId);
}

// ---------------------------------------------------------------------------
// Multi-month P&L summary

export interface PnlMonth {
  month: string; // YYYY-MM
  revenue: number;
  adSpend: number;
  net: number;
}

export interface PnlSummary {
  months: PnlMonth[];
  totals: { revenue: number; adSpend: number; net: number };
}

/** Per-month revenue / ad spend / net for the last N months (default 6), plus
    grand totals across the window. Built from daily_records + categories using
    the same calculateMetrics the dashboard uses. */
export async function getPnlSummary(
  client: SupabaseClient,
  userId: string,
  opts?: { months?: number; now?: Date },
): Promise<PnlSummary> {
  const now = opts?.now ?? new Date();
  const months = opts?.months && opts.months > 0 ? opts.months : 6;
  const fromDate = isoDay(monthsAgoFirst(now, months - 1));

  const [recordsRes, categories] = await Promise.all([
    client
      .from('daily_records')
      .select('*')
      .eq('user_id', userId)
      .gte('date', fromDate)
      .order('date'),
    fetchCategories(client, userId),
  ]);
  if (recordsRes.error) throw recordsRes.error;

  const byMonth = new Map<string, PnlMonth>();
  const totals = { revenue: 0, adSpend: 0, net: 0 };

  for (const row of recordsRes.data ?? []) {
    const record = dailyRecordFromDb(row);
    const monthKey = record.date.substring(0, 7);
    const m = calculateMetrics(record, categories);
    let entry = byMonth.get(monthKey);
    if (!entry) {
      entry = { month: monthKey, revenue: 0, adSpend: 0, net: 0 };
      byMonth.set(monthKey, entry);
    }
    entry.revenue += m.totalRevenue;
    entry.adSpend += m.totalAdSpend;
    entry.net += m.netRevenue;
    totals.revenue += m.totalRevenue;
    totals.adSpend += m.totalAdSpend;
    totals.net += m.netRevenue;
  }

  const monthsOut = Array.from(byMonth.values()).sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  return { months: monthsOut, totals };
}
