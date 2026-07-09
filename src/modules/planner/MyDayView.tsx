import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Clock, Trash2, Check, Circle,
  GripVertical, ExternalLink, CalendarPlus, Link2Off, X, Sun, Inbox, AlertCircle, Search,
  CornerDownLeft, Sparkles, Info, History,
} from 'lucide-react';
import type { UseGoogleCalendar } from './useGoogleCalendar';
import type { GCalEvent } from './google';
import { TaskRow, TaskActionsMenu } from './TaskRow';
import { AiSuggestPanel } from './AiSuggestPanel';
import { suggestDayPlan, suggestPhaseTriage, type AiResult } from './aiAssist';
import {
  addDaysISO, blockMinutes, formatClock, formatMinutes, localDay,
  minutesToTime, timeToMinutes, phaseInfo, daysBetweenISO,
  type PlannerNote, type PlannerSettings, type PlannerTask, type PlannerTimeBlock, type PhaseInfo, type PlannerTimeSession,
} from './types';

export interface MyDayHandlers {
  onAddTask: (input: { title: string; due_date: string; block_id?: string | null; estimate_minutes?: number | null }) => void;
  onPatchTask: (id: string, patch: Partial<PlannerTask>) => void;
  onDeleteTask: (id: string) => void;
  onCreateBlock: (day: string) => void;
  onUpdateBlock: (id: string, patch: Partial<PlannerTimeBlock>) => void;
  onDeleteBlock: (id: string) => void;
  onSyncBlock: (block: PlannerTimeBlock, tasksInBlock: PlannerTask[]) => void;
  onUnsyncBlock: (block: PlannerTimeBlock) => void;
  onUpdateCapacity: (minutes: number) => void;
  onToggleCarryOver: (on: boolean) => void;
  // Retroactively record time worked on a to-do, on a given day.
  onLogTime: (taskId: string, minutes: number, day: string) => void;
  // Record a time block's planned time as actually worked (its to-dos).
  onLogBlockWorked: (block: PlannerTimeBlock, tasks: PlannerTask[]) => void;
}

export default function MyDayView({
  tasks, blocks, sessions, settings, today, cal, handlers, jumpTo, notesById = {}, lists = [], onOpenTask,
}: {
  tasks: PlannerTask[];
  blocks: PlannerTimeBlock[];
  sessions: PlannerTimeSession[];
  settings: PlannerSettings;
  today: string;
  cal: { gc: UseGoogleCalendar; calVersion: number };
  handlers: MyDayHandlers;
  // A nudge from elsewhere (the Plan view) to open a specific day.
  jumpTo?: { iso: string; n: number };
  notesById?: Record<string, PlannerNote>;
  // The selectable lists (non-archived notes) a to-do can be filed into.
  lists?: PlannerNote[];
  // Open a searched to-do where it lives (its list, its day, or the Inbox).
  onOpenTask?: (task: PlannerTask) => void;
}) {
  const { gc, calVersion } = cal;
  const carryOver = !!settings.carry_over_capacity;
  const orbitEnabled = !!settings.orbit_enabled;
  const [selected, setSelected] = useState(today);
  const prevDay = addDaysISO(selected, -1);
  const [showMonth, setShowMonth] = useState(false);
  const [events, setEvents] = useState<GCalEvent[]>([]);
  // The previous day's timed events — only needed (and only fetched) when the
  // carry-over setting is on, so the deduction matches what that day's bar showed.
  const [prevEvents, setPrevEvents] = useState<GCalEvent[]>([]);

  // Follow external day jumps (Plan → My Day). n bumps so the same day re-opens.
  useEffect(() => {
    if (jumpTo && jumpTo.n > 0) { setSelected(jumpTo.iso); setShowMonth(false); }
  }, [jumpTo]);

  // Load the selected day's Google events (re-runs when a block is synced), plus
  // the previous day's when carry-over is on so its overage can be measured.
  const loadEvents = useCallback(async () => {
    if (!gc.connected) { setEvents([]); setPrevEvents([]); return; }
    const start = new Date(selected + 'T00:00:00');
    const end = new Date(start); end.setDate(start.getDate() + 1);
    setEvents(await gc.fetchEvents(start.toISOString(), end.toISOString()));
    if (carryOver) {
      const pStart = new Date(prevDay + 'T00:00:00');
      const pEnd = new Date(pStart); pEnd.setDate(pStart.getDate() + 1);
      setPrevEvents(await gc.fetchEvents(pStart.toISOString(), pEnd.toISOString()));
    } else {
      setPrevEvents([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, prevDay, carryOver, gc.connected, gc.calendarId, gc.fetchEvents, calVersion]);
  useEffect(() => { loadEvents(); }, [loadEvents]);

  function goToDay(iso: string) { setSelected(iso); setShowMonth(false); }
  function shiftDay(delta: number) { setSelected(s => addDaysISO(s, delta)); }

  // The day's blocks, and the to-dos that live on the day.
  const dayBlocks = useMemo(
    () => blocks.filter(b => b.day === selected)
      .sort((a, b) => (a.start_minute ?? 1e9) - (b.start_minute ?? 1e9) || a.sort_order - b.sort_order),
    [blocks, selected],
  );
  const dayTasks = useMemo(
    () => tasks.filter(t => t.kind === 'task' && t.due_date === selected),
    [tasks, selected],
  );
  // Blocks that actually live on this day — a to-do is only "in a block" if its
  // block is one of these. (A to-do rolled forward can still point at a block on
  // its old day; that link is stale here, so it falls back to loose below.)
  const dayBlockIds = useMemo(() => new Set(dayBlocks.map(b => b.id)), [dayBlocks]);
  const tasksByBlock = useMemo(() => {
    const m: Record<string, PlannerTask[]> = {};
    for (const t of dayTasks) if (t.block_id && dayBlockIds.has(t.block_id)) (m[t.block_id] ??= []).push(t);
    return m;
  }, [dayTasks, dayBlockIds]);
  // Loose = scheduled for the day but not in one of today's blocks (so a to-do
  // with a stale block link still shows here instead of vanishing). De-duped: a
  // to-do in a real block shows only inside that block, never also here.
  const looseTasks = dayTasks.filter(t => !t.block_id || !dayBlockIds.has(t.block_id));

  // The local YYYY-MM-DD a to-do "belongs" to for navigation/recall: its due
  // day, else the day it was completed.
  function taskDay(t: PlannerTask): string | null {
    if (t.due_date) return t.due_date;
    if (t.done_at) { const d = new Date(t.done_at); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); }
    return null;
  }

  // Days that saw activity — something due, something finished, or a time
  // block — so the month can dot the days you actually worked.
  const activeDays = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) {
      if (t.kind !== 'task') continue;
      const d = taskDay(t);
      if (d) s.add(d);
    }
    for (const b of blocks) s.add(b.day);
    return s;
  }, [tasks, blocks]);

  // Open to-dos that slipped past their day (only surfaced when viewing today,
  // so the day-view inherits the old Today bucket's overdue behaviour).
  const overdue = useMemo(
    () => (selected === today
      ? tasks.filter(t => t.kind === 'task' && !t.done && !t.someday && !!t.due_date && t.due_date < today)
        .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
      : []),
    [tasks, selected, today],
  );

  // Planned load for any day: timed blocks count their range; untimed blocks +
  // loose to-dos count their estimates; and the day's *timed* Google events count
  // too — except events already represented by a synced block or time-blocked
  // to-do (matched by gcal_event_id), so nothing is double-counted. Pulling this
  // out lets us measure both the selected day and the previous one identically.
  const plannedFor = useCallback((dayIso: string, dayEvents: GCalEvent[]) => {
    const dBlocks = blocks.filter(b => b.day === dayIso);
    const dTasks = tasks.filter(t => t.kind === 'task' && t.due_date === dayIso);
    const byBlock: Record<string, PlannerTask[]> = {};
    for (const t of dTasks) if (t.block_id) (byBlock[t.block_id] ??= []).push(t);
    let total = 0;
    for (const b of dBlocks) total += blockMinutes(b, byBlock[b.id] ?? []);
    for (const t of dTasks) if (!t.block_id && !t.done) total += t.estimate_minutes ?? 0;
    const linked = new Set<string>();
    for (const b of dBlocks) if (b.gcal_event_id) linked.add(b.gcal_event_id);
    for (const t of dTasks) if (t.gcal_event_id) linked.add(t.gcal_event_id);
    for (const ev of dayEvents) {
      if (ev.id && linked.has(ev.id)) continue;
      if (!ev.start?.dateTime || !ev.end?.dateTime) continue; // skip all-day
      total += Math.max(0, Math.round((new Date(ev.end.dateTime).getTime() - new Date(ev.start.dateTime).getTime()) / 60_000));
    }
    return total;
  }, [blocks, tasks]);

  const plannedMinutes = useMemo(() => plannedFor(selected, events), [plannedFor, selected, events]);

  // Daily goal: how many of the day's *scheduled* to-dos you've completed —
  // matches what My Day shows, rather than counting completions from any list.
  const goal = settings.daily_goal_count;
  const completedCount = useMemo(
    () => tasks.filter(t => t.kind === 'task' && t.done && t.due_date === selected).length,
    [tasks, selected],
  );
  // Real time tracked on the viewed day (from the timer session log), so the
  // header reflects what you've actually done, not just what's planned.
  const workedMinutes = useMemo(
    () => sessions.reduce((sum, s) => sum + (localDay(s.started_at) === selected ? s.minutes : 0), 0),
    [sessions, selected],
  );

  // Working Phase: when one is active, it scales the day's target down (or up)
  // from the plain baseline — e.g. Recovery proposes a gentle fraction. This
  // becomes the effective base the bar and carry-over work from.
  const baseTarget = settings.daily_capacity_minutes;
  const phase = settings.working_phase ? phaseInfo(settings.working_phase) : null;
  const daysInPhase = settings.working_phase && settings.phase_started_on
    ? Math.max(0, daysBetweenISO(settings.phase_started_on, selected)) : 0;
  const phaseTarget = phase ? phase.proposed(baseTarget, daysInPhase) : null;
  const effectiveBase = phaseTarget ?? baseTarget;

  // Carry-over: if the previous day was planned *over* its target, lower today's
  // target by that overage rounded to the nearest hour (floored at zero). Off by
  // default; the deduction is shown on the bar so it never silently moves.
  const carryDeduction = useMemo(() => {
    if (!carryOver) return 0;
    const over = plannedFor(prevDay, prevEvents) - effectiveBase;
    return over > 0 ? Math.round(over / 60) * 60 : 0;
  }, [carryOver, plannedFor, prevDay, prevEvents, effectiveBase]);
  const effectiveTarget = Math.max(0, effectiveBase - carryDeduction);

  function handleDragEnd(e: DragEndEvent) {
    const taskId = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over) return;
    const task = dayTasks.find(t => t.id === taskId);
    if (!task) return;
    const nextBlock = over === 'loose' ? null : over.startsWith('block:') ? over.slice(6) : task.block_id;
    if (nextBlock !== task.block_id) handlers.onPatchTask(taskId, { block_id: nextBlock });
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const sel = new Date(selected + 'T00:00:00');

  // ---- AI planning assists (Suggest my day · Catch up) ------------------
  // Which assist is open, plus its async state. The shared panel renders the
  // result; applying a pick schedules the to-do via onPatchTask.
  const [aiFeature, setAiFeature] = useState<'day' | 'triage' | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const tasksById = useMemo(() => {
    const m: Record<string, PlannerTask> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);

  async function runAi(feature: 'day' | 'triage') {
    setAiFeature(feature);
    setAiResult(null);
    setAiError(null);
    setAiLoading(true);
    try {
      const fn = feature === 'day' ? suggestDayPlan : suggestPhaseTriage;
      setAiResult(await fn(tasks, settings, today, notesById));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Something went wrong — try again.');
    } finally {
      setAiLoading(false);
    }
  }

  function applyAiPicks(picks: { id: string; date: string | null }[]) {
    for (const p of picks) handlers.onPatchTask(p.id, { due_date: p.date, someday: false, block_id: null });
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Title + Google connection */}
      <div className="flex items-center gap-3 mb-5">
        <Sun className="w-6 h-6 text-amber-500" />
        <h2 className="text-2xl font-bold text-slate-800">My Day</h2>
        {/* AI planning assists — let Claude shape today or spread the load. */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => runAi('day')}
            className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg px-2.5 py-1.5"
            title="Let Claude suggest a realistic set of to-dos for today"
          >
            <Sparkles className="w-3.5 h-3.5" /> Suggest my day
          </button>
          <button
            onClick={() => runAi('triage')}
            className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg px-2.5 py-1.5"
            title="Let Claude spread your overdue and unscheduled to-dos across the next few days"
          >
            <Sparkles className="w-3.5 h-3.5" /> Catch up
          </button>
          {/* What the two AI assists do — hover to learn without clicking. */}
          <span className="relative group">
            <Info className="w-4 h-4 text-slate-300 hover:text-violet-500 cursor-help" />
            <span className="pointer-events-none group-hover:pointer-events-auto opacity-0 group-hover:opacity-100 transition-opacity absolute right-0 top-7 z-30 w-72 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs leading-relaxed text-slate-600 shadow-lg">
              <span className="flex items-center gap-1 font-semibold text-slate-700 mb-1.5"><Sparkles className="w-3.5 h-3.5 text-violet-500" /> AI planning help</span>
              <span className="block"><span className="font-medium text-slate-700">Suggest my day</span> — picks a realistic set of to-dos to tackle today, sized to your daily capacity and Working Phase.</span>
              <span className="block mt-1.5"><span className="font-medium text-slate-700">Catch up</span> — when you're behind, spreads your overdue and unscheduled to-dos gently across the next few days.</span>
              <span className="block mt-1.5 text-slate-400">Uses your Claude key (Settings → API Keys). You review every suggestion before anything changes.</span>
            </span>
          </span>
          <ConnectControls gc={gc} />
        </div>
      </div>

      <AiSuggestPanel
        open={aiFeature !== null}
        title={aiFeature === 'triage' ? 'Catch up' : 'Suggest my day'}
        intro={aiFeature === 'triage'
          ? 'Spread your overdue and unscheduled to-dos gently across the next 5 days.'
          : 'A realistic set of to-dos to tackle today.'}
        loading={aiLoading}
        error={aiError}
        result={aiResult}
        tasksById={tasksById}
        showDates
        onApply={applyAiPicks}
        onClose={() => setAiFeature(null)}
      />

      {gc.error && (
        <div className="mb-4 flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2">
          <span className="flex-1">{gc.error}</span>
          <button onClick={() => gc.setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}
      {gc.available && !gc.configured && <NotConfiguredCard />}

      {/* Search any task and jump to the day it's on / was done */}
      <TaskSearch
        tasks={tasks}
        taskDay={taskDay}
        today={today}
        lists={lists}
        onPatch={handlers.onPatchTask}
        onDelete={handlers.onDeleteTask}
        onOpen={t => (onOpenTask ? onOpenTask(t) : (taskDay(t) && goToDay(taskDay(t)!)))}
      />

      {/* Marvin-style day navigator: a big day number with Previous · 📅 · Next.
          Tapping the date (or the calendar button) drops a compact month picker
          right below it — dots mark the days you actually worked — and it closes
          the moment you choose a day, so it never takes over the page. */}
      <div className="mb-4">
        <div className="relative">
          <button onClick={() => setShowMonth(s => !s)} className="block w-full text-center group" title="Pick a day">
            <div className="text-base font-medium text-slate-500">{sel.toLocaleDateString(undefined, { weekday: 'long' })}</div>
            <div className="text-6xl font-bold text-slate-800 leading-none my-1 group-hover:text-teal-600 transition-colors">{sel.getDate()}</div>
            <div className="text-sm text-slate-400">
              {sel.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              {selected === today && <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-teal-600">Today</span>}
            </div>
          </button>
          {showMonth && (
            <>
              {/* Click-anywhere-else backdrop closes the picker. */}
              <div className="fixed inset-0 z-40" onClick={() => setShowMonth(false)} />
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-72 rounded-2xl shadow-xl">
                <MonthGrid selected={selected} today={today} activeDays={activeDays} onSelect={goToDay} />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-center gap-6 mt-3">
          <button onClick={() => shiftDay(-1)} className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-teal-600">
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>
          <button
            onClick={() => setShowMonth(s => !s)}
            className={`p-2 rounded-lg transition-colors ${showMonth ? 'bg-teal-50 text-teal-600' : 'text-slate-400 hover:bg-slate-100 hover:text-teal-600'}`}
            title={showMonth ? 'Back to the day' : 'Pick a day from the month'}
          >
            <CalendarDays className="w-5 h-5" />
          </button>
          <button onClick={() => shiftDay(1)} className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-teal-600">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {selected !== today && (
          <div className="text-center mt-1">
            <button onClick={() => goToDay(today)} className="text-xs font-medium text-teal-600 hover:text-teal-700">Jump to today</button>
          </div>
        )}

        <div className="mt-3">
          <CapacityBar
            planned={plannedMinutes}
            target={effectiveTarget}
            baseTarget={baseTarget}
            carryDeduction={carryDeduction}
            onSetTarget={handlers.onUpdateCapacity}
          />
          {goal != null && goal > 0 && <GoalBar done={completedCount} goal={goal} />}
          {workedMinutes > 0 && (
            <div className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400">
              <Clock className="w-3 h-3" /> {formatMinutes(workedMinutes)} worked {selected === today ? 'today' : 'this day'}
            </div>
          )}
        </div>
      </div>

      {phase && (
        <div className="mb-4">
          <PhaseBanner phase={phase} target={phaseTarget!} planned={plannedMinutes} daysIn={daysInPhase} />
        </div>
      )}

      {/* Full-width schedule so the day's to-dos have the whole width. */}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="space-y-4 min-w-0">
          {gc.connected && <GoogleEventsCard events={events} />}
          {overdue.length > 0 && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-500 mb-1 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Overdue
              </p>
              <ul className="space-y-0.5">
                {overdue.map(t => (
                  <DraggableTaskRow
                    key={t.id}
                    task={t}
                    today={today}
                    lists={lists}
                    orbitEnabled={orbitEnabled}
                    onPatch={handlers.onPatchTask}
                    onDelete={handlers.onDeleteTask}
                    onLogTime={handlers.onLogTime}
                    draggable={false}
                    onMoveToToday={() => handlers.onPatchTask(t.id, { due_date: today, block_id: null })}
                  />
                ))}
              </ul>
            </div>
          )}

          {dayBlocks.map(b => (
            <BlockCard
              key={b.id}
              block={b}
              tasks={tasksByBlock[b.id] ?? []}
              today={today}
              lists={lists}
              orbitEnabled={orbitEnabled}
              gcConnected={gc.connected}
              handlers={handlers}
            />
          ))}

          <LooseZone
            tasks={looseTasks}
            today={today}
            lists={lists}
            orbitEnabled={orbitEnabled}
            hasBlocks={dayBlocks.length > 0}
            onPatch={handlers.onPatchTask}
            onDelete={handlers.onDeleteTask}
            onLogTime={handlers.onLogTime}
          />

          <div className="flex items-center gap-2">
            <QuickAddTask onAdd={title => handlers.onAddTask({ title, due_date: selected })} />
            <button
              onClick={() => handlers.onCreateBlock(selected)}
              className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-teal-600 border border-slate-200 rounded-lg px-2.5 py-2 shrink-0"
              title="Add a named time block"
            >
              <Plus className="w-3.5 h-3.5" /> Block
            </button>
          </div>
        </div>
      </DndContext>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capacity bar
// ---------------------------------------------------------------------------

function CapacityBar({
  planned, target, baseTarget, carryDeduction, onSetTarget,
}: {
  planned: number;
  target: number; // effective target the bar measures against (after phase + carry-over)
  baseTarget: number; // the saved daily target; what the editable field shows/sets
  carryDeduction: number; // minutes shaved off today because yesterday ran over
  onSetTarget: (m: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState((baseTarget / 60).toString());
  const pct = target > 0 ? Math.min(100, Math.round((planned / target) * 100)) : 0;
  const over = planned > target;
  const reduced = carryDeduction > 0;

  function commit() {
    setEditing(false);
    const h = parseFloat(hours);
    if (!isNaN(h) && h > 0) onSetTarget(Math.round(h * 60));
    else setHours((baseTarget / 60).toString());
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 text-xs mb-1">
        <span className={`font-medium ${over ? 'text-rose-600' : 'text-slate-500'}`}>
          {formatMinutes(planned) || '0m'} planned
        </span>
        <span className="text-slate-400">of</span>
        {editing ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              type="number"
              min="0.5"
              step="0.5"
              value={hours}
              onChange={e => setHours(e.target.value)}
              onBlur={commit}
              onKeyDown={e => { if (e.key === 'Enter') commit(); }}
              className="w-14 text-xs border border-slate-200 rounded px-1.5 py-0.5"
            />
            <span className="text-slate-400">h target</span>
          </span>
        ) : (
          <button onClick={() => { setHours((baseTarget / 60).toString()); setEditing(true); }} className="font-medium text-slate-500 hover:text-teal-600 underline decoration-dotted">
            {formatMinutes(target)} target
          </button>
        )}
        {over && <span className="ml-auto text-rose-600 font-medium">Over by {formatMinutes(planned - target)}</span>}
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${over ? 'bg-rose-500' : pct > 80 ? 'bg-amber-500' : 'bg-teal-500'}`} style={{ width: `${pct}%` }} />
      </div>
      {reduced && (
        <div className="mt-1.5 text-[11px] text-amber-600">
          −{formatMinutes(carryDeduction)} carried over from yesterday ({formatMinutes(target + carryDeduction)} → {formatMinutes(target)})
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily goal — a count-based companion to the capacity bar: not "have I done
// enough hours" but "did I finish the things I set out to."
// ---------------------------------------------------------------------------

function GoalBar({ done, goal }: { done: number; goal: number }) {
  const hit = done >= goal;
  const pct = Math.min(100, Math.round((done / goal) * 100));
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 text-xs mb-1">
        <span className={`font-medium ${hit ? 'text-emerald-600' : 'text-slate-500'}`}>
          {done} of {goal} done
        </span>
        {hit && <span className="ml-auto text-emerald-600 font-medium">🎉 Goal met — nice work!</span>}
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${hit ? 'bg-emerald-500' : 'bg-indigo-400'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Working Phase banner — the forcing function: names the season you're in and
// flags when the day you've planned outruns what that phase can hold.
// ---------------------------------------------------------------------------

function PhaseBanner({ phase, target, planned, daysIn }: { phase: PhaseInfo; target: number; planned: number; daysIn: number }) {
  const over = planned > target && target > 0;
  return (
    <div className={`rounded-2xl border p-4 ${over ? 'border-rose-200 bg-rose-50/60' : 'border-slate-200 bg-slate-50/70'}`}>
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${phase.dot} shrink-0`} />
        <span className={`text-sm font-semibold ${phase.accent}`}>You're in {phase.label}</span>
        <span className="ml-auto text-xs font-medium text-slate-500">suggests {formatMinutes(target)} · day {daysIn + 1}</span>
      </div>
      <p className="text-xs text-slate-500 mt-1">{phase.tagline}</p>
      {over ? (
        <p className="text-xs text-rose-600 mt-2 font-medium">
          Today's plan is {formatMinutes(planned)} — more than {phase.label} can hold. What can move or wait?
          {phase.watchFor ? ` ${phase.watchFor}` : ''}
        </p>
      ) : phase.watchFor ? (
        <p className="text-xs text-amber-600 mt-2"><span className="font-medium">Watch for:</span> {phase.watchFor}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time block card (a droppable container of to-dos)
// ---------------------------------------------------------------------------

function BlockCard({
  block, tasks, today, lists, orbitEnabled, gcConnected, handlers,
}: {
  block: PlannerTimeBlock;
  tasks: PlannerTask[];
  today: string;
  lists: PlannerNote[];
  orbitEnabled: boolean;
  gcConnected: boolean;
  handlers: MyDayHandlers;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `block:${block.id}` });
  const [title, setTitle] = useState(block.title);
  const [draft, setDraft] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!block.title) titleRef.current?.focus(); }, [block.id, block.title]);

  const open = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);
  const minutes = blockMinutes(block, open);
  const timed = block.start_minute != null;
  const range = timed
    ? `${formatClock(block.start_minute)}${block.end_minute != null ? `–${formatClock(block.end_minute)}` : ''}`
    : 'Anytime';

  return (
    <div ref={setNodeRef} className={`rounded-2xl border bg-white p-4 transition-colors ${isOver ? 'border-teal-400 ring-2 ring-teal-100' : 'border-slate-200'}`}>
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-teal-600 shrink-0" />
        <input
          ref={titleRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (title !== block.title) handlers.onUpdateBlock(block.id, { title }); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="Name this block…"
          className="flex-1 text-sm font-semibold text-slate-800 bg-transparent outline-none placeholder:text-slate-300"
        />
        {minutes > 0 && <span className="text-xs font-medium text-slate-400">{formatMinutes(minutes)}</span>}
        {tasks.length > 0 && (
          <button
            onClick={() => handlers.onLogBlockWorked(block, tasks)}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-teal-600 shrink-0"
            title="Log this block’s time as actually worked — adds it to your Logbook & Stats without a timer"
          >
            <History className="w-3.5 h-3.5" /> Log as worked
          </button>
        )}
        {block.gcal_event_id ? (
          <button onClick={() => handlers.onUnsyncBlock(block)} className="inline-flex items-center gap-0.5 text-xs font-medium text-sky-600 hover:text-rose-500" title="Remove from Google Calendar">
            synced <Link2Off className="w-3.5 h-3.5" />
          </button>
        ) : gcConnected && timed && block.end_minute != null ? (
          <button onClick={() => handlers.onSyncBlock(block, open)} className="text-slate-300 hover:text-sky-600" title="Add this block to Google Calendar">
            <CalendarPlus className="w-4 h-4" />
          </button>
        ) : null}
        <button onClick={() => handlers.onDeleteBlock(block.id)} className="text-slate-300 hover:text-rose-500" title="Delete block (its to-dos stay on the day)">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Time range editor */}
      <div className="flex items-center gap-2 mb-2 ml-6 text-xs text-slate-400">
        <span className="text-slate-500 font-medium">{range}</span>
        <input
          type="time"
          value={minutesToTime(block.start_minute)}
          onChange={e => handlers.onUpdateBlock(block.id, { start_minute: timeToMinutes(e.target.value) })}
          className="border border-slate-200 rounded px-1.5 py-0.5"
        />
        <span>to</span>
        <input
          type="time"
          value={minutesToTime(block.end_minute)}
          onChange={e => handlers.onUpdateBlock(block.id, { end_minute: timeToMinutes(e.target.value) })}
          className="border border-slate-200 rounded px-1.5 py-0.5"
        />
      </div>

      <ul className="ml-6 space-y-0.5">
        {open.map(t => <DraggableTaskRow key={t.id} task={t} today={today} lists={lists} orbitEnabled={orbitEnabled} onPatch={handlers.onPatchTask} onDelete={handlers.onDeleteTask} onLogTime={handlers.onLogTime} />)}
        {done.map(t => <DraggableTaskRow key={t.id} task={t} today={today} lists={lists} orbitEnabled={orbitEnabled} onPatch={handlers.onPatchTask} onDelete={handlers.onDeleteTask} onLogTime={handlers.onLogTime} />)}
      </ul>
      {tasks.length === 0 && <p className="ml-6 text-xs text-slate-400">Drop a to-do here, or add one below.</p>}

      <div className="ml-6 mt-1">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && draft.trim()) {
              handlers.onAddTask({ title: draft.trim(), due_date: block.day, block_id: block.id });
              setDraft('');
            }
          }}
          placeholder="+ add a to-do to this block"
          className="w-full text-sm bg-transparent outline-none placeholder:text-slate-300 text-slate-700 py-1"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loose (un-blocked) to-dos for the day — also a drop target
// ---------------------------------------------------------------------------

function LooseZone({
  tasks, today, lists, orbitEnabled, hasBlocks, onPatch, onDelete, onLogTime,
}: {
  tasks: PlannerTask[];
  today: string;
  lists: PlannerNote[];
  orbitEnabled: boolean;
  hasBlocks: boolean;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  onLogTime?: (taskId: string, minutes: number, day: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'loose' });
  const open = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);
  if (tasks.length === 0 && !hasBlocks) {
    // Nothing scheduled and no blocks: still render as a drop target prompt.
    return (
      <div ref={setNodeRef} className={`rounded-2xl border border-dashed p-6 text-center text-sm text-slate-400 transition-colors ${isOver ? 'border-teal-400 bg-teal-50/40' : 'border-slate-200'}`}>
        <Inbox className="w-5 h-5 mx-auto mb-1 text-slate-300" />
        Nothing scheduled yet — add a to-do or a time block.
      </div>
    );
  }
  return (
    <div ref={setNodeRef} className={`rounded-2xl border bg-white p-4 transition-colors ${isOver ? 'border-teal-400 ring-2 ring-teal-100' : 'border-slate-200'}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{hasBlocks ? 'Not in a block' : 'Scheduled today'}</p>
      <ul className="space-y-0.5">
        {open.map(t => <DraggableTaskRow key={t.id} task={t} today={today} lists={lists} orbitEnabled={orbitEnabled} onPatch={onPatch} onDelete={onDelete} onLogTime={onLogTime} />)}
        {done.map(t => <DraggableTaskRow key={t.id} task={t} today={today} lists={lists} orbitEnabled={orbitEnabled} onPatch={onPatch} onDelete={onDelete} onLogTime={onLogTime} />)}
      </ul>
      {open.length === 0 && done.length === 0 && <p className="text-xs text-slate-400">Drag a to-do here to pull it out of its block.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A draggable to-do row (compact)
// ---------------------------------------------------------------------------

// A My Day to-do row: the unified TaskRow wrapped with dnd-kit's useDraggable so
// it can be dragged between time blocks and the loose zone. The drag handle is
// passed into TaskRow; everything else (chips, ⋯ menu, expand card) is shared.
function DraggableTaskRow({
  task, today, onPatch, onDelete, draggable = true, onMoveToToday, lists = [], orbitEnabled = false, onLogTime,
}: {
  task: PlannerTask;
  today: string;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  draggable?: boolean;
  onMoveToToday?: () => void;
  lists?: PlannerNote[];
  orbitEnabled?: boolean;
  onLogTime?: (taskId: string, minutes: number, day: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled: !draggable });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;
  const listName = task.note_id ? (lists.find(l => l.id === task.note_id)?.title.trim() || 'Untitled list') : undefined;

  const handle = draggable ? (
    <button
      {...attributes}
      {...listeners}
      className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity shrink-0 touch-none"
      title="Drag between blocks"
    >
      <GripVertical className="w-4 h-4" />
    </button>
  ) : undefined;

  // Rescheduling from My Day also pops the to-do out of its time block (whose
  // block lives on the old day) so it can't vanish from both days.
  function patchFromRow(id: string, patch: Partial<PlannerTask>) {
    if ('due_date' in patch) onPatch(id, { block_id: null, ...patch });
    else onPatch(id, patch);
  }

  return (
    <li ref={setNodeRef} style={style} className={isDragging ? 'opacity-50' : ''}>
      <TaskRow
        task={task}
        today={today}
        onPatch={patchFromRow}
        onDelete={onDelete}
        dragHandle={handle}
        lists={lists}
        listName={listName}
        showTimer
        canFlag
        canSomeday
        orbitEnabled={orbitEnabled}
        enableRecurrence
        enableChecklist
        onMoveToToday={onMoveToToday}
        onLogTime={onLogTime ? (m, d) => onLogTime(task.id, m, d) : undefined}
      />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Side cards
// ---------------------------------------------------------------------------

function GoogleEventsCard({ events }: { events: GCalEvent[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1">
        <CalendarDays className="w-3.5 h-3.5 text-sky-500" /> On your calendar
      </p>
      {events.length === 0 ? (
        <p className="text-sm text-slate-400">No events.</p>
      ) : (
        <ul className="space-y-1">
          {events.map(ev => (
            <li key={ev.id} className="flex items-center gap-2 text-sm">
              <span className="text-xs font-medium text-slate-400 w-16 shrink-0">
                {ev.start?.date ? 'All day' : ev.start?.dateTime ? new Date(ev.start.dateTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}
              </span>
              <span className="flex-1 text-slate-600 truncate">{ev.summary || '(no title)'}</span>
              {ev.htmlLink && <a href={ev.htmlLink} target="_blank" rel="noreferrer" className="text-slate-300 hover:text-sky-500"><ExternalLink className="w-3.5 h-3.5" /></a>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month grid (expandable full-month overview)
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isoOf(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// 42-cell (6-week) grid starting on the Sunday on/before the 1st of the month.
function monthCells(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function MonthGrid({
  selected, today, activeDays, onSelect,
}: {
  selected: string;
  today: string;
  activeDays: Set<string>;
  onSelect: (iso: string) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(selected + 'T00:00:00');
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const cells = monthCells(cursor.y, cursor.m);
  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  function shift(delta: number) {
    setCursor(c => { const d = new Date(c.y, c.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => shift(-1)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></button>
        <span className="text-sm font-semibold text-slate-700">{monthName}</span>
        <button onClick={() => shift(1)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map(w => <div key={w} className="text-center text-[10px] font-semibold uppercase text-slate-400">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map(d => {
          const iso = isoOf(d);
          const inMonth = d.getMonth() === cursor.m;
          const isToday = iso === today;
          const isSel = iso === selected;
          const has = activeDays.has(iso);
          return (
            <button
              key={iso}
              onClick={() => onSelect(iso)}
              className={`relative aspect-square rounded-lg text-sm flex items-center justify-center transition-colors
                ${isSel ? 'bg-teal-600 text-white font-semibold' : isToday ? 'bg-teal-50 text-teal-700 font-semibold' : inMonth ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 hover:bg-slate-50'}`}
            >
              {d.getDate()}
              {has && <span className={`absolute bottom-1 w-1 h-1 rounded-full ${isSel ? 'bg-white' : 'bg-teal-500'}`} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

// Search every to-do by title and jump to the day it lives on (or was done) —
// so when you've lost track of when something happened, you can find it and
// land on that day's schedule.
function TaskSearch({
  tasks, taskDay, today, lists, onPatch, onDelete, onOpen,
}: {
  tasks: PlannerTask[];
  taskDay: (t: PlannerTask) => string | null;
  today: string;
  lists: PlannerNote[];
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  onOpen: (task: PlannerTask) => void;
}) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return tasks.filter(t => t.kind === 'task' && (t.title || '').toLowerCase().includes(s)).slice(0, 12);
  }, [q, tasks]);

  return (
    <div className="relative mb-4">
      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-full px-4 py-2">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search tasks…"
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400 text-slate-700"
        />
        {q && <button onClick={() => setQ('')} className="text-slate-300 hover:text-slate-500"><X className="w-4 h-4" /></button>}
      </div>
      {q.trim() && (
        <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-80 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">No matching tasks.</p>
          ) : (
            <ul className="py-1">
              {results.map(t => {
                const day = taskDay(t);
                return (
                  <li key={t.id} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
                    <button
                      onClick={() => onPatch(t.id, { done: !t.done })}
                      className="shrink-0 transition-colors"
                      title={t.done ? 'Mark not done' : 'Mark done'}
                    >
                      {t.done
                        ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-teal-600 text-white"><Check className="w-3 h-3" /></span>
                        : <Circle className="w-4 h-4 text-slate-300 hover:text-teal-600" />}
                    </button>
                    <button
                      onClick={() => { onOpen(t); setQ(''); }}
                      className={`flex-1 min-w-0 text-left text-sm truncate ${t.done ? 'text-slate-400 line-through' : 'text-slate-700 hover:text-teal-600'}`}
                      title="Open this to-do"
                    >
                      {t.title || 'Untitled'}
                    </button>
                    {day && <span className="text-xs text-slate-400 shrink-0">{new Date(day + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
                    <TaskActionsMenu
                      task={t}
                      today={today}
                      onPatch={onPatch}
                      onDelete={onDelete}
                      onEditDetails={() => { onOpen(t); setQ(''); }}
                      lists={lists}
                      canFlag
                      canSomeday
                      enableRecurrence
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function QuickAddTask({ onAdd }: { onAdd: (title: string) => void }) {
  const [value, setValue] = useState('');
  function submit() { if (value.trim()) { onAdd(value.trim()); setValue(''); } }
  return (
    <div className="flex-1 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <Plus className="w-4 h-4 text-slate-400 shrink-0" />
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        placeholder="Add a to-do to this day…"
        className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400 text-slate-700"
      />
      <button
        onClick={submit}
        disabled={!value.trim()}
        title="Add (Enter)"
        className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
          value.trim() ? 'bg-teal-600 text-white hover:bg-teal-700' : 'text-slate-300 cursor-default'
        }`}
      >
        <CornerDownLeft className="w-3.5 h-3.5" /> Add
      </button>
    </div>
  );
}

function ConnectControls({ gc }: { gc: UseGoogleCalendar }) {
  if (!gc.configured) return null;
  if (!gc.connected) {
    return (
      <button onClick={gc.connect} disabled={gc.busy} className="inline-flex items-center gap-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg px-3 py-1.5 disabled:opacity-60">
        <CalendarDays className="w-4 h-4" /> {gc.busy ? 'Connecting…' : 'Connect Google Calendar'}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <select value={gc.calendarId} onChange={e => gc.chooseCalendar(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 max-w-[12rem]">
        {gc.calendars.map(c => <option key={c.id} value={c.id}>{c.summary}</option>)}
      </select>
      <button onClick={gc.disconnect} className="text-xs text-slate-400 hover:text-rose-500">Disconnect</button>
    </div>
  );
}

function NotConfiguredCard() {
  return (
    <div className="mb-6 bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-200 rounded-2xl p-5">
      <h3 className="font-semibold text-sky-800 mb-1 flex items-center gap-2"><CalendarDays className="w-4 h-4" /> Connect your Google Calendar</h3>
      <p className="text-sm text-sky-700 leading-relaxed">
        My Day works fully without it — connecting Google Calendar just layers your existing events
        alongside your plan and lets you push a time block out as a calendar event (with a reminder).
        It needs a one-time sign-in key (a free OAuth client ID) as <code className="bg-white/60 px-1 rounded">VITE_GOOGLE_CLIENT_ID</code>.
      </p>
    </div>
  );
}
