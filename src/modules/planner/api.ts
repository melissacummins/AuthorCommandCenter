import { supabase } from '../../lib/supabase';
import type { PlannerNote, PlannerTask } from './types';

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
  patch: Partial<Pick<PlannerNote, 'title' | 'body' | 'pinned' | 'archived' | 'sort_order'>>,
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
  input: { title: string; note_id?: string | null; due_date?: string | null; someday?: boolean },
): Promise<PlannerTask> {
  const { data, error } = await supabase
    .from('planner_tasks')
    .insert({
      user_id: userId,
      title: input.title,
      note_id: input.note_id ?? null,
      due_date: input.due_date ?? null,
      someday: input.someday ?? false,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as PlannerTask;
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<PlannerTask, 'title' | 'done' | 'due_date' | 'someday' | 'note_id' | 'sort_order'>>,
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
