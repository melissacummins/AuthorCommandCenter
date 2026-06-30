import { supabase } from '../../lib/supabase';
import type {
  ChecklistItem, PlannerDayNote, PlannerNote, PlannerSettings, PlannerTask, PlannerTimeBlock, PlannerTimeSession, TaskKind, WeeklyReset,
} from './types';
import { DEFAULT_DAILY_CAPACITY } from './types';

// ---- Notes ----------------------------------------------------------------

export async function listNotes(userId: string, includeArchived = false): Promise<PlannerNote[]> {
  let q = supabase
    .from('planner_notes')
    .select('*')
    .eq('user_id', userId);
  if (!includeArchived) q = q.eq('archived', false);
  const { data, error } = await q
    .order('pinned', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PlannerNote[];
}

export async function createNote(userId: string, title = ''): Promise<PlannerNote> {
  const { data, error } = await supabase
    .from('planner_notes')
    .insert({ user_id: userId, title })
    .select('*')
    .single();
  if (error) throw error;
  return data as PlannerNote;
}

export async function updateNote(
  id: string,
  patch: Partial<Pick<PlannerNote, 'title' | 'body' | 'pinned' | 'archived' | 'sort_order' | 'book_id' | 'pen_name_id'>>,
): Promise<PlannerNote> {
  const { data, error } = await supabase
    .from('planner_notes')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as PlannerNote;
}

export async function deleteNote(id: string): Promise<void> {
  // planner_tasks cascade on note delete via the FK.
  const { error } = await supabase.from('planner_notes').delete().eq('id', id);
  if (error) throw error;
}

// Duplicate a list into a fresh "(copy)" — a template workflow: keep a list set
// up the way you start a kind of work, then duplicate it when you begin. Copies
// the note's pen name (its author identity) but not its book link (a copy isn't
// the same book's work) and resets every per-instance field on the to-dos so
// the copy starts clean: nothing done, scheduled, in orbit, blocked or timing.
export async function duplicateList(
  userId: string,
  note: PlannerNote,
  tasks: PlannerTask[],
): Promise<{ note: PlannerNote; tasks: PlannerTask[] }> {
  const { data: noteData, error: noteErr } = await supabase
    .from('planner_notes')
    .insert({
      user_id: userId,
      title: `${note.title.trim() || 'Untitled list'} (copy)`,
      body: note.body,
      pen_name_id: note.pen_name_id,
      // A copy is a template instance, not the original book's work — don't
      // roll its time up into the linked book.
      book_id: null,
      // Float to the top so the new copy is easy to find.
      sort_order: 0,
    })
    .select('*')
    .single();
  if (noteErr) throw noteErr;
  const newNote = noteData as PlannerNote;

  const rows = tasks
    .filter(t => t.note_id === note.id)
    .map(t => ({
      user_id: userId,
      note_id: newNote.id,
      title: t.title,
      kind: t.kind,
      sort_order: t.sort_order,
      estimate_minutes: t.estimate_minutes,
      recurrence: t.recurrence,
      flagged: t.flagged,
      // Deep-copy the checklist with fresh item ids.
      checklist: (t.checklist ?? []).map(i => ({ ...i, id: crypto.randomUUID(), done: false })),
      // Reset everything instance-specific so the copy starts fresh.
      done: false,
      done_at: null,
      due_date: null,
      someday: false,
      in_orbit: false,
      block_id: null,
      timer_started_at: null,
      start_at: null,
      gcal_event_id: null,
    }));

  if (!rows.length) return { note: newNote, tasks: [] };

  const { data: taskData, error: taskErr } = await supabase
    .from('planner_tasks')
    .insert(rows)
    .select('*');
  if (taskErr) throw taskErr;
  return { note: newNote, tasks: (taskData ?? []) as PlannerTask[] };
}

// ---- Tasks ----------------------------------------------------------------

// All of a user's tasks. Small data set (personal to-dos), so we pull them in
// one query and bucket them in the app rather than running a query per view.
export async function listTasks(userId: string): Promise<PlannerTask[]> {
  const { data, error } = await supabase
    .from('planner_tasks')
    .select('*')
    .eq('user_id', userId)
    .order('done', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlannerTask[];
}

export async function createTask(
  userId: string,
  input: {
    title: string;
    note_id?: string | null;
    due_date?: string | null;
    someday?: boolean;
    kind?: TaskKind;
    sort_order?: number;
    block_id?: string | null;
    estimate_minutes?: number | null;
    in_orbit?: boolean;
    flagged?: boolean;
    reset_week?: string | null;
    reset_section?: string | null;
  },
): Promise<PlannerTask> {
  const { data, error } = await supabase
    .from('planner_tasks')
    .insert({
      user_id: userId,
      title: input.title,
      note_id: input.note_id ?? null,
      due_date: input.due_date ?? null,
      someday: input.someday ?? false,
      kind: input.kind ?? 'task',
      sort_order: input.sort_order ?? 0,
      block_id: input.block_id ?? null,
      estimate_minutes: input.estimate_minutes ?? null,
      in_orbit: input.in_orbit ?? false,
      ...(input.flagged != null ? { flagged: input.flagged } : {}),
      ...(input.reset_week !== undefined ? { reset_week: input.reset_week } : {}),
      ...(input.reset_section !== undefined ? { reset_section: input.reset_section } : {}),
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as PlannerTask;
}

// ---- Weekly Reset ---------------------------------------------------------

export async function getWeeklyReset(userId: string, weekStart: string): Promise<WeeklyReset | null> {
  const { data, error } = await supabase
    .from('weekly_resets')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .maybeSingle();
  if (error) throw error;
  return (data as WeeklyReset) ?? null;
}

export async function upsertWeeklyReset(
  userId: string,
  weekStart: string,
  patch: Partial<Pick<WeeklyReset, 'wins' | 'not_done' | 'drained' | 'feel_more'>>,
): Promise<WeeklyReset> {
  const { data, error } = await supabase
    .from('weekly_resets')
    .upsert({ user_id: userId, week_start: weekStart, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id,week_start' })
    .select('*')
    .single();
  if (error) throw error;
  return data as WeeklyReset;
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<PlannerTask,
    'title' | 'notes' | 'done' | 'due_date' | 'someday' | 'note_id' | 'sort_order' | 'checklist' | 'recurrence'
    | 'estimate_minutes' | 'start_at' | 'gcal_event_id' | 'block_id' | 'flagged'
    | 'actual_minutes' | 'timer_started_at' | 'in_orbit'>>,
): Promise<PlannerTask> {
  const next: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  // Keep done_at in step with done so we can show "completed" timestamps later.
  if (patch.done !== undefined) next.done_at = patch.done ? new Date().toISOString() : null;
  const { data, error } = await supabase
    .from('planner_tasks')
    .update(next)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as PlannerTask;
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('planner_tasks').delete().eq('id', id);
  if (error) throw error;
}

// Persist a fresh sort order after a drag-and-drop. The data set per note is
// tiny, so a handful of parallel updates is simpler than a bulk upsert (which
// would need every NOT NULL column echoed back).
export async function reorderTasks(updates: { id: string; sort_order: number }[]): Promise<void> {
  const stamp = new Date().toISOString();
  const results = await Promise.all(
    updates.map(u =>
      supabase.from('planner_tasks').update({ sort_order: u.sort_order, updated_at: stamp }).eq('id', u.id),
    ),
  );
  const failed = results.find(r => r.error);
  if (failed?.error) throw failed.error;
}

// Persist a new list (note) ordering after a drag or an alphabetical sort.
export async function reorderNotes(updates: { id: string; sort_order: number }[]): Promise<void> {
  const stamp = new Date().toISOString();
  const results = await Promise.all(
    updates.map(u =>
      supabase.from('planner_notes').update({ sort_order: u.sort_order, updated_at: stamp }).eq('id', u.id),
    ),
  );
  const failed = results.find(r => r.error);
  if (failed?.error) throw failed.error;
}

export function newChecklistItem(title: string): ChecklistItem {
  return { id: crypto.randomUUID(), title, done: false };
}

// ---- Time-tracking sessions -----------------------------------------------

// Recent timer runs (last ~120 days) — enough to cover the Stats range while
// keeping the payload bounded as the log grows.
export async function listTimeSessions(userId: string): Promise<PlannerTimeSession[]> {
  const cutoff = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('planner_time_sessions')
    .select('*')
    .eq('user_id', userId)
    .gte('started_at', cutoff)
    .order('started_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlannerTimeSession[];
}

// Log one or more completed timer runs. Returns the inserted rows.
export async function createTimeSessions(
  userId: string,
  rows: { task_id: string; started_at: string; ended_at: string; minutes: number }[],
): Promise<PlannerTimeSession[]> {
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from('planner_time_sessions')
    .insert(rows.map(r => ({ ...r, user_id: userId })))
    .select('*');
  if (error) throw error;
  return (data ?? []) as PlannerTimeSession[];
}

// ---- Settings -------------------------------------------------------------

// The user's planner settings, creating a default row the first time so the My
// Day capacity bar always has a target to measure against.
export async function getSettings(userId: string): Promise<PlannerSettings> {
  const { data, error } = await supabase
    .from('planner_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data as PlannerSettings;
  const { data: created, error: insErr } = await supabase
    .from('planner_settings')
    .insert({ user_id: userId, daily_capacity_minutes: DEFAULT_DAILY_CAPACITY })
    .select('*')
    .single();
  if (insErr) throw insErr;
  return created as PlannerSettings;
}

export async function updateSettings(
  userId: string,
  patch: Partial<Pick<PlannerSettings,
    'daily_capacity_minutes' | 'carry_over_capacity' | 'auto_rollover' | 'working_phase' | 'phase_started_on' | 'daily_goal_count' | 'orbit_enabled'>>,
): Promise<PlannerSettings> {
  const { data, error } = await supabase
    .from('planner_settings')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data as PlannerSettings;
}

// ---- Day notes ------------------------------------------------------------

export async function listDayNotes(userId: string): Promise<PlannerDayNote[]> {
  const { data, error } = await supabase
    .from('planner_day_notes')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as PlannerDayNote[];
}

// Upsert a single day's note (one row per (user, day)); empty bodies are kept
// so the row's timestamps survive, which is harmless.
export async function saveDayNote(userId: string, day: string, body: string): Promise<PlannerDayNote> {
  const { data, error } = await supabase
    .from('planner_day_notes')
    .upsert({ user_id: userId, day, body, updated_at: new Date().toISOString() }, { onConflict: 'user_id,day' })
    .select('*')
    .single();
  if (error) throw error;
  return data as PlannerDayNote;
}

// ---- Time blocks ----------------------------------------------------------

export async function listTimeBlocks(userId: string): Promise<PlannerTimeBlock[]> {
  const { data, error } = await supabase
    .from('planner_time_blocks')
    .select('*')
    .eq('user_id', userId)
    .order('day', { ascending: true })
    .order('start_minute', { ascending: true, nullsFirst: false })
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlannerTimeBlock[];
}

export async function createTimeBlock(
  userId: string,
  input: {
    day: string;
    title?: string;
    start_minute?: number | null;
    end_minute?: number | null;
    sort_order?: number;
  },
): Promise<PlannerTimeBlock> {
  const { data, error } = await supabase
    .from('planner_time_blocks')
    .insert({
      user_id: userId,
      day: input.day,
      title: input.title ?? '',
      start_minute: input.start_minute ?? null,
      end_minute: input.end_minute ?? null,
      sort_order: input.sort_order ?? 0,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as PlannerTimeBlock;
}

export async function updateTimeBlock(
  id: string,
  patch: Partial<Pick<PlannerTimeBlock, 'title' | 'start_minute' | 'end_minute' | 'gcal_event_id' | 'sort_order' | 'day'>>,
): Promise<PlannerTimeBlock> {
  const { data, error } = await supabase
    .from('planner_time_blocks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as PlannerTimeBlock;
}

export async function deleteTimeBlock(id: string): Promise<void> {
  // planner_tasks.block_id is ON DELETE SET NULL, so the block's to-dos stay on
  // the day and just lose their block grouping.
  const { error } = await supabase.from('planner_time_blocks').delete().eq('id', id);
  if (error) throw error;
}
