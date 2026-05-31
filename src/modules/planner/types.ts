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
  done: boolean;
  done_at: string | null;
  // 'YYYY-MM-DD' or null. null + someday=false => Anytime; someday=true => Someday.
  due_date: string | null;
  someday: boolean;
  checklist: ChecklistItem[];
  recurrence: Recurrence | null;
  estimate_minutes: number | null;
  // Optional timed start (a calendar time block) and the linked Google Calendar
  // event id, set when a to-do is placed on the calendar.
  start_at: string | null;
  gcal_event_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

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
