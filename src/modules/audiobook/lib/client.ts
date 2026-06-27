// Wrapper around the /api/audiobook endpoint. Attaches the user's Supabase
// access token so the serverless handler can authenticate them and use their
// own ElevenLabs / Claude keys. Mirrors the Media + Planner key clients.

import { supabase } from '../../../lib/supabase';
import type { ElevenVoice, NarrationMode, VoicePreview } from '../types';
import type { AttributedSegment } from './attribution';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  return { Authorization: `Bearer ${token}` };
}

async function postJson<T>(action: string, payload: unknown): Promise<T> {
  const headers = await authHeader();
  const res = await fetch(`/api/audiobook?action=${action}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data?.detail === 'string' && data.detail ? data.detail
      : typeof data?.error === 'string' ? data.error
      : `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return data as T;
}

// ---- ElevenLabs API key (BYOK) ----

export interface KeyStatus { has_key: boolean; hint: string | null; updated_at: string | null }

export async function getElevenlabsKeyStatus(): Promise<KeyStatus> {
  const headers = await authHeader();
  const res = await fetch('/api/audiobook?action=key', { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Key status failed (${res.status}).`);
  return data as KeyStatus;
}

export async function setElevenlabsKey(key: string): Promise<KeyStatus> {
  const data = await postJson<{ hint?: string }>('key', { key });
  return { has_key: true, hint: data.hint ?? null, updated_at: new Date().toISOString() };
}

export async function removeElevenlabsKey(): Promise<void> {
  const headers = await authHeader();
  const res = await fetch('/api/audiobook?action=key', { method: 'DELETE', headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data?.error === 'string' ? data.error : `Failed to remove key (${res.status}).`);
  }
}

// ---- Voices ----

export async function listVoices(): Promise<ElevenVoice[]> {
  const headers = await authHeader();
  const res = await fetch('/api/audiobook?action=voices', { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Could not list voices (${res.status}).`);
  return Array.isArray(data.voices) ? (data.voices as ElevenVoice[]) : [];
}

// ---- Voice Design ----

export async function designVoice(voiceDescription: string, text?: string): Promise<{ previews: VoicePreview[]; text: string }> {
  return postJson('design', { voice_description: voiceDescription, text });
}

export async function saveDesignedVoice(voiceName: string, voiceDescription: string, generatedVoiceId: string): Promise<{ voice_id: string; name: string }> {
  return postJson('design-save', { voice_name: voiceName, voice_description: voiceDescription, generated_voice_id: generatedVoiceId });
}

// ---- Instant Voice Cloning ----

export interface CloneSample { filename: string; content_type: string; base64: string }

export async function cloneVoice(name: string, samples: CloneSample[], description?: string): Promise<{ voice_id: string; name: string }> {
  return postJson('clone', { name, description, samples });
}

// ---- AI speaker attribution ----

export async function attributeChunk(text: string, mode: NarrationMode): Promise<AttributedSegment[]> {
  const data = await postJson<{ segments?: AttributedSegment[] }>('attribute', { text, mode });
  return Array.isArray(data.segments) ? data.segments : [];
}

// ---- Render ----

export async function renderSegment(
  voiceId: string,
  text: string,
  modelId: string,
): Promise<{ audioBase64: string; contentType: string }> {
  const data = await postJson<{ audio_base64?: string; content_type?: string }>('render', {
    voice_id: voiceId, text, model_id: modelId,
  });
  return { audioBase64: data.audio_base64 ?? '', contentType: data.content_type ?? 'audio/mpeg' };
}
