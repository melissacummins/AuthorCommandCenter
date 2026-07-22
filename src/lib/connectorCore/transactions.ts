// Client-injected transactions data core (MCP directive §1.5).
//
// Mirrors src/lib/dashboardCore.ts / finance.ts: every function takes a Supabase
// client as its first argument and NEVER imports the browser singleton
// (src/lib/supabase.ts uses import.meta.env, which doesn't exist server-side).
// The MCP server passes a per-request client built from the caller's OAuth token,
// so every query here runs under that user's RLS. We also filter by user_id
// explicitly, matching the FinStream module's own query code (src/modules/finstream/api.ts).
//
// Column shapes come straight from the app's types (Transaction, ManualSubscription,
// CashFlowNote) and the `transactions` / `manual_subscriptions` / `cash_flow_notes`
// tables in supabase/migrations/001_initial_schema.sql.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Transaction, ManualSubscription, CashFlowNote } from '../types';

// ---------------------------------------------------------------------------
// Transactions

/** Recent transactions for the user. Optional date-window (inclusive, YYYY-MM-DD)
    and row cap (default 200). Ordered newest first, matching the FinStream table. */
export async function listTransactions(
  client: SupabaseClient,
  userId: string,
  opts?: { fromDate?: string; toDate?: string; limit?: number },
): Promise<Transaction[]> {
  const limit = opts?.limit && opts.limit > 0 ? opts.limit : 200;

  let query = client
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (opts?.fromDate) query = query.gte('date', opts.fromDate);
  if (opts?.toDate) query = query.lte('date', opts.toDate);

  const { data, error } = await query.limit(limit);
  if (error) throw error;
  return (data ?? []) as Transaction[];
}

// ---------------------------------------------------------------------------
// Monthly income vs expense summary

export interface TransactionMonth {
  month: string; // YYYY-MM
  income: number;
  expenses: number;
  net: number;
}

/** Income vs expense totals grouped by month for the last N months (default 6).
    Amounts are stored positive; `type` determines the bucket. Newest month first. */
export async function getMonthlyTransactionSummary(
  client: SupabaseClient,
  userId: string,
  opts?: { months?: number; now?: Date },
): Promise<TransactionMonth[]> {
  const now = opts?.now ?? new Date();
  const months = opts?.months && opts.months > 0 ? opts.months : 6;
  // First day of the earliest month in the window.
  const first = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const fromMonth = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`;

  const { data, error } = await client
    .from('transactions')
    .select('date, amount, type')
    .eq('user_id', userId)
    .gte('date', fromMonth) // TEXT dates sort lexically; 'YYYY-MM' is a valid lower bound
    .order('date', { ascending: false });
  if (error) throw error;

  const byMonth = new Map<string, TransactionMonth>();
  for (const tx of data ?? []) {
    const month = String(tx.date).substring(0, 7);
    let entry = byMonth.get(month);
    if (!entry) {
      entry = { month, income: 0, expenses: 0, net: 0 };
      byMonth.set(month, entry);
    }
    const amt = Math.abs(Number(tx.amount) || 0);
    if (tx.type === 'income') entry.income += amt;
    else entry.expenses += amt;
    entry.net = entry.income - entry.expenses;
  }

  return Array.from(byMonth.values()).sort((a, b) => b.month.localeCompare(a.month));
}

// ---------------------------------------------------------------------------
// Recurring subscriptions

/** The user's manually-tracked recurring subscriptions / expenses. */
export async function listSubscriptions(
  client: SupabaseClient,
  userId: string,
): Promise<ManualSubscription[]> {
  const { data, error } = await client
    .from('manual_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .order('vendor_name');
  if (error) throw error;
  return (data ?? []) as ManualSubscription[];
}

// ---------------------------------------------------------------------------
// Cash-flow notes

/** Free-text cash-flow notes, one per month (user_id, month, note). Newest first. */
export async function listCashFlowNotes(
  client: SupabaseClient,
  userId: string,
): Promise<CashFlowNote[]> {
  const { data, error } = await client
    .from('cash_flow_notes')
    .select('*')
    .eq('user_id', userId)
    .order('month', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CashFlowNote[];
}

// ---------------------------------------------------------------------------
// WRITE: add a single transaction
//
// INSERT-only. Mirrors the FinStream module's addTransaction
// (src/modules/finstream/api.ts) and the `transactions` table
// (supabase/migrations/001_initial_schema.sql): columns are
// date (TEXT, required), amount (NUMERIC), type ('income' | 'expense'),
// category, description, original_description, source. Amount is stored
// positive; `type` decides the income/expense bucket. Returns the created row.

export interface AddTransactionArgs {
  /** Transaction date, YYYY-MM-DD (stored as TEXT). */
  date: string;
  /** Amount; stored as an absolute value (positive). */
  amount: number;
  type: 'income' | 'expense';
  category?: string;
  description?: string;
  /** Raw bank/import description; defaults to `description` when omitted. */
  original_description?: string;
  /** Free-text origin label (e.g. bank name, 'manual'). */
  source?: string;
}

export async function addTransaction(
  client: SupabaseClient,
  userId: string,
  args: AddTransactionArgs,
): Promise<Transaction> {
  if (!args.date) throw new Error('addTransaction: date is required (YYYY-MM-DD)');
  if (args.type !== 'income' && args.type !== 'expense') {
    throw new Error(`addTransaction: invalid type '${args.type}' (expected 'income' | 'expense')`);
  }
  const amount = Number(args.amount);
  if (!Number.isFinite(amount)) throw new Error('addTransaction: amount must be a finite number');

  const description = args.description ?? '';
  const row = {
    user_id: userId,
    date: args.date,
    description,
    original_description: args.original_description ?? description,
    amount: Math.abs(amount),
    category: args.category ?? 'Uncategorized',
    source: args.source ?? '',
    type: args.type,
  };

  const { data, error } = await client
    .from('transactions')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data as Transaction;
}

// ---------------------------------------------------------------------------
// WRITE: upsert a monthly cash-flow note
//
// UPSERT on the (user_id, month) unique key (see the cash_flow_notes table in
// supabase/migrations/001_initial_schema.sql: UNIQUE(user_id, month)). Mirrors
// FinStream's saveCashFlowNote but client-injected. Returns the stored row.

export async function saveCashFlowNote(
  client: SupabaseClient,
  userId: string,
  args: { month: string; note: string },
): Promise<CashFlowNote> {
  if (!args.month) throw new Error('saveCashFlowNote: month is required (YYYY-MM)');

  const { data, error } = await client
    .from('cash_flow_notes')
    .upsert(
      {
        user_id: userId,
        month: args.month,
        note: args.note ?? '',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,month' },
    )
    .select()
    .single();
  if (error) throw error;
  return data as CashFlowNote;
}
