// Supabase data layer for the Audiobook module: project + segment CRUD and the
// audiobook-audio storage bucket (private, per-user folders). RLS scopes every
// row/object to the owner; we still pass user_id explicitly on insert to satisfy
// the WITH CHECK policies.

import { supabase } from '../../lib/supabase';
import type {
  AudiobookProject, AudiobookProjectInsert, AudiobookProjectUpdate, AudiobookSegment,
} from './types';
import type { AttributedSegment } from './lib/attribution';

const BUCKET = 'audiobook-audio';

// ---- Projects ----

export async function listProjects(userId: string): Promise<AudiobookProject[]> {
  const { data, error } = await supabase
    .from('audiobook_projects')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AudiobookProject[];
}

export async function getProject(id: string): Promise<AudiobookProject | null> {
  const { data, error } = await supabase.from('audiobook_projects').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as AudiobookProject) ?? null;
}

export async function createProject(userId: string, input: AudiobookProjectInsert): Promise<AudiobookProject> {
  const { data, error } = await supabase
    .from('audiobook_projects')
    .insert({ user_id: userId, ...input })
    .select('*')
    .single();
  if (error) throw error;
  return data as AudiobookProject;
}

export async function updateProject(id: string, patch: AudiobookProjectUpdate): Promise<AudiobookProject> {
  const { data, error } = await supabase.from('audiobook_projects').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data as AudiobookProject;
}

export async function deleteProject(id: string): Promise<void> {
  // Best-effort cleanup of the project's audio folder before the rows cascade away.
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (userId) {
    const folder = `${userId}/${id}`;
    const { data: files } = await supabase.storage.from(BUCKET).list(folder);
    if (files?.length) {
      await supabase.storage.from(BUCKET).remove(files.map(f => `${folder}/${f.name}`));
    }
  }
  const { error } = await supabase.from('audiobook_projects').delete().eq('id', id);
  if (error) throw error;
}

// ---- Segments ----

export async function listSegments(projectId: string): Promise<AudiobookSegment[]> {
  const { data, error } = await supabase
    .from('audiobook_segments')
    .select('*')
    .eq('project_id', projectId)
    .order('idx', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AudiobookSegment[];
}

// Replace the project's whole segment list with a freshly-attributed one. Used
// after the AI pass — clears any prior segments (and their audio) and inserts the
// new ones in order.
export async function replaceSegments(
  projectId: string,
  userId: string,
  segments: AttributedSegment[],
): Promise<AudiobookSegment[]> {
  const folder = `${userId}/${projectId}`;
  const { data: files } = await supabase.storage.from(BUCKET).list(folder);
  if (files?.length) {
    await supabase.storage.from(BUCKET).remove(files.map(f => `${folder}/${f.name}`));
  }
  await supabase.from('audiobook_segments').delete().eq('project_id', projectId);
  if (!segments.length) return [];
  const rows = segments.map((s, i) => ({
    project_id: projectId,
    user_id: userId,
    idx: i,
    speaker: s.speaker,
    character_name: s.character_name,
    text: s.text,
    status: 'pending' as const,
  }));
  const { data, error } = await supabase.from('audiobook_segments').insert(rows).select('*').order('idx', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AudiobookSegment[];
}

export async function updateSegment(id: string, patch: Partial<AudiobookSegment>): Promise<AudiobookSegment> {
  const { data, error } = await supabase.from('audiobook_segments').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data as AudiobookSegment;
}

export async function deleteSegment(id: string): Promise<void> {
  const { error } = await supabase.from('audiobook_segments').delete().eq('id', id);
  if (error) throw error;
}

// ---- Audio storage ----

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

// Store a rendered clip and return its storage path (kept on the segment row).
export async function uploadSegmentAudio(
  userId: string,
  projectId: string,
  segmentId: string,
  base64: string,
  contentType: string,
): Promise<string> {
  const path = `${userId}/${projectId}/${segmentId}.mp3`;
  const blob = base64ToBlob(base64, contentType);
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType });
  if (error) throw error;
  return path;
}

// Private bucket — mint a short-lived signed URL for playback/download.
export async function signedAudioUrl(path: string, expiresInSeconds = 60 * 60): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data) throw error ?? new Error('Could not sign audio URL.');
  return data.signedUrl;
}
