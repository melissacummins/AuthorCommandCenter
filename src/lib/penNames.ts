import { supabase } from './supabase';

// Curated palette — must match the Tailwind class lookups in PenNameChip.
// Adding a new color here requires updating PEN_NAME_COLOR_CLASSES too.
export const PEN_NAME_COLORS = [
  'slate', 'rose', 'pink', 'fuchsia', 'purple', 'violet',
  'indigo', 'blue', 'cyan', 'teal', 'emerald', 'amber',
] as const;
export type PenNameColor = (typeof PEN_NAME_COLORS)[number];

export interface PenName {
  id: string;
  user_id: string;
  name: string;
  color: PenNameColor;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PenNameInsert {
  name: string;
  color?: PenNameColor;
  notes?: string | null;
}

export async function listPenNames(userId: string): Promise<PenName[]> {
  const { data, error } = await supabase
    .from('pen_names')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PenName[];
}

export async function createPenName(userId: string, input: PenNameInsert): Promise<PenName> {
  const { data, error } = await supabase
    .from('pen_names')
    .insert({
      user_id: userId,
      name: input.name.trim(),
      color: input.color ?? 'slate',
      notes: input.notes ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as PenName;
}

export async function updatePenName(id: string, patch: Partial<PenNameInsert>): Promise<PenName> {
  const { data, error } = await supabase
    .from('pen_names')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as PenName;
}

export async function deletePenName(id: string): Promise<void> {
  const { error } = await supabase.from('pen_names').delete().eq('id', id);
  if (error) throw error;
}
