import { useMemo, useState, type ReactNode } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { MousePointerClick, Globe2, Link2, BarChart3, Eye, Layout } from 'lucide-react';
import type { BioView, LinkClick, ShortLink } from '../types';
import { formatNumber } from '../utils';

interface Props {
  links: ShortLink[];
  clicks: LinkClick[];
  bioViews?: BioView[];
  rangeDays: number;
}

// YYYY-MM-DD in the viewer's local timezone. We use local everywhere so the
// chart's "today" bucket aligns with how the user perceives "today" — a click
// at 23:30 UTC for a UTC+2 user lands on the next local day, so bucketing by
// UTC silently drops those clicks off the right edge of the chart.
function localDateKey(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface BarItem {
  key: string;
  label: string;
  count: number;
}

function tally(
  clicks: LinkClick[],
  picker: (c: LinkClick) => string | null | undefined,
  emptyLabel = 'Unknown',
): BarItem[] {
  const map = new Map<string, number>();
  for (const c of clicks) {
    const raw = picker(c);
    const key = raw && String(raw).trim() ? String(raw) : emptyLabel;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map, ([label, count]) => ({ key: label, label, count }))
    .sort((a, b) => b.count - a.count);
}

export default function AnalyticsDashboard({ links, clicks, bioViews = [], rangeDays }: Props) {
  const humanClicks = useMemo(() => clicks.filter((c) => !c.is_bot), [clicks]);
  const linkBySlug = useMemo(() => {
    const m = new Map<string, ShortLink>();
    for (const l of links) m.set(l.slug, l);
    return m;
  }, [links]);

  // Bio page engagement: real (non-bot) page views vs. clicks on links that
  // are shown on the bio page. CTR is a rough engagement proxy, not a
  // per-visitor funnel.
  const bio = useMemo(() => {
    const views = bioViews.filter((v) => !v.is_bot).length;
    const bioSlugs = new Set(links.filter((l) => l.show_on_bio).map((l) => l.slug));
    const bioClicks = humanClicks.filter((c) => bioSlugs.has(c.slug)).length;
    const ctr = views > 0 ? Math.round((bioClicks / views) * 100) : 0;
    return { views, bioClicks, ctr };
  }, [bioViews, links, humanClicks]);

  const totals = useMemo(() => {
    const linkMap = new Map(links.map((l) => [l.id, l]));
    const uniqueIps = new Set(humanClicks.map((c) => c.ip_hash).filter(Boolean));
    const activeLinks = links.filter((l) => l.is_active && !l.archived_at).length;
    const topLink = [...links].sort(
      (a, b) => (b.non_bot_click_count ?? 0) - (a.non_bot_click_count ?? 0),
    )[0];
    return {
      total: humanClicks.length,
      uniques: uniqueIps.size,
      activeLinks,
      topLink: topLink ? linkMap.get(topLink.id) ?? topLink : null,
      botCount: clicks.length - humanClicks.length,
    };
  }, [humanClicks, clicks, links]);

  const seriesByDay = useMemo(() => {
    const buckets = new Map<string, number>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      buckets.set(localDateKey(d), 0);
    }
    for (const c of humanClicks) {
      const key = localDateKey(c.clicked_at);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from(buckets, ([date, count]) => ({
      date: date.slice(5),
      count,
    }));
  }, [humanClicks, rangeDays]);

  const byChannel = useMemo(
    () => tally(humanClicks, (c) => c.channel || '', '(direct)'),
    [humanClicks],
  );

  const bySlug = useMemo(() => {
    const counts = tally(humanClicks, (c) => c.slug);
    return counts.map((item) => {
      const link = linkBySlug.get(item.key);
      return {
        ...item,
        label: link?.label ? `${item.key} — ${link.label}` : `/${item.key}`,
      };
    });
  }, [humanClicks, linkBySlug]);

  const byDestination = useMemo(
    () => tally(humanClicks, (c) => {
      try { return new URL(c.destination_url).hostname.replace(/^www\./, ''); }
      catch { return c.destination_url.slice(0, 60); }
    }),
    [humanClicks],
  );

  const byReferrer = useMemo(
    () => tally(humanClicks, (c) => {
      if (!c.referrer) return '(direct)';
      try { return new URL(c.referrer).hostname.replace(/^www\./, ''); }
      catch { return c.referrer.slice(0, 60); }
    }, '(direct)'),
    [humanClicks],
  );

  const byCountry = useMemo(() => tally(humanClicks, (c) => c.country), [humanClicks]);
  const byCity = useMemo(() => tally(humanClicks, (c) => c.city), [humanClicks]);
  const byRegion = useMemo(() => tally(humanClicks, (c) => c.region), [humanClicks]);
  const byDevice = useMemo(() => tally(humanClicks, (c) => c.device_type), [humanClicks]);
  const byBrowser = useMemo(() => tally(humanClicks, (c) => c.browser), [humanClicks]);
  const byOs = useMemo(() => tally(humanClicks, (c) => c.os), [humanClicks]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<MousePointerClick className="w-5 h-5" />} label="Total clicks" value={formatNumber(totals.total)} sub={`${formatNumber(totals.botCount)} bots filtered`} />
        <StatCard icon={<Globe2 className="w-5 h-5" />} label="Unique visitors" value={formatNumber(totals.uniques)} sub={`Last ${rangeDays} days`} />
        <StatCard icon={<Link2 className="w-5 h-5" />} label="Active links" value={formatNumber(totals.activeLinks)} sub={`${links.length} total`} />
        <StatCard icon={<BarChart3 className="w-5 h-5" />} label="Top link" value={totals.topLink ? `/${totals.topLink.slug}` : '—'} sub={totals.topLink ? `${formatNumber(totals.topLink.non_bot_click_count ?? 0)} clicks` : ''} />
      </div>

      <div className="bg-surface rounded-card border border-edge p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-content mb-4 flex items-center gap-2">
          <Layout className="w-4 h-4 text-brand-500" /> Bio page
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <BioMetric icon={<Eye className="w-4 h-4" />} label="Page views" value={formatNumber(bio.views)} />
          <BioMetric icon={<MousePointerClick className="w-4 h-4" />} label="Clicks on bio links" value={formatNumber(bio.bioClicks)} />
          <BioMetric icon={<BarChart3 className="w-4 h-4" />} label="Click-through rate" value={`${bio.ctr}%`} />
        </div>
        <p className="text-xs text-content-muted mt-3">
          Views are real (non-bot) loads of your public bio page over the last {rangeDays} days. CTR is clicks on bio-listed links ÷ views.
        </p>
      </div>

      <div className="bg-surface rounded-card border border-edge p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-content mb-4">Clicks over time</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={seriesByDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-edge)" />
              <XAxis dataKey="date" stroke="var(--color-content-muted)" fontSize={12} />
              <YAxis allowDecimals={false} stroke="var(--color-content-muted)" fontSize={12} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--color-edge)' }} />
              <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <TabbedCard
          tabs={[
            { key: 'channels', label: 'Channels', items: byChannel, emptyText: 'No channel data yet.' },
            { key: 'links', label: 'Short links', items: bySlug, emptyText: 'No clicks yet.' },
            { key: 'destinations', label: 'Destinations', items: byDestination, emptyText: 'No clicks yet.' },
          ]}
        />

        <TabbedCard
          tabs={[
            { key: 'referrers', label: 'Referrers', items: byReferrer, emptyText: 'No clicks yet.' },
          ]}
        />

        <TabbedCard
          tabs={[
            { key: 'countries', label: 'Countries', items: byCountry, emptyText: 'No location data yet.' },
            { key: 'cities', label: 'Cities', items: byCity, emptyText: 'No location data yet.' },
            { key: 'regions', label: 'Regions', items: byRegion, emptyText: 'No location data yet.' },
          ]}
        />

        <TabbedCard
          tabs={[
            { key: 'devices', label: 'Devices', items: byDevice, emptyText: 'No device data yet.' },
            { key: 'browsers', label: 'Browsers', items: byBrowser, emptyText: 'No browser data yet.' },
            { key: 'os', label: 'OS', items: byOs, emptyText: 'No OS data yet.' },
          ]}
        />
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface rounded-card border border-edge p-4 shadow-sm">
      <div className="flex items-center gap-2 text-content-secondary text-xs font-medium uppercase tracking-wide">
        <span className="text-brand-500">{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-content truncate">{value}</div>
      {sub && <div className="text-xs text-content-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function BioMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-card bg-surface-hover border border-edge-soft p-3">
      <div className="flex items-center gap-1.5 text-content-secondary text-[11px] font-medium uppercase tracking-wide">
        <span className="text-brand-500">{icon}</span>
        {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold text-content">{value}</div>
    </div>
  );
}

interface TabbedCardProps {
  tabs: { key: string; label: string; items: BarItem[]; emptyText?: string }[];
}

function TabbedCard({ tabs }: TabbedCardProps) {
  const [activeKey, setActiveKey] = useState(tabs[0]?.key);
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];
  const top = active?.items.slice(0, 12) ?? [];
  const total = top.reduce((sum, i) => sum + i.count, 0);

  return (
    <div className="bg-surface rounded-card border border-edge shadow-sm flex flex-col">
      <div className="flex items-center gap-1 px-2 pt-2 border-b border-edge-soft">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveKey(tab.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              tab.key === activeKey
                ? 'border-brand-500 text-brand-700'
                : 'border-transparent text-content-secondary hover:text-content'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="p-5">
        {!active || top.length === 0 ? (
          <p className="text-sm text-content-muted py-8 text-center">{active?.emptyText ?? 'No data yet.'}</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {top.map((item) => {
              const pct = total ? Math.round((item.count / total) * 100) : 0;
              return (
                <div key={item.key} className="flex items-center gap-3 text-sm">
                  <div className="w-44 truncate text-content" title={item.label}>{item.label}</div>
                  <div className="flex-1 h-2 bg-surface-sunken rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full transition-all"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                  <div className="w-12 text-right text-content-secondary tabular-nums text-xs">
                    {formatNumber(item.count)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
