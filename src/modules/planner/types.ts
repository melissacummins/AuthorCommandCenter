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
  // Optional link to a Catalog book. When set, the time tracked on this list's
  // to-dos rolls up into that book's "hours worked" in the Catalog. null = not
  // tied to a book. ON DELETE SET NULL frees it if the book is deleted.
  book_id: string | null;
  // Optional link to a pen name. When set, this list (and its to-dos) belongs
  // to that author identity, so the planner's pen-name filter can scope to it.
  // null = unassigned. ON DELETE SET NULL frees it if the pen name is deleted.
  pen_name_id: string | null;
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
export type RecurrenceUnit = 'day' | 'week' | 'month';
export const RECURRENCE_PRESETS = ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly'] as const;
export type RecurrencePreset = typeof RECURRENCE_PRESETS[number];
// Either a named preset or a custom "every:<n>:<unit>" (e.g. 'every:2:week').
export type Recurrence = RecurrencePreset | `every:${number}:${RecurrenceUnit}`;

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
  // The Weekly Reset "feel-good" ♥ tag, now available on any to-do: something
  // that would feel good to do, distinct from important. false = untagged.
  feel_good: boolean;
  // True when the to-do is "in orbit" — currently relevant, surfaced first in
  // Focus and easy to pull into the day.
  in_orbit: boolean;
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
  // When this to-do was captured from a Weekly Reset: the Monday of that reset's
  // week and which section it came from. null for ordinary to-dos.
  reset_week?: string | null;
  reset_section?: ResetSection | null;
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
  // When true, unfinished scheduled to-dos from past days roll forward to today
  // on load instead of accumulating as Overdue.
  auto_rollover: boolean;
  // The current Working Phase (season of work), or null when the strategy is
  // off. phase_started_on is the local day it was entered (for ramped targets).
  working_phase: WorkingPhase | null;
  phase_started_on: string | null;
  // How many to-dos you aim to finish in a day; the My Day progress bar fills
  // toward it. null = goal off.
  daily_goal_count: number | null;
  // Whether the Orbit staging area (rail view + per-to-do toggle) is shown.
  orbit_enabled: boolean;
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

// One start→stop run of a to-do's timer. Lets Stats place tracked time on the
// day it was worked, regardless of whether the to-do is ever completed.
// A dependency edge: `task_id` is blocked by `depends_on_id`.
export interface PlannerTaskDependency {
  id: string;
  task_id: string;
  depends_on_id: string;
}

// One entry in a to-do's activity history (created, edited, completed, …).
export interface PlannerTaskEvent {
  id: string;
  task_id: string;
  type: string;
  detail: string | null;
  created_at: string;
}

export interface PlannerTimeSession {
  id: string;
  user_id: string;
  task_id: string;
  started_at: string;
  ended_at: string;
  minutes: number;
  // How the run was recorded: 'timer' (a real timer or manual log) or 'block'
  // (auto-derived from a timed block when its to-do was checked off). Block runs
  // are the ones un-checking a to-do reverses.
  source: string;
  created_at: string;
}

// ---- Weekly Reset ---------------------------------------------------------
// A once-a-week reflection + capture, keyed to the Monday of its week. The
// reflective prose lives in this row; the actionable items it produces become
// tagged planner_tasks (see reset_week / reset_section on PlannerTask).
export interface WeeklyReset {
  user_id: string;
  week_start: string; // YYYY-MM-DD (Monday)
  wins: string;
  not_done: string;
  drained: string;
  feel_more: string;
  created_at: string;
  updated_at: string;
}

// The actionable sections — each becomes to-dos when the reset is approved.
// 'priorities' also flag the to-do Important; 'meetings' may carry a date.
export type ResetSection = 'brain_dump' | 'priorities' | 'feel_good' | 'quick' | 'meetings';

export const RESET_SECTIONS: { key: ResetSection; label: string; hint: string }[] = [
  { key: 'brain_dump', label: 'Brain dump', hint: 'Everything on your mind → to-dos' },
  { key: 'priorities', label: 'Priorities', hint: 'Become Important-flagged to-dos' },
  { key: 'feel_good', label: 'What would make me feel good', hint: 'Including things weighing on you' },
  { key: 'quick', label: 'Quick tasks', hint: 'Small things to slot into gaps' },
  { key: 'meetings', label: 'Meetings', hint: 'Become dated to-dos' },
];

// One draft item (a single brain-dump to-do) before it's approved. Categories
// are per-item TAGS you tap in-app — so an item exists exactly once and can be a
// priority and/or quick and/or feel-good, with no chance of duplication.
// `uncertain` marks a guess for the human to confirm.
export interface ResetDraftItem {
  text: string;
  estimate_minutes?: number | null;
  priority?: boolean;  // ★ Important
  quick?: boolean;     // ⚡ auto 15-min
  feel_good?: boolean; // ♥ would feel good / weighing on me
  meeting?: boolean;   // 📅 a meeting/appointment — carries a date
  date?: string | null; // YYYY-MM-DD, for a meeting
  uncertain?: boolean;
}

// The full structured transcription of a reset photo (or a manually built draft):
// reflective prose plus ONE flat brain-dump of items you then tag.
export interface ResetTranscription {
  wins: string;
  not_done: string;
  drained: string;
  feel_more: string;
  items: ResetDraftItem[];
}

// The default 15-minute estimate a "Quick" tag applies.
export const QUICK_TASK_MINUTES = 15;

// The section a tagged item lands in (most specific wins) — drives the home
// list's headings and the Planning tray's groups.
export function resetSectionFor(it: ResetDraftItem): ResetSection {
  if (it.meeting) return 'meetings';
  if (it.priority) return 'priorities';
  if (it.quick) return 'quick';
  if (it.feel_good) return 'feel_good';
  return 'brain_dump';
}

// Drop exact-duplicate items (same title) — e.g. when two photos overlap. Blank
// rows (a manual input not yet typed) are always kept.
export function dedupeResetDraft(t: ResetTranscription): ResetTranscription {
  const seen = new Set<string>();
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '').trim();
  const items: ResetDraftItem[] = [];
  for (const it of t.items) {
    const key = norm(it.text);
    if (!key) { items.push(it); continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(it);
  }
  return { ...t, items };
}

// The Monday (local) of the week containing the given YYYY-MM-DD.
export function weekStartISO(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return toISO(d);
}

// Tracked minutes per day over the window, from the session log (by started_at).
export function trackedMinutesByDay(sessions: PlannerTimeSession[], today: string, days: number): Record<string, number> {
  const by: Record<string, number> = {};
  const from = addDaysISO(today, -(days - 1));
  for (const s of sessions) {
    const day = localDay(s.started_at);
    if (day < from || day > today) continue;
    by[day] = (by[day] ?? 0) + s.minutes;
  }
  return by;
}

// Default daily focus-time target (4h) until the user sets their own.
export const DEFAULT_DAILY_CAPACITY = 240;

// ---- Working Phases -------------------------------------------------------
// Seasons of work (not a linear progression — you move between them fluidly).
// The point is to recognize which one you're actually in versus which one your
// calendar assumes, and to size the day's load accordingly.
export type WorkingPhase = 'sprint' | 'recovery' | 'calibration' | 'building' | 'flow';

export interface PhaseInfo {
  id: WorkingPhase;
  label: string;
  tagline: string;
  appropriateWhen: string;
  watchFor?: string;
  // Theme-aware: phases ride the per-theme status tokens (hue-matched to
  // the old fixed palette) so they recolor with the app theme and inherit
  // the contrast-checked values from scripts/check_contrast.py.
  accent: string; // tailwind text color, e.g. 'text-status-paused-fg'
  dot: string;    // tailwind bg color for the phase dot
  // The daily target (minutes) this phase proposes, given the user's baseline
  // target and how many days they've been in the phase (for ramps).
  proposed: (baselineMinutes: number, daysIn: number) => number;
}

const round15 = (m: number) => Math.max(15, Math.round(m / 15) * 15);

// Ordered easiest→biggest, matching the December framing.
export const PHASES: PhaseInfo[] = [
  {
    id: 'recovery',
    label: 'Recovery',
    tagline: 'Post-illness or post-sprint — minimal decisions, maintenance mode.',
    appropriateWhen: "You've been sick, sleep-deprived, emotionally depleted, or just finished something big.",
    watchFor: "You can't meet deep-work demands here. Calibration-level work in Recovery sends you further back — walking's fine, a hike isn't.",
    accent: 'text-status-editing-fg',
    dot: 'bg-status-editing-fg',
    // Start gentle (~1h) and ramp ~30m/day, capped at half your baseline.
    proposed: (base, daysIn) => round15(Math.min(base * 0.5, 60 + Math.max(0, daysIn) * 30)),
  },
  {
    id: 'calibration',
    label: 'Calibration',
    tagline: "Assessing what's working, making adjustments — moderate energy.",
    appropriateWhen: "You can think clearly but aren't ready for sustained creative output. Ad optimization, inventory checks, system tweaks live here.",
    accent: 'text-status-drafting-fg',
    dot: 'bg-status-drafting-fg',
    proposed: base => round15(base * 0.6),
  },
  {
    id: 'building',
    label: 'Building',
    tagline: 'Steady, consistent work at a sustainable pace.',
    appropriateWhen: 'The target zone for most weeks — writing, creating, growing the business at a pace that doesn’t deplete you.',
    accent: 'text-status-published-fg',
    dot: 'bg-status-published-fg',
    proposed: base => base,
  },
  {
    id: 'sprint',
    label: 'Sprint',
    tagline: 'Launching something new — high output, time-bound.',
    appropriateWhen: "You're energized, resourced, and the work has a clear endpoint.",
    watchFor: 'Sprinting when you’re actually in Recovery — the calendar says Sprint, the body says no.',
    accent: 'text-status-paused-fg',
    dot: 'bg-status-paused-fg',
    proposed: base => round15(base * 1.15),
  },
  {
    id: 'flow',
    label: 'Flow',
    tagline: 'Everything humming — clear-headed, ready for bigger moves.',
    appropriateWhen: "The big creative leaps. You can't force your way in; it arrives when the other phases have been honored.",
    accent: 'text-status-preorder-fg',
    dot: 'bg-status-preorder-fg',
    proposed: base => base,
  },
];

export function phaseInfo(phase: WorkingPhase): PhaseInfo {
  return PHASES.find(p => p.id === phase) ?? PHASES[2];
}

// Whole days between two YYYY-MM-DD strings (to - from); negative if to < from.
export function daysBetweenISO(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00').getTime();
  const b = new Date(to + 'T00:00:00').getTime();
  return Math.round((b - a) / 86_400_000);
}

export const RECURRENCE_LABELS: Record<RecurrencePreset, string> = {
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  monthly: 'Every month',
};

// Parse a custom "every:<n>:<unit>" recurrence; null for presets / invalid input.
export function parseCustomRecurrence(r: Recurrence | null | undefined): { n: number; unit: RecurrenceUnit } | null {
  if (!r) return null;
  const m = /^every:([1-9][0-9]*):(day|week|month)$/.exec(r);
  return m ? { n: parseInt(m[1], 10), unit: m[2] as RecurrenceUnit } : null;
}

// Build a custom recurrence value from a count + unit.
export function customRecurrence(n: number, unit: RecurrenceUnit): Recurrence {
  return `every:${Math.max(1, Math.round(n))}:${unit}`;
}

// Human label for any recurrence — preset or custom.
export function recurrenceLabel(r: Recurrence | null | undefined): string {
  if (!r) return '';
  const c = parseCustomRecurrence(r);
  if (c) return c.n === 1 ? `Every ${c.unit}` : `Every ${c.n} ${c.unit}s`;
  return RECURRENCE_LABELS[r as RecurrencePreset] ?? 'Repeats';
}

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

  // Custom "every N days/weeks/months".
  const custom = parseCustomRecurrence(rule);
  if (custom) {
    if (custom.unit === 'day') d.setDate(d.getDate() + custom.n);
    else if (custom.unit === 'week') d.setDate(d.getDate() + custom.n * 7);
    else {
      const day = d.getDate();
      d.setMonth(d.getMonth() + custom.n);
      if (d.getDate() < day) d.setDate(0); // clamp short months
    }
    return toISO(d);
  }

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
    case 'biweekly':
      d.setDate(d.getDate() + 14);
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
    if (t.kind !== 'task' || !t.done) continue;
    const ts = t.done_at ?? t.updated_at ?? t.created_at;
    if (!ts) continue;
    const day = localDay(ts);
    const row = (by[day] ??= { day, done: 0, estMinutes: 0, trackedMinutes: 0 });
    row.done += 1;
    row.estMinutes += t.estimate_minutes ?? 0;
    row.trackedMinutes += t.actual_minutes ?? 0;
  }
  return dayRange(addDaysISO(today, -(days - 1)), days)
    .map(day => by[day] ?? { day, done: 0, estMinutes: 0, trackedMinutes: 0 });
}

// ---- Daily review ("what did I actually do") ------------------------------
// One timer run within a day, kept on its entry so the Logbook can show the
// start–end ranges like a timesheet.
export interface ReviewEntrySession { id: string; started_at: string; ended_at: string; minutes: number }

// A single to-do's activity on one day: the time worked that day (sum of that
// day's sessions) and whether it was also completed that day.
export interface ReviewEntry {
  task: PlannerTask;
  minutes: number;
  completedToday: boolean;
  sessions: ReviewEntrySession[];
}

// Everything that happened on one day, plus its rolled-up totals.
export interface ReviewDay {
  day: string; // YYYY-MM-DD
  entries: ReviewEntry[];
  totalMinutes: number;
  completedCount: number;
}

// Per-day "what I actually did": every to-do you completed OR logged time on,
// grouped by the day it happened (newest day first). Completions are placed by
// done_at; tracked time by each session's started_at — the SAME fields Stats
// uses — so a day's totals here reconcile exactly with the Stats bars. A to-do
// can appear on two days (worked one day, finished another); a to-do with no
// session and never completed leaves no trace, by design (nothing was recorded).
export function reviewDays(tasks: PlannerTask[], sessions: PlannerTimeSession[]): ReviewDay[] {
  const byId: Record<string, PlannerTask> = {};
  for (const t of tasks) byId[t.id] = t;

  // day -> task id -> the sessions worked on it that day
  const work: Record<string, Record<string, ReviewEntrySession[]>> = {};
  for (const s of sessions) {
    if (!byId[s.task_id]) continue; // task since deleted
    const day = localDay(s.started_at);
    ((work[day] ??= {})[s.task_id] ??= []).push({ id: s.id, started_at: s.started_at, ended_at: s.ended_at, minutes: s.minutes });
  }

  // day -> ids of to-dos completed that day. A completed to-do should ALWAYS be
  // findable here, so if done_at is somehow missing we fall back to updated_at /
  // created_at rather than dropping it — "if it's done, it's recorded."
  const completed: Record<string, Set<string>> = {};
  for (const t of tasks) {
    if (t.kind !== 'task' || !t.done) continue;
    const ts = t.done_at ?? t.updated_at ?? t.created_at;
    if (!ts) continue;
    (completed[localDay(ts)] ??= new Set()).add(t.id);
  }

  const out: ReviewDay[] = [];
  for (const day of new Set([...Object.keys(work), ...Object.keys(completed)])) {
    const ids = new Set([...Object.keys(work[day] ?? {}), ...(completed[day] ?? new Set<string>())]);
    const entries: ReviewEntry[] = [];
    for (const id of ids) {
      const task = byId[id];
      if (!task) continue;
      const sess = (work[day]?.[id] ?? []).slice().sort((a, b) => a.started_at.localeCompare(b.started_at));
      entries.push({
        task,
        minutes: sess.reduce((m, s) => m + s.minutes, 0),
        completedToday: completed[day]?.has(id) ?? false,
        sessions: sess,
      });
    }
    // Chronological within the day: earliest session start, else completion time.
    const repr = (e: ReviewEntry) => e.sessions[0]?.started_at ?? e.task.done_at ?? '';
    entries.sort((a, b) => repr(a).localeCompare(repr(b)));
    out.push({
      day,
      entries,
      totalMinutes: entries.reduce((m, e) => m + e.minutes, 0),
      completedCount: entries.filter(e => e.completedToday).length,
    });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
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

// ---- Natural-language capture --------------------------------------------
// Pull a due date out of a to-do typed in plain English — "call editor Friday",
// "email Sam tomorrow", "renew domain in 3 days" — and hand back the cleaned
// title plus the date. Deliberately CONSERVATIVE: it only reads a date phrase
// off the END of the string (optionally after on/by/due/for/next), so a to-do
// literally named "Monday sync notes" is never silently scheduled. Tasks store
// only a day, so a trailing clock time ("2pm") is left in the title, not lost.
const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

// The soonest future date landing on `target` (0=Sun). A bare weekday that
// equals today resolves to the coming one (a week out), never today; "next"
// always skips to the following week.
function weekdayOnOrAfter(today: string, target: number, forceNext: boolean): string {
  const cur = new Date(today + 'T00:00:00').getDay();
  let delta = (target - cur + 7) % 7;
  if (forceNext) delta += 7;
  else if (delta === 0) delta = 7;
  return addDaysISO(today, delta);
}

export function parseCapture(raw: string, today: string): { title: string; due: string | null } {
  const text = raw.trim();
  if (!text) return { title: text, due: null };

  // Peel a trailing clock time first ("2pm", "2:30pm", "14:00") so a date can
  // sit in front of it; require am/pm or a colon so plain "chapter 3" is safe.
  const timeRe = /\s+(?:at\s+)?(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))$/i;
  const timeMatch = text.match(timeRe);
  const timeStr = timeMatch ? timeMatch[1].replace(/\s+/g, '') : null;
  const body = timeMatch ? text.slice(0, timeMatch.index).trimEnd() : text;

  const lead = '(?:due\\s+|by\\s+|on\\s+|for\\s+)?';
  const patterns: { re: RegExp; resolve: (m: RegExpMatchArray) => string | null }[] = [
    { re: new RegExp(`\\s+${lead}(today|tonight)$`, 'i'), resolve: () => today },
    { re: new RegExp(`\\s+${lead}(tomorrow|tmrw|tmr)$`, 'i'), resolve: () => addDaysISO(today, 1) },
    { re: new RegExp(`\\s+${lead}(next\\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thur?s?|fri|sat)$`, 'i'),
      resolve: m => weekdayOnOrAfter(today, WEEKDAY_INDEX[m[2].toLowerCase()], !!m[1]) },
    { re: /\s+in\s+(\d+)\s+days?$/i, resolve: m => addDaysISO(today, parseInt(m[1], 10)) },
    { re: /\s+in\s+(\d+)\s+weeks?$/i, resolve: m => addDaysISO(today, parseInt(m[1], 10) * 7) },
    { re: /\s+in\s+a\s+week$/i, resolve: () => addDaysISO(today, 7) },
  ];

  for (const p of patterns) {
    const m = body.match(p.re);
    if (!m) continue;
    const due = p.resolve(m);
    if (!due) continue;
    let title = body.slice(0, m.index).trimEnd();
    if (timeStr) title = `${title} ${timeStr}`.trim();
    return { title: title || text, due };
  }
  return { title: text, due: null };
}
