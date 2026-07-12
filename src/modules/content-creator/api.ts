import { supabase } from '../../lib/supabase';
import type {
  ContentHook, ContentScan, HookCandidate, HookStatus,
  PlaybookEntry, PlaybookEntryInsert, PlaybookRule, RuleType,
  DefaultBannedWord, AiTask, ModelSetting,
} from './types';

// ---------------- Hooks ----------------

export async function listHooks(userId: string, bookId: string): Promise<ContentHook[]> {
  const { data, error } = await supabase
    .from('content_hooks')
    .select('*')
    .eq('user_id', userId)
    .eq('book_id', bookId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function insertHooks(
  userId: string,
  rows: Array<Pick<ContentHook, 'book_id' | 'manuscript_id' | 'hook_text' | 'scene_excerpt' | 'rationale' | 'tags' | 'source'>>,
): Promise<ContentHook[]> {
  const { data, error } = await supabase
    .from('content_hooks')
    .insert(rows.map(r => ({ ...r, user_id: userId })))
    .select('*');
  if (error) throw error;
  return data ?? [];
}

export async function updateHook(
  id: string,
  patch: Partial<Pick<ContentHook, 'hook_text' | 'scene_excerpt' | 'rationale' | 'tags' | 'status' | 'favorite'>>,
): Promise<ContentHook> {
  const { data, error } = await supabase
    .from('content_hooks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteHook(id: string): Promise<void> {
  const { error } = await supabase.from('content_hooks').delete().eq('id', id);
  if (error) throw error;
}

// Bulk cleanup after a bad scan: wipe everything still in 'candidate' for a
// book (approved and archived hooks are never touched).
export async function deleteCandidateHooks(userId: string, bookId: string): Promise<void> {
  const { error } = await supabase
    .from('content_hooks')
    .delete()
    .eq('user_id', userId)
    .eq('book_id', bookId)
    .eq('status', 'candidate');
  if (error) throw error;
}

export async function setHookStatus(id: string, status: HookStatus): Promise<ContentHook> {
  return updateHook(id, { status });
}

// ---------------- Scans ----------------

export async function getRunningScan(userId: string, manuscriptId: string): Promise<ContentScan | null> {
  const { data, error } = await supabase
    .from('content_scans')
    .select('*')
    .eq('user_id', userId)
    .eq('manuscript_id', manuscriptId)
    .eq('status', 'running')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createScan(userId: string, manuscriptId: string, modelUsed: string): Promise<ContentScan> {
  const { data, error } = await supabase
    .from('content_scans')
    .insert({ user_id: userId, manuscript_id: manuscriptId, model_used: modelUsed })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateScan(
  id: string,
  patch: Partial<Pick<ContentScan, 'status' | 'scanned_chapter_ids' | 'candidates' | 'model_used'>>,
): Promise<ContentScan> {
  const { data, error } = await supabase
    .from('content_scans')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export type { HookCandidate };

// ---------------- Playbook entries ----------------

export async function listPlaybookEntries(userId: string): Promise<PlaybookEntry[]> {
  const { data, error } = await supabase
    .from('hook_playbook_entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function insertPlaybookEntries(userId: string, rows: PlaybookEntryInsert[]): Promise<PlaybookEntry[]> {
  const { data, error } = await supabase
    .from('hook_playbook_entries')
    .insert(rows.map(r => ({ ...r, user_id: userId })))
    .select('*');
  if (error) throw error;
  return data ?? [];
}

export async function updatePlaybookEntry(id: string, patch: Partial<PlaybookEntryInsert>): Promise<PlaybookEntry> {
  const { data, error } = await supabase
    .from('hook_playbook_entries')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deletePlaybookEntry(id: string): Promise<void> {
  const { error } = await supabase.from('hook_playbook_entries').delete().eq('id', id);
  if (error) throw error;
}

// ---------------- Rules (style / avatar / banned words) ----------------

export async function listRules(userId: string): Promise<PlaybookRule[]> {
  const { data, error } = await supabase
    .from('playbook_rules')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function insertRule(
  userId: string, ruleType: RuleType, content: string, replacement?: string | null,
): Promise<PlaybookRule> {
  const { data, error } = await supabase
    .from('playbook_rules')
    .insert({ user_id: userId, rule_type: ruleType, content, replacement: replacement ?? null })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateRule(id: string, patch: Partial<Pick<PlaybookRule, 'content' | 'replacement' | 'active'>>): Promise<PlaybookRule> {
  const { data, error } = await supabase
    .from('playbook_rules')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRule(id: string): Promise<void> {
  const { error } = await supabase.from('playbook_rules').delete().eq('id', id);
  if (error) throw error;
}

// ---------------- Default banned words + opt-outs ----------------

export async function listDefaultBannedWords(): Promise<DefaultBannedWord[]> {
  const { data, error } = await supabase
    .from('default_banned_words')
    .select('*')
    .order('word', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function listBannedWordOptouts(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_banned_word_optouts')
    .select('word_id')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map(r => r.word_id);
}

export async function setBannedWordOptout(userId: string, wordId: string, optedOut: boolean): Promise<void> {
  if (optedOut) {
    const { error } = await supabase.from('user_banned_word_optouts').upsert({ user_id: userId, word_id: wordId });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('user_banned_word_optouts')
      .delete()
      .eq('user_id', userId)
      .eq('word_id', wordId);
    if (error) throw error;
  }
}

// ---------------- Per-task model settings ----------------

export async function listModelSettings(userId: string): Promise<ModelSetting[]> {
  const { data, error } = await supabase
    .from('content_model_settings')
    .select('task, provider, model_id')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as ModelSetting[];
}

export async function saveModelSetting(userId: string, task: AiTask, provider: string, modelId: string): Promise<void> {
  const { error } = await supabase
    .from('content_model_settings')
    .upsert({ user_id: userId, task, provider, model_id: modelId, updated_at: new Date().toISOString() });
  if (error) throw error;
}
