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

export interface PlannerTask {
  id: string;
  user_id: string;
  note_id: string | null;
  title: string;
  done: boolean;
  done_at: string | null;
  // 'YYYY-MM-DD' or null. null + someday=false => Anytime; someday=true => Someday.
  due_date: string | null;
  someday: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

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
export function isDueToday(task: PlannerTask, today: string = todayISO()): boolean {
  return !task.done && !task.someday && !!task.due_date && task.due_date <= today;
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
