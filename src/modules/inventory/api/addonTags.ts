import { supabase } from '../../../lib/supabase';

export interface AddonTag {
  id: string;
  user_id: string;
  label: string;
  color: string;
  created_at: string;
}

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

export async function getAddonTags(): Promise<AddonTag[]> {
  const { data, error } = await supabase
    .from('addon_tags')
    .select('*')
    .order('label');
  if (error) throw error;
  return (data || []) as AddonTag[];
}

export async function upsertAddonTagColor(label: string, color: string): Promise<void> {
  const user_id = await getUserId();
  const { error } = await supabase
    .from('addon_tags')
    .upsert({ user_id, label, color }, { onConflict: 'user_id,label' });
  if (error) throw error;
}

export async function deleteAddonTag(label: string): Promise<void> {
  const user_id = await getUserId();
  const { error } = await supabase
    .from('addon_tags')
    .delete()
    .eq('user_id', user_id)
    .eq('label', label);
  if (error) throw error;
}
