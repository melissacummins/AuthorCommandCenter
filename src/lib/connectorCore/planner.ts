// Client-injected data core for the Planner domain (to-dos + lists).
//
// Like dashboardCore.ts, these functions power the MCP connector (api/mcp.ts).
// They MUST NOT import the browser Supabase singleton (src/lib/supabase.ts uses
// import.meta.env, which doesn't exist server-side), must not import React, and
// must not use import.meta. The MCP server passes a per-request client built
// from the caller's OAuth token, so every query here runs under that user's
// RLS. Every query also filters by user_id explicitly to match the app.
//
// dashboardCore.ts already exposes the day-scoped slices (getTodayTasksCore,
// getUpcomingDatesCore). These functions expose the browse-and-filter data the
// Planner module works with directly.
//
// Tables (supabase/migrations/054_planner.sql and friends):
//   planner_tasks — the to-dos. A task's LIST is planner_tasks.note_id
//                   (the app calls a list a "note"). priority/star = flagged;
//                   estimate = estimate_minutes; feel_good and someday are their
//                   own booleans. There is NO tags column in this schema.
//   planner_notes — the named lists / brain-dumps (id, title, archived,
//                   sort_order, pinned). This IS a real table, so listTaskLists
//                   reads it directly rather than deriving lists from tasks.

import type { SupabaseClient } from '@supabase/supabase-js';

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Tasks

/** The to-do fields the Planner surfaces. `list_id` is planner_tasks.note_id;
    `star`/priority is `flagged`. */
export interface TaskSummary {
  id: string;
  list_id: string | null;
  kind: 'task' | 'heading';
  title: string;
  notes: string | null;
  done: boolean;
  done_at: string | null;
  due_date: string | null;
  someday: boolean;
  /** Priority star ("Important"). */
  flagged: boolean;
  /** The "would feel good" ♥ tag. */
  feel_good: boolean;
  in_orbit: boolean;
  estimate_minutes: number | null;
  recurrence: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const TASK_COLUMNS =
  'id, note_id, kind, title, notes, done, done_at, due_date, someday, flagged, ' +
  'feel_good, in_orbit, estimate_minutes, recurrence, sort_order, created_at, updated_at';

interface TaskRow {
  id: string;
  note_id: string | null;
  kind: 'task' | 'heading';
  title: string;
  notes: string | null;
  done: boolean;
  done_at: string | null;
  due_date: string | null;
  someday: boolean;
  flagged: boolean;
  feel_good: boolean;
  in_orbit: boolean;
  estimate_minutes: number | null;
  recurrence: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const toTaskSummary = (r: TaskRow): TaskSummary => ({
  id: r.id,
  list_id: r.note_id,
  kind: r.kind,
  title: r.title,
  notes: r.notes,
  done: r.done,
  done_at: r.done_at,
  due_date: r.due_date,
  someday: r.someday,
  flagged: r.flagged,
  feel_good: r.feel_good,
  in_orbit: r.in_orbit,
  estimate_minutes: r.estimate_minutes,
  recurrence: r.recurrence,
  sort_order: r.sort_order,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

/** The user's planner to-dos, ordered by due date then sort order. Defaults to
    OPEN tasks (done=false), up to 200. Filter with:
      done      — true/false to force a completion state (omit for the default)
      listId    — only tasks in one list (planner_tasks.note_id)
      dueBefore — only tasks with due_date < this YYYY-MM-DD
      someday   — true/false to include or exclude Someday tasks
      limit     — cap the row count (default 200) */
export async function listTasks(
  client: SupabaseClient,
  userId: string,
  opts: {
    done?: boolean;
    listId?: string;
    dueBefore?: string;
    someday?: boolean;
    limit?: number;
  } = {},
): Promise<TaskSummary[]> {
  const done = opts.done ?? false;
  const limit = opts.limit ?? 200;

  let q = client
    .from('planner_tasks')
    .select(TASK_COLUMNS)
    .eq('user_id', userId)
    .eq('done', done);
  if (opts.listId !== undefined) q = q.eq('note_id', opts.listId);
  if (opts.dueBefore) q = q.lt('due_date', opts.dueBefore);
  if (opts.someday !== undefined) q = q.eq('someday', opts.someday);

  const { data, error } = await q
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('sort_order', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as unknown as TaskRow[]).map(toTaskSummary);
}

// ---------------------------------------------------------------------------
// Lists

/** A planner list (the app's "note": a named to-do list / brain-dump). */
export interface TaskList {
  id: string;
  title: string;
  archived: boolean;
  pinned: boolean;
  sort_order: number;
}

/** The user's planner lists, pinned first then by sort order. These are real
    rows in planner_notes (not derived from tasks); a task joins to one via
    planner_tasks.note_id. */
export async function listTaskLists(
  client: SupabaseClient,
  userId: string,
): Promise<TaskList[]> {
  const { data, error } = await client
    .from('planner_notes')
    .select('id, title, archived, pinned, sort_order')
    .eq('user_id', userId)
    .order('pinned', { ascending: false })
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TaskList[];
}

/** Create a new named planner list (a planner_notes row) and return it.
    Additive — never deletes or overwrites. Column defaults fill body/sort_order. */
export async function createList(
  client: SupabaseClient,
  userId: string,
  args: { title: string; pinned?: boolean },
): Promise<TaskList> {
  const row: Record<string, unknown> = {
    user_id: userId,
    title: args.title,
    archived: false,
  };
  if (args.pinned != null) row.pinned = args.pinned;
  const { data, error } = await client
    .from('planner_notes')
    .insert(row)
    .select('id, title, archived, pinned, sort_order')
    .single();
  if (error) throw error;
  return data as TaskList;
}

// ---------------------------------------------------------------------------
// Counts

export interface TaskCounts {
  open: number;
  done: number;
  /** Open, dated tasks whose due_date is strictly before today. */
  overdue: number;
  /** Open tasks flagged Someday. */
  someday: number;
}

/** A small tally of the user's to-dos, derived in JS. Counts only kind='task'
    rows (headings are section dividers, never real to-dos), matching the app.
    `now` defaults to new Date(), like dashboardCore.ts. */
export async function getTaskCounts(
  client: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<TaskCounts> {
  const todayIso = isoDay(now);
  const { data, error } = await client
    .from('planner_tasks')
    .select('done, due_date, someday')
    .eq('user_id', userId)
    .eq('kind', 'task');
  if (error) throw error;

  const rows = (data ?? []) as { done: boolean; due_date: string | null; someday: boolean }[];
  let open = 0;
  let done = 0;
  let overdue = 0;
  let someday = 0;
  for (const r of rows) {
    if (r.done) {
      done += 1;
      continue;
    }
    open += 1;
    if (r.someday) someday += 1;
    if (!r.someday && r.due_date && r.due_date < todayIso) overdue += 1;
  }
  return { open, done, overdue, someday };
}

// ---------------------------------------------------------------------------
// Writes
//
// These mirror the Planner module's create/update paths (src/modules/planner/
// api.ts) but are client-injected: no browser singleton, no crypto/React.
// Every write filters by user_id, sets only columns that exist in the schema,
// throws on error, and returns the affected row(s) as plain TaskSummary objects.
// Nothing here deletes — completing a task flips `done`, it never removes rows.

/** Create one to-do. Inserts a single planner_tasks row (kind='task',
    done=false). `listId` maps to note_id (the task's list), `priority` to the
    `flagged` star, `estimateMinutes` to estimate_minutes, `feelGood` to
    feel_good. Omitted flags fall back to the column defaults. Returns the
    created row. */
export async function createTask(
  client: SupabaseClient,
  userId: string,
  args: {
    title: string;
    dueDate?: string;
    listId?: string;
    priority?: boolean;
    someday?: boolean;
    estimateMinutes?: number;
    feelGood?: boolean;
  },
): Promise<TaskSummary> {
  const row: Record<string, unknown> = {
    user_id: userId,
    kind: 'task',
    title: args.title,
    done: false,
    note_id: args.listId ?? null,
    due_date: args.dueDate ?? null,
    someday: args.someday ?? false,
  };
  // Only set the optional booleans/number when provided, so their column
  // defaults (flagged/feel_good = false, estimate_minutes = NULL) apply otherwise.
  if (args.priority != null) row.flagged = args.priority;
  if (args.feelGood != null) row.feel_good = args.feelGood;
  if (args.estimateMinutes != null) row.estimate_minutes = args.estimateMinutes;

  const { data, error } = await client
    .from('planner_tasks')
    .insert(row)
    .select(TASK_COLUMNS)
    .single();
  if (error) throw error;
  return toTaskSummary(data as unknown as TaskRow);
}

/** Mark a to-do complete: set done=true and done_at=now() for the given task,
    scoped to the user. Non-destructive (no delete). Returns the updated row. */
export async function completeTask(
  client: SupabaseClient,
  userId: string,
  args: { taskId: string },
): Promise<TaskSummary> {
  const { data, error } = await client
    .from('planner_tasks')
    .update({
      done: true,
      done_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', args.taskId)
    .select(TASK_COLUMNS)
    .single();
  if (error) throw error;
  return toTaskSummary(data as unknown as TaskRow);
}

/** The most tasks addTasks will insert in a single call. Guards against a
    runaway import (e.g. a giant paste from an old planning app) rather than
    silently truncating the batch. */
export const ADD_TASKS_MAX = 200;

/** Bulk-create to-dos in one insert — powers importing a backlog from another
    planning app. Each task inserts as kind='task', done=false; `listId` maps to
    note_id, `dueDate` to due_date. Caps the batch at ADD_TASKS_MAX (200) and
    throws if more are passed rather than dropping any. Returns the created rows. */
export async function addTasks(
  client: SupabaseClient,
  userId: string,
  tasks: Array<{ title: string; dueDate?: string; listId?: string }>,
): Promise<TaskSummary[]> {
  if (tasks.length === 0) return [];
  if (tasks.length > ADD_TASKS_MAX) {
    throw new Error(
      `addTasks: too many tasks (${tasks.length}); cap is ${ADD_TASKS_MAX} per call. ` +
        'Split the import into smaller batches.',
    );
  }

  const rows = tasks.map((t) => ({
    user_id: userId,
    kind: 'task',
    title: t.title,
    done: false,
    note_id: t.listId ?? null,
    due_date: t.dueDate ?? null,
  }));

  const { data, error } = await client
    .from('planner_tasks')
    .insert(rows)
    .select(TASK_COLUMNS);
  if (error) throw error;
  return ((data ?? []) as unknown as TaskRow[]).map(toTaskSummary);
}
