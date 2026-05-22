import { useEffect, useMemo, useState } from 'react';
import { Clock, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePenNames } from '../../contexts/PenNameContext';
import PenNameChip from '../../components/PenNameChip';
import CatalogBookPicker from '../../components/CatalogBookPicker';
import { listBooks } from '../catalog/api';
import type { Book } from '../catalog/types';
import { fetchTimeline, type TimelineData } from './api';
import {
  DEFAULT_FILTERS,
  EVENT_COLORS,
  resolveRange,
  type EventFilters,
  type TimelineRange,
  type WindowPreset,
} from './types';
import RevenueChart from './components/RevenueChart';
import EventLog from './components/EventLog';

// Per-book timeline: pick a book, pick a window, get a chart and an
// event log showing the cause-and-effect story between actions
// (promos, newsletters, launches, ARC transitions) and revenue.

export default function TimelineModule() {
  const { user } = useAuth();
  const { penNames } = usePenNames();
  const [books, setBooks] = useState<Book[]>([]);
  const [bookId, setBookId] = useState<string | null>(null);
  const [preset, setPreset] = useState<WindowPreset>('30d');
  const [customRange, setCustomRange] = useState<TimelineRange | null>(null);
  const [filters, setFilters] = useState<EventFilters>(DEFAULT_FILTERS);

  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the user's catalog books on mount so the picker has data.
  // We auto-pick the first published book to give the page something
  // to show on the initial render rather than an empty state.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listBooks(user.id)
      .then(rows => {
        if (cancelled) return;
        setBooks(rows);
        if (!bookId && rows.length > 0) {
          const firstPublished = rows.find(b => b.status === 'published') ?? rows[0];
          setBookId(firstPublished.id);
        }
      })
      .catch(err => { if (!cancelled) setError(err?.message ?? String(err)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const range = useMemo(
    () => resolveRange(preset, new Date(), customRange ?? undefined),
    [preset, customRange],
  );
  const selectedBook = books.find(b => b.id === bookId) ?? null;

  useEffect(() => {
    if (!user || !selectedBook) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTimeline({ userId: user.id, book: selectedBook, range })
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => { if (!cancelled) setError(err?.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, selectedBook, range]);

  const penName = selectedBook?.pen_name_id ? penNames.find(p => p.id === selectedBook.pen_name_id) : null;

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
            <Clock className="w-6 h-6 text-indigo-500" />
            Timeline
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
              Per-book performance &amp; action history
            </span>
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Every sale, ad spend, promo, newsletter, and launch event for one book in chronological order. See cause and effect — what you did, and what happened to revenue.
          </p>
        </div>
      </div>

      {/* Book + window controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[280px]">
          <CatalogBookPicker
            value={bookId}
            onChange={id => setBookId(id)}
            placeholder="Pick a book to see its timeline…"
          />
        </div>
        <WindowPicker
          preset={preset}
          onPreset={setPreset}
          range={preset === 'custom' ? customRange : range}
          onCustomChange={r => { setCustomRange(r); setPreset('custom'); }}
        />
      </div>

      {selectedBook && penName && (
        <div>
          <PenNameChip name={penName.name} color={penName.color} size="md" />
        </div>
      )}

      {/* Filter chips */}
      <FilterChips filters={filters} onChange={setFilters} />

      {error && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {!selectedBook ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">
          Pick a book to see its timeline.
        </div>
      ) : loading ? (
        <div className="text-sm text-slate-500">Loading timeline…</div>
      ) : data ? (
        <>
          {/* Summary cards */}
          <SummaryCards data={data} preset={preset} />

          {/* Chart */}
          <RevenueChart
            daily={data.daily}
            markers={data.markers}
            showSales={filters.sales}
            showAds={filters.ads}
          />

          {/* Event log */}
          <EventLog
            events={data.markers}
            daily={data.daily}
            showSales={filters.sales}
            showAds={filters.ads}
            showPromo={filters.promo}
            showNewsletter={filters.newsletter}
            showLaunch={filters.launch}
            showArc={filters.arc}
          />
        </>
      ) : null}
    </div>
  );
}

// Window-preset chips + an optional custom-date popover. We don't
// surface the popover unless 'custom' is active to keep the row tidy.
function WindowPicker({
  preset, onPreset, range, onCustomChange,
}: {
  preset: WindowPreset;
  onPreset: (p: WindowPreset) => void;
  range: TimelineRange | null;
  onCustomChange: (r: TimelineRange) => void;
}) {
  const presets: { id: WindowPreset; label: string }[] = [
    { id: '7d', label: '7d' },
    { id: '30d', label: '30d' },
    { id: '90d', label: '90d' },
    { id: 'lifetime', label: 'Lifetime' },
    { id: 'custom', label: 'Custom' },
  ];
  return (
    <div className="flex items-center gap-3">
      <div className="inline-flex bg-slate-100 rounded-lg p-1">
        {presets.map(p => (
          <button
            key={p.id}
            onClick={() => onPreset(p.id)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              preset === p.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-1.5 text-sm">
          <input
            type="date"
            value={range?.start ?? ''}
            onChange={e => onCustomChange({ start: e.target.value, end: range?.end ?? e.target.value })}
            className="px-2 py-1 border border-slate-300 rounded-lg text-xs"
          />
          <span className="text-slate-400">→</span>
          <input
            type="date"
            value={range?.end ?? ''}
            onChange={e => onCustomChange({ start: range?.start ?? e.target.value, end: e.target.value })}
            className="px-2 py-1 border border-slate-300 rounded-lg text-xs"
          />
        </div>
      )}
      {range && preset !== 'custom' && (
        <div className="text-xs text-slate-500">
          {formatDateRange(range)}
        </div>
      )}
    </div>
  );
}

function FilterChips({ filters, onChange }: { filters: EventFilters; onChange: (f: EventFilters) => void }) {
  const items: Array<{ key: keyof EventFilters; label: string; color: keyof typeof EVENT_COLORS }> = [
    { key: 'sales',      label: 'Sales',      color: 'sales' },
    { key: 'ads',        label: 'Ads',        color: 'ads' },
    { key: 'promo',      label: 'Promo',      color: 'promo' },
    { key: 'newsletter', label: 'Newsletter', color: 'newsletter' },
    { key: 'launch',     label: 'Launch',     color: 'launch' },
    { key: 'arc',        label: 'ARC',        color: 'arc' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-slate-400 font-medium">Show</span>
      {items.map(item => {
        const on = filters[item.key];
        const c = EVENT_COLORS[item.color];
        return (
          <button
            key={item.key}
            onClick={() => onChange({ ...filters, [item.key]: !on })}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-all ${
              on
                ? `${c.chip} ${c.text} border-transparent`
                : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${on ? c.dot : 'bg-slate-300'}`} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function SummaryCards({ data, preset }: { data: TimelineData; preset: WindowPreset }) {
  const windowLabel =
    preset === '7d' ? '7D' :
    preset === '30d' ? '30D' :
    preset === '90d' ? '90D' :
    preset === 'lifetime' ? 'LIFETIME' : 'CUSTOM';
  const s = data.summary;
  const actionsTaken = s.promo_count + s.newsletter_count + s.launch_count;
  const adsPctOfRevenue = s.revenue_total > 0 ? (s.ad_spend_total / s.revenue_total) * 100 : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card label={`Revenue (${windowLabel})`} value={`$${s.revenue_total.toFixed(2)}`} />
      <Card
        label={`Ad spend (${windowLabel})`}
        value={`$${s.ad_spend_total.toFixed(2)}`}
        sub={adsPctOfRevenue !== null ? `${adsPctOfRevenue.toFixed(1)}% of revenue` : undefined}
      />
      <Card
        label={`Net (${windowLabel})`}
        value={`${s.net >= 0 ? '+' : '-'}$${Math.abs(s.net).toFixed(2)}`}
        positive={s.net >= 0}
        sub="After ad spend"
      />
      <Card
        label="Actions taken"
        value={String(actionsTaken)}
        sub={breakdown(s)}
      />
    </div>
  );
}

function Card({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  const color = positive === undefined
    ? 'text-slate-800'
    : positive ? 'text-emerald-700' : 'text-rose-700';
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function breakdown(s: TimelineData['summary']): string {
  const parts: string[] = [];
  if (s.promo_count) parts.push(`${s.promo_count} promo${s.promo_count === 1 ? '' : 's'}`);
  if (s.newsletter_count) parts.push(`${s.newsletter_count} nlt`);
  if (s.launch_count) parts.push(`${s.launch_count} launch${s.launch_count === 1 ? '' : 'es'}`);
  if (s.arc_event_count) parts.push(`${s.arc_event_count} ARC`);
  return parts.length === 0 ? 'No actions in this window' : parts.join(', ');
}

function formatDateRange(r: TimelineRange): string {
  function fmt(iso: string): string {
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return `${fmt(r.start)} — ${fmt(r.end)}`;
}
