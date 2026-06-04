import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MiniMenu } from './MiniMenu';
import { TimerButton } from './TimerButton';
import { TaskNotes } from './TaskNotes';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../../contexts/AuthContext';
import {
  NotebookPen, Plus, Check, Circle, Trash2, Pin, PinOff, Archive,
  CalendarClock, Layers, Moon, Inbox, X, GripVertical,
  Heading as HeadingIcon, ChevronRight, ChevronDown, Repeat, Clock, CalendarDays, CalendarPlus, Link2Off, Sun, BarChart3,
  Star, Menu, CalendarRange, BookCheck, FileText,
} from 'lucide-react';
import MyDayView, { type MyDayHandlers } from './MyDayView';
import StatsView from './StatsView';
import LogbookView from './LogbookView';
import PlanView from './PlanView';
import { useGoogleCalendar, type UseGoogleCalendar } from './useGoogleCalendar';
import type { GCalEvent } from './google';
import {
  listNotes, createNote, updateNote, deleteNote,
  listTasks, createTask, updateTask, deleteTask, reorderTasks, newChecklistItem,
  getSettings, updateSettings, listDayNotes, saveDayNote as apiSaveDayNote,
  listTimeBlocks, createTimeBlock, updateTimeBlock, deleteTimeBlock,
} from './api';
import {
  bucketForTask, checklistProgress, formatDue, formatMinutes, nextDueDate, sumEstimate, todayISO,
  elapsedMinutes, ESTIMATE_PRESETS, RECURRENCE_LABELS, DEFAULT_DAILY_CAPACITY,
  type ChecklistItem, type PlannerNote, type PlannerTask, type Bucket, type Recurrence,
  type PlannerSettings, type PlannerDayNote, type PlannerTimeBlock,
} from './types';

type Selection =
  | { kind: 'view'; bucket: Bucket }
  | { kind: 'note'; id: string }
  | { kind: 'myday' }
  | { kind: 'plan' }
  | { kind: 'stats' }
  | { kind: 'logbook' };

// Everything a list/calendar view needs to show Google events and turn to-dos
// into time blocks. Bundled so it's one prop to thread down.
interface CalendarBridge {
  gc: UseGoogleCalendar;
  calVersion: number;
  onTimeBlock: (task: PlannerTask, time: string) => void;
  onUnblock: (task: PlannerTask) => void;
}

// "Today" is intentionally absent here — My Day is the day view and surfaces
// today (and overdue) itself.
const VIEWS: { bucket: Bucket; label: string; icon: typeof Inbox; color: string }[] = [
  { bucket: 'upcoming', label: 'Upcoming', icon: CalendarClock, color: 'text-rose-500' },
  { bucket: 'anytime',  label: 'Anytime',  icon: Layers,        color: 'text-teal-600' },
  { bucket: 'someday',  label: 'Someday',  icon: Moon,          color: 'text-indigo-500' },
];

export default function PlannerModule() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<PlannerNote[]>([]);
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [blocks, setBlocks] = useState<PlannerTimeBlock[]>([]);
  const [dayNotes, setDayNotes] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<PlannerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'myday' });
  // The planner rail is a slide-over on mobile; always-on from md up.
  const [railOpen, setRailOpen] = useState(false);
  // A nudge to open a specific day in My Day (e.g. from the Plan view). The
  // bumping counter lets the same day be re-opened.
  const [dayJump, setDayJump] = useState<{ iso: string; n: number }>(() => ({ iso: todayISO(), n: 0 }));
  const today = todayISO();
  const gc = useGoogleCalendar();
  // Bumped whenever a time block is added/removed so the views re-fetch events.
  const [calVersion, setCalVersion] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([
      listNotes(user.id), listTasks(user.id), listTimeBlocks(user.id),
      listDayNotes(user.id), getSettings(user.id),
    ])
      .then(([n, t, b, dn, s]) => {
        if (!active) return;
        setNotes(n); setTasks(t); setBlocks(b);
        setDayNotes(Object.fromEntries((dn as PlannerDayNote[]).map(d => [d.day, d.body])));
        setSettings(s);
      })
      .catch(e => { if (active) setError(e?.message ?? 'Could not load your planner.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

  const notesById = useMemo(() => Object.fromEntries(notes.map(n => [n.id, n])), [notes]);
  const openCountByNote = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of tasks) if (t.note_id && t.kind === 'task' && !t.done) m[t.note_id] = (m[t.note_id] ?? 0) + 1;
    return m;
  }, [tasks]);

  const viewCounts = useMemo(() => {
    const c: Record<Bucket, number> = { today: 0, upcoming: 0, anytime: 0, someday: 0 };
    for (const t of tasks) if (t.kind === 'task' && !t.done) c[bucketForTask(t, today)]++;
    return c;
  }, [tasks, today]);

  // ---- mutations (optimistic where it helps responsiveness) ----

  async function handleNewNote() {
    if (!user) return;
    try {
      const note = await createNote(user.id, '');
      setNotes(prev => [note, ...prev]);
      setSelection({ kind: 'note', id: note.id });
      setRailOpen(false);
    } catch (e) { setError((e as Error)?.message ?? 'Could not create note.'); }
  }

  function patchNoteLocal(id: string, patch: Partial<PlannerNote>) {
    setNotes(prev => prev.map(n => (n.id === id ? { ...n, ...patch } : n)));
  }

  async function saveNote(id: string, patch: Partial<PlannerNote>) {
    patchNoteLocal(id, patch);
    try { await updateNote(id, patch); }
    catch (e) { setError((e as Error)?.message ?? 'Could not save note.'); }
  }

  async function removeNote(id: string) {
    if (!confirm('Delete this list and its checklist? This can’t be undone.')) return;
    setNotes(prev => prev.filter(n => n.id !== id));
    setTasks(prev => prev.filter(t => t.note_id !== id));
    setSelection({ kind: 'myday' });
    try { await deleteNote(id); }
    catch (e) { setError((e as Error)?.message ?? 'Could not delete note.'); }
  }

  async function addTask(input: {
    title: string; note_id?: string | null; due_date?: string | null; someday?: boolean;
    kind?: 'task' | 'heading'; sort_order?: number; block_id?: string | null; estimate_minutes?: number | null;
  }) {
    if (!user || !input.title.trim()) return;
    try {
      const task = await createTask(user.id, { ...input, title: input.title.trim() });
      setTasks(prev => [...prev, task]);
    } catch (e) { setError((e as Error)?.message ?? 'Could not add item.'); }
  }

  // Like addTask but returns the created row (and allows an empty title) so the
  // list editor can place it precisely and focus it for keyboard-driven entry.
  async function createTaskReturning(input: {
    title?: string; note_id?: string | null; kind?: 'task' | 'heading'; sort_order?: number;
  }): Promise<PlannerTask | undefined> {
    if (!user) return undefined;
    try {
      const task = await createTask(user.id, { ...input, title: input.title ?? '' });
      setTasks(prev => [...prev, task]);
      return task;
    } catch (e) { setError((e as Error)?.message ?? 'Could not add item.'); return undefined; }
  }

  async function patchTask(id: string, patch: Partial<PlannerTask>) {
    // Completing a recurring to-do rolls it forward to the next occurrence
    // (and resets its checklist) instead of finishing it.
    const task = tasks.find(t => t.id === id);
    let effective = patch;
    if (patch.done === true && task?.recurrence && task.due_date) {
      effective = {
        done: false,
        due_date: nextDueDate(task.due_date, task.recurrence),
        checklist: (task.checklist ?? []).map(i => ({ ...i, done: false })),
      };
    }
    // Completing a to-do with a running timer banks the in-progress time first.
    if (patch.done === true && task?.timer_started_at) {
      effective = { ...effective, actual_minutes: (task.actual_minutes ?? 0) + elapsedMinutes(task.timer_started_at), timer_started_at: null };
    }
    // Only one timer runs at a time: starting one stops + banks every other.
    const startingTimer = !!patch.timer_started_at;
    const others = startingTimer ? tasks.filter(t => t.id !== id && t.timer_started_at) : [];
    setTasks(prev => prev.map(t => {
      if (t.id === id) return { ...t, ...effective };
      if (startingTimer && t.timer_started_at) {
        return { ...t, actual_minutes: (t.actual_minutes ?? 0) + elapsedMinutes(t.timer_started_at), timer_started_at: null };
      }
      return t;
    }));
    try {
      await updateTask(id, effective);
      await Promise.all(others.map(t =>
        updateTask(t.id, { actual_minutes: (t.actual_minutes ?? 0) + elapsedMinutes(t.timer_started_at!), timer_started_at: null })));
    }
    catch (e) { setError((e as Error)?.message ?? 'Could not update item.'); }
  }

  async function removeTask(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id));
    try { await deleteTask(id); }
    catch (e) { setError((e as Error)?.message ?? 'Could not delete item.'); }
  }

  async function reorder(updates: { id: string; sort_order: number }[]) {
    setTasks(prev => {
      const byId = new Map(updates.map(u => [u.id, u.sort_order]));
      return prev.map(t => (byId.has(t.id) ? { ...t, sort_order: byId.get(t.id)! } : t));
    });
    try { await reorderTasks(updates); }
    catch (e) { setError((e as Error)?.message ?? 'Could not save the new order.'); }
  }

  // ---- calendar time-blocking (shared by the Calendar tab and the lists) ----

  async function timeBlock(task: PlannerTask, time: string) {
    const dateISO = task.due_date ?? today;
    const start = new Date(`${dateISO}T${time}:00`);
    const minutes = task.estimate_minutes ?? 30;
    const end = new Date(start.getTime() + minutes * 60_000);
    try {
      const ev = await gc.createEvent({
        summary: task.title, start: start.toISOString(), end: end.toISOString(), reminderMinutes: 10,
      });
      await patchTask(task.id, { start_at: start.toISOString(), gcal_event_id: ev.id, due_date: dateISO, someday: false });
      setCalVersion(v => v + 1);
    } catch (e) { gc.setError((e as Error).message); }
  }

  async function unblock(task: PlannerTask) {
    try { if (task.gcal_event_id) await gc.deleteEvent(task.gcal_event_id); }
    catch (e) { gc.setError((e as Error).message); }
    await patchTask(task.id, { start_at: null, gcal_event_id: null });
    setCalVersion(v => v + 1);
  }

  const cal: CalendarBridge = { gc, calVersion, onTimeBlock: timeBlock, onUnblock: unblock };

  // ---- My Day: time blocks, day notes, capacity ----

  async function createBlock(day: string) {
    if (!user) return;
    const sort = blocks.filter(b => b.day === day).length;
    try {
      const block = await createTimeBlock(user.id, { day, sort_order: sort });
      setBlocks(prev => [...prev, block]);
    } catch (e) { setError((e as Error)?.message ?? 'Could not add a time block.'); }
  }

  async function patchBlock(id: string, patch: Partial<PlannerTimeBlock>) {
    setBlocks(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)));
    try { await updateTimeBlock(id, patch); }
    catch (e) { setError((e as Error)?.message ?? 'Could not update the block.'); }
  }

  async function removeBlock(id: string) {
    // Free the block's to-dos back into the day (mirrors the DB's SET NULL).
    setBlocks(prev => prev.filter(b => b.id !== id));
    setTasks(prev => prev.map(t => (t.block_id === id ? { ...t, block_id: null } : t)));
    try {
      const block = blocks.find(b => b.id === id);
      if (block?.gcal_event_id) { try { await gc.deleteEvent(block.gcal_event_id); } catch { /* event may be gone */ } }
      await deleteTimeBlock(id);
    } catch (e) { setError((e as Error)?.message ?? 'Could not delete the block.'); }
  }

  // Push a timed block out to Google Calendar as a single event spanning its
  // range, with the block's to-dos listed in the description.
  async function syncBlock(block: PlannerTimeBlock, tasksInBlock: PlannerTask[]) {
    if (block.start_minute == null || block.end_minute == null) return;
    const start = new Date(`${block.day}T00:00:00`); start.setMinutes(block.start_minute);
    const end = new Date(`${block.day}T00:00:00`); end.setMinutes(block.end_minute);
    const summary = block.title.trim() || 'Time block';
    try {
      const ev = await gc.createEvent({ summary, start: start.toISOString(), end: end.toISOString(), reminderMinutes: 10 });
      await patchBlock(block.id, { gcal_event_id: ev.id });
      void tasksInBlock; // (description sync is a roadmap follow-up)
      setCalVersion(v => v + 1);
    } catch (e) { gc.setError((e as Error).message); }
  }

  async function unsyncBlock(block: PlannerTimeBlock) {
    try { if (block.gcal_event_id) await gc.deleteEvent(block.gcal_event_id); }
    catch (e) { gc.setError((e as Error).message); }
    await patchBlock(block.id, { gcal_event_id: null });
    setCalVersion(v => v + 1);
  }

  async function saveDayNote(day: string, body: string) {
    if (!user) return;
    setDayNotes(prev => ({ ...prev, [day]: body }));
    try { await apiSaveDayNote(user.id, day, body); }
    catch (e) { setError((e as Error)?.message ?? 'Could not save the day note.'); }
  }

  async function updateCapacity(minutes: number) {
    if (!user) return;
    setSettings(prev => (prev ? { ...prev, daily_capacity_minutes: minutes } : prev));
    try { const s = await updateSettings(user.id, { daily_capacity_minutes: minutes }); setSettings(s); }
    catch (e) { setError((e as Error)?.message ?? 'Could not save your daily target.'); }
  }

  async function updateCarryOver(on: boolean) {
    if (!user) return;
    setSettings(prev => (prev ? { ...prev, carry_over_capacity: on } : prev));
    try { const s = await updateSettings(user.id, { carry_over_capacity: on }); setSettings(s); }
    catch (e) { setError((e as Error)?.message ?? 'Could not save your capacity setting.'); }
  }

  const myDayHandlers: MyDayHandlers = {
    onAddTask: addTask,
    onPatchTask: patchTask,
    onDeleteTask: removeTask,
    onCreateBlock: createBlock,
    onUpdateBlock: patchBlock,
    onDeleteBlock: removeBlock,
    onSyncBlock: syncBlock,
    onUnsyncBlock: unsyncBlock,
    onSaveDayNote: saveDayNote,
    onUpdateCapacity: updateCapacity,
    onToggleCarryOver: updateCarryOver,
  };

  // Pick a view and dismiss the mobile rail in one go.
  function choose(sel: Selection) { setSelection(sel); setRailOpen(false); }
  // Open a specific day in My Day (from the Plan grid).
  function openDay(iso: string) { setDayJump(d => ({ iso, n: d.n + 1 })); choose({ kind: 'myday' }); }

  const selectedNote = selection.kind === 'note' ? notesById[selection.id] : undefined;

  return (
    <div className="flex h-full min-h-0 relative">
      {/* Backdrop behind the mobile slide-over rail */}
      {railOpen && <div className="md:hidden fixed inset-0 bg-black/30 z-40" onClick={() => setRailOpen(false)} />}

      {/* Left rail: smart views + lists. Static from md up; a slide-over on
          mobile so the day/list has full width for adding to-dos. */}
      <aside
        className={`w-64 shrink-0 border-r border-slate-200 bg-slate-50/60 flex-col overflow-y-auto nice-scrollbar
          md:static md:flex
          ${railOpen ? 'fixed inset-y-0 left-0 z-50 flex shadow-2xl' : 'hidden md:flex'}`}
      >
        <div className="md:hidden flex justify-end p-2">
          <button onClick={() => setRailOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200" title="Close menu">
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="p-3 space-y-1">
          <button
            onClick={() => choose({ kind: 'myday' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              selection.kind === 'myday' ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-600 hover:bg-white/70'
            }`}
          >
            <Sun className="w-4 h-4 text-amber-500" />
            <span className="flex-1 text-left">My Day</span>
            {viewCounts.today > 0 && <span className="text-xs text-slate-400 font-medium">{viewCounts.today}</span>}
          </button>
          <button
            onClick={() => choose({ kind: 'plan' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              selection.kind === 'plan' ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-600 hover:bg-white/70'
            }`}
          >
            <CalendarRange className="w-4 h-4 text-sky-500" />
            <span className="flex-1 text-left">Plan</span>
          </button>
          {VIEWS.map(v => {
            const Icon = v.icon;
            const active = selection.kind === 'view' && selection.bucket === v.bucket;
            const count = viewCounts[v.bucket];
            return (
              <button
                key={v.bucket}
                onClick={() => choose({ kind: 'view', bucket: v.bucket })}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                <Icon className={`w-4 h-4 ${v.color}`} />
                <span className="flex-1 text-left">{v.label}</span>
                {count > 0 && <span className="text-xs text-slate-400 font-medium">{count}</span>}
              </button>
            );
          })}
          <button
            onClick={() => choose({ kind: 'stats' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              selection.kind === 'stats' ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-600 hover:bg-white/70'
            }`}
          >
            <BarChart3 className="w-4 h-4 text-indigo-500" />
            <span className="flex-1 text-left">Stats</span>
          </button>
          <button
            onClick={() => choose({ kind: 'logbook' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              selection.kind === 'logbook' ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-600 hover:bg-white/70'
            }`}
          >
            <BookCheck className="w-4 h-4 text-emerald-500" />
            <span className="flex-1 text-left">Logbook</span>
          </button>
        </nav>

        <div className="px-4 pt-3 pb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Lists</span>
          <button onClick={handleNewNote} className="text-slate-400 hover:text-teal-600" title="New list">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <nav className="px-3 pb-4 space-y-1">
          {notes.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-400">No lists yet. Hit + to start one.</p>
          )}
          {notes.map(n => {
            const active = selection.kind === 'note' && selection.id === n.id;
            const open = openCountByNote[n.id] ?? 0;
            return (
              <button
                key={n.id}
                onClick={() => choose({ kind: 'note', id: n.id })}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                {n.pinned ? <Pin className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <NotebookPen className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                <span className="flex-1 text-left truncate">{n.title.trim() || 'Untitled list'}</span>
                {open > 0 && <span className="text-xs text-slate-400">{open}</span>}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Detail */}
      <section className="flex-1 min-w-0 overflow-y-auto nice-scrollbar">
        {/* Mobile-only bar to reopen the planner rail */}
        <div className="md:hidden sticky top-0 z-10 flex items-center gap-2 bg-white/85 backdrop-blur border-b border-slate-100 px-3 py-2">
          <button onClick={() => setRailOpen(true)} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-teal-600">
            <Menu className="w-5 h-5" /> Menu
          </button>
        </div>
        {error && (
          <div className="m-4 flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}
        {loading ? (
          <div className="p-8 text-slate-400">Loading your planner…</div>
        ) : selection.kind === 'myday' ? (
          <MyDayView
            tasks={tasks}
            blocks={blocks}
            dayNotes={dayNotes}
            settings={settings ?? { user_id: user?.id ?? '', daily_capacity_minutes: DEFAULT_DAILY_CAPACITY, carry_over_capacity: false, created_at: '', updated_at: '' }}
            today={today}
            cal={{ gc, calVersion }}
            handlers={myDayHandlers}
            jumpTo={dayJump}
          />
        ) : selection.kind === 'plan' ? (
          <PlanView
            tasks={tasks}
            blocks={blocks}
            settings={settings ?? { user_id: user?.id ?? '', daily_capacity_minutes: DEFAULT_DAILY_CAPACITY, carry_over_capacity: false, created_at: '', updated_at: '' }}
            today={today}
            onOpenDay={openDay}
          />
        ) : selection.kind === 'stats' ? (
          <StatsView tasks={tasks} notesById={notesById} today={today} />
        ) : selection.kind === 'logbook' ? (
          <LogbookView tasks={tasks} notesById={notesById} today={today} onPatch={patchTask} onDelete={removeTask} />
        ) : selection.kind === 'view' ? (
          <ViewPane
            bucket={selection.bucket}
            tasks={tasks}
            today={today}
            notesById={notesById}
            onAdd={addTask}
            onPatch={patchTask}
            onDelete={removeTask}
            onOpenNote={id => setSelection({ kind: 'note', id })}
            cal={cal}
          />
        ) : selectedNote ? (
          <NotePane
            key={selectedNote.id}
            note={selectedNote}
            tasks={tasks.filter(t => t.note_id === selectedNote.id)}
            today={today}
            onSaveNote={saveNote}
            onDeleteNote={removeNote}
            onAdd={addTask}
            onCreate={createTaskReturning}
            onPatch={patchTask}
            onDelete={removeTask}
            onReorder={reorder}
          />
        ) : (
          <div className="p-8 text-slate-400">Select a note or view.</div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Smart views
// ---------------------------------------------------------------------------

function ViewPane({
  bucket, tasks, today, notesById, onAdd, onPatch, onDelete, onOpenNote, cal,
}: {
  bucket: Bucket;
  tasks: PlannerTask[];
  today: string;
  notesById: Record<string, PlannerNote>;
  onAdd: (i: { title: string; due_date?: string | null; someday?: boolean }) => void;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  onOpenNote: (id: string) => void;
  cal: CalendarBridge;
}) {
  const meta = VIEWS.find(v => v.bucket === bucket)!;
  const Icon = meta.icon;
  const [draft, setDraft] = useState('');
  const { gc, calVersion, onTimeBlock, onUnblock } = cal;
  const [eventsByDay, setEventsByDay] = useState<Record<string, GCalEvent[]>>({});

  const items = tasks
    .filter(t => t.kind === 'task' && !t.done && bucketForTask(t, today) === bucket)
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));

  // Pull Google events for the day (Today) or the day range (Upcoming) so they
  // can sit alongside the to-dos. Other buckets have no dates, so no events.
  const dueDates = items.map(t => t.due_date!).filter(Boolean);
  const rangeMin = bucket === 'today' ? today : dueDates[0];
  const rangeMax = bucket === 'today' ? today : dueDates[dueDates.length - 1];
  const wantsEvents = gc.connected && (bucket === 'today' || (bucket === 'upcoming' && dueDates.length > 0));
  const rangeKey = wantsEvents ? `${rangeMin}_${rangeMax}` : '';

  useEffect(() => {
    if (!wantsEvents) { setEventsByDay({}); return; }
    let active = true;
    const start = new Date(rangeMin + 'T00:00:00');
    const end = new Date(rangeMax + 'T00:00:00'); end.setDate(end.getDate() + 1);
    gc.fetchEvents(start.toISOString(), end.toISOString()).then(evs => {
      if (!active) return;
      const byDay: Record<string, GCalEvent[]> = {};
      for (const ev of evs) {
        const iso = eventDayISO(ev);
        if (iso) (byDay[iso] ??= []).push(ev);
      }
      setEventsByDay(byDay);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, gc.connected, gc.calendarId, gc.fetchEvents, calVersion, wantsEvents]);

  const addDefaults =
    bucket === 'today' ? { due_date: today } :
    bucket === 'someday' ? { someday: true } :
    {};

  function noteNameFor(t: PlannerTask) {
    return t.note_id ? (notesById[t.note_id]?.title.trim() || 'Untitled list') : undefined;
  }

  function renderRow(t: PlannerTask) {
    return (
      <TaskRow key={t.id} task={t} today={today} noteName={noteNameFor(t)}
        onOpenNote={t.note_id ? () => onOpenNote(t.note_id!) : undefined}
        onPatch={onPatch} onDelete={onDelete} showSchedule
        calConnected={gc.connected}
        onTimeBlock={time => onTimeBlock(t, time)}
        onUnblock={() => onUnblock(t)} />
    );
  }

  const totalMinutes = sumEstimate(items);

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Icon className={`w-6 h-6 ${meta.color}`} />
        <h2 className="text-2xl font-bold text-slate-800">{meta.label}</h2>
        {(bucket === 'today' || bucket === 'anytime') && totalMinutes > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-slate-500">
            <Clock className="w-4 h-4" /> {formatMinutes(totalMinutes)} planned
          </span>
        )}
      </div>

      <QuickAdd
        value={draft}
        onChange={setDraft}
        placeholder={`Add to ${meta.label}…`}
        onSubmit={() => { onAdd({ title: draft, ...addDefaults }); setDraft(''); }}
      />

      {bucket === 'today' && <DayEventsStrip events={eventsByDay[today]} />}

      {items.length === 0 ? (
        <p className="text-sm text-slate-400 mt-4">Nothing here right now.</p>
      ) : bucket === 'upcoming' ? (
        // Group by day, like the Things "Upcoming" list.
        <div className="mt-4 space-y-5">
          {groupByDay(items).map(group => (
            <div key={group.date}>
              <DayHeader date={group.date} today={today} totalMinutes={sumEstimate(group.items)} />
              <DayEventsStrip events={eventsByDay[group.date]} />
              <ul className="divide-y divide-slate-100">
                {group.items.map(renderRow)}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {items.map(renderRow)}
        </ul>
      )}
    </div>
  );
}

// The local YYYY-MM-DD a Google event falls on (timed events use their start
// instant; all-day events already carry a plain date).
function eventDayISO(ev: GCalEvent): string | undefined {
  if (ev.start?.date) return ev.start.date;
  if (ev.start?.dateTime) {
    const d = new Date(ev.start.dateTime);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  }
  return undefined;
}

function eventTimeLabel(ev: GCalEvent): string {
  if (ev.start?.date) return 'All day';
  if (!ev.start?.dateTime) return '';
  return new Date(ev.start.dateTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// A subtle sky-tinted strip of the day's calendar events, shown above the
// to-dos so you have context while planning the day.
function DayEventsStrip({ events }: { events?: GCalEvent[] }) {
  if (!events || events.length === 0) return null;
  return (
    <div className="mt-3 mb-1 rounded-lg bg-sky-50/70 border border-sky-100 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-500 mb-1 flex items-center gap-1">
        <CalendarDays className="w-3 h-3" /> On your calendar
      </p>
      <ul className="space-y-0.5">
        {events.map(ev => (
          <li key={ev.id} className="flex items-center gap-2 text-sm">
            <span className="text-xs font-medium text-sky-600 w-16 shrink-0">{eventTimeLabel(ev)}</span>
            <span className="flex-1 text-slate-600 truncate">{ev.summary || '(no title)'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function groupByDay(items: PlannerTask[]): { date: string; items: PlannerTask[] }[] {
  const map = new Map<string, PlannerTask[]>();
  for (const t of items) {
    const key = t.due_date ?? '';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, items]) => ({ date, items }));
}

function DayHeader({ date, today, totalMinutes }: { date: string; today: string; totalMinutes: number }) {
  const d = new Date(date + 'T00:00:00');
  const weekday = d.toLocaleDateString(undefined, { weekday: 'long' });
  const monthDay = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const diff = Math.round((d.getTime() - new Date(today + 'T00:00:00').getTime()) / 86_400_000);
  const rel = diff === 1 ? 'Tomorrow' : weekday;
  return (
    <div className="flex items-baseline gap-2 mb-1">
      <span className="text-xl font-bold text-slate-700">{d.getDate()}</span>
      <span className="text-sm font-medium text-slate-500">{rel}</span>
      <span className="text-xs text-slate-400">· {monthDay}</span>
      {totalMinutes > 0 && (
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-slate-400">
          <Clock className="w-3.5 h-3.5" /> {formatMinutes(totalMinutes)}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Note editor (headings + drag-to-reorder + checklists)
// ---------------------------------------------------------------------------

function NotePane({
  note, tasks, today, onSaveNote, onDeleteNote, onAdd, onCreate, onPatch, onDelete, onReorder,
}: {
  note: PlannerNote;
  tasks: PlannerTask[];
  today: string;
  onSaveNote: (id: string, patch: Partial<PlannerNote>) => void;
  onDeleteNote: (id: string) => void;
  onAdd: (i: { title: string; note_id: string; kind?: 'task' | 'heading'; sort_order?: number }) => void;
  onCreate: (i: { title?: string; note_id: string; kind?: 'task' | 'heading' }) => Promise<PlannerTask | undefined>;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  onReorder: (updates: { id: string; sort_order: number }[]) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<'all' | 'important'>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // The to-do id that should open for editing next render (keyboard entry).
  const [focusId, setFocusId] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!note.title) titleRef.current?.focus(); }, [note.id, note.title]);

  const ordered = [...tasks].sort((a, b) =>
    (a.sort_order - b.sort_order) || a.created_at.localeCompare(b.created_at));
  // The full main list (headings + open tasks) ignoring collapse — the basis
  // for drag reordering so hidden rows keep their place. Completed to-dos drop
  // to a "Done" section so they don't clutter what's left.
  const mainAll = ordered.filter(t => t.kind === 'heading' || !t.done);
  const doneItems = ordered.filter(t => t.kind === 'task' && t.done);
  const flaggedOpen = ordered.filter(t => t.kind === 'task' && !t.done && t.flagged);
  const nextOrder = (ordered.at(-1)?.sort_order ?? 0) + 1;

  // Walk the list tracking the current heading so we can hide a heading's
  // tasks when it's collapsed and show a "n hidden" count on the heading.
  const hidden = new Set<string>();
  const childCount: Record<string, number> = {};
  {
    let head: string | null = null;
    for (const t of mainAll) {
      if (t.kind === 'heading') { head = t.id; childCount[head] = 0; }
      else if (head) { childCount[head]++; if (collapsed.has(head)) hidden.add(t.id); }
    }
  }
  const visibleMain = mainAll.filter(t => !hidden.has(t.id));

  function toggleCollapse(id: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    // Reorder within the *full* list so collapsed rows keep their positions.
    const ids = mainAll.map(t => t.id);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(mainAll, oldIdx, newIdx);
    onReorder(reordered.map((t, i) => ({ id: t.id, sort_order: i })));
  }

  // Create an empty to-do positioned right after `refId` in the list, then
  // focus it — the heart of the keyboard flow (Enter on a heading/task).
  async function createAfter(refId: string) {
    const created = await onCreate({ note_id: note.id, kind: 'task' });
    if (!created) return;
    // If we're adding under a collapsed heading, expand it so the new (focused)
    // row is actually visible.
    setCollapsed(prev => { if (!prev.has(refId)) return prev; const n = new Set(prev); n.delete(refId); return n; });
    const idx = mainAll.findIndex(t => t.id === refId);
    const insertAt = idx < 0 ? mainAll.length : idx + 1;
    const next = [...mainAll.slice(0, insertAt), created, ...mainAll.slice(insertAt)];
    onReorder(next.map((t, i) => ({ id: t.id, sort_order: i })));
    setFocusId(created.id);
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-start gap-3 mb-2">
        <input
          ref={titleRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (title !== note.title) onSaveNote(note.id, { title }); }}
          placeholder="Untitled list"
          className="flex-1 text-2xl font-bold text-slate-800 bg-transparent outline-none placeholder:text-slate-300"
        />
        <div className="flex items-center gap-1 pt-2">
          <button
            onClick={() => onSaveNote(note.id, { pinned: !note.pinned })}
            className={`p-2 rounded-lg hover:bg-slate-100 ${note.pinned ? 'text-amber-500' : 'text-slate-400'}`}
            title={note.pinned ? 'Unpin' : 'Pin to top'}
          >
            {note.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </button>
          <button onClick={() => onSaveNote(note.id, { archived: true })} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100" title="Archive">
            <Archive className="w-4 h-4" />
          </button>
          <button onClick={() => onDeleteNote(note.id)} className="p-2 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500" title="Delete list">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        onBlur={() => { if (body !== note.body) onSaveNote(note.id, { body }); }}
        placeholder="Notes, links, anything you want to remember…"
        rows={2}
        className="w-full text-sm text-slate-600 bg-transparent outline-none resize-y placeholder:text-slate-400 mb-4"
      />

      {/* All / Important filter (Things-3-style) */}
      <div className="flex items-center gap-1 mb-2">
        {(['all', 'important'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
              filter === f ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {f === 'important' && <Star className="w-3 h-3" fill={filter === f ? 'currentColor' : 'none'} />}
            {f === 'all' ? 'All' : 'Important'}
            {f === 'important' && flaggedOpen.length > 0 && <span className={filter === f ? 'text-amber-300' : 'text-amber-500'}>{flaggedOpen.length}</span>}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-1">
        <div className="flex-1">
          <QuickAdd
            value={draft}
            onChange={setDraft}
            placeholder="Add a to-do…"
            onSubmit={() => { onAdd({ title: draft, note_id: note.id, sort_order: nextOrder }); setDraft(''); }}
          />
        </div>
        <button
          onClick={() => onAdd({ title: 'New section', note_id: note.id, kind: 'heading', sort_order: nextOrder })}
          className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-teal-600 border border-slate-200 rounded-lg px-2.5 py-2"
          title="Add a section heading"
        >
          <HeadingIcon className="w-3.5 h-3.5" /> Heading
        </button>
      </div>

      {filter === 'important' ? (
        flaggedOpen.length === 0 ? (
          <p className="text-sm text-slate-400 mt-3">Nothing flagged. Star a to-do to mark it Important.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {flaggedOpen.map(t => (
              <TaskRow
                key={t.id}
                task={t}
                today={today}
                enableChecklist
                showSchedule
                focusId={focusId}
                onFocused={() => setFocusId(null)}
                onEnter={() => createAfter(t.id)}
                onPatch={onPatch}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleMain.map(t => t.id)} strategy={verticalListSortingStrategy}>
            <ul className="mt-2">
              {visibleMain.map(t => (
                <SortableNoteItem
                  key={t.id}
                  task={t}
                  today={today}
                  collapsed={collapsed.has(t.id)}
                  childCount={childCount[t.id] ?? 0}
                  focusId={focusId}
                  onFocused={() => setFocusId(null)}
                  onToggleCollapse={() => toggleCollapse(t.id)}
                  onAddUnder={() => createAfter(t.id)}
                  onEnter={() => createAfter(t.id)}
                  onPatch={onPatch}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {filter === 'all' && mainAll.length === 0 && (
        <p className="text-sm text-slate-400 mt-2">Add a to-do or a section heading to start planning this out.</p>
      )}

      {doneItems.length > 0 && (
        <div className="mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Done</p>
          <ul className="divide-y divide-slate-100">
            {doneItems.map(t => (
              <TaskRow key={t.id} task={t} today={today} onPatch={onPatch} onDelete={onDelete} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function useSortableStyle(id: string) {
  const sortable = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
  };
  return { ...sortable, style };
}

function SortableNoteItem({
  task, today, collapsed, childCount, focusId, onFocused, onToggleCollapse, onAddUnder, onEnter, onPatch, onDelete,
}: {
  task: PlannerTask;
  today: string;
  collapsed: boolean;
  childCount: number;
  focusId: string | null;
  onFocused: () => void;
  onToggleCollapse: () => void;
  onAddUnder: () => void;
  onEnter: () => void;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, style } = useSortableStyle(task.id);
  const handle = (
    <button
      {...attributes}
      {...listeners}
      className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity shrink-0 touch-none"
      title="Drag to reorder"
    >
      <GripVertical className="w-4 h-4" />
    </button>
  );

  if (task.kind === 'heading') {
    return (
      <li ref={setNodeRef} style={style}>
        <HeadingRow
          task={task}
          dragHandle={handle}
          collapsed={collapsed}
          childCount={childCount}
          onToggleCollapse={onToggleCollapse}
          onAddUnder={onAddUnder}
          onPatch={onPatch}
          onDelete={onDelete}
        />
      </li>
    );
  }
  return (
    <li ref={setNodeRef} style={style} className="border-b border-slate-100">
      <TaskRow
        task={task}
        today={today}
        dragHandle={handle}
        enableChecklist
        showSchedule
        focusId={focusId}
        onFocused={onFocused}
        onEnter={onEnter}
        onPatch={onPatch}
        onDelete={onDelete}
      />
    </li>
  );
}

function HeadingRow({
  task, dragHandle, collapsed, childCount, onToggleCollapse, onAddUnder, onPatch, onDelete,
}: {
  task: PlannerTask;
  dragHandle?: ReactNode;
  collapsed: boolean;
  childCount: number;
  onToggleCollapse: () => void;
  onAddUnder: () => void;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (task.title === 'New section') ref.current?.select(); }, [task.title]);

  function commit() {
    if (title.trim() && title !== task.title) onPatch(task.id, { title: title.trim() });
  }

  return (
    <div className="flex items-center gap-2 pt-5 pb-1 group">
      {dragHandle}
      <button
        onClick={onToggleCollapse}
        className="text-slate-400 hover:text-slate-600 shrink-0"
        title={collapsed ? 'Expand section' : 'Collapse section'}
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      <input
        ref={ref}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onBlur={commit}
        // Enter commits the heading and drops a fresh to-do underneath it.
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); onAddUnder(); } }}
        className="flex-1 text-sm font-bold uppercase tracking-wide text-slate-600 bg-transparent outline-none border-b border-transparent focus:border-teal-400"
      />
      {collapsed && childCount > 0 && (
        <span className="text-xs text-slate-400 shrink-0">{childCount}</span>
      )}
      <button
        onClick={onAddUnder}
        className="text-slate-300 hover:text-teal-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        title="Add a to-do under this heading"
      >
        <Plus className="w-4 h-4" />
      </button>
      <button
        onClick={() => onDelete(task.id)}
        className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        title="Delete heading"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TaskRow({
  task, today, noteName, onOpenNote, onPatch, onDelete, showSchedule = false,
  enableChecklist = false, dragHandle, calConnected = false, onTimeBlock, onUnblock,
  focusId, onFocused, onEnter,
}: {
  task: PlannerTask;
  today: string;
  noteName?: string;
  onOpenNote?: () => void;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  showSchedule?: boolean;
  enableChecklist?: boolean;
  dragHandle?: ReactNode;
  calConnected?: boolean;
  onTimeBlock?: (time: string) => void;
  onUnblock?: () => void;
  focusId?: string | null;
  onFocused?: () => void;
  onEnter?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [expanded, setExpanded] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [blockTime, setBlockTime] = useState('09:00');
  const hasNotes = !!task.notes?.trim();
  const overdue = !task.done && !!task.due_date && task.due_date < today;
  const progress = checklistProgress(task);
  const hasChecklist = progress.total > 0;

  // Open for editing when the keyboard flow points focus at this row.
  useEffect(() => {
    if (focusId && focusId === task.id) { setEditing(true); onFocused?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, task.id]);

  // Commit on blur; a row left blank (a new one never typed into) is removed.
  function blurCommit() {
    setEditing(false);
    const next = title.trim();
    if (!next) { if (!task.title) onDelete(task.id); else setTitle(task.title); return; }
    if (next !== task.title) onPatch(task.id, { title: next });
  }

  // Enter commits, then (via onEnter) spawns the next sibling to-do and focuses
  // it. Pressing Enter on a still-blank row just ends entry instead.
  function enterCommit() {
    const next = title.trim();
    if (!next) { setEditing(false); if (!task.title) onDelete(task.id); return; }
    if (next !== task.title) onPatch(task.id, { title: next });
    setEditing(false);
    onEnter?.();
  }

  function setChecklist(items: ChecklistItem[]) {
    onPatch(task.id, { checklist: items });
  }

  return (
    <div className="py-2 group">
      <div className="flex items-center gap-2">
        {dragHandle}
        <button
          onClick={() => onPatch(task.id, { done: !task.done })}
          className={`shrink-0 transition-colors ${task.done ? 'text-teal-600' : 'text-slate-300 hover:text-teal-600'}`}
          title={task.done ? 'Mark not done' : 'Mark done'}
        >
          {task.done
            ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-teal-600 text-white"><Check className="w-3.5 h-3.5" /></span>
            : <Circle className="w-5 h-5" />}
        </button>

        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={blurCommit}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); enterCommit(); } if (e.key === 'Escape') { setTitle(task.title); setEditing(false); } }}
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

        {/* Checklist toggle / progress */}
        {enableChecklist && !task.done && (
          <button
            onClick={() => setExpanded(v => !v)}
            className={`flex items-center gap-1 text-xs shrink-0 ${hasChecklist ? 'text-slate-500' : 'text-slate-300 hover:text-slate-500'}`}
            title="Checklist"
          >
            {hasChecklist
              ? <span className="font-medium tabular-nums">{progress.done}/{progress.total}</span>
              : <Check className="w-3.5 h-3.5" />}
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        )}

        {noteName && (
          <button onClick={onOpenNote} className="text-xs text-slate-400 hover:text-teal-600 truncate max-w-[10rem] shrink-0">
            {noteName}
          </button>
        )}

        {showSchedule && !task.done && (
          <div className="flex items-center gap-1.5 shrink-0">
            <TimerButton task={task} onPatch={onPatch} />
            <button
              onClick={() => onPatch(task.id, { flagged: !task.flagged })}
              className={`${task.flagged ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400 opacity-0 group-hover:opacity-100'} transition-opacity`}
              title={task.flagged ? 'Unflag' : 'Flag as Important'}
            >
              <Star className="w-4 h-4" fill={task.flagged ? 'currentColor' : 'none'} />
            </button>
            {task.estimate_minutes ? (
              <span className="text-xs font-medium text-slate-400">{formatMinutes(task.estimate_minutes)}</span>
            ) : null}
            {task.due_date && (
              <span className={`text-xs font-medium ${overdue ? 'text-rose-500' : 'text-slate-500'}`}>
                {formatDue(task.due_date, today)}
              </span>
            )}
            <label className="relative cursor-pointer text-slate-300 hover:text-teal-600" title="Schedule a day">
              <CalendarClock className="w-4 h-4" />
              <input
                type="date"
                value={task.due_date ?? ''}
                onChange={e => onPatch(task.id, { due_date: e.target.value || null, someday: false })}
                className="absolute inset-0 opacity-0 cursor-pointer w-4"
              />
            </label>

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

            <MiniMenu title="Repeat" icon={<Repeat className={`w-4 h-4 ${task.recurrence ? 'text-teal-600' : 'text-slate-300 hover:text-teal-600'}`} />}>
              {close => (
                <div className="py-1">
                  {(['daily', 'weekdays', 'weekly', 'monthly'] as Recurrence[]).map(r => (
                    <button key={r} onClick={() => { onPatch(task.id, { recurrence: r, ...(task.due_date ? {} : { due_date: today, someday: false }) }); close(); }}
                      className={`block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-slate-100 ${task.recurrence === r ? 'text-teal-600 font-medium' : 'text-slate-700'}`}>
                      {RECURRENCE_LABELS[r]}
                    </button>
                  ))}
                  <button onClick={() => { onPatch(task.id, { recurrence: null }); close(); }}
                    className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-slate-100 text-slate-400">Don’t repeat</button>
                </div>
              )}
            </MiniMenu>

            {/* Time block: drop this to-do onto the calendar (or pull it off). */}
            {onTimeBlock && task.gcal_event_id ? (
              <button
                onClick={onUnblock}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-sky-600 hover:text-rose-500"
                title="Remove time block from calendar"
              >
                {task.start_at && new Date(task.start_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                <Link2Off className="w-3.5 h-3.5" />
              </button>
            ) : onTimeBlock && calConnected ? (
              <MiniMenu title="Add to calendar as a time block" icon={<CalendarPlus className="w-4 h-4 text-slate-300 hover:text-sky-600" />}>
                {close => (
                  <div className="p-2 flex items-center gap-2">
                    <input type="time" value={blockTime} onChange={e => setBlockTime(e.target.value)}
                      className="text-sm border border-slate-200 rounded px-2 py-1" />
                    <button onClick={() => { onTimeBlock(blockTime); close(); }}
                      className="text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded px-2 py-1">Block</button>
                  </div>
                )}
              </MiniMenu>
            ) : null}

            <button
              onClick={() => onPatch(task.id, { someday: !task.someday, due_date: null, ...(!task.someday ? { recurrence: null } : {}) })}
              className={`${task.someday ? 'text-indigo-500' : 'text-slate-300 hover:text-indigo-500'}`}
              title={task.someday ? 'In Someday — click to move to Anytime' : 'Move to Someday'}
            >
              <Moon className="w-4 h-4" />
            </button>
          </div>
        )}

        <button
          onClick={() => setNotesOpen(v => !v)}
          className={`shrink-0 transition-opacity ${hasNotes || notesOpen ? 'opacity-100 text-teal-600' : 'opacity-0 group-hover:opacity-100 text-slate-300 hover:text-teal-600'}`}
          title={hasNotes ? 'Notes' : 'Add notes'}
        >
          <FileText className="w-4 h-4" />
        </button>

        <button
          onClick={() => onDelete(task.id)}
          className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Notes body: open editor, or a one-line preview that opens it. */}
      {notesOpen ? (
        <div className="ml-7 mt-1.5">
          <TaskNotes task={task} onPatch={onPatch} autoFocus />
        </div>
      ) : hasNotes ? (
        <button
          onClick={() => setNotesOpen(true)}
          className="ml-7 mt-0.5 block text-left text-xs text-slate-400 hover:text-slate-600 truncate max-w-full"
        >
          {task.notes!.trim().split('\n')[0]}
        </button>
      ) : null}

      {/* Checklist body */}
      {enableChecklist && (expanded || hasChecklist) && !task.done && (
        <ChecklistEditor
          items={task.checklist ?? []}
          expanded={expanded}
          onToggleExpand={() => setExpanded(v => !v)}
          onChange={setChecklist}
        />
      )}
    </div>
  );
}

function ChecklistEditor({
  items, expanded, onToggleExpand, onChange,
}: {
  items: ChecklistItem[];
  expanded: boolean;
  onToggleExpand: () => void;
  onChange: (items: ChecklistItem[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function toggle(id: string) { onChange(items.map(i => (i.id === id ? { ...i, done: !i.done } : i))); }
  function rename(id: string, title: string) { onChange(items.map(i => (i.id === id ? { ...i, title } : i))); }
  function remove(id: string) { onChange(items.filter(i => i.id !== id)); }
  function add() {
    const title = draft.trim();
    if (!title) return;
    onChange([...items, newChecklistItem(title)]);
    setDraft('');
  }

  return (
    <div className="ml-7 mt-1 pl-3 border-l-2 border-slate-100 space-y-1">
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2 group/ci">
          <button
            onClick={() => toggle(item.id)}
            className={`shrink-0 ${item.done ? 'text-teal-600' : 'text-slate-300 hover:text-teal-600'}`}
          >
            {item.done
              ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-teal-600 text-white"><Check className="w-2.5 h-2.5" /></span>
              : <Circle className="w-4 h-4" />}
          </button>
          <input
            value={item.title}
            onChange={e => rename(item.id, e.target.value)}
            className={`flex-1 text-sm bg-transparent outline-none ${item.done ? 'text-slate-400 line-through' : 'text-slate-600'}`}
          />
          <button
            onClick={() => remove(item.id)}
            className="text-slate-300 hover:text-rose-500 opacity-0 group-hover/ci:opacity-100 transition-opacity shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      {expanded && (
        <div className="flex items-center gap-2">
          <Plus className="w-3.5 h-3.5 text-slate-300 shrink-0" />
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); }}
            placeholder="Add a sub-step…"
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-300 text-slate-600"
          />
        </div>
      )}
      {!expanded && items.length > 0 && (
        <button onClick={onToggleExpand} className="text-xs text-slate-400 hover:text-teal-600">+ add sub-step</button>
      )}
    </div>
  );
}

// A tiny click-to-open menu lives in ./MiniMenu (shared with My Day rows).

function QuickAdd({
  value, onChange, onSubmit, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <Plus className="w-4 h-4 text-slate-400 shrink-0" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSubmit(); }}
        placeholder={placeholder}
        className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400 text-slate-700"
      />
    </div>
  );
}
