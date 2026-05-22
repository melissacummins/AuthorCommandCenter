import type { Promotion } from '../promotions/types';
import type { NewsletterEvent } from '../newsletters/types';

// Time window options for the picker. 'lifetime' walks all available
// dates for the book; 'custom' is bounded by user-picked start/end.
export type WindowPreset = '7d' | '30d' | '90d' | 'lifetime' | 'custom';

// Discriminated union of every Timeline event the page renders. Each
// kind maps to one source table (or computed daily roll-up); the
// event log filters/renders by `kind` and the chart picks out only
// the daily_revenue rows.
export type TimelineEvent =
  // One row per day per book: stacked revenue by source + ad spend
  // pulled out as a separate line on the chart.
  | {
      kind: 'daily_revenue';
      date: string; // YYYY-MM-DD
      sources: Record<string, number>; // {amazon: 12.34, shopify: 1.20, ...}
      revenue_total: number;
      ad_spend: number;
    }
  | { kind: 'promo';      date: string; promotion: Promotion }
  | { kind: 'newsletter'; date: string; event: NewsletterEvent }
  | { kind: 'launch';     date: string; book_title: string; phase: 'publish' | 'pre_order' }
  | {
      kind: 'arc';
      date: string;
      reader_name: string;
      relationship: 'applied' | 'received' | 'reviewed';
    };

// Filter toggles in the chip strip. 'sales' covers all daily_revenue
// (we don't separately model KU vs paid sales until the Profit
// module's schema distinguishes them). 'ads' = the ad-spend line.
export type EventFilterKind = 'sales' | 'ads' | 'promo' | 'newsletter' | 'launch' | 'arc';

export interface EventFilters {
  sales: boolean;
  ads: boolean;
  promo: boolean;
  newsletter: boolean;
  launch: boolean;
  arc: boolean;
}

export const DEFAULT_FILTERS: EventFilters = {
  sales: true, ads: true, promo: true, newsletter: true, launch: true, arc: true,
};

export interface TimelineSummary {
  revenue_total: number;
  ad_spend_total: number;
  net: number;
  promo_count: number;
  newsletter_count: number;
  launch_count: number;
  arc_event_count: number;
}

export interface TimelineRange {
  start: string; // YYYY-MM-DD inclusive
  end: string;   // YYYY-MM-DD inclusive
}

// Resolve a window preset (or custom dates) to a concrete start/end.
// 'lifetime' returns null so the caller can skip the date filter
// entirely on the underlying queries.
export function resolveRange(
  preset: WindowPreset,
  today: Date,
  custom?: TimelineRange,
): TimelineRange | null {
  if (preset === 'lifetime') return null;
  if (preset === 'custom') {
    if (!custom) return null;
    return custom;
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const end = isoDate(today);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - days + 1);
  return { start: isoDate(startDate), end };
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Color tokens for the event-log dots + chart markers. Keep these
// here so the chart and the log render the same palette.
export const EVENT_COLORS: Record<EventFilterKind, { dot: string; chip: string; text: string }> = {
  sales:      { dot: 'bg-emerald-500', chip: 'bg-emerald-50',  text: 'text-emerald-700'  },
  ads:        { dot: 'bg-orange-500',  chip: 'bg-orange-50',   text: 'text-orange-700'   },
  promo:      { dot: 'bg-pink-500',    chip: 'bg-pink-50',     text: 'text-pink-700'     },
  newsletter: { dot: 'bg-amber-500',   chip: 'bg-amber-50',    text: 'text-amber-700'    },
  launch:     { dot: 'bg-cyan-500',    chip: 'bg-cyan-50',     text: 'text-cyan-700'     },
  arc:        { dot: 'bg-purple-500',  chip: 'bg-purple-50',   text: 'text-purple-700'   },
};
