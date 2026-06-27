import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RunningTimerBar, stopTimerPatch } from './TimerButton';
import { FocusPicker } from './FocusPicker';
import { TaskRow } from './TaskRow';
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
  NotebookPen, Plus, Trash2, Pin, PinOff, Archive, ArchiveRestore,
  CalendarClock, Layers, Inbox, X, GripVertical,
  Heading as HeadingIcon, ChevronRight, ChevronDown, Clock, CalendarDays, Link2Off, Sun, BarChart3,
  Star, Menu, CalendarRange, BookCheck, Settings as SettingsIcon, CornerDownLeft, ArrowDownAZ, Target, Orbit as OrbitIcon, Sparkles,
  CopyPlus, Check, Users as UsersIcon,
} from 'lucide-react';
import MyDayView, { type MyDayHandlers } from './MyDayView';
import { AiSuggestPanel } from './AiSuggestPanel';
import { suggestOrbitPicks, type AiResult } from './aiAssist';
import StatsView from './StatsView';
import LogbookView from './LogbookView';
import SettingsView from './SettingsView';
import PlanView from './PlanView';
import { useGoogleCalendar, type UseGoogleCalendar } from './useGoogleCalendar';
import type { GCalEvent } from './google';
import CatalogBookPicker from '../../components/CatalogBookPicker';
import {
  listNotes, createNote, updateNote, deleteNote, duplicateList,
  listTasks, createTask, updateTask, deleteTask, reorderTasks, newChecklistItem,
  getSettings, updateSettings, listDayNotes, saveDayNote as apiSaveDayNote,
  listTimeBlocks, createTimeBlock, updateTimeBlock, deleteTimeBlock,
  listTimeSessions, createTimeSessions, reorderNotes,
} from './api';
import { listPenNames, type PenName } from '../../lib/penNames';
import { penNameClasses } from '../../components/PenNameChip';
import {
  bucketForTask, formatMinutes, nextDueDate, sumEstimate, todayISO,
  elapsedMinutes, DEFAULT_DAILY_CAPACITY,
  type PlannerNote, type PlannerTask, type Bucket,
  type PlannerSettings, type PlannerDayNote, type PlannerTimeBlock, type PlannerTimeSession,
} from './types';

type Selection =
  | { kind: 'view'; bucket: Bucket }
  | { kind: 'note'; id: string }
  | { kind: 'myday' }
  | { kind: 'plan' }
  | { kind: 'inbox' }
  | { kind: 'orbit' }
  | { kind: 'stats' }
  | { kind: 'logbook' }
  | { kind: 'settings' };

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
];

export default function PlannerModule() {
  const { user, isAdmin } = useAuth();
  const [notes, setNotes] = useState<PlannerNote[]>([]);
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [blocks, setBlocks] = useState<PlannerTimeBlock[]>([]);
  const [sessions, setSessions] = useState<PlannerTimeSession[]>([]);
  const [dayNotes, setDayNotes] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<PlannerSettings | null>(null);
  const [penNames, setPenNames] = useState<PenName[]>([]);
  // Whole-planner pen-name focus: null = All (show everything, today's behavior).
  // Persisted only in component state, not the DB.
  const [penFilter, setPenFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'myday' });
  // The planner rail is a slide-over on mobile; always-on from md up.
  const [railOpen, setRailOpen] = useState(false);
  // The search-and-start focus picker (a modal).
  const [focusOpen, setFocusOpen] = useState(false);
  // A nudge to open a specific day in My Day (e.g. from the Plan view). The
  // bumping counter lets the same day be re-opened.
  const [dayJump, setDayJump] = useState<{ iso: string; n: number }>(() => ({ iso: todayISO(), n: 0 }));
  const today = todayISO();
  const gc = useGoogleCalendar(isAdmin);
  // Bumped whenever a time block is added/removed so the views re-fetch events.
  const [calVersion, setCalVersion] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([
      listNotes(user.id, true), listTasks(user.id), listTimeBlocks(user.id),
      listDayNotes(user.id), getSettings(user.id), listTimeSessions(user.id),
      listPenNames(user.id),
    ])
      .then(([n, t, b, dn, s, ts, pn]) => {
        if (!active) return;
        setNotes(n); setTasks(t); setBlocks(b); setSessions(ts);
        setDayNotes(Object.fromEntries((dn as PlannerDayNote[]).map(d => [d.day, d.body])));
        setSettings(s);
        setPenNames(pn);
      })
      .catch(e => { if (active) setError(e?.message ?? 'Could not load your planner.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

  // Auto roll-over: while the setting is on, pull unfinished, non-Someday to-dos
  // from past days forward to today — reactively, so flipping it on (or simply
  // opening the planner on a new day) takes effect right away rather than only
  // on a hard reload. After bumping there's nothing stale left, so it settles.
  useEffect(() => {
    if (!user || loading || !settings?.auto_rollover) return;
    const today = todayISO();
    const stale = tasks.filter(t => t.kind === 'task' && !t.done && !t.someday && !!t.due_date && t.due_date < today);
    if (!stale.length) return;
    const ids = new Set(stale.map(t => t.id));
    setTasks(prev => prev.map(t => (ids.has(t.id) ? { ...t, due_date: today } : t)));
    Promise.all(stale.map(t => updateTask(t.id, { due_date: today }))).catch(() => { /* best effort */ });
  }, [user, loading, settings?.auto_rollover, tasks]);

  const notesById = useMemo(() => Object.fromEntries(notes.map(n => [n.id, n])), [notes]);
  // The rail shows non-archived lists, pinned ones floated to the top. Archived
  // lists live in their own collapsible section so archive stays recoverable.
  const activeNotes = useMemo(
    () => notes.filter(n => !n.archived).sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (a.sort_order - b.sort_order)),
    [notes],
  );
  const archivedNotes = useMemo(
    () => notes.filter(n => n.archived).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')),
    [notes],
  );
  const penNamesById = useMemo(() => Object.fromEntries(penNames.map(p => [p.id, p])), [penNames]);
  // A focused pen name drops any list it no longer matches; All keeps everything.
  // The pinned-first / sort_order order from activeNotes is preserved.
  const railNotes = useMemo(
    () => (penFilter ? activeNotes.filter(n => n.pen_name_id === penFilter) : activeNotes),
    [activeNotes, penFilter],
  );
  // The active (non-archived) lists handed to views for "move to list" — scoped
  // to the focused pen name when a filter is on, else all active lists.
  const listsForViews = useMemo(
    () => (penFilter ? activeNotes.filter(n => n.pen_name_id === penFilter) : notes.filter(n => !n.archived)),
    [activeNotes, notes, penFilter],
  );
  // The task set the VISIBLE views render: when a pen name is focused, only
  // to-dos whose list carries that pen name (loose/Inbox to-dos have no list,
  // hence no pen name, so they're hidden under a focus — intended). Under All
  // (penFilter === null) this is exactly the full `tasks`, so nothing changes.
  const scopedTasks = useMemo(
    () => (penFilter ? tasks.filter(t => t.note_id != null && notesById[t.note_id]?.pen_name_id === penFilter) : tasks),
    [tasks, notesById, penFilter],
  );
  const [showArchived, setShowArchived] = useState(false);
  const openCountByNote = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of tasks) if (t.note_id && t.kind === 'task' && !t.done) m[t.note_id] = (m[t.note_id] ?? 0) + 1;
    return m;
  }, [tasks]);

  // Smart-view + Inbox + Orbit badge counts track the focused set, so the rail
  // badges match what each view actually shows under a pen-name filter. (Under
  // All, scopedTasks === tasks, so these are unchanged.)
  const viewCounts = useMemo(() => {
    const c: Record<Bucket, number> = { today: 0, upcoming: 0, anytime: 0, someday: 0 };
    for (const t of scopedTasks) if (t.kind === 'task' && !t.done) c[bucketForTask(t, today)]++;
    return c;
  }, [scopedTasks, today]);

  // Open to-dos captured but never filed into a list — the Inbox count.
  const inboxCount = useMemo(
    () => scopedTasks.filter(t => t.kind === 'task' && !t.done && !t.note_id).length,
    [scopedTasks],
  );

  const orbitEnabled = !!settings?.orbit_enabled;
  const orbitCount = useMemo(
    () => scopedTasks.filter(t => t.kind === 'task' && !t.done && t.in_orbit).length,
    [scopedTasks],
  );

  // The single to-do whose timer is currently running (if any) — surfaced in a
  // floating bar so it can be stopped from any planner view.
  const runningTask = useMemo(() => tasks.find(t => !!t.timer_started_at) ?? null, [tasks]);

  // Reorder lists by drag, persisting the new sort_order.
  const listSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  // Persist a new order for the (non-archived) lists, writing sort_order by index.
  function persistOrder(ordered: PlannerNote[], failMsg: string) {
    const orderById = new Map(ordered.map((n, i) => [n.id, i]));
    setNotes(prev => prev.map(n => (orderById.has(n.id) ? { ...n, sort_order: orderById.get(n.id)! } : n)));
    reorderNotes(ordered.map((n, i) => ({ id: n.id, sort_order: i }))).catch(e2 => setError((e2 as Error)?.message ?? failMsg));
  }
  function handleListDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    // Reorder within the visible rail set (which is scoped by penFilter).
    const from = railNotes.findIndex(n => n.id === active.id);
    const to = railNotes.findIndex(n => n.id === over.id);
    if (from < 0 || to < 0) return;
    const reordered = [...railNotes];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    persistOrder(reordered, 'Could not save list order.');
  }
  function sortNotesAZ() {
    const sorted = [...railNotes].sort((a, b) => (a.title.trim() || 'Untitled list').localeCompare(b.title.trim() || 'Untitled list'));
    persistOrder(sorted, 'Could not sort lists.');
  }

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
    // Archiving the open list would otherwise leave its editor stranded.
    if (patch.archived === true) setSelection(sel => (sel.kind === 'note' && sel.id === id ? { kind: 'myday' } : sel));
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

  // Duplicate a list + its to-dos/headings into a fresh "(copy)" and open it.
  async function duplicateNote(note: PlannerNote) {
    if (!user) return;
    try {
      const noteTasks = tasks.filter(t => t.note_id === note.id);
      const { note: copy, tasks: copied } = await duplicateList(user.id, note, noteTasks);
      setNotes(prev => [copy, ...prev]);
      setTasks(prev => [...prev, ...copied]);
      setSelection({ kind: 'note', id: copy.id });
    } catch (e) { setError((e as Error)?.message ?? 'Could not duplicate the list.'); }
  }

  async function addTask(input: {
    title: string; note_id?: string | null; due_date?: string | null; someday?: boolean;
    kind?: 'task' | 'heading'; sort_order?: number; block_id?: string | null; estimate_minutes?: number | null; in_orbit?: boolean;
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

    // Log a session for every timer that stops in this patch (this to-do being
    // stopped or completed, plus any others displaced by starting a new one), so
    // tracked time lands on the day it was worked — even if never completed.
    const stoppedAt = new Date().toISOString();
    const sessionRows: { task_id: string; started_at: string; ended_at: string; minutes: number }[] = [];
    const logStop = (t: PlannerTask) => {
      if (!t.timer_started_at) return;
      const minutes = elapsedMinutes(t.timer_started_at);
      if (minutes > 0) sessionRows.push({ task_id: t.id, started_at: t.timer_started_at, ended_at: stoppedAt, minutes });
    };
    if (task && task.timer_started_at && (patch.timer_started_at === null || patch.done === true)) logStop(task);
    if (startingTimer) others.forEach(logStop);

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
      if (sessionRows.length && user) {
        const created = await createTimeSessions(user.id, sessionRows);
        setSessions(prev => [...prev, ...created]);
      }
    }
    catch (e) { setError((e as Error)?.message ?? 'Could not update item.'); }
  }

  async function removeTask(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id));
    try { await deleteTask(id); }
    catch (e) { setError((e as Error)?.message ?? 'Could not delete item.'); }
  }

  // Manually log time worked on a to-do (e.g. you forgot to start the timer):
  // bumps its running total and records a session ending now, so it lands on
  // today in Stats and "worked today".
  async function logManualMinutes(taskId: string, minutes: number) {
    if (!user || minutes <= 0) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60_000);
    setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, actual_minutes: (t.actual_minutes ?? 0) + minutes } : t)));
    try {
      await updateTask(taskId, { actual_minutes: (task.actual_minutes ?? 0) + minutes });
      const created = await createTimeSessions(user.id, [{ task_id: taskId, started_at: start.toISOString(), ended_at: end.toISOString(), minutes }]);
      setSessions(prev => [...prev, ...created]);
    } catch (e) { setError((e as Error)?.message ?? 'Could not log time.'); }
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

  // One updater for the central Settings page (capacity, carry-over, roll-over,
  // working phase). Optimistic, then reconciled with the saved row.
  async function updatePlannerSettings(patch: Partial<PlannerSettings>) {
    if (!user) return;
    setSettings(prev => (prev ? { ...prev, ...patch } : prev));
    try { const s = await updateSettings(user.id, patch); setSettings(s); }
    catch (e) { setError((e as Error)?.message ?? 'Could not save your settings.'); }
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
        className={`w-64 shrink-0 border-r border-slate-200 bg-slate-50 flex-col overflow-y-auto nice-scrollbar
          md:static md:flex md:bg-slate-50/60
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
          {orbitEnabled && (
            <button
              onClick={() => choose({ kind: 'orbit' })}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                selection.kind === 'orbit' ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-600 hover:bg-white/70'
              }`}
            >
              <OrbitIcon className="w-4 h-4 text-violet-500" />
              <span className="flex-1 text-left">Orbit</span>
              {orbitCount > 0 && <span className="text-xs text-slate-400 font-medium">{orbitCount}</span>}
            </button>
          )}
          <button
            onClick={() => choose({ kind: 'inbox' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              selection.kind === 'inbox' ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-600 hover:bg-white/70'
            }`}
          >
            <Inbox className="w-4 h-4 text-slate-400" />
            <span className="flex-1 text-left">Inbox</span>
            {inboxCount > 0 && <span className="text-xs text-slate-400 font-medium">{inboxCount}</span>}
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
            onClick={() => choose({ kind: 'plan' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              selection.kind === 'plan' ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-600 hover:bg-white/70'
            }`}
          >
            <CalendarRange className="w-4 h-4 text-sky-500" />
            <span className="flex-1 text-left">Planning</span>
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
            onClick={() => choose({ kind: 'settings' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              selection.kind === 'settings' ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-600 hover:bg-white/70'
            }`}
          >
            <SettingsIcon className="w-4 h-4 text-slate-400" />
            <span className="flex-1 text-left">Settings</span>
          </button>
        </nav>

        {penNames.length > 0 && (
          <div className="px-3 pt-1 pb-2 border-b border-slate-200/70">
            <PenFilterSwitcher
              penNames={penNames}
              value={penFilter}
              onChange={setPenFilter}
            />
          </div>
        )}

        <div className="px-4 pt-3 pb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Lists</span>
          <div className="flex items-center gap-1">
            {railNotes.length > 1 && (
              <button onClick={sortNotesAZ} className="text-slate-400 hover:text-teal-600" title="Sort lists A–Z">
                <ArrowDownAZ className="w-4 h-4" />
              </button>
            )}
            <button onClick={handleNewNote} className="text-slate-400 hover:text-teal-600" title="New list">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
        <nav className="px-3 pb-4 space-y-1">
          {railNotes.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-400">
              {penFilter ? 'No lists for this pen name yet.' : 'No lists yet. Hit + to start one.'}
            </p>
          )}
          <DndContext sensors={listSensors} collisionDetection={closestCenter} onDragEnd={handleListDragEnd}>
            <SortableContext items={railNotes.map(n => n.id)} strategy={verticalListSortingStrategy}>
              {railNotes.map(n => (
                <SortableListItem
                  key={n.id}
                  note={n}
                  active={selection.kind === 'note' && selection.id === n.id}
                  open={openCountByNote[n.id] ?? 0}
                  penName={n.pen_name_id ? penNamesById[n.pen_name_id] : undefined}
                  onChoose={() => choose({ kind: 'note', id: n.id })}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* Archived lists — collapsed by default, with restore + delete. */}
          {archivedNotes.length > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-200/70">
              <button
                onClick={() => setShowArchived(v => !v)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600"
              >
                {showArchived ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Archived ({archivedNotes.length})
              </button>
              {showArchived && (
                <div className="mt-0.5 space-y-0.5">
                  {archivedNotes.map(n => (
                    <div key={n.id} className="group/arch flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-white/70">
                      <Archive className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                      <span className="flex-1 truncate">{n.title.trim() || 'Untitled list'}</span>
                      <button onClick={() => saveNote(n.id, { archived: false })} className="text-slate-300 hover:text-teal-600 shrink-0" title="Restore list">
                        <ArchiveRestore className="w-4 h-4" />
                      </button>
                      <button onClick={() => removeNote(n.id)} className="text-slate-300 hover:text-rose-500 shrink-0" title="Delete list">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
            tasks={scopedTasks}
            blocks={blocks}
            sessions={sessions}
            dayNotes={dayNotes}
            settings={settings ?? { user_id: user?.id ?? '', daily_capacity_minutes: DEFAULT_DAILY_CAPACITY, carry_over_capacity: false, auto_rollover: false, working_phase: null, phase_started_on: null, daily_goal_count: 3, orbit_enabled: false, created_at: '', updated_at: '' }}
            today={today}
            cal={{ gc, calVersion }}
            handlers={myDayHandlers}
            jumpTo={dayJump}
            notesById={notesById}
            lists={listsForViews}
          />
        ) : selection.kind === 'plan' ? (
          <PlanView
            tasks={scopedTasks}
            blocks={blocks}
            settings={settings ?? { user_id: user?.id ?? '', daily_capacity_minutes: DEFAULT_DAILY_CAPACITY, carry_over_capacity: false, auto_rollover: false, working_phase: null, phase_started_on: null, daily_goal_count: 3, orbit_enabled: false, created_at: '', updated_at: '' }}
            notesById={notesById}
            today={today}
            onOpenDay={openDay}
            onPatch={patchTask}
          />
        ) : selection.kind === 'stats' ? (
          <StatsView tasks={scopedTasks} sessions={sessions} today={today} />
        ) : selection.kind === 'logbook' ? (
          <LogbookView tasks={scopedTasks} notesById={notesById} today={today} onPatch={patchTask} onDelete={removeTask} />
        ) : selection.kind === 'settings' ? (
          <SettingsView
            settings={settings ?? { user_id: user?.id ?? '', daily_capacity_minutes: DEFAULT_DAILY_CAPACITY, carry_over_capacity: false, auto_rollover: false, working_phase: null, phase_started_on: null, daily_goal_count: 3, orbit_enabled: false, created_at: '', updated_at: '' }}
            today={today}
            onUpdate={updatePlannerSettings}
          />
        ) : selection.kind === 'view' || selection.kind === 'inbox' || selection.kind === 'orbit' ? (
          <ViewPane
            bucket={selection.kind === 'view' ? selection.bucket : undefined}
            inbox={selection.kind === 'inbox'}
            orbit={selection.kind === 'orbit'}
            orbitEnabled={orbitEnabled}
            settings={settings ?? null}
            tasks={scopedTasks}
            today={today}
            notesById={notesById}
            lists={listsForViews}
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
            orbitEnabled={orbitEnabled}
            tasks={tasks.filter(t => t.note_id === selectedNote.id)}
            today={today}
            lists={listsForViews}
            penNames={penNames}
            onSaveNote={saveNote}
            onDeleteNote={removeNote}
            onDuplicateNote={duplicateNote}
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

      {runningTask ? (
        <RunningTimerBar
          task={runningTask}
          inToday={runningTask.due_date === today}
          onAddToday={() => patchTask(runningTask.id, { due_date: today, someday: false })}
          onStop={() => patchTask(runningTask.id, stopTimerPatch(runningTask))}
          onOpen={() => {
            if (runningTask.note_id) setSelection({ kind: 'note', id: runningTask.note_id });
            else choose({ kind: 'myday' });
          }}
        />
      ) : (
        <button
          onClick={() => setFocusOpen(true)}
          className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white rounded-full shadow-xl px-4 py-2.5 text-sm font-medium"
          title="Start a focus timer on any to-do"
        >
          <Target className="w-4 h-4" /> Focus
        </button>
      )}

      {focusOpen && (
        <FocusPicker
          tasks={tasks}
          notesById={notesById}
          orbitEnabled={orbitEnabled}
          onStart={id => patchTask(id, { timer_started_at: new Date().toISOString() })}
          onLogTime={logManualMinutes}
          onClose={() => setFocusOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Smart views
// ---------------------------------------------------------------------------

function ViewPane({
  bucket, inbox = false, orbit = false, orbitEnabled = false, settings = null, tasks, today, notesById, lists, onAdd, onPatch, onDelete, onOpenNote, cal,
}: {
  bucket?: Bucket;
  inbox?: boolean;
  orbit?: boolean;
  orbitEnabled?: boolean;
  settings?: PlannerSettings | null;
  tasks: PlannerTask[];
  today: string;
  notesById: Record<string, PlannerNote>;
  lists: PlannerNote[];
  onAdd: (i: { title: string; due_date?: string | null; someday?: boolean; in_orbit?: boolean }) => void;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  onOpenNote: (id: string) => void;
  cal: CalendarBridge;
}) {
  const meta = orbit
    ? { label: 'Orbit', icon: OrbitIcon, color: 'text-violet-500' }
    : inbox
      ? { label: 'Inbox', icon: Inbox, color: 'text-slate-500' }
      : VIEWS.find(v => v.bucket === bucket)!;
  const Icon = meta.icon;
  const [draft, setDraft] = useState('');
  const { gc, calVersion, onTimeBlock, onUnblock } = cal;
  const [eventsByDay, setEventsByDay] = useState<Record<string, GCalEvent[]>>({});

  // Inbox is the catch-all for anything captured but never filed into a list,
  // regardless of date — so you can edit those to-dos without hunting for the
  // day you added them on.
  const items = orbit
    ? tasks
        .filter(t => t.kind === 'task' && !t.done && t.in_orbit)
        .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    : inbox
      ? tasks
          .filter(t => t.kind === 'task' && !t.done && !t.note_id)
          .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
      : tasks
          .filter(t => t.kind === 'task' && !t.done && bucketForTask(t, today) === bucket)
          .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));

  // Pull Google events for the day (Today) or the day range (Upcoming) so they
  // can sit alongside the to-dos. Other buckets have no dates, so no events.
  const dueDates = items.map(t => t.due_date!).filter(Boolean);
  const rangeMin = bucket === 'today' ? today : dueDates[0];
  const rangeMax = bucket === 'today' ? today : dueDates[dueDates.length - 1];
  const wantsEvents = !inbox && !orbit && gc.connected && (bucket === 'today' || (bucket === 'upcoming' && dueDates.length > 0));
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
    orbit ? { in_orbit: true } :
    bucket === 'today' ? { due_date: today } :
    bucket === 'someday' ? { someday: true } :
    {};

  function noteNameFor(t: PlannerTask) {
    return t.note_id ? (notesById[t.note_id]?.title.trim() || 'Untitled list') : undefined;
  }

  function renderRow(t: PlannerTask) {
    return (
      <TaskRow key={t.id} task={t} today={today}
        lists={lists}
        listName={noteNameFor(t)}
        onOpenList={t.note_id ? () => onOpenNote(t.note_id!) : undefined}
        onPatch={onPatch} onDelete={onDelete}
        showTimer canFlag canSomeday orbitEnabled={orbitEnabled}
        enableRecurrence enableChecklist
        calConnected={gc.connected}
        onTimeBlock={time => onTimeBlock(t, time)}
        onUnblock={() => onUnblock(t)} />
    );
  }

  const totalMinutes = sumEstimate(items);

  // ---- Smart Orbit picks (Orbit view only) ------------------------------
  // Ask Claude which open to-dos are most worth pulling into Orbit; applying a
  // pick flips its in_orbit flag. Local state, like the My Day assists.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiSettings = settings ?? {
    user_id: '', daily_capacity_minutes: DEFAULT_DAILY_CAPACITY, carry_over_capacity: false,
    auto_rollover: false, working_phase: null, phase_started_on: null, daily_goal_count: 3,
    orbit_enabled: true, created_at: '', updated_at: '',
  };
  const tasksById = useMemo(() => {
    const m: Record<string, PlannerTask> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);

  async function runOrbitAi() {
    setAiOpen(true);
    setAiResult(null);
    setAiError(null);
    setAiLoading(true);
    try {
      setAiResult(await suggestOrbitPicks(tasks, aiSettings, today, notesById));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Something went wrong — try again.');
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Icon className={`w-6 h-6 ${meta.color}`} />
        <h2 className="text-2xl font-bold text-slate-800">{meta.label}</h2>
        {orbit && orbitEnabled && (
          <button
            onClick={runOrbitAi}
            className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-lg px-2.5 py-1.5"
            title="Let Claude suggest which to-dos to pull into Orbit"
          >
            <Sparkles className="w-3.5 h-3.5" /> Suggest picks
          </button>
        )}
        {(orbit || inbox || bucket === 'today' || bucket === 'anytime') && totalMinutes > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-slate-500">
            <Clock className="w-4 h-4" /> {formatMinutes(totalMinutes)} planned
          </span>
        )}
      </div>
      {orbit && orbitEnabled && (
        <AiSuggestPanel
          open={aiOpen}
          title="Suggest Orbit picks"
          intro="The 3–7 to-dos most worth pulling into Orbit right now."
          loading={aiLoading}
          error={aiError}
          result={aiResult}
          tasksById={tasksById}
          showDates={false}
          onApply={picks => { for (const p of picks) onPatch(p.id, { in_orbit: true }); }}
          onClose={() => setAiOpen(false)}
        />
      )}
      {orbit && (
        <p className="text-sm text-slate-400 -mt-4 mb-5">What's currently relevant. Star to-dos into Orbit from any list; they surface first in Focus.</p>
      )}

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
  note, tasks, today, lists, penNames, onSaveNote, onDeleteNote, onDuplicateNote, onAdd, onCreate, onPatch, onDelete, onReorder, orbitEnabled = false,
}: {
  note: PlannerNote;
  tasks: PlannerTask[];
  today: string;
  lists: PlannerNote[];
  penNames: PenName[];
  onSaveNote: (id: string, patch: Partial<PlannerNote>) => void;
  onDeleteNote: (id: string) => void;
  onDuplicateNote: (note: PlannerNote) => void;
  onAdd: (i: { title: string; note_id: string; kind?: 'task' | 'heading'; sort_order?: number }) => void;
  onCreate: (i: { title?: string; note_id: string; kind?: 'task' | 'heading' }) => Promise<PlannerTask | undefined>;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  onReorder: (updates: { id: string; sort_order: number }[]) => void;
  orbitEnabled?: boolean;
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
  // List rollups: estimate of what's left, and total time tracked on this list.
  const listEst = sumEstimate(ordered);
  const listTracked = ordered.reduce((s, t) => s + (t.kind === 'task' ? (t.actual_minutes ?? 0) : 0), 0);

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
          {penNames.length > 0 && (
            <NotePenNamePicker
              penNames={penNames}
              value={note.pen_name_id}
              onChange={penId => onSaveNote(note.id, { pen_name_id: penId })}
            />
          )}
          <button
            onClick={() => onSaveNote(note.id, { pinned: !note.pinned })}
            className={`p-2 rounded-lg hover:bg-slate-100 ${note.pinned ? 'text-amber-500' : 'text-slate-400'}`}
            title={note.pinned ? 'Unpin' : 'Pin to top'}
          >
            {note.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </button>
          <button onClick={() => onDuplicateNote(note)} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-teal-600" title="Duplicate this list (copy its to-dos, reset completion)">
            <CopyPlus className="w-4 h-4" />
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
        className="w-full text-sm text-slate-600 bg-transparent outline-none resize-y placeholder:text-slate-400 mb-2"
      />

      {/* Link this list to a Catalog book so its tracked time rolls up into
          that book's "hours worked". */}
      <div className="flex items-center gap-2 mb-3 max-w-md">
        <div className="flex-1">
          <CatalogBookPicker
            value={note.book_id}
            filterByPenName={false}
            placeholder="Link to a book in Catalog…"
            onChange={bookId => onSaveNote(note.id, { book_id: bookId })}
          />
        </div>
        {note.book_id && (
          <button
            type="button"
            onClick={() => onSaveNote(note.id, { book_id: null })}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"
            title="Unlink from book"
          >
            <Link2Off className="w-4 h-4" />
          </button>
        )}
      </div>

      {(listEst > 0 || listTracked > 0) && (
        <div className="flex items-center gap-3 text-xs text-slate-400 mb-4">
          {listEst > 0 && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {formatMinutes(listEst)} planned</span>}
          {listTracked > 0 && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-teal-500" /> {formatMinutes(listTracked)} tracked</span>}
        </div>
      )}

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
                lists={lists}
                showTimer
                canFlag
                canSomeday
                enableRecurrence
                enableChecklist
                orbitEnabled={orbitEnabled}
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
                  lists={lists}
                  collapsed={collapsed.has(t.id)}
                  childCount={childCount[t.id] ?? 0}
                  orbitEnabled={orbitEnabled}
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
              <TaskRow key={t.id} task={t} today={today} showTimer onPatch={onPatch} onDelete={onDelete} />
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
  task, today, lists, collapsed, childCount, focusId, onFocused, onToggleCollapse, onAddUnder, onEnter, onPatch, onDelete, orbitEnabled = false,
}: {
  task: PlannerTask;
  today: string;
  lists: PlannerNote[];
  collapsed: boolean;
  childCount: number;
  focusId: string | null;
  onFocused: () => void;
  onToggleCollapse: () => void;
  onAddUnder: () => void;
  onEnter: () => void;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  orbitEnabled?: boolean;
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
        lists={lists}
        showTimer
        canFlag
        canSomeday
        enableRecurrence
        enableChecklist
        orbitEnabled={orbitEnabled}
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

// The unified TaskRow (resting chips + ⋯ menu + expand card) lives in ./TaskRow,
// shared with My Day. Headings are rendered by HeadingRow above, not routed
// through it.

// A list in the rail: click to open, drag the grip to reorder.
// The whole-planner pen-name focus, sitting above the Lists rail. A compact
// dropdown of All + one row per pen name (with color dots), like the global
// PenNamePicker but driven by local state instead of the pen-name context.
function PenFilterSwitcher({
  penNames, value, onChange,
}: {
  penNames: PenName[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickAway(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const selected = value ? penNames.find(p => p.id === value) : undefined;
  const dot = selected ? penNameClasses(selected.color).dot : 'bg-slate-300';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700"
        title="Focus the planner on one pen name"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span className="flex-1 text-left font-medium truncate">{selected?.name ?? 'All pen names'}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50"
          >
            <span className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
            <span className="flex-1 font-medium text-slate-700">All pen names</span>
            {value === null && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
          </button>
          <div className="my-1 border-t border-slate-100" />
          {penNames.map(pn => {
            const c = penNameClasses(pn.color);
            return (
              <button
                key={pn.id}
                onClick={() => { onChange(pn.id); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
                <span className="flex-1 font-medium text-slate-700 truncate">{pn.name}</span>
                {pn.id === value && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Per-list pen-name assignment, shown in the list header. A compact dropdown of
// "No pen name" + one row per pen name (with color dots). Picking writes the
// note's pen_name_id (null clears it).
function NotePenNamePicker({
  penNames, value, onChange,
}: {
  penNames: PenName[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickAway(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const selected = value ? penNames.find(p => p.id === value) : undefined;
  const dot = selected ? penNameClasses(selected.color).dot : 'bg-slate-300';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-2 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        title="Assign a pen name to this list"
      >
        {selected
          ? <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
          : <UsersIcon className="w-4 h-4" />}
        <span className="max-w-[8rem] truncate">{selected?.name ?? 'No pen name'}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50"
          >
            <span className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
            <span className="flex-1 font-medium text-slate-700">No pen name</span>
            {value === null && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
          </button>
          <div className="my-1 border-t border-slate-100" />
          {penNames.map(pn => {
            const c = penNameClasses(pn.color);
            return (
              <button
                key={pn.id}
                onClick={() => { onChange(pn.id); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
                <span className="flex-1 font-medium text-slate-700 truncate">{pn.name}</span>
                {pn.id === value && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SortableListItem({
  note, active, open, penName, onChoose,
}: {
  note: PlannerNote;
  active: boolean;
  open: number;
  penName?: PenName;
  onChoose: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: note.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={`group flex items-center rounded-lg ${isDragging ? 'opacity-60 bg-white shadow-sm' : ''}`}>
      <button
        {...attributes}
        {...listeners}
        className="pl-1.5 py-2 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity shrink-0 touch-none"
        title="Drag to reorder"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onChoose}
        className={`flex-1 min-w-0 flex items-center gap-2 pr-3 py-2 rounded-lg text-sm transition-colors ${
          active ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-600 hover:bg-white/70'
        }`}
      >
        {note.pinned ? <Pin className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <NotebookPen className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
        <span className="flex-1 text-left truncate">{note.title.trim() || 'Untitled list'}</span>
        {penName && <span className={`w-2 h-2 rounded-full shrink-0 ${penNameClasses(penName.color).dot}`} title={penName.name} />}
        {open > 0 && <span className="text-xs text-slate-400 shrink-0">{open}</span>}
      </button>
    </div>
  );
}

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
      <button
        onClick={onSubmit}
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
