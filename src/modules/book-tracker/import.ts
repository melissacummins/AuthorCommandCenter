// Parser for the legacy Firebase / localStorage export. Schema observed
// in the user's v5.1 export:
//
//   {
//     books:        LegacyActiveBook[]   // not yet paid off
//     paidOffBooks: LegacyPaidOffBook[]
//     exportDate, userEmail, version
//   }
//
// We map both arrays into a single normalized list keyed by legacy_id so
// re-imports update in place rather than duplicating.

import type {
  TrackedBookInsert,
  QuarterlyUpdateInsert,
  CostLineItem,
} from './types';
import { normalizeQuarterSortKey } from './types';

interface LegacyCostLine {
  category?: string;
  amount?: number;
}

interface LegacyQuarterUpdate {
  quarter?: string;
  profit?: number;
  date?: string;
}

interface LegacyBookCommon {
  id?: number;
  title?: string;
  createdAt?: string;
  launchDate?: string | null;
  devCost?: number;
  cumulativeProfit?: number;
  costBreakdown?: LegacyCostLine[];
  quarterlyUpdates?: LegacyQuarterUpdate[];
}

interface LegacyPaidOff extends LegacyBookCommon {
  finalProfit?: number;
  payoffDate?: string;
  payoffQuarter?: string;
  monthsToPayoff?: number;
  costCategory?: string;
}

export interface LegacyExport {
  books?: LegacyBookCommon[];
  paidOffBooks?: LegacyPaidOff[];
  exportDate?: string;
  userEmail?: string;
  version?: string;
}

export interface ParsedBook {
  book: TrackedBookInsert;
  updates: Omit<QuarterlyUpdateInsert, 'tracked_book_id'>[];
}

export interface ParseSummary {
  active: number;
  paidOff: number;
  totalUpdates: number;
  warnings: string[];
}

export interface ParseResult {
  parsed: ParsedBook[];
  summary: ParseSummary;
}

function cleanCostBreakdown(items: LegacyCostLine[] | undefined): CostLineItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter(item => item && typeof item.amount === 'number' && item.amount > 0)
    .map(item => ({
      category: typeof item.category === 'string' && item.category.trim() ? item.category.trim() : 'Other',
      amount: Number(item.amount),
    }));
}

function cleanUpdates(items: LegacyQuarterUpdate[] | undefined, warnings: string[], title: string): ParsedBook['updates'] {
  if (!Array.isArray(items)) return [];
  return items
    .filter(u => u && typeof u.profit === 'number' && typeof u.quarter === 'string' && u.quarter.trim())
    .map(u => {
      const label = u.quarter!.trim();
      // Surface unrecognized quarter formats so the user can spot bad
      // data before importing rather than after.
      const sort = normalizeQuarterSortKey(label);
      if (sort === label && !/^\d{4}-(Q[1-4]|\d{2}-\d{2})$/.test(sort)) {
        warnings.push(`${title}: quarter label "${label}" doesn't match a known format — it will sort alphabetically.`);
      }
      return {
        quarter_label: label,
        profit: Number(u.profit),
      };
    });
}

export function parseLegacyExport(raw: unknown): ParseResult {
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { parsed: [], summary: { active: 0, paidOff: 0, totalUpdates: 0, warnings: ['File is not a JSON object.'] } };
  }
  const exp = raw as LegacyExport;
  if (!Array.isArray(exp.books) && !Array.isArray(exp.paidOffBooks)) {
    return { parsed: [], summary: { active: 0, paidOff: 0, totalUpdates: 0, warnings: ['No `books` or `paidOffBooks` arrays found — is this the right file?'] } };
  }

  const parsed: ParsedBook[] = [];
  let active = 0;
  let paidOff = 0;
  let totalUpdates = 0;

  for (const legacy of exp.books ?? []) {
    if (!legacy?.title?.trim()) {
      warnings.push(`Skipped a record in "books" with no title (legacy id ${legacy?.id ?? '?'}).`);
      continue;
    }
    const cost_breakdown = cleanCostBreakdown(legacy.costBreakdown);
    const updates = cleanUpdates(legacy.quarterlyUpdates, warnings, legacy.title);
    totalUpdates += updates.length;
    active += 1;
    parsed.push({
      book: {
        title: legacy.title.trim(),
        launch_date: legacy.launchDate ? toIsoDate(legacy.launchDate) : null,
        dev_cost: typeof legacy.devCost === 'number' ? legacy.devCost : 0,
        cost_breakdown,
        status: 'active',
        legacy_id: typeof legacy.id === 'number' ? legacy.id : null,
      },
      updates,
    });
  }

  for (const legacy of exp.paidOffBooks ?? []) {
    if (!legacy?.title?.trim()) {
      warnings.push(`Skipped a record in "paidOffBooks" with no title (legacy id ${legacy?.id ?? '?'}).`);
      continue;
    }
    const cost_breakdown = cleanCostBreakdown(legacy.costBreakdown);
    const updates = cleanUpdates(legacy.quarterlyUpdates, warnings, legacy.title);
    totalUpdates += updates.length;
    paidOff += 1;
    parsed.push({
      book: {
        title: legacy.title.trim(),
        launch_date: legacy.launchDate ? toIsoDate(legacy.launchDate) : null,
        dev_cost: typeof legacy.devCost === 'number' ? legacy.devCost : 0,
        cost_breakdown,
        status: 'paid_off',
        legacy_id: typeof legacy.id === 'number' ? legacy.id : null,
      },
      updates,
    });
  }

  return {
    parsed,
    summary: { active, paidOff, totalUpdates, warnings },
  };
}

// Convert assorted launch/payoff date formats into YYYY-MM-DD. Accepts:
//   "2023-01-17"
//   "2024-11-16T00:00:00.000Z"
//   "2025-06-29T21:00:00.000Z"   <- preserve local date by reading UTC components
function toIsoDate(raw: string): string | null {
  if (!raw) return null;
  // Pure YYYY-MM-DD (no time component) — keep verbatim.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  // Use UTC components — the export stored midnight-ish UTC and we
  // don't want a TZ shift to push the date back a day.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
