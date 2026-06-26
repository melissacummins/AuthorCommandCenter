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
  // Ideogram v3 only — 'TURBO' / 'DEFAULT' / 'QUALITY'.
  rendering_speed?: string;
}

// Returns every generation row produced by the request. Image batches
// (num_images > 1) yield one row per image; video and single-image
// requests yield exactly one.
export interface GenerationResponse {
  generations: MediaGeneration[];
  // Set when the server signalled a failure. The full provider-side
  // message (e.g. an OpenAI safety violation explanation) gets surfaced
  // here so the caller can show it immediately instead of waiting for
  // the user to refresh.
  error?: string;
}

export async function requestGeneration(payload: GeneratePayload): Promise<GenerationResponse> {
  const headers = await authHeader();
  const res = await fetch('/api/media/generate', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  const generations: MediaGeneration[] = Array.isArray(data.generations)
    ? (data.generations as MediaGeneration[])
    : (data.generation ? [data.generation as MediaGeneration] : []);
  if (!res.ok) {
    // Prefer the descriptive `detail` (full provider message) over the
    // short `error` header so the user sees what actually happened.
    const message = typeof data?.detail === 'string' ? data.detail
      : typeof data?.error === 'string' ? data.error
      : `Request failed (${res.status})`;
    return { generations, error: message };
  }
  return { generations };
}

// Image-to-prompt via Florence-2 (run through Fal). Pass a URL that
// the server can reach — i.e. an already-uploaded media-inputs URL.
export async function describeImage(imageUrl: string): Promise<string> {
  const headers = await authHeader();
  const res = await fetch('/api/media/generate?action=describe', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Describe failed (${res.status})`);
  }
  return typeof data?.caption === 'string' ? data.caption : '';
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

// Provider routing is via ?provider=fal|openai on a single endpoint
// (Vercel Hobby caps a deployment at 12 serverless functions, so we
// can't split them into two files).
type KeyProvider = 'fal' | 'openai' | 'ideogram';

async function getKeyStatus(provider: KeyProvider): Promise<FalKeyStatus> {
  const headers = await authHeader();
  const res = await fetch(`/api/media/key?provider=${provider}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Key status failed (${res.status})`);
  return data as FalKeyStatus;
}

async function saveKey(provider: KeyProvider, key: string): Promise<FalKeyStatus> {
  const headers = await authHeader();
  const res = await fetch(`/api/media/key?provider=${provider}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Failed to save key (${res.status})`);
  return { has_key: true, hint: data.hint ?? null, updated_at: new Date().toISOString() };
}

async function deleteKey(provider: KeyProvider): Promise<void> {
  const headers = await authHeader();
  const res = await fetch(`/api/media/key?provider=${provider}`, { method: 'DELETE', headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data?.error === 'string' ? data.error : `Failed to remove key (${res.status})`);
  }
}

export const getFalKeyStatus = () => getKeyStatus('fal');
export const setFalKey = (key: string) => saveKey('fal', key);
export const removeFalKey = () => deleteKey('fal');
export const getOpenaiKeyStatus = () => getKeyStatus('openai');
export const setOpenaiKey = (key: string) => saveKey('openai', key);
export const removeOpenaiKey = () => deleteKey('openai');
export const getIdeogramKeyStatus = () => getKeyStatus('ideogram');
export const setIdeogramKey = (key: string) => saveKey('ideogram', key);
export const removeIdeogramKey = () => deleteKey('ideogram');

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
