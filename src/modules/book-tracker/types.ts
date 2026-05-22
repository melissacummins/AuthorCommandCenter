export type TrackedBookStatus = 'active' | 'paid_off';

export const COST_CATEGORIES = [
  'Cover Design',
  'Editing',
  'Formatting',
  'Marketing',
  'Other',
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number] | string;

export interface CostLineItem {
  category: CostCategory;
  amount: number;
}

// Lightweight projection of the linked Catalog book — just what the
// tracker UI needs to display title + pen name attribution.
export interface TrackedBookCatalogRef {
  id: string;
  title: string;
  pen_name_id: string | null;
}

export interface TrackedBook {
  id: string;
  user_id: string;
  legacy_id: number | null;
  title: string;
  catalog_book?: TrackedBookCatalogRef | null;
  launch_date: string | null;
  dev_cost: number;
  cost_breakdown: CostLineItem[];
  cumulative_profit: number;
  status: TrackedBookStatus;
  payoff_date: string | null;
  payoff_quarter: string | null;
  months_to_payoff: number | null;
  catalog_book_id: string | null;
  klaviyo_list_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Helper for the UI that picks the display title — prefers the linked
// Catalog book's title (which is the source of truth going forward),
// falls back to the tracker's own title for legacy imports that weren't
// catalog-linked.
export function displayTitle(book: { title: string; catalog_book?: TrackedBookCatalogRef | null }): string {
  return book.catalog_book?.title || book.title;
}

export interface TrackedBookInsert {
  title: string;
  launch_date?: string | null;
  dev_cost?: number;
  cost_breakdown?: CostLineItem[];
  status?: TrackedBookStatus;
  catalog_book_id?: string | null;
  klaviyo_list_id?: string | null;
  notes?: string | null;
  legacy_id?: number | null;
}

export type TrackedBookUpdate = Partial<TrackedBookInsert>;

export interface QuarterlyUpdate {
  id: string;
  user_id: string;
  tracked_book_id: string;
  quarter_label: string;
  sort_key: string;
  profit: number;
  recorded_at: string;
}

export interface QuarterlyUpdateInsert {
  tracked_book_id: string;
  quarter_label: string;
  profit: number;
}

// Normalize a free-form quarter label into a sortable string. Accepts:
//   "Q4 2024"           -> "2024-Q4"
//   "Q1 2022"           -> "2022-Q1"
//   "10/31/2023"        -> "2023-10-31"
//   "12/31/2023"        -> "2023-12-31"
//   "07/31/2025"        -> "2025-07-31"
//   "2024-12-31"        -> "2024-12-31"
// Anything unrecognized falls back to the raw label.
export function normalizeQuarterSortKey(label: string): string {
  const trimmed = label.trim();
  const qMatch = trimmed.match(/^Q([1-4])\s+(\d{4})$/i);
  if (qMatch) return `${qMatch[2]}-Q${qMatch[1]}`;
  const usDate = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usDate) {
    const mm = usDate[1].padStart(2, '0');
    const dd = usDate[2].padStart(2, '0');
    return `${usDate[3]}-${mm}-${dd}`;
  }
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return trimmed;
  return trimmed;
}

// Detect translation edition suffix. "Night Shade - GE" => { base: "Night Shade", edition: "GE" }
export function parseTitleEdition(title: string): { base: string; edition: string | null } {
  const m = title.match(/^(.+?)\s+-\s+([A-Z]{2,3})$/);
  if (m) return { base: m[1].trim(), edition: m[2] };
  return { base: title, edition: null };
}

export const EDITION_LABELS: Record<string, string> = {
  GE: 'German',
  FR: 'French',
  ES: 'Spanish',
  IT: 'Italian',
  PT: 'Portuguese',
  NL: 'Dutch',
  PL: 'Polish',
  JP: 'Japanese',
};
