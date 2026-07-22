// Client-injected weekly cash-flow data core (mirrors Melissa's weekly
// cash-flow spreadsheet).
//
// Same contract as the other connectorCore modules (writing/catalog/finance/
// transactions/…): every function takes a per-request, RLS-scoped SupabaseClient
// as its first argument and NEVER imports the browser singleton
// (src/lib/supabase.ts uses import.meta.env, which doesn't exist server-side).
// No React, no import.meta. We also filter by user_id explicitly, and throw on
// any query error. All returns are plain JSON-serializable objects.
//
// Column shapes come from the cash_flow_weeks / cash_flow_lines tables in
// supabase/migrations/112_cash_flow.sql. Worst-case / projected endings and the
// income/bill subtotals are COMPUTED here in JS, not stored.

import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Row + return shapes

export interface CashFlowWeekRow {
  id: string;
  user_id: string;
  week_start: string; // YYYY-MM-DD
  week_end: string; // YYYY-MM-DD
  opening_balance: number | null;
  actual_ending_balance: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface CashFlowLineRow {
  id: string;
  user_id: string;
  week_id: string;
  kind: 'income' | 'bill';
  line_date: string | null; // YYYY-MM-DD
  source: string;
  amount: number;
  settled: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A week plus its split-out lines and the COMPUTED cash-flow fields. */
export interface CashFlowWeek {
  week: CashFlowWeekRow;
  income: CashFlowLineRow[];
  bills: CashFlowLineRow[];
  /** Sum of income line amounts. */
  incomeSubtotal: number;
  /** Sum of bill line amounts. */
  billsSubtotal: number;
  /** opening_balance − billsSubtotal (assume zero income). null if no opening. */
  worstCaseEnding: number | null;
  /** opening_balance + incomeSubtotal − billsSubtotal. null if no opening. */
  projectedEnding: number | null;
}

// ---------------------------------------------------------------------------
// Helpers

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Order lines by line_date ascending; nulls sort last, then by created_at. */
function orderLines(lines: CashFlowLineRow[]): CashFlowLineRow[] {
  return [...lines].sort((a, b) => {
    const da = a.line_date ?? '';
    const db = b.line_date ?? '';
    if (da && db) {
      if (da !== db) return da < db ? -1 : 1;
    } else if (da || db) {
      return da ? -1 : 1; // dated lines before undated
    }
    return String(a.created_at).localeCompare(String(b.created_at));
  });
}

function buildWeek(week: CashFlowWeekRow, lines: CashFlowLineRow[]): CashFlowWeek {
  const income = orderLines(lines.filter((l) => l.kind === 'income'));
  const bills = orderLines(lines.filter((l) => l.kind === 'bill'));
  const incomeSubtotal = income.reduce((s, l) => s + num(l.amount), 0);
  const billsSubtotal = bills.reduce((s, l) => s + num(l.amount), 0);
  const hasOpening = week.opening_balance !== null && week.opening_balance !== undefined;
  const opening = num(week.opening_balance);
  return {
    week,
    income,
    bills,
    incomeSubtotal,
    billsSubtotal,
    worstCaseEnding: hasOpening ? opening - billsSubtotal : null,
    projectedEnding: hasOpening ? opening + incomeSubtotal - billsSubtotal : null,
  };
}

// ---------------------------------------------------------------------------
// READ: weeks + their lines with computed fields

/** Return the user's cash-flow weeks (each with income/bills split out and the
    computed incomeSubtotal / billsSubtotal / worstCaseEnding / projectedEnding).

    - opts.weekStart (YYYY-MM-DD) — return just that one week (or [] if none).
    - opts.month (YYYY-MM)        — return every week whose week_start falls in
                                    that calendar month.
    - neither                     — return all weeks.
    Weeks are ordered by week_start ascending. */
export async function getCashFlow(
  client: SupabaseClient,
  userId: string,
  opts?: { month?: string; weekStart?: string },
): Promise<CashFlowWeek[]> {
  let weekQuery = client
    .from('cash_flow_weeks')
    .select('*')
    .eq('user_id', userId)
    .order('week_start', { ascending: true });

  if (opts?.weekStart) {
    weekQuery = weekQuery.eq('week_start', opts.weekStart);
  } else if (opts?.month) {
    // week_start is a DATE; filter to the calendar month [first, nextMonthFirst).
    const { start, end } = monthBounds(opts.month);
    weekQuery = weekQuery.gte('week_start', start).lt('week_start', end);
  }

  const { data: weeks, error: weeksErr } = await weekQuery;
  if (weeksErr) throw weeksErr;

  const weekRows = (weeks ?? []) as CashFlowWeekRow[];
  if (weekRows.length === 0) return [];

  const weekIds = weekRows.map((w) => w.id);
  const { data: lines, error: linesErr } = await client
    .from('cash_flow_lines')
    .select('*')
    .eq('user_id', userId)
    .in('week_id', weekIds);
  if (linesErr) throw linesErr;

  const byWeek = new Map<string, CashFlowLineRow[]>();
  for (const line of (lines ?? []) as CashFlowLineRow[]) {
    const arr = byWeek.get(line.week_id);
    if (arr) arr.push(line);
    else byWeek.set(line.week_id, [line]);
  }

  return weekRows.map((w) => buildWeek(w, byWeek.get(w.id) ?? []));
}

/** First day of the given YYYY-MM month and first day of the next month, as
    YYYY-MM-DD strings, for a half-open [start, end) DATE range filter. */
function monthBounds(month: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`getCashFlow: invalid month '${month}' (expected YYYY-MM)`);
  const year = Number(m[1]);
  const mon = Number(m[2]); // 1-12
  const start = `${m[1]}-${m[2]}-01`;
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const end = `${String(nextYear).padStart(4, '0')}-${String(nextMon).padStart(2, '0')}-01`;
  return { start, end };
}

// ---------------------------------------------------------------------------
// WRITE: upsert a week

/** Upsert a week on (user_id, week_start). Only the provided optional fields are
    written, so a partial update never clobbers existing values with null.
    Returns the stored week row. */
export async function upsertCashFlowWeek(
  client: SupabaseClient,
  userId: string,
  args: {
    weekStart: string;
    weekEnd: string;
    openingBalance?: number;
    actualEndingBalance?: number;
    note?: string;
  },
): Promise<CashFlowWeekRow> {
  if (!args.weekStart) throw new Error('upsertCashFlowWeek: weekStart is required (YYYY-MM-DD)');
  if (!args.weekEnd) throw new Error('upsertCashFlowWeek: weekEnd is required (YYYY-MM-DD)');

  const row: Record<string, unknown> = {
    user_id: userId,
    week_start: args.weekStart,
    week_end: args.weekEnd,
    updated_at: new Date().toISOString(),
  };
  if (args.openingBalance !== undefined) row.opening_balance = args.openingBalance;
  if (args.actualEndingBalance !== undefined) row.actual_ending_balance = args.actualEndingBalance;
  if (args.note !== undefined) row.note = args.note;

  const { data, error } = await client
    .from('cash_flow_weeks')
    .upsert(row, { onConflict: 'user_id,week_start' })
    .select()
    .single();
  if (error) throw error;
  return data as CashFlowWeekRow;
}

// ---------------------------------------------------------------------------
// WRITE: add a line to a week

/** Add one income or bill line to a week, resolved by (user_id, week_start).
    Throws if the week doesn't exist yet (create it first via upsertCashFlowWeek).
    Returns the created line. */
export async function addCashFlowLine(
  client: SupabaseClient,
  userId: string,
  args: {
    weekStart: string;
    kind: 'income' | 'bill';
    date?: string;
    source: string;
    amount: number;
    settled?: boolean;
    notes?: string;
  },
): Promise<CashFlowLineRow> {
  if (!args.weekStart) throw new Error('addCashFlowLine: weekStart is required (YYYY-MM-DD)');
  if (args.kind !== 'income' && args.kind !== 'bill') {
    throw new Error(`addCashFlowLine: invalid kind '${args.kind}' (expected 'income' | 'bill')`);
  }
  const amount = Number(args.amount);
  if (!Number.isFinite(amount)) throw new Error('addCashFlowLine: amount must be a finite number');

  const { data: week, error: weekErr } = await client
    .from('cash_flow_weeks')
    .select('id')
    .eq('user_id', userId)
    .eq('week_start', args.weekStart)
    .maybeSingle();
  if (weekErr) throw weekErr;
  if (!week) {
    throw new Error(
      `addCashFlowLine: no cash-flow week exists for week_start ${args.weekStart}. ` +
        'Create it first with upsertCashFlowWeek({ weekStart, weekEnd }).',
    );
  }

  const row = {
    user_id: userId,
    week_id: (week as { id: string }).id,
    kind: args.kind,
    line_date: args.date ?? null,
    source: args.source ?? '',
    amount,
    settled: args.settled ?? false,
    notes: args.notes ?? null,
  };

  const { data, error } = await client
    .from('cash_flow_lines')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data as CashFlowLineRow;
}

// ---------------------------------------------------------------------------
// WRITE: update a line

/** Update only the provided fields on a line scoped to the user. Returns the
    updated line. */
export async function updateCashFlowLine(
  client: SupabaseClient,
  userId: string,
  args: {
    lineId: string;
    source?: string;
    amount?: number;
    settled?: boolean;
    date?: string;
    notes?: string;
  },
): Promise<CashFlowLineRow> {
  if (!args.lineId) throw new Error('updateCashFlowLine: lineId is required');

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (args.source !== undefined) patch.source = args.source;
  if (args.amount !== undefined) {
    const amount = Number(args.amount);
    if (!Number.isFinite(amount)) throw new Error('updateCashFlowLine: amount must be a finite number');
    patch.amount = amount;
  }
  if (args.settled !== undefined) patch.settled = args.settled;
  if (args.date !== undefined) patch.line_date = args.date;
  if (args.notes !== undefined) patch.notes = args.notes;

  const { data, error } = await client
    .from('cash_flow_lines')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', args.lineId)
    .select()
    .single();
  if (error) throw error;
  return data as CashFlowLineRow;
}

// ---------------------------------------------------------------------------
// WRITE: delete a line
//
// Deletion is allowed here: cash-flow lines are lightweight user FORECAST data,
// unlike transactions / manuscript chapters (which are never hard-deleted).

/** Delete one line, scoped by user_id. Returns { deleted: true }. */
export async function deleteCashFlowLine(
  client: SupabaseClient,
  userId: string,
  args: { lineId: string },
): Promise<{ deleted: true }> {
  if (!args.lineId) throw new Error('deleteCashFlowLine: lineId is required');

  const { error } = await client
    .from('cash_flow_lines')
    .delete()
    .eq('user_id', userId)
    .eq('id', args.lineId);
  if (error) throw error;
  return { deleted: true };
}
