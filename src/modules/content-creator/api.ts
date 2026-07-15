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
  patch: Partial<Pick<ContentHook, 'hook_text' | 'scene_excerpt' | 'rationale' | 'tags' | 'status' | 'favorite' | 'test_result'>>,
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

// ---------------- Creatives (slideshows / screenshots / videos) ----------------

export interface ContentCreative {
  id: string;
  user_id: string;
  book_id: string | null;
  hook_id: string | null;
  type: 'slideshow' | 'screenshot' | 'video';
  title: string;
  payload: Record<string, unknown>;
  status: 'draft' | 'final';
  created_at: string;
  updated_at: string;
}

export async function listCreatives(userId: string, bookId: string, type: ContentCreative['type']): Promise<ContentCreative[]> {
  const { data, error } = await supabase
    .from('content_creatives')
    .select('*')
    .eq('user_id', userId)
    .eq('book_id', bookId)
    .eq('type', type)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function insertCreative(
  userId: string,
  row: Pick<ContentCreative, 'book_id' | 'hook_id' | 'type' | 'title' | 'payload'>,
): Promise<ContentCreative> {
  const { data, error } = await supabase
    .from('content_creatives')
    .insert({ ...row, user_id: userId })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateCreative(
  id: string,
  patch: Partial<Pick<ContentCreative, 'title' | 'payload' | 'status'>>,
): Promise<ContentCreative> {
  const { data, error } = await supabase
    .from('content_creatives')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCreative(id: string): Promise<void> {
  const { error } = await supabase.from('content_creatives').delete().eq('id', id);
  if (error) throw error;
}

// Upload a user-provided background to the public media-outputs bucket
// (client uploads to own folder are allowed by the 024 policies) and return
// its stable public URL.
export async function uploadBackground(userId: string, file: File): Promise<string> {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'png';
  const path = `${userId}/content-creator/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from('media-outputs')
    .upload(path, file, { cacheControl: '31536000', upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('media-outputs').getPublicUrl(path);
  return data.publicUrl;
}

// Completed video generations, for the composer's background picker.
export async function listLibraryVideos(userId: string): Promise<Array<{ id: string; url: string; prompt: string }>> {
  const { data, error } = await supabase
    .from('media_generations')
    .select('id, output_url, prompt, kind, status')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? [])
    .filter(g => g.output_url && g.kind === 'video')
    .map(g => ({ id: g.id, url: g.output_url as string, prompt: g.prompt ?? '' }));
}

// Generate a background-music track via the BYOK ElevenLabs endpoint.
export async function generateMusic(prompt: string, durationSeconds: number): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  const res = await fetch('/api/content/music', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, duration_seconds: durationSeconds }),
  });
  const json = await res.json().catch(() => ({})) as { url?: string; error?: string };
  if (!res.ok || !json.url) throw new Error(json.error || `Music generation failed (${res.status}).`);
  return json.url;
}

// The user's completed image generations, for the background library picker.
export async function listLibraryImages(userId: string): Promise<Array<{ id: string; url: string; prompt: string }>> {
  const { data, error } = await supabase
    .from('media_generations')
    .select('id, output_url, prompt, kind, status')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? [])
    .filter(g => g.output_url && g.kind === 'image')
    .map(g => ({ id: g.id, url: g.output_url as string, prompt: g.prompt ?? '' }));
}

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
