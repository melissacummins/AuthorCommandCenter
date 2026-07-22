import { useMemo, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Flame, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, Cell } from 'recharts';
import {
  productivitySeries, trackedMinutesByDay, localDay,
  addDaysISO, weekStartISO, dayRange, daysBetweenISO, formatMinutes,
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

// A "how am I doing" dashboard. Two tabs: Overview (charts + momentum) and a
// full Timesheet grid. Hours come from the timer session log, so they reflect
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
  const [tab, setTab] = useState<'overview' | 'timesheet'>('overview');
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
  const seriesByDay = useMemo(() => Object.fromEntries(series.map(d => [d.day, d])), [series]);

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

  // ---- Momentum: current + longest streak of "active" days (a completion or
  // any tracked time). Computed across ALL history, not just the window.
  const activeSet = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) if (t.kind === 'task' && t.done) s.add(localDay(t.done_at ?? t.updated_at ?? t.created_at));
    for (const ss of sessions) s.add(localDay(ss.started_at));
    return s;
  }, [tasks, sessions]);
  const streak = useMemo(() => {
    // Current: walk back from today (forgiving — if nothing yet today, start at
    // yesterday so an in-progress day doesn't read as a broken streak).
    let current = 0;
    let cursor = activeSet.has(today) ? today : addDaysISO(today, -1);
    while (activeSet.has(cursor)) { current += 1; cursor = addDaysISO(cursor, -1); }
    let longest = 0, run = 0, prev: string | null = null;
    for (const d of [...activeSet].sort()) {
      run = prev && addDaysISO(prev, 1) === d ? run + 1 : 1;
      longest = Math.max(longest, run); prev = d;
    }
    return { current, longest };
  }, [activeSet, today]);

  // ---- This week vs last week (done + tracked). Full-data, week-anchored.
  const weekCompare = useMemo(() => {
    const agg = (weekStart: string) => {
      const set = new Set(dayRange(weekStart, 7));
      let done = 0, tracked = 0;
      for (const t of tasks) {
        if (t.kind === 'task' && t.done && set.has(localDay(t.done_at ?? t.updated_at ?? t.created_at))) done += 1;
      }
      for (const s of sessions) if (set.has(localDay(s.started_at))) tracked += s.minutes;
      return { done, tracked };
    };
    const thisWeek = weekStartISO(today);
    return { this: agg(thisWeek), last: agg(addDaysISO(thisWeek, -7)) };
  }, [tasks, sessions, today]);

  // ---- Estimate vs actual on completed, sized, tracked to-dos in the window.
  const estVsActual = useMemo(() => {
    let est = 0, act = 0, n = 0;
    for (const t of tasks) {
      if (t.kind !== 'task' || !t.done) continue;
      const d = localDay(t.done_at ?? t.updated_at ?? t.created_at);
      if (d < from || d > today) continue;
      if (!t.estimate_minutes || !t.actual_minutes) continue;
      est += t.estimate_minutes; act += t.actual_minutes; n += 1;
    }
    return { est, act, n };
  }, [tasks, from, today]);

  // ---- Where the tracked hours went, by list, over the window.
  const hoursByList = useMemo(() => {
    const by: Record<string, number> = {};
    for (const s of sessions) {
      const day = localDay(s.started_at);
      if (day < from || day > today) continue;
      const t = tasksById[s.task_id];
      const key = t?.note_id ? (notesById[t.note_id]?.title.trim() || 'Untitled list') : 'Inbox';
      by[key] = (by[key] ?? 0) + s.minutes;
    }
    return Object.entries(by).map(([name, minutes]) => ({ name, minutes })).sort((a, b) => b.minutes - a.minutes);
  }, [sessions, tasksById, notesById, from, today]);

  // ---- Consistency heatmap grid: full weeks from the window's start Monday
  // through today's week, each cell a day. Activity follows the metric toggle.
  const heat = useMemo(() => {
    const gridStart = weekStartISO(from);
    const weeks = Math.ceil((daysBetweenISO(gridStart, today) + 1) / 7);
    const cols: string[][] = Array.from({ length: weeks }, (_, w) => dayRange(addDaysISO(gridStart, w * 7), 7));
    const valueOf = (day: string) => {
      const d = seriesByDay[day];
      if (!d) return 0;
      return metric === 'todos' ? d.done : d.trackedMinutes;
    };
    return { cols, valueOf };
  }, [from, today, seriesByDay, metric]);

  // Bucket a day's activity into 0–4 for the heatmap shade.
  function heatLevel(v: number): number {
    if (v <= 0) return 0;
    if (metric === 'todos') return v >= 4 ? 4 : v; // 1,2,3,4+
    if (v <= 30) return 1; if (v <= 60) return 2; if (v <= 120) return 3; return 4;
  }
  const HEAT_TODOS = ['', 'bg-teal-200', 'bg-teal-300', 'bg-teal-400', 'bg-teal-600'];
  const HEAT_HOURS = ['', 'bg-indigo-200', 'bg-indigo-300', 'bg-indigo-400', 'bg-indigo-600'];

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <BarChart3 className="w-6 h-6 text-brand-500" />
        <h2 className="text-2xl font-bold text-content">Stats</h2>
        <div className="ml-auto inline-flex rounded-control border border-edge overflow-hidden">
          {(['overview', 'timesheet'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === t ? 'bg-brand-600 text-brand-fg' : 'text-content-secondary hover:bg-surface-sunken'}`}
            >
              {t === 'overview' ? 'Overview' : 'Timesheet'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' ? (
        <>
          {/* Range + metric controls */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="inline-flex rounded-control border border-edge overflow-hidden">
              {RANGES.map(r => (
                <button
                  key={r}
                  onClick={() => setDays(r)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${days === r ? 'bg-slate-700 text-white' : 'text-content-secondary hover:bg-surface-sunken'}`}
                >
                  {r}d
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-control border border-edge overflow-hidden text-sm">
              {(['todos', 'hours'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  className={`px-3 py-1.5 font-medium transition-colors ${metric === m ? 'bg-slate-700 text-white' : 'text-content-secondary hover:bg-surface-sunken'}`}
                >
                  {m === 'todos' ? 'To-dos' : 'Hours'}
                </button>
              ))}
            </div>
          </div>

          {/* Headline numbers */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatCard label="Completed" value={totals.done} hint={`last ${days} days`} />
            <StatCard label="Tracked" value={fmtHours(trackedTotal)} hint="real time on the timer" />
            <StatCard label="Per day" value={avgPerDay.toFixed(1)} hint="to-dos completed" />
            <StatCard
              label="Streak"
              value={streak.current === 0 ? '—' : `${streak.current}d`}
              hint={streak.longest > 0 ? `best ${streak.longest}d` : 'active days in a row'}
              flame={streak.current >= 3}
            />
          </div>

          {/* Main chart: completions or hours per day */}
          <div className="rounded-card border border-edge bg-surface p-4 mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted mb-3">
              {metric === 'todos' ? 'To-dos completed' : 'Hours worked'} · last {days} days
              {onOpenDay && <span className="ml-2 normal-case font-normal tracking-normal text-content-faint">— tap a bar to see that day</span>}
            </p>
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

          {/* Consistency heatmap */}
          <div className="rounded-card border border-edge bg-surface p-4 mb-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                Consistency · {metric === 'todos' ? 'to-dos done' : 'time tracked'} each day
              </p>
              <div className="flex items-center gap-1.5 text-[10px] text-content-muted">
                <span>Less</span>
                {[1, 2, 3, 4].map(l => <span key={l} className={`w-3 h-3 rounded-sm ${(metric === 'todos' ? HEAT_TODOS : HEAT_HOURS)[l]}`} />)}
                <span>More</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="flex gap-1 min-w-max">
                {heat.cols.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-1">
                    {week.map(day => {
                      const inWindow = day >= from && day <= today;
                      const v = heat.valueOf(day);
                      const lvl = heatLevel(v);
                      const shade = (metric === 'todos' ? HEAT_TODOS : HEAT_HOURS)[lvl];
                      const future = day > today;
                      return (
                        <button
                          key={day}
                          onClick={() => inWindow && onOpenDay?.(day)}
                          disabled={!inWindow || !onOpenDay}
                          title={future ? '' : `${new Date(day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${metric === 'todos' ? `${v} done` : `${formatMinutes(v) || '0m'} tracked`}`}
                          className={`w-3.5 h-3.5 rounded-sm transition-colors ${future ? 'bg-transparent' : lvl === 0 ? 'bg-surface-sunken' : shade} ${day === today ? 'ring-2 ring-brand-500 ring-offset-1 ring-offset-surface' : ''} ${inWindow && onOpenDay ? 'hover:opacity-80 cursor-pointer' : ''}`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Two-up: week vs week + estimate vs actual */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* This week vs last */}
            <div className="rounded-card border border-edge bg-surface p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted mb-3">This week vs last</p>
              <div className="space-y-3">
                <CompareRow
                  label="To-dos done"
                  now={weekCompare.this.done}
                  prev={weekCompare.last.done}
                  fmt={v => `${v}`}
                />
                <CompareRow
                  label="Tracked"
                  now={weekCompare.this.tracked}
                  prev={weekCompare.last.tracked}
                  fmt={v => fmtHours(v)}
                />
              </div>
            </div>

            {/* Estimate vs actual */}
            <div className="rounded-card border border-edge bg-surface p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted mb-3">Estimate vs actual</p>
              {estVsActual.n === 0 ? (
                <p className="text-sm text-content-muted">No sized, tracked to-dos completed yet. Add an estimate and run the timer to see how your guesses hold up.</p>
              ) : (
                <>
                  <EstBar label="Estimated" minutes={estVsActual.est} max={Math.max(estVsActual.est, estVsActual.act)} color="bg-slate-400" />
                  <EstBar label="Actual" minutes={estVsActual.act} max={Math.max(estVsActual.est, estVsActual.act)} color="bg-brand-500" />
                  <p className="text-xs text-content-secondary mt-3">{estVerdict(estVsActual.est, estVsActual.act, estVsActual.n)}</p>
                </>
              )}
            </div>
          </div>

          {/* Hours by list */}
          <div className="rounded-card border border-edge bg-surface p-4 mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted mb-3">Where the hours went · last {days} days</p>
            {hoursByList.length === 0 ? (
              <p className="text-sm text-content-muted">No time tracked in this window yet.</p>
            ) : (
              <div className="space-y-2">
                {hoursByList.slice(0, 6).map(row => (
                  <div key={row.name} className="flex items-center gap-3">
                    <div className="w-32 shrink-0 text-sm text-content-secondary truncate" title={row.name}>{row.name}</div>
                    <div className="flex-1 h-3 rounded-full bg-surface-sunken overflow-hidden">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round((row.minutes / hoursByList[0].minutes) * 100)}%` }} />
                    </div>
                    <div className="w-14 shrink-0 text-right text-xs tabular-nums text-content-secondary">{formatMinutes(row.minutes)}</div>
                  </div>
                ))}
              </div>
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
              />
              <Mini label="Open now" value={totals.openNow} />
              <Mini label="Overdue" value={totals.overdue} tone={totals.overdue > 0 ? 'rose' : 'slate'} />
              <Mini label="Avg size" value={formatMinutes(Math.round(totals.avgSize)) || '—'} hint="est. per to-do" />
            </div>
          </div>
        </>
      ) : (
        /* ---- Timesheet tab: tracked time per to-do across one week. ---- */
        <div className="rounded-card border border-edge bg-surface p-4">
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
                      const isToday = d === today;
                      return (
                        <th key={d} className={`px-2 py-1.5 text-right font-medium whitespace-nowrap ${isToday ? 'bg-brand-50 text-brand-700 rounded-t-control' : ''}`}>
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
                        <td key={d} className={`px-2 py-1.5 text-right tabular-nums ${d === today ? 'bg-brand-50' : ''} ${r.perDay[d] ? 'text-content-secondary' : 'text-content-faint'}`}>
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
                    {tsDays.map(d => <td key={d} className={`px-2 py-1.5 text-right tabular-nums ${d === today ? 'bg-brand-50 rounded-b-control' : ''}`}>{timesheet.dayTotals[d] ? formatMinutes(timesheet.dayTotals[d]) : '—'}</td>)}
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatMinutes(timesheet.grand)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A short verdict comparing total estimate vs total actual across N to-dos.
function estVerdict(est: number, act: number, n: number): string {
  if (est <= 0) return `Across ${n} to-do${n === 1 ? '' : 's'}, you tracked ${fmtHours(act)}.`;
  const ratio = act / est;
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  const over = `${n} to-do${n === 1 ? '' : 's'} · you tend to run about ${pct}% longer than you estimate.`;
  const under = `${n} to-do${n === 1 ? '' : 's'} · you tend to finish about ${pct}% faster than you estimate.`;
  const spot = `${n} to-do${n === 1 ? '' : 's'} · your estimates are right on the money.`;
  if (ratio > 1.1) return over;
  if (ratio < 0.9) return under;
  return spot;
}

function CompareRow({ label, now, prev, fmt }: { label: string; now: number; prev: number; fmt: (v: number) => string }) {
  const delta = now - prev;
  const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus;
  const tone = delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-rose-500' : 'text-content-muted';
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 shrink-0 text-xs uppercase tracking-wide text-content-muted">{label}</div>
      <div className="text-xl font-bold text-content tabular-nums">{fmt(now)}</div>
      <div className={`ml-auto inline-flex items-center gap-0.5 text-xs font-medium ${tone}`}>
        <Icon className="w-3.5 h-3.5" />
        {delta === 0 ? 'same' : fmt(Math.abs(delta))}
        <span className="text-content-faint font-normal ml-1">vs {fmt(prev)}</span>
      </div>
    </div>
  );
}

function EstBar({ label, minutes, max, color }: { label: string; minutes: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <div className="w-20 shrink-0 text-xs text-content-secondary">{label}</div>
      <div className="flex-1 h-3 rounded-full bg-surface-sunken overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${max > 0 ? Math.round((minutes / max) * 100) : 0}%` }} />
      </div>
      <div className="w-14 shrink-0 text-right text-xs tabular-nums text-content-secondary">{fmtHours(minutes)}</div>
    </div>
  );
}

function StatCard({ label, value, hint, flame }: { label: string; value: number | string; hint?: string; flame?: boolean }) {
  return (
    <div className="rounded-card border border-edge bg-surface p-4">
      <div className="text-2xl font-bold text-content leading-none flex items-center gap-1.5">
        {flame && <Flame className="w-5 h-5 text-orange-500" />}
        {value}
      </div>
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
