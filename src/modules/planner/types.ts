// Planner data model. Notes are named lists / brain-dumps; tasks are the
// checkable items inside them (note_id may be null for a loose "Today" capture
// made from the Home panel).

export interface PlannerNote {
  id: string;
  user_id: string;
  title: string;
  body: string;
  pinned: boolean;
  archived: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// A to-do's own sub-steps (Things-3-style checklist), stored inline on the task.
export interface ChecklistItem {
  id: string;
  title: string;
  done: boolean;
}

export type TaskKind = 'task' | 'heading';

// How often a to-do repeats; null = one-off.
export type Recurrence = 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface PlannerTask {
  id: string;
  user_id: string;
  note_id: string | null;
  // 'task' is a normal to-do; 'heading' is a section divider inside a note that
  // groups the tasks beneath it. Headings never appear in the smart views.
  kind: TaskKind;
  title: string;
  // Optional long-form body: a draft, links, context that doesn't fit the
  // title. Empty/null when unused.
  notes: string | null;
  done: boolean;
  done_at: string | null;
  // 'YYYY-MM-DD' or null. null + someday=false => Anytime; someday=true => Someday.
  due_date: string | null;
  someday: boolean;
  checklist: ChecklistItem[];
  recurrence: Recurrence | null;
  estimate_minutes: number | null;
  // True when the to-do is flagged "Important" (a Things-3-style priority star).
  flagged: boolean;
  // Optional timed start (a calendar time block) and the linked Google Calendar
  // event id, set when a to-do is placed on the calendar.
  start_at: string | null;
  gcal_event_id: string | null;
  // The named My Day time block this to-do has been dropped into, or null when
  // it sits loose on the day. ON DELETE SET NULL frees it back into the day.
  block_id: string | null;
  // Time tracking. actual_minutes is the real time worked, accumulated across
  // timer runs; timer_started_at is the ISO start of the active run while a
  // timer is going (null when stopped). Only one to-do runs at a time.
  actual_minutes: number;
  timer_started_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Per-user planner preferences. The daily focus-time target the My Day
// capacity bar measures a day's planned load against, plus an opt-in to carry
// yesterday's overage into today's target.
export interface PlannerSettings {
  user_id: string;
  daily_capacity_minutes: number;
  // When true, the My Day capacity bar subtracts the previous day's overage
  // (rounded to the nearest hour, floored at zero) from this day's target.
  carry_over_capacity: boolean;
  created_at: string;
  updated_at: string;
}

// A freeform note attached to a single calendar day (feelings, wins, ideas),
// keyed by day. Distinct from PlannerNote, which is a named reusable list.
export interface PlannerDayNote {
  user_id: string;
  day: string; // YYYY-MM-DD
  body: string;
  created_at: string;
  updated_at: string;
}

// A named block of time on a given day ("Writing 9–11am") that groups to-dos.
// start_minute/end_minute are minutes from local midnight; null = an
// unscheduled bucket block. gcal_event_id links it to Google Calendar.
export interface PlannerTimeBlock {
  id: string;
  user_id: string;
  day: string; // YYYY-MM-DD
  title: string;
  start_minute: number | null;
  end_minute: number | null;
  gcal_event_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Default daily focus-time target (4h) until the user sets their own.
export const DEFAULT_DAILY_CAPACITY = 240;

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekly: 'Every week',
  monthly: 'Every month',
};

// Preset estimates offered in the time menu (minutes).
export const ESTIMATE_PRESETS = [15, 30, 45, 60, 90, 120, 180];

// The four Things-style buckets a task can fall into, derived from due_date +
// someday + the current date.
export type Bucket = 'today' | 'upcoming' | 'anytime' | 'someday';

// Local (not UTC) YYYY-MM-DD for "today", so day boundaries match the user's
// clock rather than the server's.
export function todayISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

export function bucketForTask(task: PlannerTask, today: string = todayISO()): Bucket {
  if (task.someday) return 'someday';
  if (!task.due_date) return 'anytime';
  return task.due_date <= today ? 'today' : 'upcoming';
}

// True for unfinished tasks scheduled on or before today (today + overdue).
// Headings are never "due".
export function isDueToday(task: PlannerTask, today: string = todayISO()): boolean {
  return task.kind !== 'heading' && !task.done && !task.someday && !!task.due_date && task.due_date <= today;
}

// Count of completed checklist items vs total, for a small "2/5" progress badge.
export function checklistProgress(task: PlannerTask): { done: number; total: number } {
  const items = task.checklist ?? [];
  return { done: items.filter(i => i.done).length, total: items.length };
}

// Local YYYY-MM-DD for a Date, matching todayISO()'s convention.
function toISO(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// The next occurrence of a recurring to-do after the given due date.
export function nextDueDate(due: string, rule: Recurrence): string {
  const d = new Date(due + 'T00:00:00');
  switch (rule) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekdays':
      do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly': {
      const day = d.getDate();
      d.setMonth(d.getMonth() + 1);
      // Clamp for short months (e.g. Jan 31 -> Feb 28).
      if (d.getDate() < day) d.setDate(0);
      break;
    }
  }
  return toISO(d);
}

// "1h 30m" / "45m" / "2h" — compact duration label.
export function formatMinutes(mins: number | null | undefined): string {
  if (!mins || mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Total estimated minutes across the open (not done) to-dos in a list.
export function sumEstimate(tasks: PlannerTask[]): number {
  return tasks.reduce((sum, t) => sum + (t.kind === 'task' && !t.done ? (t.estimate_minutes ?? 0) : 0), 0);
}

// Add (or subtract) whole days to a YYYY-MM-DD string, returning YYYY-MM-DD.
export function addDaysISO(iso: string, delta: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return toISO(d);
}

// A run of consecutive YYYY-MM-DD strings, `count` long, starting `from`.
export function dayRange(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDaysISO(from, i));
}

// "9:30am" / "2pm" from minutes-since-midnight; null/undefined => ''.
export function formatClock(minute: number | null | undefined): string {
  if (minute == null) return '';
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, m ? { hour: 'numeric', minute: '2-digit' } : { hour: 'numeric' });
}

// "HH:MM" (an <input type="time"> value) -> minutes from midnight, or null.
export function timeToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// minutes from midnight -> "HH:MM" for an <input type="time"> value.
export function minutesToTime(minute: number | null | undefined): string {
  if (minute == null) return '';
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// A block's own planned minutes: its time-range length if scheduled, otherwise
// the sum of its to-dos' estimates (so an untimed bucket still counts).
export function blockMinutes(block: PlannerTimeBlock, tasksInBlock: PlannerTask[]): number {
  if (block.start_minute != null && block.end_minute != null && block.end_minute > block.start_minute) {
    return block.end_minute - block.start_minute;
  }
  return sumEstimate(tasksInBlock);
}

// How many to-dos the user completed on each of the last `days` days, oldest
// first — fed to the My Day stats sparkline. Uses done_at (local day).
export function completionsByDay(tasks: PlannerTask[], today: string, days: number): { day: string; done: number }[] {
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    if (t.kind !== 'task' || !t.done || !t.done_at) continue;
    const d = new Date(t.done_at);
    const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    counts[iso] = (counts[iso] ?? 0) + 1;
  }
  return dayRange(addDaysISO(today, -(days - 1)), days).map(day => ({ day, done: counts[day] ?? 0 }));
}

// Whole minutes elapsed since an ISO timestamp (a running timer's start), never
// negative. Used to bank a running timer's in-progress time.
export function elapsedMinutes(since: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60_000));
}

// Local YYYY-MM-DD for an ISO timestamp (e.g. done_at, created_at), matching
// todayISO()'s local-day convention. Shared by the Logbook and Stats.
export function localDay(ts: string): string {
  const d = new Date(ts);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// One row per day over the window: how many to-dos were completed (by done_at),
// plus the estimated and actually-tracked minutes of those completed to-dos.
// Drives the Stats chart, which can plot count or hours.
export interface DayStat { day: string; done: number; estMinutes: number; trackedMinutes: number }
export function productivitySeries(tasks: PlannerTask[], today: string, days: number): DayStat[] {
  const by: Record<string, DayStat> = {};
  for (const t of tasks) {
    if (t.kind !== 'task' || !t.done || !t.done_at) continue;
    const day = localDay(t.done_at);
    const row = (by[day] ??= { day, done: 0, estMinutes: 0, trackedMinutes: 0 });
    row.done += 1;
    row.estMinutes += t.estimate_minutes ?? 0;
    row.trackedMinutes += t.actual_minutes ?? 0;
  }
  return dayRange(addDaysISO(today, -(days - 1)), days)
    .map(day => by[day] ?? { day, done: 0, estMinutes: 0, trackedMinutes: 0 });
}

// Completed-to-do counts by weekday (0 = Sunday … 6 = Saturday), over a window
// bounded by [from, to] inclusive on done_at's local day.
export function completionsByWeekday(tasks: PlannerTask[], from: string, to: string): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const t of tasks) {
    if (t.kind !== 'task' || !t.done || !t.done_at) continue;
    const day = localDay(t.done_at);
    if (day < from || day > to) continue;
    counts[new Date(day + 'T00:00:00').getDay()] += 1;
  }
  return counts;
}

// Per-list rollup of completed to-dos in a window: count + estimated/tracked
// minutes, keyed by note_id ('' for list-less to-dos). Sorted by tracked then
// estimated time, busiest first.
export interface ListStat { noteId: string; done: number; estMinutes: number; trackedMinutes: number }
export function completionsByList(tasks: PlannerTask[], from: string, to: string): ListStat[] {
  const by: Record<string, ListStat> = {};
  for (const t of tasks) {
    if (t.kind !== 'task' || !t.done || !t.done_at) continue;
    const day = localDay(t.done_at);
    if (day < from || day > to) continue;
    const key = t.note_id ?? '';
    const row = (by[key] ??= { noteId: key, done: 0, estMinutes: 0, trackedMinutes: 0 });
    row.done += 1;
    row.estMinutes += t.estimate_minutes ?? 0;
    row.trackedMinutes += t.actual_minutes ?? 0;
  }
  return Object.values(by).sort((a, b) =>
    (b.trackedMinutes - a.trackedMinutes) || (b.estMinutes - a.estMinutes) || (b.done - a.done));
}

// Short weekday + day-of-month for the date strip, e.g. { dow: 'Mon', dom: 2 }.
export function stripLabel(iso: string): { dow: string; dom: number } {
  const d = new Date(iso + 'T00:00:00');
  return { dow: d.toLocaleDateString(undefined, { weekday: 'short' }), dom: d.getDate() };
}

// Friendly relative label for a due date, e.g. "Today", "Yesterday", "Overdue
// · May 28", "Tomorrow", "Jun 3".
export function formatDue(due: string, today: string = todayISO()): string {
  if (due === today) return 'Today';
  const dueDate = new Date(due + 'T00:00:00');
  const todayDate = new Date(today + 'T00:00:00');
  const diffDays = Math.round((dueDate.getTime() - todayDate.getTime()) / 86_400_000);
  const month = dueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (diffDays === -1) return 'Yesterday';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays < 0) return `Overdue · ${month}`;
  return month;
}
