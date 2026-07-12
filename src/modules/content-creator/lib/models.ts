import type { AiTask, ModelSetting } from '../types';

// The ONLY place default model ids live (directive ground rule 3). Every AI
// call reads the user's content_model_settings row first; these are just the
// out-of-the-box values shown until the user picks something else, and the
// single spot to update if a default model is ever retired.
export const DEFAULT_MODELS: Record<AiTask, ModelSetting> = {
  // Per-chapter extraction runs dozens of times per scan — default to the
  // current small/cheap tier.
  extract: { task: 'extract', provider: 'anthropic', model_id: 'claude-haiku-4-5' },
  synonym: { task: 'synonym', provider: 'anthropic', model_id: 'claude-haiku-4-5' },
  image_prompt: { task: 'image_prompt', provider: 'anthropic', model_id: 'claude-haiku-4-5' },
  // Taste-sensitive tasks default to the app's standard model (same default
  // the Writing module ships with).
  rank: { task: 'rank', provider: 'anthropic', model_id: 'claude-sonnet-4-6' },
  slides: { task: 'slides', provider: 'anthropic', model_id: 'claude-sonnet-4-6' },
  script: { task: 'script', provider: 'anthropic', model_id: 'claude-sonnet-4-6' },
  copy: { task: 'copy', provider: 'anthropic', model_id: 'claude-sonnet-4-6' },
  catalog: { task: 'catalog', provider: 'anthropic', model_id: 'claude-sonnet-4-6' },
};

export const TASK_LABELS: Record<AiTask, { name: string; hint: string }> = {
  extract: { name: 'Hook extraction', hint: 'Reads each chapter during a scan. Runs once per chapter — a small, cheap model is ideal.' },
  rank: { name: 'Hook ranking & wording', hint: 'Distills all scan candidates into your hook list. Runs once per scan.' },
  slides: { name: 'Slideshow writing', hint: 'Turns an approved hook into slide-by-slide text.' },
  script: { name: 'Video scripts', hint: 'Writes timed caption scripts for the video composer.' },
  copy: { name: 'Ad copy & imports', hint: 'Ad copy drafts and AI-assisted playbook imports.' },
  image_prompt: { name: 'Image prompts', hint: 'Turns a scene into a background-image prompt for the Media generator.' },
  synonym: { name: 'Safe-word suggestions', hint: 'Suggests platform-safe synonyms for banned words.' },
  catalog: { name: 'Catalog autofill', hint: 'Proposes catalog fields (tropes, heat, subgenre…) from a manuscript scan.' },
};

export const ALL_TASKS = Object.keys(DEFAULT_MODELS) as AiTask[];

// Default image model for slide backgrounds (fast + pennies). Same rule as
// AI tasks: one place to change, user-selectable in the slideshow editor.
export const DEFAULT_IMAGE_MODEL = 'flux-schnell';
