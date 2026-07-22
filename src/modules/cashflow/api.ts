// Browser wrappers for the client-injected cash-flow data core.
//
// Same pattern as src/lib/dashboard.ts: the real query logic lives in
// src/lib/connectorCore/cashflow.ts (shared with the MCP server so both run the
// exact same code under the caller's RLS). These thin wrappers bind the browser
// Supabase singleton and take the user id from the caller (useAuth()).

import { supabase } from '../../lib/supabase';
import {
  getCashFlow as getCashFlowCore,
  upsertCashFlowWeek as upsertCashFlowWeekCore,
  addCashFlowLine as addCashFlowLineCore,
  updateCashFlowLine as updateCashFlowLineCore,
  deleteCashFlowLine as deleteCashFlowLineCore,
} from '../../lib/connectorCore/cashflow';

export type {
  CashFlowWeek,
  CashFlowWeekRow,
  CashFlowLineRow,
} from '../../lib/connectorCore/cashflow';

export function getCashFlow(userId: string, opts?: { month?: string; weekStart?: string }) {
  return getCashFlowCore(supabase, userId, opts);
}

export function upsertCashFlowWeek(
  userId: string,
  args: {
    weekStart: string;
    weekEnd: string;
    openingBalance?: number;
    actualEndingBalance?: number;
    note?: string;
  },
) {
  return upsertCashFlowWeekCore(supabase, userId, args);
}

export function addCashFlowLine(
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
) {
  return addCashFlowLineCore(supabase, userId, args);
}

export function updateCashFlowLine(
  userId: string,
  args: {
    lineId: string;
    source?: string;
    amount?: number;
    settled?: boolean;
    date?: string;
    notes?: string;
  },
) {
  return updateCashFlowLineCore(supabase, userId, args);
}

export function deleteCashFlowLine(userId: string, args: { lineId: string }) {
  return deleteCashFlowLineCore(supabase, userId, args);
}
