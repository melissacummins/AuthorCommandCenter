import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  // Resolve a past timed block that still has open to-dos: worked[taskId] says
  // whether you worked on each. Worked (+ already-done) to-dos split the block's
  // time; worked ones stay open and carry to today.
  onResolveBlockReview: (blockId: string, worked: Record<string, boolean>) => void;
  // Planner-wide AI tools (scan every open to-do), surfaced from the My Day header.
  onEstimateDurations: () => void;
  onFindDuplicates: () => void;
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

  // Past timed blocks that STILL have open to-dos — the "you had these in a
  // block yesterday, did you work on them?" review. Held out of rollover until
  // resolved so their time gets logged (or not) on purpose.
  const reviewBlocks = useMemo(() =>
    blocks
      .filter(b => b.day < today && b.start_minute != null && b.end_minute != null && b.end_minute > b.start_minute)
      .map(b => {
        const inBlock = tasks.filter(t => t.kind === 'task' && t.block_id === b.id);
        return { block: b, all: inBlock, open: inBlock.filter(t => !t.done) };
      })
      .filter(x => x.open.length > 0)
      .sort((a, b) => a.block.day.localeCompare(b.block.day)),
    [blocks, tasks, today],
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
        <h2 className="text-2xl font-bold text-content">My Day</h2>
        {/* AI planning assists — let Claude shape today or spread the load. */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => runAi('day')}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-control px-2.5 py-1.5"
            title="Let Claude suggest a realistic set of to-dos for today"
          >
            <Sparkles className="w-3.5 h-3.5" /> Suggest my day
          </button>
          <button
            onClick={() => runAi('triage')}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-control px-2.5 py-1.5"
            title="Let Claude spread your overdue and unscheduled to-dos across the next few days"
          >
            <Sparkles className="w-3.5 h-3.5" /> Catch up
          </button>
          <button
            onClick={handlers.onEstimateDurations}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-control px-2.5 py-1.5"
            title="Let Claude estimate a duration for to-dos that have none (across all lists)"
          >
            <Sparkles className="w-3.5 h-3.5" /> Durations
          </button>
          <button
            onClick={handlers.onFindDuplicates}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-control px-2.5 py-1.5"
            title="Let Claude find duplicate to-dos across all your lists"
          >
            <Sparkles className="w-3.5 h-3.5" /> Duplicates
          </button>
          {/* What the two AI assists do — hover to learn without clicking. */}
          <span className="relative group">
            <Info className="w-4 h-4 text-content-faint hover:text-brand-500 cursor-help" />
            <span className="pointer-events-none group-hover:pointer-events-auto opacity-0 group-hover:opacity-100 transition-opacity absolute right-0 top-7 z-30 w-72 rounded-control border border-edge bg-surface p-3 text-left text-xs leading-relaxed text-content-secondary shadow-lg">
              <span className="flex items-center gap-1 font-semibold text-content mb-1.5"><Sparkles className="w-3.5 h-3.5 text-brand-500" /> AI planning help</span>
              <span className="block"><span className="font-medium text-content">Suggest my day</span> — picks a realistic set of to-dos to tackle today, sized to your daily capacity and Working Phase.</span>
              <span className="block mt-1.5"><span className="font-medium text-content">Catch up</span> — when you're behind, spreads your overdue and unscheduled to-dos gently across the next few days.</span>
              <span className="block mt-1.5 text-content-muted">Uses your Claude key (Settings → API Keys). You review every suggestion before anything changes.</span>
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
        <div className="mb-4 flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-control px-3 py-2">
          <span className="flex-1">{gc.error}</span>
          <button onClick={() => gc.setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}
      {gc.available && !gc.configured && <NotConfiguredCard />}

      {/* "You had to-dos in a time block that you never checked off — did you
          work on them?" Logging here records the block time without completing
          the to-do (worked ≠ done); it then carries forward to today. */}
      {selected === today && reviewBlocks.length > 0 && (
        <BlockReview reviewBlocks={reviewBlocks} onResolve={handlers.onResolveBlockReview} />
      )}

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
      <DayCommandBar
        sel={sel}
        isToday={selected === today}
        showMonth={showMonth}
        setShowMonth={setShowMonth}
        monthGrid={<MonthGrid selected={selected} today={today} activeDays={activeDays} onSelect={goToDay} />}
        onPrev={() => shiftDay(-1)}
        onNext={() => shiftDay(1)}
        onToday={() => goToDay(today)}
        planned={plannedMinutes}
        target={effectiveTarget}
        baseTarget={baseTarget}
        carryDeduction={carryDeduction}
        onSetTarget={handlers.onUpdateCapacity}
        goal={goal}
        done={completedCount}
        worked={workedMinutes}
        phase={phase}
        phaseTarget={phaseTarget}
        daysInPhase={daysInPhase}
      />

      {/* Full-width schedule so the day's to-dos have the whole width. */}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="space-y-4 min-w-0">
          {gc.connected && <GoogleEventsCard events={events} />}
          {overdue.length > 0 && (
            <div className="rounded-card border border-rose-200 bg-rose-50/60 p-4">
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
              className="flex items-center gap-1 text-xs font-medium text-content-secondary hover:text-brand-600 border border-edge rounded-control px-2.5 py-2 shrink-0"
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
// Day command bar — the whole My Day header on one row: the date (with arrows +
// month picker), an Hours meter (planned vs an editable target, with the target
// marked as a notch so "over" reads at a glance), a Tasks meter, and — only when
// a Working Phase is on — a tappable phase chip at the far right that reveals its
// tagline. Optional pieces sit at the end so a user without them sees no gap.
// ---------------------------------------------------------------------------

function DayCommandBar({
  sel, isToday, showMonth, setShowMonth, monthGrid, onPrev, onNext, onToday,
  planned, target, baseTarget, carryDeduction, onSetTarget,
  goal, done, worked, phase, phaseTarget, daysInPhase,
}: {
  sel: Date;
  isToday: boolean;
  showMonth: boolean;
  setShowMonth: (fn: (s: boolean) => boolean) => void;
  monthGrid: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  planned: number;
  target: number;
  baseTarget: number;
  carryDeduction: number;
  onSetTarget: (m: number) => void;
  goal: number | null;
  done: number;
  worked: number;
  phase: PhaseInfo | null;
  phaseTarget: number | null;
  daysInPhase: number;
}) {
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState((baseTarget / 60).toString());
  const [phaseOpen, setPhaseOpen] = useState(false);

  const over = planned > target;
  const nearing = target > 0 && planned / target > 0.8;
  // The bar spans 0…max(planned,target): the coloured fill is the planned share,
  // and the notch marks where the target sits. Under target the notch lands at
  // the right end; over target it sits back where the target was, so the red
  // overflow past it is obvious.
  const span = Math.max(planned, target, 1);
  const fillPct = Math.min(100, (planned / span) * 100);
  const notchPct = Math.min(100, (target / span) * 100);
  const barColor = over ? 'bg-rose-500' : nearing ? 'bg-amber-500' : 'bg-brand-500';

  function commitTarget() {
    setEditing(false);
    const h = parseFloat(hours);
    if (!isNaN(h) && h > 0) onSetTarget(Math.round(h * 60));
    else setHours((baseTarget / 60).toString());
  }

  const goalDots = goal != null && goal > 0 && goal <= 8;

  return (
    <div className="mb-4 rounded-card border border-edge bg-surface/60 px-3 py-2.5 flex items-center gap-x-5 gap-y-3 flex-wrap">
      {/* Date */}
      <div className="relative flex items-center gap-1.5 shrink-0">
        <button onClick={onPrev} className="p-1.5 rounded-control text-content-muted hover:bg-surface-sunken hover:text-brand-600" title="Previous day" aria-label="Previous day"><ChevronLeft className="w-4 h-4" /></button>
        <button onClick={() => setShowMonth(s => !s)} className="text-left px-1 group" title="Pick a day">
          <div className="text-[15px] font-semibold text-content group-hover:text-brand-600 transition-colors whitespace-nowrap">
            {sel.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
          {isToday
            ? <div className="text-[10px] font-bold uppercase tracking-wide text-brand-600">Today</div>
            : <div className="text-[11px] font-medium text-content-muted">{sel.toLocaleDateString(undefined, { year: 'numeric' })}</div>}
        </button>
        <button onClick={onNext} className="p-1.5 rounded-control text-content-muted hover:bg-surface-sunken hover:text-brand-600" title="Next day" aria-label="Next day"><ChevronRight className="w-4 h-4" /></button>
        <button onClick={() => setShowMonth(s => !s)} className={`p-1.5 rounded-control transition-colors ${showMonth ? 'bg-brand-50 text-brand-600' : 'text-content-muted hover:bg-surface-sunken hover:text-brand-600'}`} title="Pick a day from the month"><CalendarDays className="w-4 h-4" /></button>
        {!isToday && <button onClick={onToday} className="text-[11px] font-medium text-brand-600 hover:text-brand-700 ml-0.5 whitespace-nowrap">Today ›</button>}
        {showMonth && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowMonth(() => false)} />
            <div className="absolute left-0 top-full mt-2 z-50 w-72 rounded-card shadow-xl">{monthGrid}</div>
          </>
        )}
      </div>

      {/* Hours */}
      <div className="min-w-[10rem] flex-1">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Hours</span>
          <span className="text-[11px] tabular-nums">
            <span className={over ? 'text-rose-600 font-semibold' : 'text-content-secondary font-medium'}>{formatMinutes(planned) || '0m'}</span>
            <span className="text-content-muted"> / </span>
            {editing ? (
              <input
                autoFocus type="number" min="0.5" step="0.5" value={hours}
                onChange={e => setHours(e.target.value)} onBlur={commitTarget}
                onKeyDown={e => { if (e.key === 'Enter') commitTarget(); }}
                className="w-12 text-[11px] border border-edge rounded px-1 py-0.5 bg-surface"
              />
            ) : (
              <button onClick={() => { setHours((baseTarget / 60).toString()); setEditing(true); }} className="text-content-secondary hover:text-brand-600 underline decoration-dotted" title="Set your daily hour target">{formatMinutes(target)}</button>
            )}
          </span>
        </div>
        <div className="relative h-2 rounded-full bg-surface-sunken overflow-visible">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${fillPct}%` }} />
          <div className="absolute top-[-3px] w-[2px] h-[14px] rounded-sm" style={{ left: `calc(${notchPct}% - 1px)`, background: 'var(--color-content)', opacity: 0.6 }} title={`Target ${formatMinutes(target)}`} />
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-content-muted min-h-[14px]">
          {over && <span className="text-rose-600 font-medium">Over by {formatMinutes(planned - target)}</span>}
          {carryDeduction > 0 && <span className="text-amber-600">−{formatMinutes(carryDeduction)} carried over</span>}
          {worked > 0 && <span className="inline-flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{formatMinutes(worked)} worked</span>}
        </div>
      </div>

      {/* Tasks — mirrors the Hours block (compact value + a reserved caption row)
          so its bar lines up with Hours'. */}
      <div className="min-w-[8rem] flex-1">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-content-muted">Tasks</span>
          <span className="text-[11px] tabular-nums font-medium text-content-secondary">
            {goal != null && goal > 0 ? <>{done}/{goal}</> : <>{done} done</>}
          </span>
        </div>
        {goal != null && goal > 0 ? (
          goalDots ? (
            <div className="flex items-center gap-1 h-2">
              {Array.from({ length: goal }, (_, i) => (
                <span key={i} className={`h-2 flex-1 rounded-full ${i < done ? (done >= goal ? 'bg-emerald-500' : 'bg-brand-500') : 'bg-surface-sunken'}`} />
              ))}
            </div>
          ) : (
            <div className="h-2 rounded-full bg-surface-sunken overflow-hidden">
              <div className={`h-full rounded-full transition-all ${done >= goal ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, Math.round((done / goal) * 100))}%` }} />
            </div>
          )
        ) : (
          <div className="h-2 rounded-full bg-surface-sunken" />
        )}
        <div className="mt-1 text-[10px] font-medium text-emerald-600 min-h-[14px]">
          {goal != null && goal > 0 && done >= goal ? '🎉 Goal met' : ''}
        </div>
      </div>

      {/* Working phase (optional) — tappable for its tagline. Sits at the end so
          users without a phase see no gap. */}
      {phase && (
        <div className="relative shrink-0 ml-auto">
          <button
            onClick={() => setPhaseOpen(o => !o)}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium border transition-colors ${over ? 'border-transparent bg-rose-50 text-rose-600' : `border-edge ${phase.accent} hover:bg-surface-sunken`}`}
            title="What this phase means"
          >
            <span className={`w-2 h-2 rounded-full ${phase.dot}`} />
            {phase.label}
          </button>
          {phaseOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setPhaseOpen(false)} />
              <div className="absolute right-0 top-full mt-2 z-50 w-64 rounded-card border border-edge bg-surface shadow-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2.5 h-2.5 rounded-full ${phase.dot}`} />
                  <span className={`text-sm font-semibold ${phase.accent}`}>You're in {phase.label}</span>
                </div>
                <p className="text-xs text-content-secondary">{phase.tagline}</p>
                <p className="text-[11px] text-content-muted mt-2">Suggests {formatMinutes(phaseTarget ?? target)} · day {daysInPhase + 1}</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block review — "worked on" vs "done." When a timed block from an earlier day
// still has un-checked to-dos, this asks whether you worked on each. Worked ones
// log their share of the block's time and STAY OPEN (carried to today to finish);
// "didn't" ones just drop back to today. Saying "didn't" hands that to-do's share
// to the rest, so the block's time always lands on the work you actually did.
// ---------------------------------------------------------------------------

type ReviewBlock = { block: PlannerTimeBlock; all: PlannerTask[]; open: PlannerTask[] };

function BlockReview({
  reviewBlocks, onResolve,
}: {
  reviewBlocks: ReviewBlock[];
  onResolve: (blockId: string, worked: Record<string, boolean>) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = reviewBlocks.reduce((n, x) => n + x.open.length, 0);
  return (
    <div className="mb-4 rounded-card border border-brand-200 bg-brand-50/60 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <History className="w-4 h-4 text-brand-500 shrink-0" />
        <span className="text-sm font-semibold text-brand-800">
          {count} to-do{count === 1 ? '' : 's'} from earlier time block{reviewBlocks.length === 1 ? '' : 's'} — did you work on {count === 1 ? 'it' : 'them'}?
        </span>
        <span className="ml-auto text-xs font-medium text-brand-600">{open ? 'Hide' : 'Review'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {reviewBlocks.map(rb => <BlockReviewCard key={rb.block.id} rb={rb} onResolve={onResolve} />)}
        </div>
      )}
    </div>
  );
}

function BlockReviewCard({
  rb, onResolve,
}: {
  rb: ReviewBlock;
  onResolve: (blockId: string, worked: Record<string, boolean>) => void;
}) {
  const { block, all, open } = rb;
  // Default each open to-do to "worked" — a scheduled block usually happened;
  // flip the ones that didn't.
  const [worked, setWorked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(open.map(t => [t.id, true])));
  const dur = (block.end_minute ?? 0) - (block.start_minute ?? 0);
  const doneCount = all.filter(t => t.done).length;
  const countedCount = doneCount + open.filter(t => worked[t.id]).length;
  const share = countedCount > 0 ? Math.round(dur / countedCount) : 0;
  const dayLabel = new Date(block.day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <div className="rounded-card border border-edge bg-surface p-3">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-sm font-semibold text-content">{block.title || 'Time block'}</span>
        <span className="text-xs text-content-muted">
          {dayLabel} · {formatClock(block.start_minute)}–{formatClock(block.end_minute)} · {formatMinutes(dur)}
        </span>
      </div>
      {doneCount > 0 && (
        <p className="text-xs text-content-muted mb-1.5">{doneCount} already checked off{countedCount > 0 && <> · {formatMinutes(share)} each</>}</p>
      )}
      <ul className="space-y-1.5">
        {open.map(t => (
          <li key={t.id} className="flex items-center gap-2">
            <span className="flex-1 min-w-0 text-sm text-content break-words">{t.title || 'Untitled'}</span>
            <div className="shrink-0 inline-flex rounded-control border border-edge overflow-hidden text-xs font-medium">
              <button
                onClick={() => setWorked(w => ({ ...w, [t.id]: true }))}
                className={`px-2.5 py-1 transition-colors ${worked[t.id] ? 'bg-brand-600 text-brand-fg' : 'text-content-secondary hover:bg-surface-sunken'}`}
                title="I worked on it — log the time, keep it open"
              >
                Worked
              </button>
              <button
                onClick={() => setWorked(w => ({ ...w, [t.id]: false }))}
                className={`px-2.5 py-1 transition-colors ${!worked[t.id] ? 'bg-slate-600 text-white' : 'text-content-secondary hover:bg-surface-sunken'}`}
                title="I didn't — leave it untracked and move it to today"
              >
                Didn’t
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={() => onResolve(block.id, worked)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 rounded-control px-3 py-1.5"
        >
          <Check className="w-4 h-4" /> Save
        </button>
        <span className="text-xs text-content-muted">
          {countedCount > 0
            ? <>Logs {formatMinutes(share)} to each of {countedCount}; open ones carry to today.</>
            : <>Nothing logged; all move to today.</>}
        </span>
      </div>
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
    <div ref={setNodeRef} className={`rounded-card border bg-surface p-4 transition-colors ${isOver ? 'border-brand-400 ring-2 ring-brand-100' : 'border-edge'}`}>
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-brand-600 shrink-0" />
        <input
          ref={titleRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (title !== block.title) handlers.onUpdateBlock(block.id, { title }); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="Name this block…"
          className="flex-1 text-sm font-semibold text-content bg-transparent outline-none placeholder:text-content-faint"
        />
        {minutes > 0 && <span className="text-xs font-medium text-content-muted">{formatMinutes(minutes)}</span>}
        {tasks.length > 0 && (
          <button
            onClick={() => handlers.onLogBlockWorked(block, tasks)}
            className="inline-flex items-center gap-1 text-xs font-medium text-content-muted hover:text-brand-600 shrink-0"
            title="Log this block’s time as actually worked — adds it to your Logbook & Stats without a timer"
          >
            <History className="w-3.5 h-3.5" /> Log as worked
          </button>
        )}
        {block.gcal_event_id ? (
          <button onClick={() => handlers.onUnsyncBlock(block)} className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-600 hover:text-rose-500" title="Remove from Google Calendar">
            synced <Link2Off className="w-3.5 h-3.5" />
          </button>
        ) : gcConnected && timed && block.end_minute != null ? (
          <button onClick={() => handlers.onSyncBlock(block, open)} className="text-content-faint hover:text-brand-600" title="Add this block to Google Calendar">
            <CalendarPlus className="w-4 h-4" />
          </button>
        ) : null}
        <button onClick={() => handlers.onDeleteBlock(block.id)} className="text-content-faint hover:text-rose-500" title="Delete block (its to-dos stay on the day)">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Time range editor */}
      <div className="flex items-center gap-2 mb-2 ml-6 text-xs text-content-muted">
        <span className="text-content-secondary font-medium">{range}</span>
        <input
          type="time"
          value={minutesToTime(block.start_minute)}
          onChange={e => handlers.onUpdateBlock(block.id, { start_minute: timeToMinutes(e.target.value) })}
          className="border border-edge rounded px-1.5 py-0.5"
        />
        <span>to</span>
        <input
          type="time"
          value={minutesToTime(block.end_minute)}
          onChange={e => handlers.onUpdateBlock(block.id, { end_minute: timeToMinutes(e.target.value) })}
          className="border border-edge rounded px-1.5 py-0.5"
        />
      </div>

      <ul className="ml-6 space-y-0.5">
        {open.map(t => <DraggableTaskRow key={t.id} task={t} today={today} lists={lists} orbitEnabled={orbitEnabled} onPatch={handlers.onPatchTask} onDelete={handlers.onDeleteTask} onLogTime={handlers.onLogTime} />)}
        {done.map(t => <DraggableTaskRow key={t.id} task={t} today={today} lists={lists} orbitEnabled={orbitEnabled} onPatch={handlers.onPatchTask} onDelete={handlers.onDeleteTask} onLogTime={handlers.onLogTime} />)}
      </ul>
      {tasks.length === 0 && <p className="ml-6 text-xs text-content-muted">Drop a to-do here, or add one below.</p>}

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
          className="w-full text-sm bg-transparent outline-none placeholder:text-content-faint text-content py-1"
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
      <div ref={setNodeRef} className={`rounded-card border border-dashed p-6 text-center text-sm text-content-muted transition-colors ${isOver ? 'border-brand-400 bg-brand-50/40' : 'border-edge'}`}>
        <Inbox className="w-5 h-5 mx-auto mb-1 text-content-faint" />
        Nothing scheduled yet — add a to-do or a time block.
      </div>
    );
  }
  return (
    <div ref={setNodeRef} className={`rounded-card border bg-surface p-4 transition-colors ${isOver ? 'border-brand-400 ring-2 ring-brand-100' : 'border-edge'}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted mb-1">{hasBlocks ? 'Not in a block' : 'Scheduled today'}</p>
      <ul className="space-y-0.5">
        {open.map(t => <DraggableTaskRow key={t.id} task={t} today={today} lists={lists} orbitEnabled={orbitEnabled} onPatch={onPatch} onDelete={onDelete} onLogTime={onLogTime} />)}
        {done.map(t => <DraggableTaskRow key={t.id} task={t} today={today} lists={lists} orbitEnabled={orbitEnabled} onPatch={onPatch} onDelete={onDelete} onLogTime={onLogTime} />)}
      </ul>
      {open.length === 0 && done.length === 0 && <p className="text-xs text-content-muted">Drag a to-do here to pull it out of its block.</p>}
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
  task, today, onPatch, onDelete, draggable = true, onMoveToToday, lists = [], orbitEnabled = false, onLogTime, blocked = false, onEditDependencies,
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
  blocked?: boolean;
  onEditDependencies?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled: !draggable });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;
  const listName = task.note_id ? (lists.find(l => l.id === task.note_id)?.title.trim() || 'Untitled list') : undefined;

  const handle = draggable ? (
    <button
      {...attributes}
      {...listeners}
      className="text-content-faint hover:text-content-secondary cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity shrink-0 touch-none"
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
        blocked={blocked}
        onEditDependencies={onEditDependencies}
      />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Side cards
// ---------------------------------------------------------------------------

function GoogleEventsCard({ events }: { events: GCalEvent[] }) {
  return (
    <div className="rounded-card border border-edge bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted mb-2 flex items-center gap-1">
        <CalendarDays className="w-3.5 h-3.5 text-brand-500" /> On your calendar
      </p>
      {events.length === 0 ? (
        <p className="text-sm text-content-muted">No events.</p>
      ) : (
        <ul className="space-y-1">
          {events.map(ev => (
            <li key={ev.id} className="flex items-center gap-2 text-sm">
              <span className="text-xs font-medium text-content-muted w-16 shrink-0">
                {ev.start?.date ? 'All day' : ev.start?.dateTime ? new Date(ev.start.dateTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}
              </span>
              <span className="flex-1 text-content-secondary truncate">{ev.summary || '(no title)'}</span>
              {ev.htmlLink && <a href={ev.htmlLink} target="_blank" rel="noreferrer" className="text-content-faint hover:text-brand-500"><ExternalLink className="w-3.5 h-3.5" /></a>}
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
    <div className="rounded-card border border-edge bg-surface p-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => shift(-1)} className="p-1.5 rounded-control text-content-muted hover:bg-surface-sunken"><ChevronLeft className="w-4 h-4" /></button>
        <span className="text-sm font-semibold text-content">{monthName}</span>
        <button onClick={() => shift(1)} className="p-1.5 rounded-control text-content-muted hover:bg-surface-sunken"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map(w => <div key={w} className="text-center text-[10px] font-semibold uppercase text-content-muted">{w}</div>)}
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
              className={`relative aspect-square rounded-control text-sm flex items-center justify-center transition-colors
                ${isSel ? 'bg-brand-600 text-brand-fg font-semibold' : isToday ? 'bg-brand-50 text-brand-700 font-semibold' : inMonth ? 'text-content hover:bg-surface-sunken' : 'text-content-faint hover:bg-surface-hover'}`}
            >
              {d.getDate()}
              {has && <span className={`absolute bottom-1 w-1 h-1 rounded-full ${isSel ? 'bg-surface' : 'bg-brand-500'}`} />}
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
      <div className="flex items-center gap-2 bg-surface-hover border border-edge rounded-full px-4 py-2">
        <Search className="w-4 h-4 text-content-muted shrink-0" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search tasks…"
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-content-muted text-content"
        />
        {q && <button onClick={() => setQ('')} className="text-content-faint hover:text-content-secondary"><X className="w-4 h-4" /></button>}
      </div>
      {q.trim() && (
        <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-surface border border-edge rounded-card shadow-xl max-h-80 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-content-muted">No matching tasks.</p>
          ) : (
            <ul className="py-1">
              {results.map(t => {
                const day = taskDay(t);
                return (
                  <li key={t.id} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover">
                    <button
                      onClick={() => onPatch(t.id, { done: !t.done })}
                      className="shrink-0 transition-colors"
                      title={t.done ? 'Mark not done' : 'Mark done'}
                    >
                      {t.done
                        ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand-600 text-brand-fg"><Check className="w-3 h-3" /></span>
                        : <Circle className="w-4 h-4 text-content-faint hover:text-brand-600" />}
                    </button>
                    <button
                      onClick={() => { onOpen(t); setQ(''); }}
                      className={`flex-1 min-w-0 text-left text-sm truncate ${t.done ? 'text-content-muted line-through' : 'text-content hover:text-brand-600'}`}
                      title="Open this to-do"
                    >
                      {t.title || 'Untitled'}
                    </button>
                    {day && <span className="text-xs text-content-muted shrink-0">{new Date(day + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
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
    <div className="flex-1 flex items-center gap-2 bg-surface-hover border border-edge rounded-control px-3 py-2">
      <Plus className="w-4 h-4 text-content-muted shrink-0" />
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        placeholder="Add a to-do to this day…"
        className="flex-1 text-sm bg-transparent outline-none placeholder:text-content-muted text-content"
      />
      <button
        onClick={submit}
        disabled={!value.trim()}
        title="Add (Enter)"
        className={`shrink-0 inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-medium transition-colors ${
          value.trim() ? 'bg-brand-600 text-brand-fg hover:bg-brand-700' : 'text-content-faint cursor-default'
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
      <button onClick={gc.connect} disabled={gc.busy} className="inline-flex items-center gap-2 text-sm font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 rounded-control px-3 py-1.5 disabled:opacity-60">
        <CalendarDays className="w-4 h-4" /> {gc.busy ? 'Connecting…' : 'Connect Google Calendar'}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <select value={gc.calendarId} onChange={e => gc.chooseCalendar(e.target.value)} className="text-sm border border-edge rounded-control px-2 py-1.5 max-w-[12rem]">
        {gc.calendars.map(c => <option key={c.id} value={c.id}>{c.summary}</option>)}
      </select>
      <button onClick={gc.disconnect} className="text-xs text-content-muted hover:text-rose-500">Disconnect</button>
    </div>
  );
}

function NotConfiguredCard() {
  return (
    <div className="mb-6 bg-gradient-to-r from-brand-50 to-brand-50 border border-brand-200 rounded-card p-5">
      <h3 className="font-semibold text-brand-800 mb-1 flex items-center gap-2"><CalendarDays className="w-4 h-4" /> Connect your Google Calendar</h3>
      <p className="text-sm text-brand-700 leading-relaxed">
        My Day works fully without it — connecting Google Calendar just layers your existing events
        alongside your plan and lets you push a time block out as a calendar event (with a reminder).
        It needs a one-time sign-in key (a free OAuth client ID) as <code className="bg-surface/60 px-1 rounded">VITE_GOOGLE_CLIENT_ID</code>.
      </p>
    </div>
  );
}
