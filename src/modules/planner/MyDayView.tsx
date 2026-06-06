import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Clock, Trash2, Check, Circle,
  GripVertical, ExternalLink, CalendarPlus, Link2Off, X, Sun, Inbox, AlertCircle, Search,
  CalendarClock, FileText, CornerDownLeft,
} from 'lucide-react';
import type { UseGoogleCalendar } from './useGoogleCalendar';
import type { GCalEvent } from './google';
import { MiniMenu } from './MiniMenu';
import { TimerButton } from './TimerButton';
import { TaskNotes } from './TaskNotes';
import {
  addDaysISO, blockMinutes, formatClock, formatMinutes, localDay,
  minutesToTime, timeToMinutes, ESTIMATE_PRESETS, phaseInfo, daysBetweenISO,
  type PlannerSettings, type PlannerTask, type PlannerTimeBlock, type PhaseInfo,
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
  onSaveDayNote: (day: string, body: string) => void;
  onUpdateCapacity: (minutes: number) => void;
  onToggleCarryOver: (on: boolean) => void;
}

export default function MyDayView({
  tasks, blocks, dayNotes, settings, today, cal, handlers, jumpTo,
}: {
  tasks: PlannerTask[];
  blocks: PlannerTimeBlock[];
  dayNotes: Record<string, string>;
  settings: PlannerSettings;
  today: string;
  cal: { gc: UseGoogleCalendar; calVersion: number };
  handlers: MyDayHandlers;
  // A nudge from elsewhere (the Plan view) to open a specific day.
  jumpTo?: { iso: string; n: number };
}) {
  const { gc, calVersion } = cal;
  const carryOver = !!settings.carry_over_capacity;
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
  const tasksByBlock = useMemo(() => {
    const m: Record<string, PlannerTask[]> = {};
    for (const t of dayTasks) if (t.block_id) (m[t.block_id] ??= []).push(t);
    return m;
  }, [dayTasks]);
  // Loose = scheduled for the day but not dropped into a block. De-duped: a
  // to-do in a block shows only inside that block, never also here.
  const looseTasks = dayTasks.filter(t => !t.block_id);

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

  // Daily goal: how many to-dos were completed on the viewed day vs the target.
  const goal = settings.daily_goal_count;
  const completedCount = useMemo(
    () => tasks.filter(t => t.kind === 'task' && t.done && t.done_at && localDay(t.done_at) === selected).length,
    [tasks, selected],
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

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Title + Google connection */}
      <div className="flex items-center gap-3 mb-5">
        <Sun className="w-6 h-6 text-amber-500" />
        <h2 className="text-2xl font-bold text-slate-800">My Day</h2>
        <div className="ml-auto"><ConnectControls gc={gc} /></div>
      </div>

      {gc.error && (
        <div className="mb-4 flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2">
          <span className="flex-1">{gc.error}</span>
          <button onClick={() => gc.setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}
      {!gc.configured && <NotConfiguredCard />}

      {/* Search any task and jump to the day it's on / was done */}
      <TaskSearch tasks={tasks} taskDay={taskDay} onJump={goToDay} />

      {/* Marvin-style day navigator: a big day number with Previous · 📅 · Next.
          The calendar button swaps the number for the full month so you can
          land on any day — with dots on the days you actually worked. */}
      <div className="mb-4">
        {showMonth ? (
          <MonthGrid selected={selected} today={today} activeDays={activeDays} onSelect={goToDay} />
        ) : (
          <button onClick={() => setShowMonth(true)} className="block w-full text-center group" title="Open the month">
            <div className="text-base font-medium text-slate-500">{sel.toLocaleDateString(undefined, { weekday: 'long' })}</div>
            <div className="text-6xl font-bold text-slate-800 leading-none my-1 group-hover:text-teal-600 transition-colors">{sel.getDate()}</div>
            <div className="text-sm text-slate-400">
              {sel.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              {selected === today && <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-teal-600">Today</span>}
            </div>
          </button>
        )}

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
        </div>
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
          {/* Schedule column */}
          <div className="space-y-4">
            {phase && (
              <PhaseBanner phase={phase} target={phaseTarget!} planned={plannedMinutes} daysIn={daysInPhase} />
            )}
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
                      onPatch={handlers.onPatchTask}
                      onDelete={handlers.onDeleteTask}
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
                gcConnected={gc.connected}
                handlers={handlers}
              />
            ))}

            <LooseZone
              tasks={looseTasks}
              today={today}
              hasBlocks={dayBlocks.length > 0}
              onPatch={handlers.onPatchTask}
              onDelete={handlers.onDeleteTask}
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

          {/* Side column: calendar, day note, stats */}
          <div className="space-y-4">
            {gc.connected && <GoogleEventsCard events={events} />}
            <DayNoteCard
              key={selected}
              day={selected}
              value={dayNotes[selected] ?? ''}
              onSave={handlers.onSaveDayNote}
            />
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
  block, tasks, today, gcConnected, handlers,
}: {
  block: PlannerTimeBlock;
  tasks: PlannerTask[];
  today: string;
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
        {open.map(t => <DraggableTaskRow key={t.id} task={t} today={today} onPatch={handlers.onPatchTask} onDelete={handlers.onDeleteTask} />)}
        {done.map(t => <DraggableTaskRow key={t.id} task={t} today={today} onPatch={handlers.onPatchTask} onDelete={handlers.onDeleteTask} />)}
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
  tasks, today, hasBlocks, onPatch, onDelete,
}: {
  tasks: PlannerTask[];
  today: string;
  hasBlocks: boolean;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
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
        {open.map(t => <DraggableTaskRow key={t.id} task={t} today={today} onPatch={onPatch} onDelete={onDelete} />)}
        {done.map(t => <DraggableTaskRow key={t.id} task={t} today={today} onPatch={onPatch} onDelete={onDelete} />)}
      </ul>
      {open.length === 0 && done.length === 0 && <p className="text-xs text-slate-400">Drag a to-do here to pull it out of its block.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A draggable to-do row (compact)
// ---------------------------------------------------------------------------

function DraggableTaskRow({
  task, today, onPatch, onDelete, draggable = true, onMoveToToday,
}: {
  task: PlannerTask;
  today: string;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  draggable?: boolean;
  onMoveToToday?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled: !draggable });
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [notesOpen, setNotesOpen] = useState(false);
  const hasNotes = !!task.notes?.trim();
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;

  function commit() {
    setEditing(false);
    const next = title.trim();
    if (next && next !== task.title) onPatch(task.id, { title: next });
    else setTitle(task.title);
  }

  return (
    <li ref={setNodeRef} style={style} className={`group ${isDragging ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2 py-1">
      {draggable && (
        <button
          {...attributes}
          {...listeners}
          className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity shrink-0 touch-none"
          title="Drag between blocks"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}
      <button
        onClick={() => onPatch(task.id, { done: !task.done })}
        className={`shrink-0 transition-colors ${task.done ? 'text-teal-600' : 'text-slate-300 hover:text-teal-600'}`}
        title={task.done ? 'Mark not done' : 'Mark done'}
      >
        {task.done
          ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-teal-600 text-white"><Check className="w-2.5 h-2.5" /></span>
          : <Circle className="w-4 h-4" />}
      </button>
      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setTitle(task.title); setEditing(false); } }}
          className="flex-1 text-sm bg-transparent outline-none border-b border-teal-400 text-slate-700"
        />
      ) : (
        <span
          onClick={() => !task.done && setEditing(true)}
          className={`flex-1 text-sm cursor-text ${task.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}
        >
          {task.title || 'Untitled'}
        </span>
      )}
      {task.estimate_minutes ? <span className="text-xs font-medium text-slate-400 shrink-0">{formatMinutes(task.estimate_minutes)}</span> : null}
      {task.start_at && (
        <span className="text-xs text-sky-600 shrink-0">{new Date(task.start_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
      )}
      <TimerButton task={task} onPatch={onPatch} />
      {!task.done && (
        <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Set / clear a time estimate. */}
          <MiniMenu title="Time estimate" icon={<Clock className={`w-4 h-4 ${task.estimate_minutes ? 'text-teal-600' : 'text-slate-300 hover:text-teal-600'}`} />}>
            {close => (
              <div className="py-1">
                {ESTIMATE_PRESETS.map(p => (
                  <button key={p} onClick={() => { onPatch(task.id, { estimate_minutes: p }); close(); }}
                    className={`block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-slate-100 ${task.estimate_minutes === p ? 'text-teal-600 font-medium' : 'text-slate-700'}`}>
                    {formatMinutes(p)}
                  </button>
                ))}
                <button onClick={() => { onPatch(task.id, { estimate_minutes: null }); close(); }}
                  className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-slate-100 text-slate-400">No estimate</button>
              </div>
            )}
          </MiniMenu>

          {/* Reschedule to another day. Also pops it out of any time block (whose
              block lives on the old day) so it can't vanish from both days, and
              clearing the date moves it to Anytime. */}
          <label className="relative cursor-pointer text-slate-300 hover:text-teal-600" title="Move to another day">
            <CalendarClock className="w-4 h-4" />
            <input
              type="date"
              value={task.due_date ?? ''}
              onChange={e => onPatch(task.id, { due_date: e.target.value || null, block_id: null, someday: false })}
              className="absolute inset-0 opacity-0 cursor-pointer w-4"
            />
          </label>
        </div>
      )}
      <button
        onClick={() => setNotesOpen(v => !v)}
        className={`shrink-0 transition-opacity ${hasNotes || notesOpen ? 'opacity-100 text-teal-600' : 'opacity-0 group-hover:opacity-100 text-slate-300 hover:text-teal-600'}`}
        title={hasNotes ? 'Notes' : 'Add notes'}
      >
        <FileText className="w-3.5 h-3.5" />
      </button>
      {onMoveToToday && !task.done && (
        <button onClick={onMoveToToday} className="text-xs font-medium text-teal-600 hover:text-teal-700 shrink-0" title="Move to today">
          → Today
        </button>
      )}
      <button onClick={() => onDelete(task.id)} className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" title="Delete">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      </div>
      {notesOpen ? (
        <div className="ml-6 mb-1.5"><TaskNotes task={task} onPatch={onPatch} autoFocus /></div>
      ) : hasNotes ? (
        <button
          onClick={() => setNotesOpen(true)}
          className="ml-6 mb-1 block text-left text-xs text-slate-400 hover:text-slate-600 truncate max-w-full"
        >
          {task.notes!.trim().split('\n')[0]}
        </button>
      ) : null}
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

function DayNoteCard({ day, value, onSave }: { day: string; value: string; onSave: (day: string, body: string) => void }) {
  const [body, setBody] = useState(value);
  useEffect(() => { setBody(value); }, [value]);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Day note</p>
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        onBlur={() => { if (body !== value) onSave(day, body); }}
        placeholder="How's the day going? Wins, ideas, how you're feeling…"
        rows={4}
        className="w-full text-sm text-slate-700 bg-transparent outline-none resize-y placeholder:text-slate-300"
      />
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
  tasks, taskDay, onJump,
}: {
  tasks: PlannerTask[];
  taskDay: (t: PlannerTask) => string | null;
  onJump: (iso: string) => void;
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
                  <li key={t.id}>
                    <button
                      disabled={!day}
                      onClick={() => { if (day) { onJump(day); setQ(''); } }}
                      className={`w-full text-left px-4 py-2 flex items-center gap-2 ${day ? 'hover:bg-slate-50' : 'opacity-60 cursor-default'}`}
                      title={day ? 'Go to this day' : 'No date — schedule it to navigate'}
                    >
                      {t.done
                        ? <Check className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                        : <Circle className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
                      <span className={`flex-1 text-sm truncate ${t.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{t.title || 'Untitled'}</span>
                      {day && <span className="text-xs text-slate-400 shrink-0">{new Date(day + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
                    </button>
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
