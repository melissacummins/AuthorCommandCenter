import { supabase } from './supabase';

// Starred AI models, shared app-wide (Writing chat, Content Creator, and any
// future AI surface). Stored per user in model_favorites (migration 100) so
// favorites follow the account, not the browser.

export interface ModelFavorite {
  provider: string;
  model_id: string;
}

export async function listModelFavorites(userId: string): Promise<ModelFavorite[]> {
  const { data, error } = await supabase
    .from('model_favorites')
    .select('provider, model_id')
    .eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}

export async function addModelFavorite(userId: string, provider: string, modelId: string): Promise<void> {
  const { error } = await supabase
    .from('model_favorites')
    .upsert({ user_id: userId, provider, model_id: modelId });
  if (error) throw error;
}

export async function removeModelFavorite(userId: string, provider: string, modelId: string): Promise<void> {
  const { error } = await supabase
    .from('model_favorites')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('model_id', modelId);
  if (error) throw error;
}
