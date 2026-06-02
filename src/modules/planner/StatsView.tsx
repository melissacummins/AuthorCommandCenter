import { useMemo, useState } from 'react';
import { BarChart3, Clock, Trophy, ListChecks } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, Cell } from 'recharts';
import {
  productivitySeries, completionsByWeekday, completionsByList, localDay,
  formatMinutes, addDaysISO, type PlannerNote, type PlannerTask,
} from './types';

const RANGES = [14, 30, 90] as const;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-first, mapping into Sun=0 arrays.

// "12.5h" / "0h" — hours from minutes, one decimal.
function fmtHours(min: number): string {
  return `${(min / 60).toFixed(min >= 60 * 10 ? 0 : 1)}h`;
}

// A "how am I doing" dashboard: completions over time, hours worked (tracked +
// estimated), throughput vs backlog, busiest weekday, effort by list, and your
// longest to-dos. Kept separate from My Day so the day view stays about planning.
export default function StatsView({
  tasks, notesById, today,
}: {
  tasks: PlannerTask[];
  notesById: Record<string, PlannerNote>;
  today: string;
}) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [metric, setMetric] = useState<'todos' | 'hours'>('todos');
  const from = useMemo(() => addDaysISO(today, -(days - 1)), [today, days]);

  const series = useMemo(() => productivitySeries(tasks, today, days), [tasks, today, days]);
  const weekday = useMemo(() => completionsByWeekday(tasks, from, today), [tasks, from, today]);
  const byList = useMemo(() => completionsByList(tasks, from, today), [tasks, from, today]);

  const totals = useMemo(() => {
    let done = 0, est = 0, tracked = 0, created = 0, sized = 0;
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
        tracked += t.actual_minutes ?? 0;
        if (t.estimate_minutes) sized += 1;
      }
    }
    return { done, est, tracked, created, openNow, overdue, avgSize: sized ? est / sized : 0 };
  }, [tasks, from, today]);

  const longest = useMemo(() => tasks
    .filter(t => t.kind === 'task' && t.done && t.done_at && localDay(t.done_at) >= from)
    .map(t => ({ t, weight: Math.max(t.actual_minutes ?? 0, t.estimate_minutes ?? 0) }))
    .filter(x => x.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5), [tasks, from]);

  const avgPerDay = series.length ? totals.done / series.length : 0;
  const net = totals.created - totals.done;
  const maxWeekday = Math.max(1, ...weekday);
  const maxListDone = Math.max(1, ...byList.map(l => l.done));

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
        <StatCard label="Tracked" value={fmtHours(totals.tracked)} hint="real time worked" />
        <StatCard label="Estimated" value={fmtHours(totals.est)} hint="of completed to-dos" />
        <StatCard label="Per day" value={avgPerDay.toFixed(1)} />
      </div>

      {/* Main chart: completions or hours per day */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {metric === 'todos' ? 'To-dos completed' : 'Hours worked'} · last {days} days
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
                <Bar dataKey="done" radius={[3, 3, 0, 0]}>
                  {series.map(d => <Cell key={d.day} fill={d.day === today ? '#0d9488' : '#5eead4'} />)}
                </Bar>
              ) : (
                <Bar dataKey="trackedMinutes" radius={[3, 3, 0, 0]}>
                  {series.map(d => <Cell key={d.day} fill={d.day === today ? '#4f46e5' : '#a5b4fc'} />)}
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
        {metric === 'hours' && totals.tracked === 0 && (
          <p className="text-xs text-slate-400 mt-2">No time tracked yet — start a timer on a to-do to fill this in.</p>
        )}
      </div>

      {/* Throughput & backlog */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4">
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

      {/* Busiest weekday */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">Busiest weekday · last {days} days</p>
        <div className="flex items-end gap-2 h-28">
          {WEEKDAY_ORDER.map((idx, i) => {
            const n = weekday[idx];
            const peak = n === maxWeekday && n > 0;
            return (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[11px] text-slate-400 tabular-nums">{n || ''}</span>
                <div className="w-full flex-1 flex items-end">
                  <div
                    className={`w-full rounded-t ${peak ? 'bg-indigo-500' : 'bg-indigo-200'}`}
                    style={{ height: `${Math.max(2, (n / maxWeekday) * 100)}%` }}
                  />
                </div>
                <span className="text-[11px] font-medium text-slate-500">{WEEKDAYS[i]}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* By list / project */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1">
          <ListChecks className="w-3.5 h-3.5" /> Effort by list · last {days} days
        </p>
        {byList.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing completed in this window.</p>
        ) : (
          <ul className="space-y-2">
            {byList.slice(0, 8).map(l => {
              const name = l.noteId ? (notesById[l.noteId]?.title.trim() || 'Untitled list') : 'No list';
              return (
                <li key={l.noteId || '∅'} className="flex items-center gap-3 text-sm">
                  <span className="w-32 truncate text-slate-600 shrink-0" title={name}>{name}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-teal-400" style={{ width: `${(l.done / maxListDone) * 100}%` }} />
                  </div>
                  <span className="text-slate-500 tabular-nums w-10 text-right shrink-0">{l.done}</span>
                  <span className="text-slate-400 tabular-nums w-12 text-right shrink-0">{l.trackedMinutes > 0 ? fmtHours(l.trackedMinutes) : fmtHours(l.estMinutes)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Longest to-dos */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1">
          <Trophy className="w-3.5 h-3.5" /> Longest to-dos · last {days} days
        </p>
        {longest.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing with a time yet — add estimates or track time to see this.</p>
        ) : (
          <ol className="space-y-1.5">
            {longest.map(({ t, weight }, i) => (
              <li key={t.id} className="flex items-center gap-3 text-sm">
                <span className="text-slate-300 font-semibold w-4 shrink-0">{i + 1}</span>
                <span className="flex-1 truncate text-slate-600">{t.title || 'Untitled'}</span>
                <span className="inline-flex items-center gap-1 text-slate-500 font-medium shrink-0">
                  <Clock className="w-3 h-3" />{formatMinutes(weight)}
                  {t.actual_minutes > 0 ? <span className="text-slate-300 font-normal">tracked</span> : <span className="text-slate-300 font-normal">est.</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
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
