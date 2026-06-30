import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, Cell } from 'recharts';
import {
  productivitySeries, trackedMinutesByDay, localDay,
  addDaysISO, formatMinutes, type PlannerTask, type PlannerTimeSession,
} from './types';

const RANGES = [14, 30, 90] as const;

// "12.5h" / "0h" — hours from minutes, one decimal (whole at 10h+).
function fmtHours(min: number): string {
  return `${(min / 60).toFixed(min >= 60 * 10 ? 0 : 1)}h`;
}

// A "how am I doing" dashboard: completions and hours worked over time, plus
// throughput vs backlog. Hours come from the timer session log, so they reflect
// the day work actually happened — completed or not.
export default function StatsView({
  tasks, sessions, today, onOpenDay,
}: {
  tasks: PlannerTask[];
  sessions: PlannerTimeSession[];
  today: string;
  // Open a given day in the Logbook so a bar's number has its tasks behind it.
  onOpenDay?: (day: string) => void;
}) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [metric, setMetric] = useState<'todos' | 'hours'>('todos');
  const from = useMemo(() => addDaysISO(today, -(days - 1)), [today, days]);

  // Completions (and their estimates) by completion day, then overlay real
  // tracked minutes by the day they were worked.
  const series = useMemo(() => {
    const base = productivitySeries(tasks, today, days);
    const tracked = trackedMinutesByDay(sessions, today, days);
    return base.map(d => ({ ...d, trackedMinutes: tracked[d.day] ?? 0 }));
  }, [tasks, sessions, today, days]);

  const trackedTotal = useMemo(() => series.reduce((s, d) => s + d.trackedMinutes, 0), [series]);

  const totals = useMemo(() => {
    let done = 0, est = 0, created = 0, sized = 0;
    let openNow = 0, overdue = 0;
    for (const t of tasks) {
      if (t.kind !== 'task') continue;
      if (!t.done) {
        openNow += 1;
        if (!t.someday && t.due_date && t.due_date < today) overdue += 1;
      }
      if (localDay(t.created_at) >= from) created += 1;
      if (t.done && t.done_at && localDay(t.done_at) >= from) {
        done += 1;
        est += t.estimate_minutes ?? 0;
        if (t.estimate_minutes) sized += 1;
      }
    }
    return { done, est, created, openNow, overdue, avgSize: sized ? est / sized : 0 };
  }, [tasks, from, today]);

  const avgPerDay = series.length ? totals.done / series.length : 0;
  const net = totals.created - totals.done;

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 className="w-6 h-6 text-indigo-500" />
        <h2 className="text-2xl font-bold text-slate-800">Stats</h2>
        <div className="ml-auto inline-flex rounded-lg border border-slate-200 overflow-hidden">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${days === r ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard label="Completed" value={totals.done} />
        <StatCard label="Tracked" value={fmtHours(trackedTotal)} hint="real time on the timer" />
        <StatCard label="Estimated" value={fmtHours(totals.est)} hint="of completed to-dos" />
        <StatCard label="Per day" value={avgPerDay.toFixed(1)} hint="to-dos completed" />
      </div>

      {/* Main chart: completions or hours per day */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {metric === 'todos' ? 'To-dos completed' : 'Hours worked'} · last {days} days
            {onOpenDay && <span className="ml-2 normal-case font-normal tracking-normal text-slate-300">— tap a bar to see that day</span>}
          </p>
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
            {(['todos', 'hours'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`px-2.5 py-1 font-medium transition-colors ${metric === m ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
              >
                {m === 'todos' ? 'To-dos' : 'Hours'}
              </button>
            ))}
          </div>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickFormatter={d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              />
              <Tooltip
                cursor={{ fill: 'rgba(20,184,166,0.08)' }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                labelFormatter={d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                formatter={(v: number) => metric === 'todos'
                  ? [`${v} done`, '']
                  : [`${(v / 60).toFixed(1)}h tracked`, '']}
              />
              {metric === 'todos' ? (
                <Bar
                  dataKey="done"
                  radius={[3, 3, 0, 0]}
                  style={{ cursor: onOpenDay ? 'pointer' : 'default' }}
                  onClick={(_, index) => { const day = series[index]?.day; if (day) onOpenDay?.(day); }}
                >
                  {series.map(d => <Cell key={d.day} fill={d.day === today ? '#0d9488' : '#5eead4'} />)}
                </Bar>
              ) : (
                <Bar
                  dataKey="trackedMinutes"
                  radius={[3, 3, 0, 0]}
                  style={{ cursor: onOpenDay ? 'pointer' : 'default' }}
                  onClick={(_, index) => { const day = series[index]?.day; if (day) onOpenDay?.(day); }}
                >
                  {series.map(d => <Cell key={d.day} fill={d.day === today ? '#4f46e5' : '#a5b4fc'} />)}
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
        {metric === 'hours' && trackedTotal === 0 && (
          <p className="text-xs text-slate-400 mt-2">No time tracked yet — start a timer on a to-do to fill this in.</p>
        )}
      </div>

      {/* Throughput & backlog */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">Throughput &amp; backlog · last {days} days</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
          <Mini label="Created" value={totals.created} />
          <Mini label="Completed" value={totals.done} />
          <Mini
            label="Net backlog"
            value={net === 0 ? '±0' : net > 0 ? `+${net}` : `${net}`}
            tone={net > 0 ? 'rose' : net < 0 ? 'emerald' : 'slate'}
            hint={net > 0 ? 'added faster than finished' : net < 0 ? 'finishing faster than adding' : 'keeping pace'}
          />
          <Mini label="Open now" value={totals.openNow} />
          <Mini label="Overdue" value={totals.overdue} tone={totals.overdue > 0 ? 'rose' : 'slate'} />
          <Mini label="Avg size" value={formatMinutes(Math.round(totals.avgSize)) || '—'} hint="est. per to-do" />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-2xl font-bold text-slate-800 leading-none">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mt-1">{label}</div>
      {hint && <div className="text-[10px] text-slate-300 mt-0.5">{hint}</div>}
    </div>
  );
}

function Mini({ label, value, tone = 'slate', hint }: { label: string; value: number | string; tone?: 'slate' | 'rose' | 'emerald'; hint?: string }) {
  const color = tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : 'text-slate-800';
  return (
    <div>
      <div className={`text-xl font-bold leading-none ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mt-1">{label}</div>
      {hint && <div className="text-[10px] text-slate-300 mt-0.5">{hint}</div>}
    </div>
  );
}
