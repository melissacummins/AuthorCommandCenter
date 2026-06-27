// Domain types for the Audiobook module. A project carries the cast (which
// ElevenLabs voice plays each role) and a narration mode; segments are the
// ordered, speaker-tagged pieces of the manuscript that get rendered one by one.

export type NarrationMode = 'narrator_plus_two' | 'duet';
export type Speaker = 'narrator' | 'male' | 'female';
export type SegmentStatus = 'pending' | 'rendered' | 'error';

export interface AudiobookProject {
  id: string;
  user_id: string;
  book_id: string | null;
  title: string;
  manuscript: string;
  narration_mode: NarrationMode;
  narrator_role: 'male' | 'female'; // which voice narrates in duet mode
  narrator_voice_id: string | null;
  narrator_voice_name: string | null;
  male_voice_id: string | null;
  male_voice_name: string | null;
  female_voice_id: string | null;
  female_voice_name: string | null;
  model_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export type AudiobookProjectInsert = {
  title?: string;
  book_id?: string | null;
  narration_mode?: NarrationMode;
  narrator_role?: 'male' | 'female';
  model_id?: string;
};

export type AudiobookProjectUpdate = Partial<Omit<AudiobookProject, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export interface AudiobookChapter {
  id: string;
  project_id: string;
  user_id: string;
  idx: number;
  title: string;
  source_text: string;
  status: string;
  created_at: string;
  updated_at: string;
}

// A scanned-but-not-yet-saved chapter (the breakdown the user reviews/edits
// before accepting).
export interface ChapterDraft {
  title: string;
  source_text: string;
}

export interface AudiobookSegment {
  id: string;
  project_id: string;
  chapter_id: string | null;
  user_id: string;
  idx: number;
  speaker: Speaker;
  character_name: string | null;
  text: string;
  audio_path: string | null;
  status: SegmentStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// A voice as returned by ElevenLabs' list-voices endpoint (slimmed server-side).
export interface ElevenVoice {
  voice_id: string;
  name: string;
  category: string | null;
  gender: string | null;
  accent: string | null;
  age: string | null;
  preview_url: string | null;
}

// A generated preview from the Voice Design flow, before it's saved as a voice.
export interface VoicePreview {
  generated_voice_id: string;
  audio_base64: string;
  media_type: string;
}

// The three slots the cast can fill, per narration mode.
export const ROLE_LABELS: Record<Speaker, string> = {
  narrator: 'Narrator',
  male: 'Male character',
  female: 'Female character',
};

// Which ElevenLabs models the user can pick for synthesis. v3 is the most
// expressive (best for emotional dialogue); multilingual_v2 is the dependable
// long-form default; the v2.5 models trade some richness for speed/cost.
export const MODEL_OPTIONS: { id: string; label: string; note: string }[] = [
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2', note: 'Reliable, natural long-form narration (default)' },
  { id: 'eleven_v3', label: 'Eleven v3', note: 'Most expressive — best for emotional dialogue' },
  { id: 'eleven_turbo_v2_5', label: 'Turbo v2.5', note: 'Faster & cheaper, slightly less rich' },
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5', note: 'Fastest & lowest cost' },
];

// Resolve which voice id should read a given speaker, honoring the mode.
export function voiceForSpeaker(project: AudiobookProject, speaker: Speaker): { id: string | null; name: string | null } {
  if (project.narration_mode === 'duet' && speaker === 'narrator') {
    return project.narrator_role === 'male'
      ? { id: project.male_voice_id, name: project.male_voice_name }
      : { id: project.female_voice_id, name: project.female_voice_name };
  }
  if (speaker === 'male') return { id: project.male_voice_id, name: project.male_voice_name };
  if (speaker === 'female') return { id: project.female_voice_id, name: project.female_voice_name };
  return { id: project.narrator_voice_id, name: project.narrator_voice_name };
}

// Which roles need a voice assigned for this mode (drives the Cast step + the
// "ready to render" check).
export function rolesForMode(mode: NarrationMode): Speaker[] {
  return mode === 'duet' ? ['female', 'male'] : ['narrator', 'female', 'male'];
}

// True once every role this mode needs has a voice id.
export function castComplete(project: AudiobookProject): boolean {
  return rolesForMode(project.narration_mode).every(role => {
    if (role === 'male') return !!project.male_voice_id;
    if (role === 'female') return !!project.female_voice_id;
    return !!project.narrator_voice_id;
  });
}
