// Small wrapper around the /api/media/* endpoints. Pulls the user's
// Supabase access token and forwards it as a bearer header so the
// serverless handlers can authenticate the caller.

import { supabase } from '../../../lib/supabase';
import type { MediaGeneration } from './types';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return { 'Authorization': `Bearer ${token}` };
}

export interface GeneratePayload {
  model: string;
  prompt: string;
  full_prompt?: string;
  style_preset_id?: string | null;
  width?: number;
  height?: number;
  source_image_url?: string | null;
  source_image_urls?: string[];
  num_images?: number;
  collection_id?: string | null;
  // GPT Image 1 only — 'low' / 'medium' / 'high' / 'auto'. Other
  // models ignore it.
  quality?: string;
}

// Returns every generation row produced by the request. Image batches
// (num_images > 1) yield one row per image; video and single-image
// requests yield exactly one.
export async function requestGeneration(payload: GeneratePayload): Promise<MediaGeneration[]> {
  const headers = await authHeader();
  const res = await fetch('/api/media/generate', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`;
    throw new Error(message);
  }
  if (Array.isArray(data.generations)) return data.generations as MediaGeneration[];
  if (data.generation) return [data.generation as MediaGeneration];
  return [];
}

export async function pollGenerationStatus(id: string): Promise<MediaGeneration> {
  const headers = await authHeader();
  const res = await fetch(`/api/media/status?id=${encodeURIComponent(id)}`, {
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Status check failed (${res.status})`);
  }
  return data.generation as MediaGeneration;
}

export interface FalKeyStatus {
  has_key: boolean;
  hint: string | null;
  updated_at: string | null;
}

export async function getFalKeyStatus(): Promise<FalKeyStatus> {
  const headers = await authHeader();
  const res = await fetch('/api/media/key', { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Key status failed (${res.status})`);
  return data as FalKeyStatus;
}

export async function setFalKey(key: string): Promise<FalKeyStatus> {
  const headers = await authHeader();
  const res = await fetch('/api/media/key', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Failed to save key (${res.status})`);
  return { has_key: true, hint: data.hint ?? null, updated_at: new Date().toISOString() };
}

export async function removeFalKey(): Promise<void> {
  const headers = await authHeader();
  const res = await fetch('/api/media/key', { method: 'DELETE', headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data?.error === 'string' ? data.error : `Failed to remove key (${res.status})`);
  }
}

export async function getOpenaiKeyStatus(): Promise<FalKeyStatus> {
  const headers = await authHeader();
  const res = await fetch('/api/media/openai-key', { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Key status failed (${res.status})`);
  return data as FalKeyStatus;
}

export async function setOpenaiKey(key: string): Promise<FalKeyStatus> {
  const headers = await authHeader();
  const res = await fetch('/api/media/openai-key', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Failed to save key (${res.status})`);
  return { has_key: true, hint: data.hint ?? null, updated_at: new Date().toISOString() };
}

export async function removeOpenaiKey(): Promise<void> {
  const headers = await authHeader();
  const res = await fetch('/api/media/openai-key', { method: 'DELETE', headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data?.error === 'string' ? data.error : `Failed to remove key (${res.status})`);
  }
}

export async function uploadInputImage(file: File): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) throw new Error('Not signed in');

  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'png';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from('media-inputs')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (uploadErr) throw uploadErr;

  // Inputs bucket is private — Fal needs a fetchable URL, so we mint a
  // long-lived signed URL valid for an hour (more than enough for the
  // generation to start). For video models that may take longer to
  // pick up the input from queue, we extend to 6 hours.
  const { data: signed, error: signErr } = await supabase.storage
    .from('media-inputs')
    .createSignedUrl(path, 60 * 60 * 6);
  if (signErr || !signed) throw signErr ?? new Error('Failed to sign upload URL');
  return signed.signedUrl;
}
