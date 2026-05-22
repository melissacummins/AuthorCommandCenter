import { Mail, Tag, Rocket, BookOpen, DollarSign, TrendingUp } from 'lucide-react';
import type { TimelineEvent } from '../types';
import { EVENT_COLORS } from '../types';
import { PROMO_LABELS } from '../../promotions/types';
import { openRate, clickRate } from '../../newsletters/types';

interface Props {
  // Sorted newest-first.
  events: Array<Exclude<TimelineEvent, { kind: 'daily_revenue' }>>;
  // Daily rollups (also newest-first or newest-last — we slice on
  // date with the marker events to find which days had sales/ads
  // worth surfacing in the log).
  daily: Array<Extract<TimelineEvent, { kind: 'daily_revenue' }>>;
  showSales: boolean;
  showAds: boolean;
  showPromo: boolean;
  showNewsletter: boolean;
  showLaunch: boolean;
  showArc: boolean;
}

// Per-book event log. The chart visualizes the daily totals; the log
// surfaces the discrete events (newsletters, promos, launches, ARC
// transitions) AND a per-day sales/ads summary so the user can see
// the cause-and-effect story the screenshot called out: "what you
// did, and what happened to revenue".
export default function EventLog({
  events, daily, showSales, showAds, showPromo, showNewsletter, showLaunch, showArc,
}: Props) {
  // Pull together a single chronological feed of marker events and
  // notable daily rows. We summarize "noteworthy" days (where a
  // marker happened OR revenue was meaningfully > 0) so the log
  // doesn't drown in 30 identical $1 days.
  const rows = buildFeed(events, daily, { showSales, showAds, showPromo, showNewsletter, showLaunch, showArc });

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 text-sm text-slate-500 text-center">
        No events to show with the current filters.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="font-semibold text-slate-800">
          Event log <span className="text-slate-400 font-normal">· {rows.length} events in window</span>
        </div>
        <span className="text-xs text-slate-400">Newest first</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((row, i) => (
          <li key={`${row.date}-${i}`} className="px-5 py-3 flex items-start gap-3">
            <Icon row={row} />
            <div className="flex-1 min-w-0">
              <Body row={row} />
            </div>
            <div className="text-xs text-slate-400 shrink-0">{formatDate(row.date)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Internal feed row — either a marker event or a daily summary row
// (one per day with sales or ads worth surfacing).
type FeedRow =
  | { kind: 'daily_summary'; date: string; sales: number; ads: number; topSource?: string }
  | Exclude<TimelineEvent, { kind: 'daily_revenue' }>;

function buildFeed(
  markers: Array<Exclude<TimelineEvent, { kind: 'daily_revenue' }>>,
  daily: Array<Extract<TimelineEvent, { kind: 'daily_revenue' }>>,
  show: { showSales: boolean; showAds: boolean; showPromo: boolean; showNewsletter: boolean; showLaunch: boolean; showArc: boolean },
): FeedRow[] {
  const rows: FeedRow[] = [];

  // Only include daily summaries on days that have something worth
  // saying. Threshold of $1 filters out rounding noise; days with a
  // marker event also surface their summary so the user sees the
  // immediate revenue impact next to the action.
  const meaningfulDays = new Set<string>();
  for (const m of markers) meaningfulDays.add(m.date);
  for (const d of daily) {
    if (d.revenue_total >= 1 || d.ad_spend >= 1) meaningfulDays.add(d.date);
  }

  for (const d of daily) {
    if (!meaningfulDays.has(d.date)) continue;
    if (!show.showSales && !show.showAds) continue;
    const sales = show.showSales ? d.revenue_total : 0;
    const ads   = show.showAds   ? d.ad_spend       : 0;
    if (sales === 0 && ads === 0) continue;
    const topSource = topSourceOf(d.sources);
    rows.push({ kind: 'daily_summary', date: d.date, sales, ads, topSource });
  }

  for (const m of markers) {
    if (m.kind === 'promo'      && !show.showPromo)      continue;
    if (m.kind === 'newsletter' && !show.showNewsletter) continue;
    if (m.kind === 'launch'     && !show.showLaunch)     continue;
    if (m.kind === 'arc'        && !show.showArc)        continue;
    rows.push(m);
  }

  rows.sort((a, b) => b.date.localeCompare(a.date));
  return rows;
}

function topSourceOf(sources: Record<string, number>): string | undefined {
  let best: { name: string; value: number } | null = null;
  for (const [name, value] of Object.entries(sources)) {
    if (!best || value > best.value) best = { name, value };
  }
  return best?.name;
}

function Icon({ row }: { row: FeedRow }) {
  if (row.kind === 'daily_summary') {
    const c = row.sales >= row.ads ? EVENT_COLORS.sales : EVENT_COLORS.ads;
    return (
      <span className={`w-7 h-7 rounded-full ${c.chip} flex items-center justify-center shrink-0`}>
        {row.sales >= row.ads ? (
          <DollarSign className={`w-3.5 h-3.5 ${c.text}`} />
        ) : (
          <TrendingUp className={`w-3.5 h-3.5 ${c.text}`} />
        )}
      </span>
    );
  }
  if (row.kind === 'newsletter') {
    return (
      <span className={`w-7 h-7 rounded-full ${EVENT_COLORS.newsletter.chip} flex items-center justify-center shrink-0`}>
        <Mail className={`w-3.5 h-3.5 ${EVENT_COLORS.newsletter.text}`} />
      </span>
    );
  }
  if (row.kind === 'promo') {
    return (
      <span className={`w-7 h-7 rounded-full ${EVENT_COLORS.promo.chip} flex items-center justify-center shrink-0`}>
        <Tag className={`w-3.5 h-3.5 ${EVENT_COLORS.promo.text}`} />
      </span>
    );
  }
  if (row.kind === 'launch') {
    return (
      <span className={`w-7 h-7 rounded-full ${EVENT_COLORS.launch.chip} flex items-center justify-center shrink-0`}>
        <Rocket className={`w-3.5 h-3.5 ${EVENT_COLORS.launch.text}`} />
      </span>
    );
  }
  return (
    <span className={`w-7 h-7 rounded-full ${EVENT_COLORS.arc.chip} flex items-center justify-center shrink-0`}>
      <BookOpen className={`w-3.5 h-3.5 ${EVENT_COLORS.arc.text}`} />
    </span>
  );
}

function Body({ row }: { row: FeedRow }) {
  if (row.kind === 'daily_summary') {
    return (
      <div>
        <div className="text-sm font-medium text-slate-800">
          {row.sales > 0 && <>Sales: <span className="text-emerald-700">${row.sales.toFixed(2)}</span></>}
          {row.sales > 0 && row.ads > 0 && <span className="text-slate-300 mx-1.5">·</span>}
          {row.ads > 0 && <>Ad spend: <span className="text-orange-700">${row.ads.toFixed(2)}</span></>}
        </div>
        {row.topSource && (
          <div className="text-xs text-slate-500 mt-0.5">Top source: {row.topSource}</div>
        )}
      </div>
    );
  }
  if (row.kind === 'newsletter') {
    const ev = row.event;
    const op = openRate(ev);
    const cl = clickRate(ev);
    return (
      <div>
        <div className="text-sm font-medium text-slate-800">
          Newsletter sent <span className="text-slate-500 font-normal">"{ev.subject}"</span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          {ev.sent_count.toLocaleString()} sent · {ev.open_count.toLocaleString()} opens
          {op !== null && <> ({op.toFixed(0)}%)</>}
          {' '}· {ev.click_count.toLocaleString()} clicks
          {cl !== null && <> ({cl.toFixed(0)}%)</>}
        </div>
      </div>
    );
  }
  if (row.kind === 'promo') {
    const p = row.promotion;
    const net = p.revenue !== null && p.cost !== null ? p.revenue - p.cost : null;
    return (
      <div>
        <div className="text-sm font-medium text-slate-800">
          {PROMO_LABELS[p.kind]} <span className="text-slate-500 font-normal">— {p.name}</span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          {p.ends_on === p.starts_on ? '1-day' : `${dayDiff(p.starts_on, p.ends_on)}-day`} run
          {p.cost !== null && <> · ${p.cost.toFixed(2)} cost</>}
          {(p.free_downloads ?? 0) > 0 && <> · {p.free_downloads!.toLocaleString()} free downloads</>}
          {(p.units_sold ?? 0) > 0 && <> · {p.units_sold!.toLocaleString()} units sold</>}
          {net !== null && <> · net <span className={net >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{net >= 0 ? '+' : '-'}${Math.abs(net).toFixed(2)}</span></>}
        </div>
      </div>
    );
  }
  if (row.kind === 'launch') {
    return (
      <div>
        <div className="text-sm font-medium text-slate-800">
          {row.phase === 'publish' ? 'Launched' : 'Pre-order opened'}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">{row.book_title}</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-sm font-medium text-slate-800">
        {row.reader_name} — {row.relationship === 'applied' ? 'applied for ARC'
          : row.relationship === 'received' ? 'received ARC'
          : 'reviewed'}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dayDiff(start: string, end: string): number {
  const a = new Date(start);
  const b = new Date(end);
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1);
}
