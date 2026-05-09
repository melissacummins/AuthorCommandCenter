import { useMemo, type ReactElement, type ReactNode } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, Legend,
} from 'recharts';
import { MousePointerClick, Globe2, Smartphone, Link2, BarChart3 } from 'lucide-react';
import type { LinkClick, ShortLink } from '../types';
import { formatNumber } from '../utils';

interface Props {
  links: ShortLink[];
  clicks: LinkClick[];
  rangeDays: number;
}

const DEVICE_COLORS: Record<string, string> = {
  desktop: '#6366f1',
  mobile: '#10b981',
  tablet: '#f59e0b',
  bot: '#94a3b8',
  unknown: '#cbd5e1',
};

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

export default function AnalyticsDashboard({ links, clicks, rangeDays }: Props) {
  const humanClicks = useMemo(() => clicks.filter((c) => !c.is_bot), [clicks]);

  const totals = useMemo(() => {
    const linkMap = new Map(links.map((l) => [l.id, l]));
    const uniqueIps = new Set(humanClicks.map((c) => c.ip_hash).filter(Boolean));
    const activeLinks = links.filter((l) => l.is_active && !l.archived_at).length;
    const topLink = [...links].sort((a, b) => b.click_count - a.click_count)[0];
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

  const byChannel = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of humanClicks) {
      const key = c.channel || '(direct)';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map, ([channel, count]) => ({ channel, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [humanClicks]);

  const byDevice = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of humanClicks) {
      const key = c.device_type || 'unknown';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map, ([name, value]) => ({ name, value }));
  }, [humanClicks]);

  const byCountry = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of humanClicks) {
      const key = c.country || 'Unknown';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map, ([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [humanClicks]);

  const byBrowser = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of humanClicks) {
      const key = c.browser || 'Other';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map, ([browser, count]) => ({ browser, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [humanClicks]);

  const topReferrers = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of humanClicks) {
      let host = '(direct)';
      if (c.referrer) {
        try {
          host = new URL(c.referrer).hostname.replace(/^www\./, '');
        } catch {
          host = c.referrer.slice(0, 60);
        }
      }
      map.set(host, (map.get(host) ?? 0) + 1);
    }
    return Array.from(map, ([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [humanClicks]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<MousePointerClick className="w-5 h-5" />} label="Total clicks" value={formatNumber(totals.total)} sub={`${formatNumber(totals.botCount)} bots filtered`} />
        <StatCard icon={<Globe2 className="w-5 h-5" />} label="Unique visitors" value={formatNumber(totals.uniques)} sub={`Last ${rangeDays} days`} />
        <StatCard icon={<Link2 className="w-5 h-5" />} label="Active links" value={formatNumber(totals.activeLinks)} sub={`${links.length} total`} />
        <StatCard icon={<BarChart3 className="w-5 h-5" />} label="Top link" value={totals.topLink ? `/${totals.topLink.slug}` : '—'} sub={totals.topLink ? `${formatNumber(totals.topLink.click_count)} clicks` : ''} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Clicks over time</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={seriesByDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
              <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={12} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
              <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <ChartCard title="Clicks by channel">
          <BarChart data={byChannel} layout="vertical" margin={{ left: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" allowDecimals={false} stroke="#94a3b8" fontSize={12} />
            <YAxis type="category" dataKey="channel" stroke="#94a3b8" fontSize={12} width={100} />
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
            <Bar dataKey="count" fill="#6366f1" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Devices">
          <PieChart>
            <Pie data={byDevice} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
              {byDevice.map((entry) => (
                <Cell key={entry.name} fill={DEVICE_COLORS[entry.name] ?? '#cbd5e1'} />
              ))}
            </Pie>
            <Legend verticalAlign="bottom" iconType="circle" />
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
          </PieChart>
        </ChartCard>

        <ChartCard title="Top countries">
          <BarChart data={byCountry} layout="vertical" margin={{ left: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" allowDecimals={false} stroke="#94a3b8" fontSize={12} />
            <YAxis type="category" dataKey="country" stroke="#94a3b8" fontSize={12} width={80} />
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
            <Bar dataKey="count" fill="#10b981" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Browsers">
          <BarChart data={byBrowser}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="browser" stroke="#94a3b8" fontSize={12} />
            <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={12} />
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
            <Bar dataKey="count" fill="#f59e0b" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ChartCard>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Top referrers</h3>
        {topReferrers.length === 0 ? (
          <p className="text-sm text-slate-500">No clicks yet.</p>
        ) : (
          <div className="space-y-1.5">
            {topReferrers.map((r) => {
              const pct = totals.total ? Math.round((r.count / totals.total) * 100) : 0;
              return (
                <div key={r.host} className="flex items-center gap-3 text-sm">
                  <div className="w-44 truncate text-slate-700">{r.host}</div>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-16 text-right text-slate-500 tabular-nums">{formatNumber(r.count)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500 text-xs font-medium uppercase tracking-wide">
        <span className="text-indigo-500">{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-800 truncate">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactElement }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
        <Smartphone className="w-4 h-4 text-slate-400" />
        {title}
      </h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}
