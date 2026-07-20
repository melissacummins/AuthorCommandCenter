import { useMemo, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, Cell } from 'recharts';
import {
  productivitySeries, trackedMinutesByDay, localDay,
  addDaysISO, weekStartISO, dayRange, formatMinutes,
  type PlannerNote, type PlannerTask, type PlannerTimeSession,
} from './types';

const RANGES = [14, 30, 90] as const;

// "12.5h" / "0h" — hours from minutes, one decimal (whole at 10h+).
function fmtHours(min: number): string {
  return `${(min / 60).toFixed(min >= 60 * 10 ? 0 : 1)}h`;
}

// "Jun 1 – Jun 7" for a Monday week start.
function weekLabel(monday: string): string {
  const a = new Date(monday + 'T00:00:00');
  const b = new Date(a); b.setDate(a.getDate() + 6);
  const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${a.toLocaleDateString(undefined, o)} – ${b.toLocaleDateString(undefined, o)}`;
}

// A "how am I doing" dashboard: completions and hours worked over time, plus
// throughput vs backlog. Hours come from the timer session log, so they reflect
// the day work actually happened — completed or not.
export default function StatsView({
  tasks, sessions, today, notesById = {}, onOpenDay, onOpenTask,
}: {
  tasks: PlannerTask[];
  sessions: PlannerTimeSession[];
  today: string;
  notesById?: Record<string, PlannerNote>;
  // Open a given day in the Logbook so a bar's number has its tasks behind it.
  onOpenDay?: (day: string) => void;
  // Open a to-do (from a timesheet row) where it lives.
  onOpenTask?: (task: PlannerTask) => void;
}) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [metric, setMetric] = useState<'todos' | 'hours'>('todos');
  const from = useMemo(() => addDaysISO(today, -(days - 1)), [today, days]);

  const tasksById = useMemo(() => {
    const m: Record<string, PlannerTask> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);

  // ---- Weekly timesheet: tracked time per to-do across one week (Mon–Sun),
  // with per-day and per-to-do totals — a ClickUp-style grid.
  const [tsWeek, setTsWeek] = useState<string>(() => weekStartISO(today));
  const tsDays = useMemo(() => dayRange(tsWeek, 7), [tsWeek]);
  const timesheet = useMemo(() => {
    const daySet = new Set(tsDays);
    const byTask: Record<string, { perDay: Record<string, number>; total: number }> = {};
    const dayTotals: Record<string, number> = {};
    for (const s of sessions) {
      const day = localDay(s.started_at);
      if (!daySet.has(day)) continue;
      const row = (byTask[s.task_id] ??= { perDay: {}, total: 0 });
      row.perDay[day] = (row.perDay[day] ?? 0) + s.minutes;
      row.total += s.minutes;
      dayTotals[day] = (dayTotals[day] ?? 0) + s.minutes;
    }
    const rows = Object.entries(byTask).map(([id, v]) => {
      const task = tasksById[id];
      const listName = task?.note_id ? (notesById[task.note_id]?.title.trim() || 'Untitled list') : undefined;
      return { id, title: task?.title?.trim() || '(deleted to-do)', listName, perDay: v.perDay, total: v.total };
    }).sort((a, b) => b.total - a.total);
    return { rows, dayTotals, grand: rows.reduce((m, r) => m + r.total, 0) };
  }, [sessions, tsDays, tasksById, notesById]);

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
      const doneTs = t.done ? (t.done_at ?? t.updated_at ?? t.created_at) : null;
      if (doneTs && localDay(doneTs) >= from) {
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
        <BarChart3 className="w-6 h-6 text-brand-500" />
        <h2 className="text-2xl font-bold text-content">Stats</h2>
        <div className="ml-auto inline-flex rounded-control border border-edge overflow-hidden">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${days === r ? 'bg-brand-600 text-brand-fg' : 'text-content-secondary hover:bg-surface-sunken'}`}
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
      <div className="rounded-card border border-edge bg-surface p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
            {metric === 'todos' ? 'To-dos completed' : 'Hours worked'} · last {days} days
            {onOpenDay && <span className="ml-2 normal-case font-normal tracking-normal text-content-faint">— tap a bar to see that day</span>}
          </p>
          <div className="inline-flex rounded-control border border-edge overflow-hidden text-xs">
            {(['todos', 'hours'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`px-2.5 py-1 font-medium transition-colors ${metric === m ? 'bg-slate-700 text-white' : 'text-content-secondary hover:bg-surface-sunken'}`}
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
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-edge)' }}
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
          <p className="text-xs text-content-muted mt-2">No time tracked yet — start a timer on a to-do to fill this in.</p>
        )}
      </div>

      {/* Throughput & backlog */}
      <div className="rounded-card border border-edge bg-surface p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted mb-3">Throughput &amp; backlog · last {days} days</p>
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

      {/* Weekly timesheet — tracked time per to-do across one week. */}
      <div className="rounded-card border border-edge bg-surface p-4 mt-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">Weekly timesheet</p>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => setTsWeek(w => addDaysISO(w, -7))} className="p-1 rounded-control text-content-muted hover:bg-surface-sunken" title="Previous week"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-xs font-medium text-content-secondary w-28 text-center">{weekLabel(tsWeek)}</span>
            <button onClick={() => setTsWeek(w => addDaysISO(w, 7))} className="p-1 rounded-control text-content-muted hover:bg-surface-sunken" title="Next week"><ChevronRight className="w-4 h-4" /></button>
            {tsWeek !== weekStartISO(today) && (
              <button onClick={() => setTsWeek(weekStartISO(today))} className="text-xs font-medium text-brand-600 hover:text-brand-700 ml-1">This week</button>
            )}
          </div>
        </div>
        {timesheet.rows.length === 0 ? (
          <p className="text-sm text-content-muted">No time tracked this week. Run a timer (or log time) on a to-do and it’ll show here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-content-muted">
                  <th className="text-left font-medium px-2 py-1.5 sticky left-0 bg-surface">Task</th>
                  {tsDays.map(d => {
                    const dt = new Date(d + 'T00:00:00');
                    return (
                      <th key={d} className={`px-2 py-1.5 text-right font-medium whitespace-nowrap ${d === today ? 'text-brand-600' : ''}`}>
                        <button
                          onClick={() => onOpenDay?.(d)}
                          disabled={!onOpenDay}
                          className={onOpenDay ? 'hover:text-brand-600 cursor-pointer' : ''}
                          title={onOpenDay ? 'See this day in the Logbook' : undefined}
                        >
                          <div>{dt.toLocaleDateString(undefined, { weekday: 'short' })} {dt.getDate()}</div>
                          <div className="text-[10px] font-normal">{timesheet.dayTotals[d] ? formatMinutes(timesheet.dayTotals[d]) : ''}</div>
                        </button>
                      </th>
                    );
                  })}
                  <th className="px-2 py-1.5 text-right font-semibold text-content-secondary">Total</th>
                </tr>
              </thead>
              <tbody>
                {timesheet.rows.map(r => (
                  <tr key={r.id} className="border-t border-edge-soft">
                    <td className="px-2 py-1.5 sticky left-0 bg-surface">
                      <button
                        onClick={() => { const t = tasksById[r.id]; if (t && onOpenTask) onOpenTask(t); }}
                        disabled={!(onOpenTask && tasksById[r.id])}
                        className={`text-left ${onOpenTask && tasksById[r.id] ? 'hover:text-brand-600 cursor-pointer' : ''}`}
                        title={onOpenTask && tasksById[r.id] ? 'Open this to-do' : undefined}
                      >
                        <div className="text-content truncate max-w-[12rem]">{r.title}</div>
                        {r.listName && <div className="text-[10px] text-content-faint truncate max-w-[12rem]">{r.listName}</div>}
                      </button>
                    </td>
                    {tsDays.map(d => (
                      <td key={d} className={`px-2 py-1.5 text-right tabular-nums ${r.perDay[d] ? 'text-content-secondary' : 'text-content-faint'}`}>
                        {r.perDay[d] ? formatMinutes(r.perDay[d]) : '—'}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right font-semibold text-content tabular-nums">{formatMinutes(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-edge font-semibold text-content">
                  <td className="px-2 py-1.5 sticky left-0 bg-surface">Total</td>
                  {tsDays.map(d => <td key={d} className="px-2 py-1.5 text-right tabular-nums">{timesheet.dayTotals[d] ? formatMinutes(timesheet.dayTotals[d]) : '—'}</td>)}
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMinutes(timesheet.grand)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-card border border-edge bg-surface p-4">
      <div className="text-2xl font-bold text-content leading-none">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-content-muted mt-1">{label}</div>
      {hint && <div className="text-[10px] text-content-faint mt-0.5">{hint}</div>}
    </div>
  );
}

function Mini({ label, value, tone = 'slate', hint }: { label: string; value: number | string; tone?: 'slate' | 'rose' | 'emerald'; hint?: string }) {
  const color = tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : 'text-content';
  return (
    <div>
      <div className={`text-xl font-bold leading-none ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-content-muted mt-1">{label}</div>
      {hint && <div className="text-[10px] text-content-faint mt-0.5">{hint}</div>}
    </div>
  );
}
