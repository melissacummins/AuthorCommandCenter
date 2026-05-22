import { useMemo } from 'react';
import type { TimelineEvent } from '../types';
import { EVENT_COLORS } from '../types';

// Stacked-bar revenue chart with an ad-spend line underneath the
// zero line. SVG-only, no charting library — the screenshot's
// requirements are simple enough that pulling in something like
// Recharts would double the bundle for one view.
//
// Markers (promo / newsletter / launch / arc) drop in as colored
// pills on top of the bar for the date they happened on.

interface Marker { date: string; color: string; label: string }

interface Props {
  // Already filtered to the time window + sorted asc by date.
  daily: Array<Extract<TimelineEvent, { kind: 'daily_revenue' }>>;
  // All non-daily events in the same window, used to drop markers
  // on the chart for promo/newsletter/launch/arc.
  markers: Array<Exclude<TimelineEvent, { kind: 'daily_revenue' }>>;
  // Toggles from the chip strip. If 'ads' is off, the line goes away.
  // If 'sales' is off, the bars do. Markers respect their own kind.
  showSales: boolean;
  showAds: boolean;
}

// Curated palette for the stacked-revenue sources. Stable order so
// 'Amazon' is always the same color regardless of what's in the data.
const SOURCE_COLORS: Record<string, string> = {
  Amazon:    '#10b981', // emerald-500
  Shopify:   '#3b82f6', // blue-500
  D2D:       '#a855f7', // purple-500
  Google:    '#06b6d4', // cyan-500
  Kobo:      '#f59e0b', // amber-500
  'Kobo Plus': '#ec4899', // pink-500
};
const FALLBACK_COLOR = '#64748b'; // slate-500

export default function RevenueChart({ daily, markers, showSales, showAds }: Props) {
  const dims = { width: 800, height: 260, padX: 40, padY: 20, axisY: 175 };
  // Bars sit in the top region; the ad-spend line lives in the
  // strip below the zero line so positive bars and ad spend never
  // overlap visually.
  const barRegionH = dims.axisY - dims.padY;
  const adRegionH  = dims.height - dims.axisY - dims.padY;

  const maxRevenue = useMemo(
    () => Math.max(1, ...daily.map(d => d.revenue_total)),
    [daily],
  );
  const maxAdSpend = useMemo(
    () => Math.max(1, ...daily.map(d => d.ad_spend)),
    [daily],
  );

  const labels = useMemo(() => uniqueSources(daily), [daily]);

  if (daily.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 text-sm text-slate-500 text-center">
        No daily revenue logged in this window. Add data in Profit to see the chart fill in.
      </div>
    );
  }

  const innerW = dims.width - dims.padX * 2;
  const barSlot = innerW / daily.length;
  const barW = Math.max(2, Math.min(28, barSlot * 0.7));

  // Build a lookup so markers can find which bar's x to anchor on.
  const xByDate = new Map<string, number>();
  daily.forEach((d, i) => xByDate.set(d.date, dims.padX + barSlot * (i + 0.5)));

  const markerDots: Marker[] = markers.flatMap(m => {
    const x = xByDate.get(m.date);
    if (x === undefined) return [];
    const palette =
      m.kind === 'promo'      ? EVENT_COLORS.promo
      : m.kind === 'newsletter' ? EVENT_COLORS.newsletter
      : m.kind === 'launch'   ? EVENT_COLORS.launch
                              : EVENT_COLORS.arc;
    const label = m.kind === 'promo' ? 'P' : m.kind === 'newsletter' ? 'N' : m.kind === 'launch' ? 'L' : 'A';
    return [{ date: m.date, color: hexFromTailwind(palette.dot), label }];
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${dims.width} ${dims.height}`}
          className="w-full h-auto"
          aria-label="Daily revenue and ad spend"
        >
          {/* Y-axis ticks (revenue side) */}
          {[0, 0.5, 1].map(t => {
            const y = dims.padY + barRegionH * (1 - t);
            const label = `$${Math.round(maxRevenue * t)}`;
            return (
              <g key={t}>
                <line x1={dims.padX} x2={dims.width - dims.padX} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="2 4" />
                <text x={dims.padX - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{label}</text>
              </g>
            );
          })}
          {/* Zero axis */}
          <line x1={dims.padX} x2={dims.width - dims.padX} y1={dims.axisY} y2={dims.axisY} stroke="#cbd5e1" />

          {/* Stacked revenue bars */}
          {showSales && daily.map((d, i) => {
            const x = dims.padX + barSlot * (i + 0.5) - barW / 2;
            let yCursor = dims.axisY;
            return (
              <g key={d.date}>
                {labels.map(label => {
                  const v = d.sources[label];
                  if (!v) return null;
                  const h = (v / maxRevenue) * barRegionH;
                  yCursor -= h;
                  return (
                    <rect
                      key={label}
                      x={x}
                      y={yCursor}
                      width={barW}
                      height={h}
                      fill={SOURCE_COLORS[label] ?? FALLBACK_COLOR}
                      className="opacity-90"
                    >
                      <title>{`${d.date} · ${label}: $${v.toFixed(2)}`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}

          {/* Ad spend line — area below the zero axis */}
          {showAds && (
            <path
              d={daily.map((d, i) => {
                const x = dims.padX + barSlot * (i + 0.5);
                const y = dims.axisY + (d.ad_spend / maxAdSpend) * adRegionH;
                return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
              }).join(' ')}
              fill="none"
              stroke="#f97316"
              strokeWidth={1.5}
            />
          )}

          {/* Markers */}
          {markerDots.map((m, idx) => {
            const x = xByDate.get(m.date)!;
            return (
              <g key={`${m.date}-${idx}`}>
                <line x1={x} x2={x} y1={dims.padY} y2={dims.axisY} stroke={m.color} strokeDasharray="3 3" opacity={0.45} />
                <circle cx={x} cy={dims.padY + 4} r={8} fill={m.color} />
                <text x={x} y={dims.padY + 7} textAnchor="middle" fontSize="10" fontWeight="bold" fill="white">
                  {m.label}
                </text>
              </g>
            );
          })}

          {/* X-axis date labels (sparse — every ~6 bars to avoid overlap) */}
          {daily.map((d, i) => {
            const step = Math.max(1, Math.floor(daily.length / 6));
            if (i % step !== 0 && i !== daily.length - 1) return null;
            const x = dims.padX + barSlot * (i + 0.5);
            return (
              <text
                key={d.date}
                x={x}
                y={dims.height - 4}
                textAnchor="middle"
                fontSize="10"
                fill="#64748b"
              >
                {d.date.slice(5)}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
        {showSales && labels.map(l => (
          <LegendDot key={l} color={SOURCE_COLORS[l] ?? FALLBACK_COLOR} label={l} />
        ))}
        {showAds && <LegendDot color="#f97316" label="Ad spend (below)" />}
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function uniqueSources(daily: Array<Extract<TimelineEvent, { kind: 'daily_revenue' }>>): string[] {
  const set = new Set<string>();
  for (const d of daily) for (const k of Object.keys(d.sources)) set.add(k);
  // Stable order by the curated palette, then any unknown names tail.
  const stable = Object.keys(SOURCE_COLORS);
  const ordered = stable.filter(s => set.has(s));
  for (const s of set) if (!stable.includes(s)) ordered.push(s);
  return ordered;
}

// Map our Tailwind dot class to a hex so the SVG can use it. The
// chart can't read Tailwind classes at render time so we mirror the
// palette here.
function hexFromTailwind(cls: string): string {
  if (cls.includes('emerald')) return '#10b981';
  if (cls.includes('orange'))  return '#f97316';
  if (cls.includes('pink'))    return '#ec4899';
  if (cls.includes('amber'))   return '#f59e0b';
  if (cls.includes('cyan'))    return '#06b6d4';
  if (cls.includes('purple'))  return '#a855f7';
  return '#64748b';
}
