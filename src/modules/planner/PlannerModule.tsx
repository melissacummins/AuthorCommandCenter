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
  CopyPlus, Check, Users as UsersIcon, RotateCcw, Search, GitMerge, ArrowUpDown,
  Loader2, Zap, Heart, Dices, Play, CalendarPlus, LayoutGrid, Lock,
} from 'lucide-react';
import MyDayView, { type MyDayHandlers } from './MyDayView';
import { AiSuggestPanel } from './AiSuggestPanel';
import { suggestOrbitPicks, findDuplicateGroups, suggestDurations, type AiResult, type DuplicateGroup, type DurationSuggestion } from './aiAssist';
import StatsView from './StatsView';
import ProjectsView from './ProjectsView';
import LogbookView from './LogbookView';
import SettingsView from './SettingsView';
import PlanView from './PlanView';
import WeeklyResetView from './WeeklyResetView';
import { useGoogleCalendar, type UseGoogleCalendar } from './useGoogleCalendar';
import type { GCalEvent } from './google';
import CatalogBookPicker from '../../components/CatalogBookPicker';
import {
  listNotes, createNote, updateNote, deleteNote, duplicateList,
  listTasks, createTask, updateTask, deleteTask, reorderTasks, newChecklistItem,
  getSettings, updateSettings,
  listTimeBlocks, createTimeBlock, updateTimeBlock, deleteTimeBlock,
  listTimeSessions, createTimeSessions, deleteTimeSession, reorderNotes,
  createTaskEvent,
  listTaskDependencies, addTaskDependency, removeTaskDependency,
  getWeeklyReset, upsertWeeklyReset,
} from './api';
import { listPenNames, type PenName } from '../../lib/penNames';
import { penNameClasses } from '../../components/PenNameChip';
import {
  bucketForTask, formatMinutes, formatDue, nextDueDate, sumEstimate, todayISO,
  elapsedMinutes, localDay, weekStartISO, addDaysISO, parseCapture, DEFAULT_DAILY_CAPACITY,
  type PlannerNote, type PlannerTask, type Bucket,
  type PlannerSettings, type PlannerTimeBlock, type PlannerTimeSession, type PlannerTaskDependency,
  dedupeResetDraft, resetSectionFor, QUICK_TASK_MINUTES,
  type WeeklyReset, type ResetTranscription, type ResetSection, type ResetDraftItem,
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
  | { kind: 'reset' }
  | { kind: 'projects' }
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
  { bucket: 'anytime',  label: 'Anytime',  icon: Layers,        color: 'text-brand-600' },
];

export default function PlannerModule() {
  const { user, isAdmin } = useAuth();
  const [notes, setNotes] = useState<PlannerNote[]>([]);
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [blocks, setBlocks] = useState<PlannerTimeBlock[]>([]);
  const [sessions, setSessions] = useState<PlannerTimeSession[]>([]);
  const [deps, setDeps] = useState<PlannerTaskDependency[]>([]);
  // The to-do whose dependencies are being edited (opens the modal), or null.
  const [depEditId, setDepEditId] = useState<string | null>(null);
  const [settings, setSettings] = useState<PlannerSettings | null>(null);
  const [penNames, setPenNames] = useState<PenName[]>([]);
  // Whole-planner pen-name focus: null = All (show everything, today's behavior).
  // Persisted only in component state, not the DB.
  const [penFilter, setPenFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'myday' });
  // AI duplicate-finder (scans all open to-dos for likely-same items to merge).
  const [dedupOpen, setDedupOpen] = useState(false);
  const [dedupLoading, setDedupLoading] = useState(false);
  const [dedupError, setDedupError] = useState<string | null>(null);
  const [dedupGroups, setDedupGroups] = useState<DuplicateGroup[] | null>(null);
  // AI duration suggestions (estimates time for to-dos that have none).
  const [durOpen, setDurOpen] = useState(false);
  const [durLoading, setDurLoading] = useState(false);
  const [durError, setDurError] = useState<string | null>(null);
  const [durSuggestions, setDurSuggestions] = useState<DurationSuggestion[] | null>(null);
  // The planner rail is a slide-over on mobile; always-on from md up.
  const [railOpen, setRailOpen] = useState(false);
  // The search-and-start focus picker (a modal).
  const [focusOpen, setFocusOpen] = useState(false);
  // "Surprise me" — a random open to-do to break decision paralysis (the dice).
  const [spinTask, setSpinTask] = useState<PlannerTask | null>(null);
  const [spinOpen, setSpinOpen] = useState(false);
  // A nudge to open a specific day in My Day (e.g. from the Plan view). The
  // bumping counter lets the same day be re-opened.
  const [dayJump, setDayJump] = useState<{ iso: string; n: number }>(() => ({ iso: todayISO(), n: 0 }));
  // A nudge to open a specific day in the Logbook (e.g. tapping a Stats bar).
  const [reviewJump, setReviewJump] = useState<{ iso: string; n: number }>(() => ({ iso: '', n: 0 }));
  // Weekly Reset: the Monday being viewed + its loaded row.
  const [resetWeek, setResetWeek] = useState<string>(() => weekStartISO(todayISO()));
  const [weeklyReset, setWeeklyReset] = useState<WeeklyReset | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const today = todayISO();
  const gc = useGoogleCalendar(isAdmin);
  // Bumped whenever a time block is added/removed so the views re-fetch events.
  const [calVersion, setCalVersion] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([
      listNotes(user.id, true), listTasks(user.id), listTimeBlocks(user.id),
      getSettings(user.id), listTimeSessions(user.id),
      listPenNames(user.id), listTaskDependencies(user.id),
    ])
      .then(([n, t, b, s, ts, pn, deps]) => {
        if (!active) return;
        setNotes(n); setTasks(t); setBlocks(b); setSessions(ts);
        setSettings(s);
        setPenNames(pn);
        setDeps(deps);
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
    // Open to-dos still sitting in a PAST timed block are held back from rollover:
    // they wait for the "did you work on these?" review on My Day, which decides
    // their logged time before carrying them forward. Everything else rolls now.
    const timedBlocks = new Set(blocks
      .filter(b => b.start_minute != null && b.end_minute != null && b.end_minute > b.start_minute)
      .map(b => b.id));
    const stale = tasks.filter(t => t.kind === 'task' && !t.done && !t.someday && !!t.due_date && t.due_date < today
      && !(t.block_id && timedBlocks.has(t.block_id)));
    if (!stale.length) return;
    const ids = new Set(stale.map(t => t.id));
    // Clear block_id too: the to-do's old time block lives on a past day, so
    // keeping the link would hide it on today (it'd be neither in a visible
    // block nor in the loose list).
    setTasks(prev => prev.map(t => (ids.has(t.id) ? { ...t, due_date: today, block_id: null } : t)));
    Promise.all(stale.map(t => updateTask(t.id, { due_date: today, block_id: null }))).catch(() => { /* best effort */ });
  }, [user, loading, settings?.auto_rollover, tasks, blocks]);

  // Heal stale block links: a to-do whose block is on a different day than its
  // due date (e.g. rolled forward in an earlier build) is freed back to loose so
  // it shows on its day instead of silently vanishing while still being counted.
  useEffect(() => {
    if (!user || loading) return;
    const blockDay = new Map(blocks.map(b => [b.id, b.day]));
    const orphans = tasks.filter(t => t.block_id && blockDay.get(t.block_id) !== t.due_date);
    if (!orphans.length) return;
    const ids = new Set(orphans.map(t => t.id));
    setTasks(prev => prev.map(t => (ids.has(t.id) ? { ...t, block_id: null } : t)));
    Promise.all(orphans.map(t => updateTask(t.id, { block_id: null }))).catch(() => { /* best effort */ });
  }, [user, loading, tasks, blocks]);

  // Load the viewed week's reset when the Weekly Reset view is open (and on
  // week change). Clear first so the per-week remount never shows stale text.
  useEffect(() => {
    if (!user || selection.kind !== 'reset') return;
    let active = true;
    setResetLoading(true);
    setWeeklyReset(null);
    getWeeklyReset(user.id, resetWeek)
      .then(r => { if (active) setWeeklyReset(r); })
      .catch(e => { if (active) setError((e as Error)?.message ?? 'Could not load your weekly reset.'); })
      .finally(() => { if (active) setResetLoading(false); });
    return () => { active = false; };
  }, [user, resetWeek, selection.kind]);

  const notesById = useMemo(() => Object.fromEntries(notes.map(n => [n.id, n])), [notes]);

  // Dependency lookups. `blockersOf` = every to-do a given one is blocked by;
  // `openBlockersByTask` keeps only the blockers that aren't done yet — those are
  // what actually make a to-do "blocked" right now.
  const blockersOf = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const d of deps) (m[d.task_id] ??= []).push(d.depends_on_id);
    return m;
  }, [deps]);
  const openBlockersByTask = useMemo(() => {
    const byId: Record<string, PlannerTask> = {};
    for (const t of tasks) byId[t.id] = t;
    const m: Record<string, PlannerTask[]> = {};
    for (const d of deps) {
      const blocker = byId[d.depends_on_id];
      if (blocker && !blocker.done) (m[d.task_id] ??= []).push(blocker);
    }
    return m;
  }, [deps, tasks]);
  const blockedTaskIds = useMemo(() => new Set(Object.keys(openBlockersByTask)), [openBlockersByTask]);

  // Add a blocker (dependsOnId blocks taskId), guarding self-links, duplicates,
  // and the obvious 2-cycle (A blocks B while B blocks A).
  async function addDependency(taskId: string, dependsOnId: string) {
    if (!user || taskId === dependsOnId) return;
    if (deps.some(d => d.task_id === taskId && d.depends_on_id === dependsOnId)) return;
    if (deps.some(d => d.task_id === dependsOnId && d.depends_on_id === taskId)) {
      setError('Those two would block each other — pick a different one.');
      return;
    }
    try {
      const row = await addTaskDependency(user.id, taskId, dependsOnId);
      setDeps(prev => [...prev, row]);
    } catch (e) { setError((e as Error)?.message ?? 'Could not add that dependency.'); }
  }
  async function removeDependency(id: string) {
    setDeps(prev => prev.filter(d => d.id !== id));
    try { await removeTaskDependency(id); }
    catch (e) { setError((e as Error)?.message ?? 'Could not remove that dependency.'); }
  }
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

  // Combine two lists: move all of the source list's to-dos into the target
  // (appended, order preserved), then archive the now-empty source. This is how
  // you fold an old Weekly Reset into the current one, or tidy scattered lists.
  // Headings stay behind (they'd duplicate the target's sections); only to-dos
  // move.
  async function mergeList(sourceId: string, targetId: string) {
    if (!user || sourceId === targetId) return;
    const moving = tasks
      .filter(t => t.note_id === sourceId && t.kind === 'task')
      .sort((a, b) => (a.sort_order - b.sort_order) || a.created_at.localeCompare(b.created_at));
    const targetMax = tasks.filter(t => t.note_id === targetId).reduce((m, t) => Math.max(m, t.sort_order), -1);
    const updates = moving.map((t, i) => ({ id: t.id, sort_order: targetMax + 1 + i }));
    const movingIds = new Set(updates.map(u => u.id));
    setTasks(prev => prev.map(t => {
      const u = updates.find(x => x.id === t.id);
      return u ? { ...t, note_id: targetId, sort_order: u.sort_order } : t;
    }));
    setNotes(prev => prev.map(n => (n.id === sourceId ? { ...n, archived: true } : n)));
    setSelection({ kind: 'note', id: targetId });
    try {
      await Promise.all([...movingIds].map(id => {
        const u = updates.find(x => x.id === id)!;
        return updateTask(id, { note_id: targetId, sort_order: u.sort_order });
      }));
      await updateNote(sourceId, { archived: true });
    } catch (e) { setError((e as Error)?.message ?? 'Could not merge the lists.'); }
  }

  // Tidy a list by rewriting its to-dos' order: A–Z, by due date (undated last),
  // or tag-first (priority, then feel-good, then the rest). Headings are left
  // where they are; only the plain to-dos are reordered around them.
  async function sortListTasks(noteId: string, mode: 'alpha' | 'due' | 'tag') {
    const items = tasks.filter(t => t.note_id === noteId && t.kind === 'task');
    if (items.length < 2) return;
    const base = tasks.filter(t => t.note_id === noteId).reduce((m, t) => Math.min(m, t.sort_order), 0);
    const cmp: Record<typeof mode, (a: PlannerTask, b: PlannerTask) => number> = {
      alpha: (a, b) => (a.title || '').localeCompare(b.title || ''),
      due: (a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || (a.title || '').localeCompare(b.title || ''),
      tag: (a, b) => (rank(b) - rank(a)) || (a.title || '').localeCompare(b.title || ''),
    };
    function rank(t: PlannerTask) { return (t.flagged ? 2 : 0) + (t.feel_good ? 1 : 0); }
    const sorted = [...items].sort(cmp[mode]);
    const updates = sorted.map((t, i) => ({ id: t.id, sort_order: base + i }));
    setTasks(prev => prev.map(t => {
      const u = updates.find(x => x.id === t.id);
      return u ? { ...t, sort_order: u.sort_order } : t;
    }));
    try { await reorderTasks(updates); }
    catch (e) { setError((e as Error)?.message ?? 'Could not sort the list.'); }
  }

  // Merge a set of duplicate to-dos into one survivor: the survivor absorbs the
  // others' tags (priority, feel-good, orbit), the largest estimate, and the
  // earliest due date; the rest are deleted. Used by the AI duplicate-finder.
  async function mergeDuplicates(survivorId: string, otherIds: string[]) {
    if (!user || !otherIds.length) return;
    const survivor = tasks.find(t => t.id === survivorId);
    if (!survivor) return;
    const group = [survivor, ...tasks.filter(t => otherIds.includes(t.id))];
    const estimates = group.map(t => t.estimate_minutes).filter((m): m is number => typeof m === 'number' && m > 0);
    const dues = group.map(t => t.due_date).filter((d): d is string => !!d).sort();
    const patch: Partial<PlannerTask> = {
      flagged: group.some(t => t.flagged),
      feel_good: group.some(t => t.feel_good),
      in_orbit: group.some(t => t.in_orbit),
      estimate_minutes: estimates.length ? Math.max(...estimates) : survivor.estimate_minutes,
      due_date: dues.length ? dues[0] : survivor.due_date,
    };
    setTasks(prev => prev.filter(t => !otherIds.includes(t.id)).map(t => (t.id === survivorId ? { ...t, ...patch } : t)));
    try {
      await updateTask(survivorId, patch);
      await Promise.all(otherIds.map(id => deleteTask(id)));
    } catch (e) { setError((e as Error)?.message ?? 'Could not merge those to-dos.'); }
  }

  // Ask Claude to group likely-duplicate open to-dos across all lists.
  async function runDedup() {
    setDedupOpen(true); setDedupLoading(true); setDedupError(null); setDedupGroups(null);
    try {
      setDedupGroups(await findDuplicateGroups(tasks, notesById));
    } catch (e) {
      setDedupError(e instanceof Error ? e.message : 'Could not scan for duplicates.');
    } finally {
      setDedupLoading(false);
    }
  }

  // "Surprise me": pick a random actionable to-do (open, not Someday) to work on
  // next — a low-stakes way past decision paralysis. Avoids repeating the last
  // pick when there's more than one to choose from.
  function spin() {
    const pool = tasks.filter(t => t.kind === 'task' && !t.done && !t.someday);
    if (!pool.length) { setSpinTask(null); setSpinOpen(true); return; }
    let pick = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && spinTask && pick.id === spinTask.id) {
      pick = pool[(pool.indexOf(pick) + 1) % pool.length];
    }
    setSpinTask(pick); setSpinOpen(true);
  }

  // Ask Claude to estimate durations for open to-dos that don't have one.
  async function runDurations() {
    if (!settings) return;
    setDurOpen(true); setDurLoading(true); setDurError(null); setDurSuggestions(null);
    try {
      setDurSuggestions(await suggestDurations(tasks, settings, today, notesById));
    } catch (e) {
      setDurError(e instanceof Error ? e.message : 'Could not estimate durations.');
    } finally {
      setDurLoading(false);
    }
  }

  // Append one entry to a to-do's activity history — fire-and-forget so a failed
  // log never blocks or surfaces over the real change.
  function logEvent(taskId: string, type: string, detail?: string | null) {
    if (!user) return;
    createTaskEvent(user.id, taskId, type, detail ?? null).catch(() => { /* non-critical */ });
  }

  async function addTask(input: {
    title: string; note_id?: string | null; due_date?: string | null; someday?: boolean;
    kind?: 'task' | 'heading'; sort_order?: number; block_id?: string | null; estimate_minutes?: number | null; in_orbit?: boolean;
  }) {
    if (!user || !input.title.trim()) return;
    try {
      const task = await createTask(user.id, { ...input, title: input.title.trim() });
      setTasks(prev => [...prev, task]);
      if (task.kind === 'task') logEvent(task.id, 'created');
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

  // One to-do's even share of a TIMED block, as a session on the block's day —
  // so checking it off can record that time without a timer. The block's length
  // is split evenly across the to-dos in it and placed back-to-back, so all of
  // them together sum to the block's duration. Untimed blocks yield nothing.
  function blockShareSession(task: PlannerTask): { started_at: string; ended_at: string; minutes: number } | null {
    if (!task.block_id) return null;
    const block = blocks.find(b => b.id === task.block_id);
    if (!block || block.start_minute == null || block.end_minute == null || block.end_minute <= block.start_minute) return null;
    const inBlock = tasks.filter(t => t.kind === 'task' && t.block_id === block.id)
      .sort((a, b) => (a.sort_order - b.sort_order) || a.created_at.localeCompare(b.created_at));
    const n = inBlock.length;
    if (!n) return null;
    const idx = Math.max(0, inBlock.findIndex(t => t.id === task.id));
    const dur = block.end_minute - block.start_minute;
    const per = Math.floor(dur / n);
    const minutes = idx === n - 1 ? dur - per * (n - 1) : per; // last one absorbs the remainder
    if (minutes <= 0) return null;
    const base = new Date(block.day + 'T00:00:00');
    const s = new Date(base); s.setMinutes(block.start_minute + idx * per);
    const e = new Date(s.getTime() + minutes * 60_000);
    return { started_at: s.toISOString(), ended_at: e.toISOString(), minutes };
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

    // Timed-block time: checking a to-do off inside a timed block records its
    // share of the block as worked time (no timer needed); un-checking gives that
    // time back. Recurring to-dos and ones with real tracked time are left alone.
    let blockLogRow: { task_id: string; started_at: string; ended_at: string; minutes: number } | null = null;
    let removeBlockSessions: PlannerTimeSession[] = [];
    if (task) {
      const completing = patch.done === true && !task.done && !task.recurrence
        && !task.timer_started_at && (task.actual_minutes ?? 0) === 0;
      if (completing && !sessions.some(s => s.task_id === id && s.source === 'block')) {
        const share = blockShareSession(task);
        if (share) {
          blockLogRow = { task_id: id, ...share };
          effective = { ...effective, actual_minutes: (task.actual_minutes ?? 0) + share.minutes };
        }
      } else if (patch.done === false && task.done) {
        removeBlockSessions = sessions.filter(s => s.task_id === id && s.source === 'block');
        if (removeBlockSessions.length) {
          const mins = removeBlockSessions.reduce((m, s) => m + s.minutes, 0);
          effective = { ...effective, actual_minutes: Math.max(0, (task.actual_minutes ?? 0) - mins) };
        }
      }
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

    // Stamp done_at locally in lockstep with done (the server does the same) so
    // the Logbook and Stats — which group by done_at — reflect a just-completed
    // (or just-uncompleted) to-do immediately, without waiting for a reload.
    const doneStamp: Partial<PlannerTask> = effective.done === undefined
      ? {}
      : { done_at: effective.done ? new Date().toISOString() : null };

    setTasks(prev => prev.map(t => {
      if (t.id === id) return { ...t, ...effective, ...doneStamp };
      if (startingTimer && t.timer_started_at) {
        return { ...t, actual_minutes: (t.actual_minutes ?? 0) + elapsedMinutes(t.timer_started_at), timer_started_at: null };
      }
      return t;
    }));

    // Record meaningful changes to the to-do's activity history (skipping purely
    // mechanical ones — timer ticks, block links, sort order). A recurring
    // completion is a "repeated", not a "completed".
    if (task && task.kind === 'task') {
      const isRoll = patch.done === true && !!task.recurrence && !!task.due_date;
      if (isRoll) logEvent(id, 'repeated', nextDueDate(task.due_date!, task.recurrence!));
      else if ('done' in patch) logEvent(id, patch.done ? 'completed' : 'reopened');
      if ('due_date' in patch && !isRoll) {
        if (patch.due_date) logEvent(id, 'scheduled', formatDue(patch.due_date, today));
        else logEvent(id, 'unscheduled');
      }
      if ('note_id' in patch) logEvent(id, 'moved', patch.note_id ? (notesById[patch.note_id]?.title?.trim() || 'a list') : 'Inbox');
      if ('flagged' in patch) logEvent(id, patch.flagged ? 'flagged' : 'unflagged');
      if ('estimate_minutes' in patch && patch.estimate_minutes) logEvent(id, 'estimated', formatMinutes(patch.estimate_minutes));
      if ('title' in patch && patch.title && patch.title !== task.title) logEvent(id, 'renamed');
      if ('recurrence' in patch && patch.recurrence) logEvent(id, 'edited', 'set to repeat');
    }
    try {
      await updateTask(id, effective);
      await Promise.all(others.map(t =>
        updateTask(t.id, { actual_minutes: (t.actual_minutes ?? 0) + elapsedMinutes(t.timer_started_at!), timer_started_at: null })));
      if (sessionRows.length && user) {
        const created = await createTimeSessions(user.id, sessionRows);
        setSessions(prev => [...prev, ...created]);
      }
      if (blockLogRow && user) {
        const created = await createTimeSessions(user.id, [blockLogRow], 'block');
        setSessions(prev => [...prev, ...created]);
      }
      if (removeBlockSessions.length) {
        setSessions(prev => prev.filter(s => !removeBlockSessions.some(r => r.id === s.id)));
        await Promise.all(removeBlockSessions.map(s => deleteTimeSession(s.id)));
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
  // bumps its running total and records a session, so it lands in the Logbook &
  // Stats. Pass a day to log it retroactively on that date (anchored to noon);
  // omit it to log "now" (today).
  async function logManualMinutes(taskId: string, minutes: number, day?: string) {
    if (!user || minutes <= 0) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const end = day && day !== today ? new Date(`${day}T12:00:00`) : new Date();
    const start = new Date(end.getTime() - minutes * 60_000);
    setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, actual_minutes: (t.actual_minutes ?? 0) + minutes } : t)));
    try {
      await updateTask(taskId, { actual_minutes: (task.actual_minutes ?? 0) + minutes });
      const created = await createTimeSessions(user.id, [{ task_id: taskId, started_at: start.toISOString(), ended_at: end.toISOString(), minutes }]);
      setSessions(prev => [...prev, ...created]);
    } catch (e) { setError((e as Error)?.message ?? 'Could not log time.'); }
  }

  // Record a time block's planned time as actually worked — the "I scheduled
  // this block and did it" shortcut, so it lands in the Logbook & Stats without
  // a timer. A timed block's range is split across its to-dos as back-to-back
  // sessions; an untimed block logs each to-do's estimate. To-dos already
  // tracked that day are skipped so re-tapping can't double-count.
  async function logBlockWorked(block: PlannerTimeBlock, blockTasks: PlannerTask[]) {
    if (!user) return;
    const already = new Set(sessions.filter(s => localDay(s.started_at) === block.day).map(s => s.task_id));
    const targets = blockTasks.filter(t => t.kind === 'task' && !already.has(t.id));
    if (!targets.length) return;
    const base = new Date(`${block.day}T00:00:00`);
    const rows: { task_id: string; started_at: string; ended_at: string; minutes: number }[] = [];
    const bump: Record<string, number> = {};
    if (block.start_minute != null && block.end_minute != null && block.end_minute > block.start_minute) {
      const per = Math.floor((block.end_minute - block.start_minute) / targets.length);
      let cursor = block.start_minute;
      targets.forEach((t, i) => {
        const mins = i === targets.length - 1 ? block.end_minute! - cursor : per;
        if (mins <= 0) return;
        const s = new Date(base); s.setMinutes(cursor);
        const e = new Date(base); e.setMinutes(cursor + mins);
        rows.push({ task_id: t.id, started_at: s.toISOString(), ended_at: e.toISOString(), minutes: mins });
        bump[t.id] = mins; cursor += mins;
      });
    } else {
      targets.forEach(t => {
        const mins = t.estimate_minutes ?? 0;
        if (mins <= 0) return;
        const e = new Date(base); e.setHours(12, 0, 0, 0);
        const s = new Date(e.getTime() - mins * 60_000);
        rows.push({ task_id: t.id, started_at: s.toISOString(), ended_at: e.toISOString(), minutes: mins });
        bump[t.id] = mins;
      });
    }
    if (!rows.length) return;
    setTasks(prev => prev.map(t => (bump[t.id] ? { ...t, actual_minutes: (t.actual_minutes ?? 0) + bump[t.id] } : t)));
    try {
      await Promise.all(Object.entries(bump).map(([id, m]) => {
        const t = tasks.find(x => x.id === id);
        return t ? updateTask(id, { actual_minutes: (t.actual_minutes ?? 0) + m }) : Promise.resolve();
      }));
      const created = await createTimeSessions(user.id, rows, 'block');
      setSessions(prev => [...prev, ...created]);
    } catch (e) { setError((e as Error)?.message ?? 'Could not log the block.'); }
  }

  // Undo a mistakenly-logged timer run from the Logbook: drops the session and
  // takes its minutes back off the to-do's running total, so Stats and the to-do
  // both reconcile as if it never happened.
  async function deleteSession(sessionId: string) {
    if (!user) return;
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setTasks(prev => prev.map(t =>
      t.id === session.task_id
        ? { ...t, actual_minutes: Math.max(0, (t.actual_minutes ?? 0) - session.minutes) }
        : t));
    try {
      await deleteTimeSession(sessionId);
      const task = tasks.find(t => t.id === session.task_id);
      if (task) await updateTask(task.id, { actual_minutes: Math.max(0, (task.actual_minutes ?? 0) - session.minutes) });
    } catch (e) { setError((e as Error)?.message ?? 'Could not remove that session.'); }
  }

  // Resolve a past timed block that still has open to-dos: for each open to-do
  // you say whether you WORKED on it. Worked to-dos (plus any already checked
  // off) share the block's time evenly — so saying "didn't" on one hands its
  // share to the rest, matching how the block would've split if it were never
  // there. "Worked" to-dos stay OPEN and carry forward to today to finish;
  // "didn't" ones just drop back to today's loose list. Either way the block is
  // done being counted, so its links are cleared.
  async function resolveBlockReview(blockId: string, worked: Record<string, boolean>) {
    if (!user) return;
    const block = blocks.find(b => b.id === blockId);
    if (!block || block.start_minute == null || block.end_minute == null || block.end_minute <= block.start_minute) return;
    const dur = block.end_minute - block.start_minute;
    const blockTasks = tasks.filter(t => t.kind === 'task' && t.block_id === blockId)
      .sort((a, b) => (a.sort_order - b.sort_order) || a.created_at.localeCompare(b.created_at));
    if (!blockTasks.length) return;

    // Who the block's time is split across: everything checked off, plus the
    // open to-dos you marked as worked.
    const counted = blockTasks.filter(t => t.done || worked[t.id]);
    const n = counted.length;
    const per = n > 0 ? Math.floor(dur / n) : 0;
    const base = new Date(block.day + 'T00:00:00');

    // Wipe this block's existing derived sessions for the day and re-create them
    // fresh at the new split — the simplest way to redistribute correctly.
    const dayBlockSessions = sessions.filter(s =>
      s.source === 'block' && localDay(s.started_at) === block.day && blockTasks.some(t => t.id === s.task_id));
    const bump: Record<string, number> = {};
    for (const s of dayBlockSessions) bump[s.task_id] = (bump[s.task_id] ?? 0) - s.minutes;
    const rows: { task_id: string; started_at: string; ended_at: string; minutes: number }[] = [];
    counted.forEach((t, i) => {
      const mins = i === n - 1 ? dur - per * (n - 1) : per;
      if (mins <= 0) return;
      const s = new Date(base); s.setMinutes(block.start_minute! + i * per);
      const e = new Date(s.getTime() + mins * 60_000);
      rows.push({ task_id: t.id, started_at: s.toISOString(), ended_at: e.toISOString(), minutes: mins });
      bump[t.id] = (bump[t.id] ?? 0) + mins;
    });

    const openIds = new Set(blockTasks.filter(t => !t.done).map(t => t.id));
    const removeIds = new Set(dayBlockSessions.map(s => s.id));
    // Optimistic: clear block links, carry open to-dos to today, adjust totals.
    setTasks(prev => prev.map(t => (blockTasks.some(bt => bt.id === t.id)
      ? { ...t, actual_minutes: Math.max(0, (t.actual_minutes ?? 0) + (bump[t.id] ?? 0)), block_id: null, due_date: openIds.has(t.id) ? today : t.due_date }
      : t)));
    setSessions(prev => prev.filter(s => !removeIds.has(s.id)));

    try {
      await Promise.all([...removeIds].map(id => deleteTimeSession(id)));
      if (rows.length) {
        const created = await createTimeSessions(user.id, rows, 'block');
        setSessions(prev => [...prev, ...created]);
      }
      await Promise.all(blockTasks.map(t => updateTask(t.id, {
        actual_minutes: Math.max(0, (t.actual_minutes ?? 0) + (bump[t.id] ?? 0)),
        block_id: null,
        ...(openIds.has(t.id) ? { due_date: today } : {}),
      })));
    } catch (e) { setError((e as Error)?.message ?? 'Could not save the block review.'); }
  }

  // ---- Weekly Reset ----

  // Persist a reflective field (optimistic), keyed to the viewed week.
  async function saveReflective(patch: Partial<Pick<WeeklyReset, 'wins' | 'not_done' | 'drained' | 'feel_more'>>) {
    if (!user) return;
    const week = resetWeek;
    setWeeklyReset(prev => ({
      user_id: user.id, week_start: week, wins: '', not_done: '', drained: '', feel_more: '',
      created_at: prev?.created_at ?? '', ...(prev ?? {}), ...patch, updated_at: new Date().toISOString(),
    }));
    try { const r = await upsertWeeklyReset(user.id, week, patch); setWeeklyReset(cur => (cur && cur.week_start === week ? r : cur)); }
    catch (e) { setError((e as Error)?.message ?? 'Could not save your weekly reset.'); }
  }

  // Turn the approved brain dump into to-dos. Each item's in-app tags decide
  // its section + attributes: Priority → flagged Important; Quick → 15-min
  // estimate; Feel-good → its own group; otherwise plain brain dump. Items are
  // grouped under section headings in a per-week home list. Returns the count.
  async function createResetTasks(rawDraft: ResetTranscription): Promise<number> {
    if (!user) return 0;
    const items = dedupeResetDraft(rawDraft).items.filter(i => i.text.trim());
    if (!items.length) return 0;

    const SECTION_ORDER: { key: ResetSection; label: string }[] = [
      { key: 'meetings', label: 'Meetings' },
      { key: 'priorities', label: 'Priorities' },
      { key: 'quick', label: 'Quick tasks' },
      { key: 'feel_good', label: 'What would feel good' },
      { key: 'brain_dump', label: 'Brain dump' },
    ];
    const bySection: Record<string, ResetDraftItem[]> = {};
    for (const it of items) (bySection[resetSectionFor(it)] ??= []).push(it);
    const groups = SECTION_ORDER.filter(s => bySection[s.key]?.length);

    // Give the week its own home list ("Weekly Reset · Jun 30"), reusing it if it
    // already exists so a second approval appends rather than making a new one.
    const listTitle = `Weekly Reset · ${new Date(resetWeek + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    let list = notes.find(n => !n.archived && n.title.trim() === listTitle);
    let createdNote: PlannerNote | null = null;
    if (!list) { list = await createNote(user.id, listTitle); createdNote = list; }
    const listId = list.id;

    // Append after anything already in the list; don't repeat a section heading.
    const inList = tasks.filter(t => t.note_id === listId);
    let sort = inList.reduce((m, t) => Math.max(m, t.sort_order), -1) + 1;
    const headings = new Set(inList.filter(t => t.kind === 'heading').map(t => t.title.trim()));

    const created: PlannerTask[] = [];
    for (const g of groups) {
      if (!headings.has(g.label)) {
        created.push(await createTask(user.id, { title: g.label, note_id: listId, kind: 'heading', sort_order: sort++ }));
      }
      for (const it of bySection[g.key]) {
        created.push(await createTask(user.id, {
          title: it.text.trim(), note_id: listId, kind: 'task', sort_order: sort++,
          due_date: it.date ?? null, reset_week: resetWeek, reset_section: g.key,
          flagged: !!it.priority,
          feel_good: !!it.feel_good,
          estimate_minutes: it.quick ? QUICK_TASK_MINUTES : (it.estimate_minutes ?? null),
        }));
      }
    }
    if (createdNote) setNotes(prev => [createdNote as PlannerNote, ...prev]);
    setTasks(prev => [...prev, ...created]);

    // Put the journal answers on the list itself (its notes), so the list is a
    // complete record: reflections at the top, tasks underneath. Snapshotted at
    // approval; refreshed if you approve again.
    const journal = ([
      ['Wins from last week', rawDraft.wins],
      ['What I didn’t do last week', rawDraft.not_done],
      ['What drained my time', rawDraft.drained],
      ['What I want to feel more of', rawDraft.feel_more],
    ] as [string, string][])
      .filter(([, v]) => (v ?? '').trim())
      .map(([label, v]) => `${label}:\n${v.trim()}`)
      .join('\n\n');
    if (journal) {
      setNotes(prev => prev.map(n => (n.id === listId ? { ...n, body: journal } : n)));
      updateNote(listId, { body: journal }).catch(() => { /* best effort */ });
    }

    return created.filter(t => t.kind === 'task').length;
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
    onUpdateCapacity: updateCapacity,
    onToggleCarryOver: updateCarryOver,
    onLogTime: logManualMinutes,
    onLogBlockWorked: logBlockWorked,
    onResolveBlockReview: resolveBlockReview,
  };

  // Pick a view and dismiss the mobile rail in one go.
  function choose(sel: Selection) { setSelection(sel); setRailOpen(false); }
  // Open a specific day in My Day (from the Plan grid).
  function openDay(iso: string) { setDayJump(d => ({ iso, n: d.n + 1 })); choose({ kind: 'myday' }); }
  // Open a specific day in the Logbook (from a Stats bar), scrolled to that day.
  function openReview(iso: string) { setReviewJump(d => ({ iso, n: d.n + 1 })); choose({ kind: 'logbook' }); }
  // Open a to-do where it lives: its list, its day, else Inbox (open) / Logbook (done).
  function openTask(t: PlannerTask) {
    if (t.note_id) choose({ kind: 'note', id: t.note_id });
    else if (t.due_date) openDay(t.due_date);
    else if (t.done) choose({ kind: 'logbook' });
    else choose({ kind: 'inbox' });
  }

  const selectedNote = selection.kind === 'note' ? notesById[selection.id] : undefined;

  return (
    <div className="flex h-full min-h-0 relative">
      {/* Backdrop behind the mobile slide-over rail */}
      {railOpen && <div className="md:hidden fixed inset-0 bg-black/30 z-40" onClick={() => setRailOpen(false)} />}

      {/* Left rail: smart views + lists. Static from md up; a slide-over on
          mobile so the day/list has full width for adding to-dos. */}
      <aside
        className={`w-64 shrink-0 border-r border-edge bg-surface-hover flex-col overflow-y-auto nice-scrollbar
          md:static md:flex md:bg-surface-hover/60
          ${railOpen ? 'fixed inset-y-0 left-0 z-50 flex shadow-2xl' : 'hidden md:flex'}`}
      >
        <div className="md:hidden flex justify-end p-2">
          <button onClick={() => setRailOpen(false)} className="p-1.5 rounded-control text-content-muted hover:bg-edge" title="Close menu">
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="p-3 space-y-1">
          <button
            onClick={() => choose({ kind: 'myday' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-control text-sm transition-colors ${
              selection.kind === 'myday' ? 'bg-surface shadow-sm text-content font-medium' : 'text-content-secondary hover:bg-surface/70'
            }`}
          >
            <Sun className="w-4 h-4 text-amber-500" />
            <span className="flex-1 text-left">My Day</span>
            {viewCounts.today > 0 && <span className="text-xs text-content-muted font-medium">{viewCounts.today}</span>}
          </button>
          {orbitEnabled && (
            <button
              onClick={() => choose({ kind: 'orbit' })}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-control text-sm transition-colors ${
                selection.kind === 'orbit' ? 'bg-surface shadow-sm text-content font-medium' : 'text-content-secondary hover:bg-surface/70'
              }`}
            >
              <OrbitIcon className="w-4 h-4 text-brand-500" />
              <span className="flex-1 text-left">Orbit</span>
              {orbitCount > 0 && <span className="text-xs text-content-muted font-medium">{orbitCount}</span>}
            </button>
          )}
          <button
            onClick={() => choose({ kind: 'inbox' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-control text-sm transition-colors ${
              selection.kind === 'inbox' ? 'bg-surface shadow-sm text-content font-medium' : 'text-content-secondary hover:bg-surface/70'
            }`}
          >
            <Inbox className="w-4 h-4 text-content-muted" />
            <span className="flex-1 text-left">Inbox</span>
            {inboxCount > 0 && <span className="text-xs text-content-muted font-medium">{inboxCount}</span>}
          </button>
          {VIEWS.map(v => {
            const Icon = v.icon;
            const active = selection.kind === 'view' && selection.bucket === v.bucket;
            const count = viewCounts[v.bucket];
            return (
              <button
                key={v.bucket}
                onClick={() => choose({ kind: 'view', bucket: v.bucket })}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-control text-sm transition-colors ${
                  active ? 'bg-surface shadow-sm text-content font-medium' : 'text-content-secondary hover:bg-surface/70'
                }`}
              >
                <Icon className={`w-4 h-4 ${v.color}`} />
                <span className="flex-1 text-left">{v.label}</span>
                {count > 0 && <span className="text-xs text-content-muted font-medium">{count}</span>}
              </button>
            );
          })}
          <button
            onClick={() => choose({ kind: 'plan' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-control text-sm transition-colors ${
              selection.kind === 'plan' ? 'bg-surface shadow-sm text-content font-medium' : 'text-content-secondary hover:bg-surface/70'
            }`}
          >
            <CalendarRange className="w-4 h-4 text-brand-500" />
            <span className="flex-1 text-left">Planning</span>
          </button>
          <button
            onClick={() => choose({ kind: 'reset' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-control text-sm transition-colors ${
              selection.kind === 'reset' ? 'bg-surface shadow-sm text-content font-medium' : 'text-content-secondary hover:bg-surface/70'
            }`}
          >
            <RotateCcw className="w-4 h-4 text-brand-500" />
            <span className="flex-1 text-left">Weekly Reset</span>
          </button>
          <button
            onClick={() => choose({ kind: 'logbook' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-control text-sm transition-colors ${
              selection.kind === 'logbook' ? 'bg-surface shadow-sm text-content font-medium' : 'text-content-secondary hover:bg-surface/70'
            }`}
          >
            <BookCheck className="w-4 h-4 text-emerald-500" />
            <span className="flex-1 text-left">Logbook</span>
          </button>
          <button
            onClick={() => choose({ kind: 'projects' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-control text-sm transition-colors ${
              selection.kind === 'projects' ? 'bg-surface shadow-sm text-content font-medium' : 'text-content-secondary hover:bg-surface/70'
            }`}
          >
            <LayoutGrid className="w-4 h-4 text-brand-500" />
            <span className="flex-1 text-left">Projects</span>
          </button>
          <button
            onClick={() => choose({ kind: 'stats' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-control text-sm transition-colors ${
              selection.kind === 'stats' ? 'bg-surface shadow-sm text-content font-medium' : 'text-content-secondary hover:bg-surface/70'
            }`}
          >
            <BarChart3 className="w-4 h-4 text-brand-500" />
            <span className="flex-1 text-left">Stats</span>
          </button>
          <button
            onClick={() => choose({ kind: 'settings' })}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-control text-sm transition-colors ${
              selection.kind === 'settings' ? 'bg-surface shadow-sm text-content font-medium' : 'text-content-secondary hover:bg-surface/70'
            }`}
          >
            <SettingsIcon className="w-4 h-4 text-content-muted" />
            <span className="flex-1 text-left">Settings</span>
          </button>
        </nav>

        {penNames.length > 0 && (
          <div className="px-3 pt-1 pb-2 border-b border-edge/70">
            <PenFilterSwitcher
              penNames={penNames}
              value={penFilter}
              onChange={setPenFilter}
            />
          </div>
        )}

        <div className="px-4 pt-3 pb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">Lists</span>
          <div className="flex items-center gap-1">
            {railNotes.length > 1 && (
              <button onClick={sortNotesAZ} className="text-content-muted hover:text-brand-600" title="Sort lists A–Z">
                <ArrowDownAZ className="w-4 h-4" />
              </button>
            )}
            <button onClick={handleNewNote} className="text-content-muted hover:text-brand-600" title="New list">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
        <nav className="px-3 pb-4 space-y-1">
          {railNotes.length === 0 && (
            <p className="px-3 py-2 text-xs text-content-muted">
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
            <div className="mt-2 pt-2 border-t border-edge/70">
              <button
                onClick={() => setShowArchived(v => !v)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-muted hover:text-content-secondary"
              >
                {showArchived ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Archived ({archivedNotes.length})
              </button>
              {showArchived && (
                <div className="mt-0.5 space-y-0.5">
                  {archivedNotes.map(n => (
                    <div key={n.id} className="group/arch flex items-center gap-2 px-3 py-1.5 rounded-control text-sm text-content-secondary hover:bg-surface/70">
                      <Archive className="w-3.5 h-3.5 text-content-faint shrink-0" />
                      <span className="flex-1 truncate">{n.title.trim() || 'Untitled list'}</span>
                      <button onClick={() => saveNote(n.id, { archived: false })} className="text-content-faint hover:text-brand-600 shrink-0" title="Restore list">
                        <ArchiveRestore className="w-4 h-4" />
                      </button>
                      <button onClick={() => removeNote(n.id)} className="text-content-faint hover:text-rose-500 shrink-0" title="Delete list">
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
      {/* pb-24 keeps the last row clear of the floating Focus button / timer bar. */}
      <section className="flex-1 min-w-0 overflow-y-auto nice-scrollbar pb-24">
        {/* Mobile-only bar to reopen the planner rail */}
        <div className="md:hidden sticky top-0 z-10 flex items-center gap-2 bg-surface/85 backdrop-blur border-b border-edge-soft px-3 py-2">
          <button onClick={() => setRailOpen(true)} className="inline-flex items-center gap-2 text-sm font-medium text-content-secondary hover:text-brand-600">
            <Menu className="w-5 h-5" /> Menu
          </button>
        </div>
        {error && (
          <div className="m-4 flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-control px-3 py-2">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}
        {loading ? (
          <div className="p-8 text-content-muted">Loading your planner…</div>
        ) : selection.kind === 'myday' ? (
          <MyDayView
            tasks={scopedTasks}
            blocks={blocks}
            sessions={sessions}
            settings={settings ?? { user_id: user?.id ?? '', daily_capacity_minutes: DEFAULT_DAILY_CAPACITY, carry_over_capacity: false, auto_rollover: false, working_phase: null, phase_started_on: null, daily_goal_count: 3, orbit_enabled: false, created_at: '', updated_at: '' }}
            today={today}
            cal={{ gc, calVersion }}
            handlers={myDayHandlers}
            jumpTo={dayJump}
            notesById={notesById}
            lists={listsForViews}
            onOpenTask={openTask}
          />
        ) : selection.kind === 'plan' ? (
          <PlanView
            tasks={scopedTasks}
            blocks={blocks}
            settings={settings ?? { user_id: user?.id ?? '', daily_capacity_minutes: DEFAULT_DAILY_CAPACITY, carry_over_capacity: false, auto_rollover: false, working_phase: null, phase_started_on: null, daily_goal_count: 3, orbit_enabled: false, created_at: '', updated_at: '' }}
            notesById={notesById}
            today={today}
            onOpenDay={openDay}
            onOpenList={id => choose({ kind: 'note', id })}
            onPatch={patchTask}
          />
        ) : selection.kind === 'projects' ? (
          <ProjectsView notes={railNotes} tasks={scopedTasks} sessions={sessions} onOpenList={id => choose({ kind: 'note', id })} />
        ) : selection.kind === 'stats' ? (
          <StatsView tasks={scopedTasks} sessions={sessions} today={today} notesById={notesById} onOpenDay={openReview} onOpenTask={openTask} />
        ) : selection.kind === 'logbook' ? (
          <LogbookView
            tasks={scopedTasks}
            sessions={sessions}
            notesById={notesById}
            today={today}
            focus={reviewJump}
            onPatch={patchTask}
            onDelete={removeTask}
            onDeleteSession={deleteSession}
            onOpenList={id => choose({ kind: 'note', id })}
            onOpenDay={openDay}
          />
        ) : selection.kind === 'reset' ? (
          resetLoading ? (
            <div className="p-8 text-content-muted">Loading your weekly reset…</div>
          ) : (
            <WeeklyResetView
              key={resetWeek}
              weekStart={resetWeek}
              today={today}
              reset={weeklyReset}
              onPrevWeek={() => setResetWeek(w => addDaysISO(w, -7))}
              onNextWeek={() => setResetWeek(w => addDaysISO(w, 7))}
              onThisWeek={() => setResetWeek(weekStartISO(today))}
              onSaveReflective={saveReflective}
              onCreateTasks={createResetTasks}
              onFindDuplicates={runDedup}
              onEstimateDurations={runDurations}
            />
          )
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
            onLogTime={logManualMinutes}
            onOpenNote={id => setSelection({ kind: 'note', id })}
            cal={cal}
            blockedIds={blockedTaskIds}
            onEditDependencies={setDepEditId}
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
            onMergeInto={mergeList}
            onSortTasks={sortListTasks}
            onAdd={addTask}
            onCreate={createTaskReturning}
            onPatch={patchTask}
            onDelete={removeTask}
            onReorder={reorder}
            blockedIds={blockedTaskIds}
            onEditDependencies={setDepEditId}
          />
        ) : (
          <div className="p-8 text-content-muted">Select a note or view.</div>
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
        <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2">
          <button
            onClick={spin}
            className="inline-flex items-center justify-center w-11 h-11 bg-violet-600 hover:bg-violet-700 text-white rounded-full shadow-xl"
            title="Surprise me — pick a random to-do to work on"
          >
            <Dices className="w-5 h-5" />
          </button>
          <button
            onClick={() => setFocusOpen(true)}
            className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white rounded-full shadow-xl px-4 py-2.5 text-sm font-medium"
            title="Start a focus timer on any to-do"
          >
            <Target className="w-4 h-4" /> Focus
          </button>
        </div>
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

      {spinOpen && (
        <SurpriseModal
          task={spinTask}
          notesById={notesById}
          onSpinAgain={spin}
          onStart={() => { if (spinTask) patchTask(spinTask.id, { timer_started_at: new Date().toISOString() }); setSpinOpen(false); }}
          onToday={() => { if (spinTask) patchTask(spinTask.id, { due_date: today, someday: false }); setSpinOpen(false); }}
          onOpen={() => { if (spinTask) openTask(spinTask); setSpinOpen(false); }}
          onClose={() => setSpinOpen(false)}
        />
      )}

      {dedupOpen && (
        <DuplicateFinderModal
          loading={dedupLoading}
          error={dedupError}
          groups={dedupGroups}
          tasks={tasks}
          notesById={notesById}
          onMerge={mergeDuplicates}
          onRescan={runDedup}
          onClose={() => setDedupOpen(false)}
        />
      )}

      {durOpen && (
        <DurationSuggestModal
          loading={durLoading}
          error={durError}
          suggestions={durSuggestions}
          tasks={tasks}
          notesById={notesById}
          onApply={(id, minutes) => patchTask(id, { estimate_minutes: minutes })}
          onRescan={runDurations}
          onClose={() => setDurOpen(false)}
        />
      )}

      {depEditId && (() => {
        const t = tasks.find(x => x.id === depEditId);
        if (!t) return null;
        return (
          <DependencyModal
            task={t}
            tasks={tasks}
            notesById={notesById}
            deps={deps}
            onAdd={depId => addDependency(t.id, depId)}
            onRemove={removeDependency}
            onClose={() => setDepEditId(null)}
          />
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dependencies — set what a to-do is "blocked by" (and see what it "blocks").
// A to-do is blocked while any of its blockers is still open. Guards against
// self-links and the obvious A↔B cycle live in the parent handler.
// ---------------------------------------------------------------------------

function DependencyModal({
  task, tasks, notesById, deps, onAdd, onRemove, onClose,
}: {
  task: PlannerTask;
  tasks: PlannerTask[];
  notesById: Record<string, PlannerNote>;
  deps: PlannerTaskDependency[];
  onAdd: (dependsOnId: string) => void;
  onRemove: (depId: string) => void;
  onClose: () => void;
}) {
  const byId = useMemo(() => {
    const m: Record<string, PlannerTask> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);
  const [query, setQuery] = useState('');

  const blockers = deps.filter(d => d.task_id === task.id);       // this to-do is blocked by …
  const dependents = deps.filter(d => d.depends_on_id === task.id); // … which in turn block these
  const blockerIds = new Set(blockers.map(d => d.depends_on_id));
  const dependentIds = new Set(dependents.map(d => d.task_id));

  const listName = (t: PlannerTask) => (t.note_id ? (notesById[t.note_id]?.title.trim() || 'Untitled list') : 'No list');

  // Candidates to add as a blocker: any other open to-do not already linked
  // either way (which would create a cycle).
  const q = query.trim().toLowerCase();
  const candidates = tasks
    .filter(t => t.kind === 'task' && !t.done && t.id !== task.id && !blockerIds.has(t.id) && !dependentIds.has(t.id))
    .filter(t => !q || (t.title || '').toLowerCase().includes(q))
    .slice(0, 8);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-lg rounded-card border border-edge bg-surface shadow-2xl my-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-edge-soft">
          <Lock className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-bold text-content">Dependencies</h3>
          <button onClick={onClose} className="ml-auto text-content-muted hover:text-content" title="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-content break-words"><span className="text-content-muted">For:</span> <span className="font-medium">{task.title || 'Untitled'}</span></p>

          {/* Blocked by */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted mb-1.5">Blocked by</p>
            {blockers.length === 0 ? (
              <p className="text-xs text-content-muted mb-2">Nothing — this to-do isn’t waiting on anything.</p>
            ) : (
              <ul className="space-y-1 mb-2">
                {blockers.map(d => {
                  const b = byId[d.depends_on_id];
                  return (
                    <li key={d.id} className="flex items-center gap-2 rounded-control border border-edge px-2.5 py-1.5">
                      {b?.done
                        ? <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        : <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-content break-words">{b?.title || 'Untitled'}</span>
                        <span className="block text-[11px] text-content-muted">{b ? listName(b) : ''}{b?.done ? ' · done (not blocking)' : ''}</span>
                      </span>
                      <button onClick={() => onRemove(d.id)} className="text-content-faint hover:text-rose-500 shrink-0" title="Remove blocker"><X className="w-3.5 h-3.5" /></button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex items-center gap-2 bg-surface-sunken/60 border border-edge rounded-control px-2.5 py-1.5">
              <Search className="w-3.5 h-3.5 text-content-muted shrink-0" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Add a blocker — search your to-dos…"
                className="flex-1 min-w-0 text-sm bg-transparent outline-none placeholder:text-content-muted text-content"
              />
            </div>
            {query.trim() && (
              <ul className="mt-1 rounded-control border border-edge divide-y divide-edge-soft overflow-hidden">
                {candidates.length === 0 ? (
                  <li className="px-2.5 py-2 text-xs text-content-muted">No matching open to-dos.</li>
                ) : candidates.map(c => (
                  <li key={c.id}>
                    <button onClick={() => { onAdd(c.id); setQuery(''); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-hover">
                      <Plus className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-content break-words">{c.title || 'Untitled'}</span>
                        <span className="block text-[11px] text-content-muted">{listName(c)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Blocking (read-only-ish: this to-do is a blocker for these) */}
          {dependents.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted mb-1.5">This blocks</p>
              <ul className="space-y-1">
                {dependents.map(d => {
                  const dep = byId[d.task_id];
                  return (
                    <li key={d.id} className="flex items-center gap-2 rounded-control border border-edge px-2.5 py-1.5">
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-content break-words">{dep?.title || 'Untitled'}</span>
                        <span className="block text-[11px] text-content-muted">{dep ? listName(dep) : ''}</span>
                      </span>
                      <button onClick={() => onRemove(d.id)} className="text-content-faint hover:text-rose-500 shrink-0" title="Remove"><X className="w-3.5 h-3.5" /></button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI duration suggestions — proposes a time estimate for each to-do that has
// none. Apply one (or all) to set its estimate so the capacity bar and planning
// have real numbers. You can nudge a value before applying.
// ---------------------------------------------------------------------------

function DurationSuggestModal({
  loading, error, suggestions, tasks, notesById, onApply, onRescan, onClose,
}: {
  loading: boolean;
  error: string | null;
  suggestions: DurationSuggestion[] | null;
  tasks: PlannerTask[];
  notesById: Record<string, PlannerNote>;
  onApply: (id: string, minutes: number) => void;
  onRescan: () => void;
  onClose: () => void;
}) {
  const byId = useMemo(() => {
    const m: Record<string, PlannerTask> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);
  // Local, editable copy so you can tweak a number before applying, and rows
  // disappear as they're applied.
  const [rows, setRows] = useState<DurationSuggestion[]>([]);
  useEffect(() => { setRows(suggestions ?? []); }, [suggestions]);

  function applyOne(r: DurationSuggestion) {
    onApply(r.id, r.minutes);
    setRows(prev => prev.filter(x => x.id !== r.id));
  }
  function applyAll() {
    rows.forEach(r => onApply(r.id, r.minutes));
    setRows([]);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-lg rounded-card border border-edge bg-surface shadow-2xl my-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-edge-soft">
          <Sparkles className="w-4 h-4 text-violet-500" />
          <h3 className="text-sm font-bold text-content">Estimate durations</h3>
          {rows.length > 0 && (
            <button onClick={applyAll} className="ml-auto text-xs font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 rounded-control px-2.5 py-1">Apply all</button>
          )}
          <button onClick={onClose} className={`text-content-muted hover:text-content ${rows.length > 0 ? 'ml-2' : 'ml-auto'}`} title="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-sm text-content-muted">
              <Loader2 className="w-4 h-4 animate-spin" /> Estimating how long your to-dos will take…
            </div>
          ) : error ? (
            <div className="py-6 text-center">
              <p className="text-sm text-rose-600 mb-3">{error}</p>
              <button onClick={onRescan} className="text-sm font-medium text-brand-600 hover:text-brand-700">Try again</button>
            </div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-content-muted">
              {suggestions === null ? 'Nothing to estimate.' : 'Every to-do already has an estimate. 🎉'}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {rows.map(r => {
                const t = byId[r.id];
                if (!t) return null;
                const list = t.note_id ? (notesById[t.note_id]?.title.trim() || 'Untitled list') : 'No list';
                return (
                  <li key={r.id} className="flex items-center gap-2 rounded-control border border-edge px-2.5 py-2">
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-content break-words">{t.title || 'Untitled'}</span>
                      <span className="block text-[11px] text-content-muted truncate">{list}{r.reason && <> · {r.reason}</>}</span>
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={5}
                      value={r.minutes}
                      onChange={e => { const v = Math.max(0, Math.round(Number(e.target.value) || 0)); setRows(prev => prev.map(x => (x.id === r.id ? { ...x, minutes: v } : x))); }}
                      className="w-16 shrink-0 text-sm text-right rounded-control border border-edge bg-surface px-1.5 py-1 text-content"
                    />
                    <span className="text-xs text-content-muted shrink-0">min</span>
                    <button onClick={() => applyOne(r)} className="shrink-0 text-xs font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 rounded-control px-2.5 py-1.5" title="Set this estimate">Set</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI duplicate-finder — shows the groups Claude flagged as the same to-do.
// For each group you pick which one to keep; merging folds the others' tags,
// estimate, and due date into the keeper and deletes them. "Not duplicates"
// dismisses a group untouched.
// ---------------------------------------------------------------------------

function DuplicateFinderModal({
  loading, error, groups, tasks, notesById, onMerge, onRescan, onClose,
}: {
  loading: boolean;
  error: string | null;
  groups: DuplicateGroup[] | null;
  tasks: PlannerTask[];
  notesById: Record<string, PlannerNote>;
  onMerge: (survivorId: string, otherIds: string[]) => void;
  onRescan: () => void;
  onClose: () => void;
}) {
  const byId = useMemo(() => {
    const m: Record<string, PlannerTask> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);
  const [remaining, setRemaining] = useState<DuplicateGroup[]>([]);
  const [survivors, setSurvivors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!groups) { setRemaining([]); return; }
    setRemaining(groups);
    setSurvivors(Object.fromEntries(groups.map(g => [g.ids.join('|'), g.ids[0]])));
  }, [groups]);

  function keyOf(g: DuplicateGroup) { return g.ids.join('|'); }
  function drop(g: DuplicateGroup) { setRemaining(prev => prev.filter(x => keyOf(x) !== keyOf(g))); }
  function merge(g: DuplicateGroup) {
    const survivorId = survivors[keyOf(g)] ?? g.ids[0];
    onMerge(survivorId, g.ids.filter(id => id !== survivorId));
    drop(g);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-lg rounded-card border border-edge bg-surface shadow-2xl my-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-edge-soft">
          <Sparkles className="w-4 h-4 text-violet-500" />
          <h3 className="text-sm font-bold text-content">Find duplicates</h3>
          <button onClick={onClose} className="ml-auto text-content-muted hover:text-content" title="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-sm text-content-muted">
              <Loader2 className="w-4 h-4 animate-spin" /> Scanning your to-dos for duplicates…
            </div>
          ) : error ? (
            <div className="py-6 text-center">
              <p className="text-sm text-rose-600 mb-3">{error}</p>
              <button onClick={onRescan} className="text-sm font-medium text-brand-600 hover:text-brand-700">Try again</button>
            </div>
          ) : remaining.length === 0 ? (
            <div className="py-8 text-center text-sm text-content-muted">
              {groups === null ? 'Nothing to review.' : 'No duplicates found — your to-dos are tidy. 🎉'}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-content-muted">Pick which to keep in each set; merging folds the others’ tags, estimate, and due date into it and deletes them.</p>
              {remaining.map(g => (
                <div key={keyOf(g)} className="rounded-card border border-edge bg-surface-hover/40 p-3">
                  {g.reason && <p className="text-[11px] font-medium uppercase tracking-wide text-content-muted mb-2">{g.reason}</p>}
                  <div className="space-y-1.5">
                    {g.ids.map(id => {
                      const t = byId[id];
                      if (!t) return null;
                      const list = t.note_id ? (notesById[t.note_id]?.title.trim() || 'Untitled list') : 'No list';
                      const chosen = (survivors[keyOf(g)] ?? g.ids[0]) === id;
                      return (
                        <button
                          key={id}
                          onClick={() => setSurvivors(prev => ({ ...prev, [keyOf(g)]: id }))}
                          className={`w-full flex items-start gap-2 text-left rounded-control px-2 py-1.5 border transition-colors ${chosen ? 'border-brand-400 bg-brand-50/50' : 'border-edge hover:bg-surface-sunken'}`}
                        >
                          <span className={`mt-0.5 shrink-0 w-3.5 h-3.5 rounded-full border ${chosen ? 'border-brand-500 bg-brand-500' : 'border-content-faint'}`} />
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm text-content break-words">{t.title || 'Untitled'}</span>
                            <span className="flex items-center gap-1.5 mt-0.5 text-[11px] text-content-muted">
                              <span className="truncate max-w-[10rem]">{list}</span>
                              {t.flagged && <Star className="w-3 h-3 text-amber-400" fill="currentColor" />}
                              {t.estimate_minutes === QUICK_TASK_MINUTES && <Zap className="w-3 h-3 text-teal-500" fill="currentColor" />}
                              {t.feel_good && <Heart className="w-3 h-3 text-rose-400" fill="currentColor" />}
                              {t.due_date && <span>· {formatDue(t.due_date)}</span>}
                            </span>
                          </span>
                          {chosen && <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-600 shrink-0">Keep</span>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2 mt-2.5">
                    <button onClick={() => merge(g)} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 rounded-control px-3 py-1.5">
                      <GitMerge className="w-3.5 h-3.5" /> Merge {g.ids.length} into 1
                    </button>
                    <button onClick={() => drop(g)} className="text-sm font-medium text-content-muted hover:text-content">Not duplicates</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Surprise me — rolls a random open to-do to break decision paralysis. From the
// pick you can start a focus timer, pull it onto today, open it, or roll again.
// ---------------------------------------------------------------------------

function SurpriseModal({
  task, notesById, onSpinAgain, onStart, onToday, onOpen, onClose,
}: {
  task: PlannerTask | null;
  notesById: Record<string, PlannerNote>;
  onSpinAgain: () => void;
  onStart: () => void;
  onToday: () => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const list = task?.note_id ? (notesById[task.note_id]?.title.trim() || 'Untitled list') : 'No list';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-card border border-edge bg-surface shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-edge-soft">
          <Dices className="w-4 h-4 text-violet-500" />
          <h3 className="text-sm font-bold text-content">Surprise me</h3>
          <button onClick={onClose} className="ml-auto text-content-muted hover:text-content" title="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5">
          {!task ? (
            <p className="py-6 text-center text-sm text-content-muted">Nothing to pick — every to-do is done or parked in Someday. 🎉</p>
          ) : (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted mb-1">Why not…</p>
              <p className="text-lg font-semibold text-content break-words">{task.title || 'Untitled'}</p>
              <p className="mt-1 flex items-center gap-2 text-xs text-content-muted">
                <span className="truncate">{list}</span>
                {task.flagged && <Star className="w-3 h-3 text-amber-400" fill="currentColor" />}
                {task.feel_good && <Heart className="w-3 h-3 text-rose-400" fill="currentColor" />}
                {task.estimate_minutes ? <span>· {formatMinutes(task.estimate_minutes)}</span> : null}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button onClick={onStart} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 rounded-control px-3 py-1.5">
                  <Play className="w-3.5 h-3.5" /> Start
                </button>
                <button onClick={onToday} className="inline-flex items-center gap-1.5 text-sm font-medium text-content-secondary border border-edge hover:bg-surface-sunken rounded-control px-3 py-1.5">
                  <CalendarPlus className="w-3.5 h-3.5" /> Do today
                </button>
                <button onClick={onOpen} className="text-sm font-medium text-content-secondary hover:text-content px-2 py-1.5">Open</button>
                <button onClick={onSpinAgain} className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-700 px-2 py-1.5">
                  <Dices className="w-3.5 h-3.5" /> Roll again
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk select — a shared hook + a selectable row + an action bar, used by the
// smart views and the list editor to move / schedule / flag / complete /
// delete (and, in a list, group under a new heading) many to-dos at once.
// ---------------------------------------------------------------------------

function useSelection() {
  const [selectMode, setSelectMode] = useState(false);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clear = () => setSel(new Set());
  const exit = () => { setSel(new Set()); setSelectMode(false); };
  const selectAll = (ids: string[]) => setSel(prev => (prev.size >= ids.length && ids.every(i => prev.has(i)) ? new Set() : new Set(ids)));
  return { selectMode, setSelectMode, sel, toggle, clear, exit, selectAll };
}

function SelectableRow({ task, selected, onToggle, listName }: {
  task: PlannerTask; selected: boolean; onToggle: () => void; listName?: string;
}) {
  return (
    <li>
      <button
        onClick={onToggle}
        className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-control text-left transition-colors ${selected ? 'bg-brand-50' : 'hover:bg-surface-hover'}`}
      >
        <span className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center ${selected ? 'bg-brand-600 border-brand-600 text-brand-fg' : 'border-edge-strong bg-surface'}`}>
          {selected && <Check className="w-3 h-3" />}
        </span>
        <span className={`flex-1 min-w-0 text-sm break-words ${task.done ? 'text-content-muted line-through' : 'text-content'}`}>{task.title || 'Untitled'}</span>
        {task.flagged && <Star className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" fill="currentColor" />}
        {listName && <span className="text-[11px] text-content-faint shrink-0 mt-0.5 truncate max-w-[8rem]">{listName}</span>}
      </button>
    </li>
  );
}

function BulkBar({
  count, allSelected, today, lists, currentListId, onSelectAll, onExit,
  onMove, onSchedule, onFlag, onDone, onDelete, onNewHeading,
}: {
  count: number;
  allSelected: boolean;
  today: string;
  lists: PlannerNote[];
  currentListId?: string;
  onSelectAll: () => void;
  onExit: () => void;
  onMove: (noteId: string | null) => void;
  onSchedule: (patch: Partial<PlannerTask>) => void;
  onFlag: (flagged: boolean) => void;
  onDone: (done: boolean) => void;
  onDelete: () => void;
  onNewHeading?: () => void;
}) {
  const none = count === 0;
  const btn = 'text-xs font-medium border border-edge rounded-control px-2 py-1 bg-surface text-content-secondary hover:text-brand-700 disabled:opacity-40';
  return (
    <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-1.5 rounded-card border border-brand-200 bg-brand-50/95 backdrop-blur px-3 py-2">
      <span className="text-sm font-semibold text-content">{count} selected</span>
      <button onClick={onSelectAll} className="text-xs font-medium text-brand-700 hover:underline">{allSelected ? 'Clear' : 'Select all'}</button>
      <span className="w-px h-5 bg-brand-200 mx-1" />
      <select
        value=""
        disabled={none}
        onChange={e => { const v = e.target.value; if (v) onMove(v === '__inbox' ? null : v); e.currentTarget.value = ''; }}
        className={btn}
        title="Move to a list"
      >
        <option value="">Move to…</option>
        <option value="__inbox">Inbox (no list)</option>
        {lists.filter(l => l.id !== currentListId).map(l => <option key={l.id} value={l.id}>{l.title.trim() || 'Untitled list'}</option>)}
      </select>
      {onNewHeading && <button onClick={onNewHeading} disabled={none} className={btn}>Under new heading</button>}
      <button onClick={() => onSchedule({ due_date: today, someday: false })} disabled={none} className={btn}>Today</button>
      <input
        type="date"
        disabled={none}
        onChange={e => { if (e.target.value) onSchedule({ due_date: e.target.value, someday: false }); }}
        className={`${btn} px-1.5`}
        title="Schedule on a date"
      />
      <button onClick={() => onSchedule({ due_date: null, someday: false })} disabled={none} className={btn}>Anytime</button>
      <button onClick={() => onFlag(true)} disabled={none} className={btn}>Flag</button>
      <button onClick={() => onFlag(false)} disabled={none} className={btn}>Unflag</button>
      <button onClick={() => onDone(true)} disabled={none} className={btn}>Mark done</button>
      <button onClick={() => onDone(false)} disabled={none} className={btn}>Reopen</button>
      <button onClick={onDelete} disabled={none} className="text-xs font-medium border border-rose-200 rounded-control px-2 py-1 bg-surface text-rose-600 hover:bg-rose-50 disabled:opacity-40">Delete</button>
      <button onClick={onExit} className="ml-auto text-xs font-medium text-content-secondary hover:text-content">Done</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Smart views
// ---------------------------------------------------------------------------

function ViewPane({
  bucket, inbox = false, orbit = false, orbitEnabled = false, settings = null, tasks, today, notesById, lists, onAdd, onPatch, onDelete, onLogTime, onOpenNote, cal, blockedIds, onEditDependencies,
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
  onLogTime: (taskId: string, minutes: number, day: string) => void;
  onOpenNote: (id: string) => void;
  cal: CalendarBridge;
  blockedIds: Set<string>;
  onEditDependencies: (id: string) => void;
}) {
  const meta = orbit
    ? { label: 'Orbit', icon: OrbitIcon, color: 'text-brand-500' }
    : inbox
      ? { label: 'Inbox', icon: Inbox, color: 'text-content-secondary' }
      : VIEWS.find(v => v.bucket === bucket)!;
  const Icon = meta.icon;
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const { selectMode, setSelectMode, sel, toggle, clear, exit, selectAll } = useSelection();
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
          // Scheduled to-dos first (soonest date first); everything undated
          // after, in alphabetical order.
          .sort((a, b) => {
            if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
            if (a.due_date) return -1;
            if (b.due_date) return 1;
            return (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
          })
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
        onLogTime={(m, d) => onLogTime(t.id, m, d)}
        showTimer canFlag canSomeday orbitEnabled={orbitEnabled}
        enableRecurrence enableChecklist
        calConnected={gc.connected}
        onTimeBlock={time => onTimeBlock(t, time)}
        onUnblock={() => onUnblock(t)}
        blocked={blockedIds.has(t.id)}
        onEditDependencies={() => onEditDependencies(t.id)} />
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

  // Live title filter for the current view.
  const q = search.trim().toLowerCase();
  const visible = q ? items.filter(t => (t.title || '').toLowerCase().includes(q)) : items;

  // ---- Bulk actions over the selected to-dos ----
  const bulkEach = (fn: (id: string) => void) => { sel.forEach(fn); };
  const bulkMove = (noteId: string | null) => { bulkEach(id => onPatch(id, { note_id: noteId })); clear(); };
  const bulkSchedule = (patch: Partial<PlannerTask>) => { bulkEach(id => onPatch(id, patch)); clear(); };
  const bulkFlag = (f: boolean) => { bulkEach(id => onPatch(id, { flagged: f })); clear(); };
  const bulkDone = (done: boolean) => { bulkEach(id => onPatch(id, { done })); clear(); };
  const bulkDelete = () => {
    if (!confirm(`Delete ${sel.size} to-do${sel.size === 1 ? '' : 's'}? This can’t be undone.`)) return;
    bulkEach(id => onDelete(id)); clear();
  };
  function row(t: PlannerTask) {
    return selectMode
      ? <SelectableRow key={t.id} task={t} selected={sel.has(t.id)} onToggle={() => toggle(t.id)} listName={noteNameFor(t)} />
      : renderRow(t);
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Icon className={`w-6 h-6 ${meta.color}`} />
        <h2 className="text-2xl font-bold text-content">{meta.label}</h2>
        {orbit && orbitEnabled && (
          <button
            onClick={runOrbitAi}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-control px-2.5 py-1.5"
            title="Let Claude suggest which to-dos to pull into Orbit"
          >
            <Sparkles className="w-3.5 h-3.5" /> Suggest picks
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {(orbit || inbox || bucket === 'today' || bucket === 'anytime') && totalMinutes > 0 && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-content-secondary">
              <Clock className="w-4 h-4" /> {formatMinutes(totalMinutes)} planned
            </span>
          )}
          {items.length > 0 && !selectMode && (
            <button onClick={() => setSelectMode(true)} className="text-xs font-medium text-content-secondary hover:text-brand-600 border border-edge rounded-control px-2.5 py-1.5">Select</button>
          )}
        </div>
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
        <p className="text-sm text-content-muted -mt-4 mb-5">What's currently relevant. Star to-dos into Orbit from any list; they surface first in Focus.</p>
      )}

      {/* Long lists read best on the same surface card My Day uses — not on
          the sunken page background (theme follow-up). */}
      <div className="bg-surface border border-edge rounded-card p-4">
      <QuickAdd
        value={draft}
        onChange={setDraft}
        today={today}
        placeholder={`Add to ${meta.label}…`}
        onSubmit={p => { onAdd({ title: p.title, ...addDefaults, ...(p.due ? { due_date: p.due, someday: false } : {}) }); setDraft(''); }}
      />

      {items.length > 0 && (
        <div className="mt-3 flex items-center gap-2 bg-surface border border-edge rounded-control px-3 py-2">
          <Search className="w-4 h-4 text-content-muted shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${meta.label}…`}
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-content-muted text-content"
          />
          {search && <button onClick={() => setSearch('')} className="text-content-faint hover:text-content-secondary" title="Clear"><X className="w-4 h-4" /></button>}
        </div>
      )}

      {selectMode && (
        <div className="mt-3">
          <BulkBar
            count={sel.size}
            allSelected={visible.length > 0 && visible.every(t => sel.has(t.id))}
            today={today}
            lists={lists}
            onSelectAll={() => selectAll(visible.map(t => t.id))}
            onExit={exit}
            onMove={bulkMove}
            onSchedule={bulkSchedule}
            onFlag={bulkFlag}
            onDone={bulkDone}
            onDelete={bulkDelete}
          />
        </div>
      )}

      {bucket === 'today' && <DayEventsStrip events={eventsByDay[today]} />}

      {visible.length === 0 ? (
        <p className="text-sm text-content-muted mt-4">{search ? 'Nothing matches that search.' : 'Nothing here right now.'}</p>
      ) : bucket === 'upcoming' ? (
        // Group by day, like the Things "Upcoming" list.
        <div className="mt-4 space-y-5">
          {groupByDay(visible).map(group => (
            <div key={group.date}>
              <DayHeader date={group.date} today={today} totalMinutes={sumEstimate(group.items)} />
              <DayEventsStrip events={eventsByDay[group.date]} />
              <ul className={selectMode ? 'space-y-0.5' : 'divide-y divide-edge-soft'}>
                {group.items.map(row)}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className={selectMode ? 'mt-2 space-y-0.5' : 'mt-2 divide-y divide-edge-soft'}>
          {visible.map(row)}
        </ul>
      )}
      </div>
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
    <div className="mt-3 mb-1 rounded-control bg-brand-50/70 border border-brand-100 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-500 mb-1 flex items-center gap-1">
        <CalendarDays className="w-3 h-3" /> On your calendar
      </p>
      <ul className="space-y-0.5">
        {events.map(ev => (
          <li key={ev.id} className="flex items-center gap-2 text-sm">
            <span className="text-xs font-medium text-brand-600 w-16 shrink-0">{eventTimeLabel(ev)}</span>
            <span className="flex-1 text-content-secondary truncate">{ev.summary || '(no title)'}</span>
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
      <span className="text-xl font-bold text-content">{d.getDate()}</span>
      <span className="text-sm font-medium text-content-secondary">{rel}</span>
      <span className="text-xs text-content-muted">· {monthDay}</span>
      {totalMinutes > 0 && (
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-content-muted">
          <Clock className="w-3.5 h-3.5" /> {formatMinutes(totalMinutes)}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Note editor (headings + drag-to-reorder + checklists)
// ---------------------------------------------------------------------------

// The weekly-reset journal questions, in the order createResetTasks writes them
// into a reset list's notes. Used to split that text back into collapsible rows.
const JOURNAL_QUESTIONS: { key: string; label: string }[] = [
  { key: 'wins', label: 'Wins from last week' },
  { key: 'not_done', label: 'What I didn’t do last week' },
  { key: 'drained', label: 'What drained my time' },
  { key: 'feel_more', label: 'What I want to feel more of' },
];
interface JournalSection { key: string; label: string; text: string }

// Split a reset list's notes ("Wins from last week:\n…\n\nWhat I…") back into
// its per-question sections. Returns null if it doesn't look like a journal.
function parseJournal(body: string): JournalSection[] | null {
  const marks = JOURNAL_QUESTIONS
    .map(q => ({ ...q, at: body.indexOf(`${q.label}:`) }))
    .filter(m => m.at !== -1)
    .sort((a, b) => a.at - b.at);
  if (!marks.length) return null;
  return marks.map((m, i) => {
    const start = m.at + m.label.length + 1;
    const end = i + 1 < marks.length ? marks[i + 1].at : body.length;
    return { key: m.key, label: m.label, text: body.slice(start, end).trim() };
  });
}

function serializeJournal(sections: JournalSection[]): string {
  return sections.filter(s => s.text.trim()).map(s => `${s.label}:\n${s.text.trim()}`).join('\n\n');
}

// A small header dropdown (Sort / Merge) — a button that opens a menu with a
// click-away backdrop. `children` renders the menu body and gets a `close`.
function ListMenuButton({
  icon, title, children,
}: {
  icon: ReactNode;
  title: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`p-2 rounded-control ${open ? 'text-brand-600 bg-surface-sunken' : 'text-content-muted hover:bg-surface-sunken hover:text-brand-600'}`}
        title={title}
      >
        {icon}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-56 max-h-72 overflow-y-auto rounded-card border border-edge bg-surface shadow-lg py-1">
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  );
}

function ListMenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center px-3 py-1.5 text-sm text-content text-left hover:bg-surface-sunken">
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

function NotePane({
  note, tasks, today, lists, penNames, onSaveNote, onDeleteNote, onDuplicateNote, onMergeInto, onSortTasks, onAdd, onCreate, onPatch, onDelete, onReorder, orbitEnabled = false, blockedIds, onEditDependencies,
}: {
  note: PlannerNote;
  tasks: PlannerTask[];
  today: string;
  lists: PlannerNote[];
  penNames: PenName[];
  onSaveNote: (id: string, patch: Partial<PlannerNote>) => void;
  onDeleteNote: (id: string) => void;
  onDuplicateNote: (note: PlannerNote) => void;
  onMergeInto: (sourceId: string, targetId: string) => void;
  onSortTasks: (noteId: string, mode: 'alpha' | 'due' | 'tag') => void;
  onAdd: (i: { title: string; note_id: string; kind?: 'task' | 'heading'; sort_order?: number; due_date?: string }) => void;
  onCreate: (i: { title?: string; note_id: string; kind?: 'task' | 'heading'; sort_order?: number }) => Promise<PlannerTask | undefined>;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  onReorder: (updates: { id: string; sort_order: number }[]) => void;
  orbitEnabled?: boolean;
  blockedIds: Set<string>;
  onEditDependencies: (id: string) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [notesOpen, setNotesOpen] = useState(true);
  // On a Weekly Reset list, the journal is stored in the notes as labeled
  // questions; split it into collapsible per-question rows (editable).
  const [journal, setJournal] = useState<JournalSection[] | null>(() =>
    note.title.trim().startsWith('Weekly Reset') ? parseJournal(note.body) : null);
  const [openJournal, setOpenJournal] = useState<Set<string>>(() => new Set());
  function toggleJournal(key: string) {
    setOpenJournal(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  function updateJournal(i: number, text: string) {
    setJournal(prev => (prev ? prev.map((s, idx) => (idx === i ? { ...s, text } : s)) : prev));
  }
  function saveJournal() {
    if (!journal) return;
    const serialized = serializeJournal(journal);
    if (serialized !== note.body) onSaveNote(note.id, { body: serialized });
  }
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<'all' | 'important'>('all');
  const [search, setSearch] = useState('');
  const { selectMode, setSelectMode, sel, toggle, clear, exit, selectAll } = useSelection();
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

  // ---- Bulk actions (select mode shows a flat, checkable list of to-dos) ----
  // Respect the active search + All/Important filter so you can scope a bulk
  // action to what you searched for.
  const bulkQuery = search.trim().toLowerCase();
  const selectable = ordered.filter(t =>
    t.kind === 'task'
    && (filter !== 'important' || t.flagged)
    && (!bulkQuery || (t.title || '').toLowerCase().includes(bulkQuery)),
  );
  const bulkEach = (fn: (id: string) => void) => { sel.forEach(fn); };
  const bulkMove = (noteId: string | null) => { bulkEach(id => onPatch(id, { note_id: noteId })); clear(); };
  const bulkSchedule = (patch: Partial<PlannerTask>) => { bulkEach(id => onPatch(id, patch)); clear(); };
  const bulkFlag = (f: boolean) => { bulkEach(id => onPatch(id, { flagged: f })); clear(); };
  const bulkDone = (done: boolean) => { bulkEach(id => onPatch(id, { done })); clear(); };
  const bulkDelete = () => {
    if (!confirm(`Delete ${sel.size} to-do${sel.size === 1 ? '' : 's'}? This can’t be undone.`)) return;
    bulkEach(id => onDelete(id)); clear();
  };
  // Append a new heading at the bottom and move the selected to-dos under it.
  async function bulkNewHeading() {
    const ids = [...sel];
    if (!ids.length) return;
    await onCreate({ note_id: note.id, kind: 'heading', title: 'New section', sort_order: nextOrder });
    onReorder(ids.map((id, i) => ({ id, sort_order: nextOrder + 1 + i })));
    clear();
  }

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
  // When searching, show a flat list of matching to-dos (open + done) instead of
  // the headings/drag structure.
  const noteQuery = search.trim().toLowerCase();
  const searchResults = noteQuery
    ? ordered.filter(t => t.kind === 'task' && (t.title || '').toLowerCase().includes(noteQuery))
    : null;

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
          className="flex-1 text-2xl font-bold text-content bg-transparent outline-none placeholder:text-content-faint"
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
            className={`p-2 rounded-control hover:bg-surface-sunken ${note.pinned ? 'text-amber-500' : 'text-content-muted'}`}
            title={note.pinned ? 'Unpin' : 'Pin to top'}
          >
            {note.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </button>
          <ListMenuButton icon={<ArrowUpDown className="w-4 h-4" />} title="Sort this list">
            {close => (
              <>
                <ListMenuItem label="Sort A–Z" onClick={() => { onSortTasks(note.id, 'alpha'); close(); }} />
                <ListMenuItem label="Sort by due date" onClick={() => { onSortTasks(note.id, 'due'); close(); }} />
                <ListMenuItem label="Sort by tags (★ ♥ first)" onClick={() => { onSortTasks(note.id, 'tag'); close(); }} />
              </>
            )}
          </ListMenuButton>
          <ListMenuButton icon={<GitMerge className="w-4 h-4" />} title="Merge this list into another">
            {close => {
              const targets = lists.filter(l => l.id !== note.id);
              return targets.length === 0
                ? <div className="px-3 py-2 text-xs text-content-muted">No other lists to merge into.</div>
                : (
                  <>
                    <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-content-muted">Move all to-dos into…</div>
                    {targets.map(l => (
                      <ListMenuItem
                        key={l.id}
                        label={l.title.trim() || 'Untitled list'}
                        onClick={() => {
                          if (confirm(`Move every to-do from “${note.title.trim() || 'this list'}” into “${l.title.trim() || 'Untitled list'}”, then archive this list?`)) {
                            onMergeInto(note.id, l.id); close();
                          }
                        }}
                      />
                    ))}
                  </>
                );
            }}
          </ListMenuButton>
          <button onClick={() => onDuplicateNote(note)} className="p-2 rounded-control text-content-muted hover:bg-surface-sunken hover:text-brand-600" title="Duplicate this list (copy its to-dos, reset completion)">
            <CopyPlus className="w-4 h-4" />
          </button>
          <button onClick={() => onSaveNote(note.id, { archived: true })} className="p-2 rounded-control text-content-muted hover:bg-surface-sunken" title="Archive">
            <Archive className="w-4 h-4" />
          </button>
          <button onClick={() => onDeleteNote(note.id)} className="p-2 rounded-control text-content-muted hover:bg-rose-50 hover:text-rose-500" title="Delete list">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {journal ? (
        // Weekly-reset journal: one collapsible row per question.
        <div className="mb-3 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted px-0.5">Journal</p>
          {journal.map((s, i) => {
            const open = openJournal.has(s.key);
            return (
              <div key={s.key} className="rounded-card border border-edge bg-surface">
                <button onClick={() => toggleJournal(s.key)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
                  {open ? <ChevronDown className="w-4 h-4 text-content-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-content-muted shrink-0" />}
                  <span className="flex-1 text-sm font-semibold text-content">{s.label}</span>
                  {!open && s.text.trim() && (
                    <span className="text-xs text-content-faint truncate max-w-[45%]">{s.text.replace(/\s+/g, ' ')}</span>
                  )}
                </button>
                {open && (
                  <div className="px-3 pb-2 border-t border-edge-soft pt-2">
                    <textarea
                      value={s.text}
                      onChange={e => updateJournal(i, e.target.value)}
                      onBlur={saveJournal}
                      rows={3}
                      className="w-full text-sm rounded-control border border-edge bg-surface px-2 py-1.5 outline-none focus:border-brand-300 text-content-secondary resize-y"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        // Any other list: a single collapsible notes field. Open by default.
        <div className="mb-2">
          <button
            onClick={() => setNotesOpen(o => !o)}
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-muted hover:text-content-secondary"
          >
            {notesOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Notes
            {!notesOpen && body.trim() && (
              <span className="normal-case font-normal tracking-normal text-content-faint truncate max-w-[18rem]">{body.trim().replace(/\s+/g, ' ')}</span>
            )}
          </button>
          {notesOpen && (
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              onBlur={() => { if (body !== note.body) onSaveNote(note.id, { body }); }}
              placeholder="Notes, links, anything you want to remember…"
              rows={2}
              className="mt-1 w-full text-sm text-content-secondary bg-transparent outline-none resize-y placeholder:text-content-muted"
            />
          )}
        </div>
      )}

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
            className="p-2 rounded-control text-content-muted hover:bg-surface-sunken hover:text-content-secondary shrink-0"
            title="Unlink from book"
          >
            <Link2Off className="w-4 h-4" />
          </button>
        )}
      </div>

      {(listEst > 0 || listTracked > 0) && (
        <div className="flex items-center gap-3 text-xs text-content-muted mb-4">
          {listEst > 0 && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {formatMinutes(listEst)} planned</span>}
          {listTracked > 0 && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-brand-500" /> {formatMinutes(listTracked)} tracked</span>}
        </div>
      )}

      {/* All / Important filter (Things-3-style) + search */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex items-center gap-1">
          {(['all', 'important'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
                filter === f ? 'bg-slate-800 text-white' : 'text-content-secondary hover:bg-surface-sunken'
              }`}
            >
              {f === 'important' && <Star className="w-3 h-3" fill={filter === f ? 'currentColor' : 'none'} />}
              {f === 'all' ? 'All' : 'Important'}
              {f === 'important' && flaggedOpen.length > 0 && <span className={filter === f ? 'text-amber-300' : 'text-amber-500'}>{flaggedOpen.length}</span>}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5 bg-surface border border-edge rounded-control px-2.5 py-1 w-48">
          <Search className="w-3.5 h-3.5 text-content-muted shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search this list…"
            className="flex-1 min-w-0 text-xs bg-transparent outline-none placeholder:text-content-muted text-content"
          />
          {search && <button onClick={() => setSearch('')} className="text-content-faint hover:text-content-secondary shrink-0" title="Clear"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>

      {/* Same surface-card treatment as My Day for the list body. */}
      <div className="bg-surface border border-edge rounded-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-1">
          <QuickAdd
            value={draft}
            onChange={setDraft}
            placeholder="Add a to-do…"
            today={today}
            onSubmit={p => { onAdd({ title: p.title, note_id: note.id, sort_order: nextOrder, ...(p.due ? { due_date: p.due } : {}) }); setDraft(''); }}
          />
        </div>
        <button
          onClick={() => onAdd({ title: 'New section', note_id: note.id, kind: 'heading', sort_order: nextOrder })}
          className="flex items-center gap-1 text-xs font-medium text-content-secondary hover:text-brand-600 border border-edge rounded-control px-2.5 py-2"
          title="Add a section heading"
        >
          <HeadingIcon className="w-3.5 h-3.5" /> Heading
        </button>
        {selectable.length > 0 && !selectMode && (
          <button
            onClick={() => setSelectMode(true)}
            className="flex items-center gap-1 text-xs font-medium text-content-secondary hover:text-brand-600 border border-edge rounded-control px-2.5 py-2"
            title="Select multiple to-dos for bulk actions"
          >
            <Check className="w-3.5 h-3.5" /> Select
          </button>
        )}
      </div>

      {selectMode ? (
        <>
          <div className="mt-3">
            <BulkBar
              count={sel.size}
              allSelected={selectable.length > 0 && selectable.every(t => sel.has(t.id))}
              today={today}
              lists={lists}
              currentListId={note.id}
              onSelectAll={() => selectAll(selectable.map(t => t.id))}
              onExit={exit}
              onMove={bulkMove}
              onSchedule={bulkSchedule}
              onFlag={bulkFlag}
              onDone={bulkDone}
              onDelete={bulkDelete}
              onNewHeading={bulkNewHeading}
            />
          </div>
          {selectable.length === 0 ? (
            <p className="text-sm text-content-muted mt-3">No to-dos to select yet.</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {selectable.map(t => (
                <SelectableRow key={t.id} task={t} selected={sel.has(t.id)} onToggle={() => toggle(t.id)} />
              ))}
            </ul>
          )}
        </>
      ) : searchResults ? (
        searchResults.length === 0 ? (
          <p className="text-sm text-content-muted mt-3">Nothing in this list matches that search.</p>
        ) : (
          <ul className="mt-2 divide-y divide-edge-soft">
            {searchResults.map(t => (
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
                onPatch={onPatch}
                onDelete={onDelete}
                blocked={blockedIds.has(t.id)}
                onEditDependencies={() => onEditDependencies(t.id)}
              />
            ))}
          </ul>
        )
      ) : (
        <>
      {filter === 'important' ? (
        flaggedOpen.length === 0 ? (
          <p className="text-sm text-content-muted mt-3">Nothing flagged. Star a to-do to mark it Important.</p>
        ) : (
          <ul className="mt-2 divide-y divide-edge-soft">
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
                blocked={blockedIds.has(t.id)}
                onEditDependencies={() => onEditDependencies(t.id)}
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
                  blockedIds={blockedIds}
                  onEditDependencies={onEditDependencies}
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
        <p className="text-sm text-content-muted mt-2">Add a to-do or a section heading to start planning this out.</p>
      )}

      {doneItems.length > 0 && (
        <div className="mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted mb-1">Done</p>
          <ul className="divide-y divide-edge-soft">
            {doneItems.map(t => (
              <TaskRow key={t.id} task={t} today={today} showTimer onPatch={onPatch} onDelete={onDelete} />
            ))}
          </ul>
        </div>
      )}
        </>
      )}
      </div>
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
  task, today, lists, collapsed, childCount, focusId, onFocused, onToggleCollapse, onAddUnder, onEnter, onPatch, onDelete, orbitEnabled = false, blockedIds, onEditDependencies,
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
  blockedIds: Set<string>;
  onEditDependencies: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, style } = useSortableStyle(task.id);
  const handle = (
    <button
      {...attributes}
      {...listeners}
      className="text-content-faint hover:text-content-secondary cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity shrink-0 touch-none"
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
    <li ref={setNodeRef} style={style} className="border-b border-edge-soft">
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
        blocked={blockedIds.has(task.id)}
        onEditDependencies={() => onEditDependencies(task.id)}
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
        className="text-content-muted hover:text-content-secondary shrink-0"
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
        className="flex-1 text-sm font-bold uppercase tracking-wide text-content-secondary bg-transparent outline-none border-b border-transparent focus:border-brand-400"
      />
      {collapsed && childCount > 0 && (
        <span className="text-xs text-content-muted shrink-0">{childCount}</span>
      )}
      <button
        onClick={onAddUnder}
        className="text-content-faint hover:text-brand-600 opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity shrink-0"
        title="Add a to-do under this heading"
      >
        <Plus className="w-4 h-4" />
      </button>
      <button
        onClick={() => onDelete(task.id)}
        className="text-content-faint hover:text-rose-500 opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity shrink-0"
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
  const dot = selected ? penNameClasses(selected.color).dot : 'bg-edge-strong';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-surface border border-edge rounded-control hover:bg-surface-hover text-content"
        title="Focus the planner on one pen name"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span className="flex-1 text-left font-medium truncate">{selected?.name ?? 'All pen names'}</span>
        <ChevronDown className="w-3.5 h-3.5 text-content-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-surface border border-edge rounded-card shadow-lg z-50 py-1">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-surface-hover"
          >
            <span className="w-2 h-2 rounded-full bg-edge-strong shrink-0" />
            <span className="flex-1 font-medium text-content">All pen names</span>
            {value === null && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
          </button>
          <div className="my-1 border-t border-edge-soft" />
          {penNames.map(pn => {
            const c = penNameClasses(pn.color);
            return (
              <button
                key={pn.id}
                onClick={() => { onChange(pn.id); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-surface-hover"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
                <span className="flex-1 font-medium text-content truncate">{pn.name}</span>
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
  const dot = selected ? penNameClasses(selected.color).dot : 'bg-edge-strong';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-2 py-2 rounded-control text-sm text-content-secondary hover:bg-surface-sunken hover:text-content"
        title="Assign a pen name to this list"
      >
        {selected
          ? <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
          : <UsersIcon className="w-4 h-4" />}
        <span className="max-w-[8rem] truncate">{selected?.name ?? 'No pen name'}</span>
        <ChevronDown className="w-3.5 h-3.5 text-content-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-surface border border-edge rounded-card shadow-lg z-50 py-1">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-surface-hover"
          >
            <span className="w-2 h-2 rounded-full bg-edge-strong shrink-0" />
            <span className="flex-1 font-medium text-content">No pen name</span>
            {value === null && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
          </button>
          <div className="my-1 border-t border-edge-soft" />
          {penNames.map(pn => {
            const c = penNameClasses(pn.color);
            return (
              <button
                key={pn.id}
                onClick={() => { onChange(pn.id); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-surface-hover"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
                <span className="flex-1 font-medium text-content truncate">{pn.name}</span>
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
    <div ref={setNodeRef} style={style} className={`group flex items-center rounded-control ${isDragging ? 'opacity-60 bg-surface shadow-sm' : ''}`}>
      <button
        {...attributes}
        {...listeners}
        className="pl-1.5 py-2 text-content-faint hover:text-content-secondary cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity shrink-0 touch-none"
        title="Drag to reorder"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onChoose}
        className={`flex-1 min-w-0 flex items-center gap-2 pr-3 py-2 rounded-control text-sm transition-colors ${
          active ? 'bg-surface shadow-sm text-content font-medium' : 'text-content-secondary hover:bg-surface/70'
        }`}
      >
        {note.pinned ? <Pin className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <NotebookPen className="w-3.5 h-3.5 text-content-muted shrink-0" />}
        <span className="flex-1 text-left truncate">{note.title.trim() || 'Untitled list'}</span>
        {penName && <span className={`w-2 h-2 rounded-full shrink-0 ${penNameClasses(penName.color).dot}`} title={penName.name} />}
        {open > 0 && <span className="text-xs text-content-muted shrink-0">{open}</span>}
      </button>
    </div>
  );
}

function QuickAdd({
  value, onChange, onSubmit, placeholder, today,
}: {
  value: string;
  onChange: (v: string) => void;
  // Receives the parsed capture: the cleaned title and any date read from plain
  // English ("call editor Friday" → title "call editor", due that Friday).
  onSubmit: (parsed: { title: string; due: string | null }) => void;
  placeholder: string;
  // When provided, dates typed into the title are recognized and previewed.
  today?: string;
}) {
  const parsed = today
    ? parseCapture(value, today)
    : { title: value.trim(), due: null as string | null };
  const submit = () => { if (value.trim()) onSubmit(parsed); };
  return (
    <div className="flex items-center gap-2 bg-surface-hover border border-edge rounded-control px-3 py-2">
      <Plus className="w-4 h-4 text-content-muted shrink-0" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        placeholder={placeholder}
        className="flex-1 min-w-0 text-sm bg-transparent outline-none placeholder:text-content-muted text-content"
      />
      {parsed.due && (
        <span
          className="shrink-0 inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2 py-0.5 text-xs font-medium"
          title={`Will be scheduled for ${captureDateLabel(parsed.due, today!)}`}
        >
          <CalendarDays className="w-3 h-3" /> {captureDateLabel(parsed.due, today!)}
        </span>
      )}
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

// A friendly label for the capture chip: "Today"/"Tomorrow" or a weekday +
// date ("Fri, Jul 11") so a parsed weekday reads unambiguously.
function captureDateLabel(due: string, today: string): string {
  if (due === today) return 'Today';
  if (due === addDaysISO(today, 1)) return 'Tomorrow';
  return new Date(due + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
