// Client wrapper for /api/writing/ai — the Writing module's three-provider AI
// endpoint (Anthropic, OpenRouter, OpenAI). Anthropic key management is NOT
// duplicated here: it already lives in Settings → API Keys via
// src/modules/planner/ai.ts's getAnthropicKeyStatus/setAnthropicKey/
// removeAnthropicKey, and this module reuses that same key server-side.
// OpenRouter gets its own key functions here (added to ApiKeysSection.tsx
// alongside it). OpenAI reuses the Media module's existing user_openai_keys
// row (src/modules/media/lib/client.ts's getOpenaiKeyStatus) — no new table,
// no new Settings row (directive §8.7).

import { supabase } from '../../../lib/supabase';

export type AiProvider = 'anthropic' | 'openrouter' | 'openai';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// Turn a plain-text AI response into simple HTML paragraphs so it can be
// inserted into the TipTap editor — mirrors lib/import.ts's textToHtml for
// the same "blank line = new paragraph" convention.
export function plainTextToHtml(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.split(/\n{2,}/).map(b => `<p>${escape(b.trim()).replace(/\n/g, '<br>')}</p>`).join('');
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  return { Authorization: `Bearer ${token}` };
}

export interface AiKeyStatus {
  has_key: boolean;
  hint: string | null;
  updated_at: string | null;
}

export async function getOpenrouterKeyStatus(): Promise<AiKeyStatus> {
  const headers = await authHeader();
  const res = await fetch('/api/writing/ai?action=key&provider=openrouter', { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Key status failed (${res.status}).`);
  return data as AiKeyStatus;
}

export async function setOpenrouterKey(key: string): Promise<AiKeyStatus> {
  const headers = await authHeader();
  const res = await fetch('/api/writing/ai?action=key&provider=openrouter', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Failed to save key (${res.status}).`);
  return { has_key: true, hint: data.hint ?? null, updated_at: new Date().toISOString() };
}

export async function removeOpenrouterKey(): Promise<void> {
  const headers = await authHeader();
  const res = await fetch('/api/writing/ai?action=key&provider=openrouter', { method: 'DELETE', headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data?.error === 'string' ? data.error : `Failed to remove key (${res.status}).`);
  }
}

export interface WritingCompleteInput {
  provider: AiProvider;
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  reasoningEffort?: ReasoningEffort;
  cachingEnabled?: boolean;
}

export async function writingComplete(input: WritingCompleteInput): Promise<string> {
  const headers = await authHeader();
  const res = await fetch('/api/writing/ai', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: input.provider,
      prompt: input.prompt,
      system: input.system,
      model: input.model,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      top_p: input.topP,
      frequency_penalty: input.frequencyPenalty,
      presence_penalty: input.presencePenalty,
      repetition_penalty: input.repetitionPenalty,
      reasoning_effort: input.reasoningEffort,
      caching: input.cachingEnabled,
    }),
  });
  const json = await res.json().catch(() => ({})) as { text?: string; error?: string };
  if (!res.ok) throw new Error(json.error || `AI request failed (${res.status}).`);
  return json.text ?? '';
}

// ---- Provider/model + generation-parameter settings -----------------------
// localStorage-persisted (directive: "fine for v1" — no server-side preset/
// favorite management), shared by the editor's AI row and the chat panel via
// one AiSettingsPanel component.

export interface AiSettings {
  provider: AiProvider;
  model: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  reasoningEffort?: ReasoningEffort;
  cachingEnabled?: boolean;
}

const SETTINGS_KEY = 'writing-ai-settings';
const DEFAULT_SETTINGS: AiSettings = { provider: 'anthropic', model: 'claude-sonnet-4-6' };

export function getAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    const provider: AiProvider = parsed.provider === 'openrouter' || parsed.provider === 'openai' ? parsed.provider : 'anthropic';
    return {
      provider,
      model: typeof parsed.model === 'string' ? parsed.model : DEFAULT_SETTINGS.model,
      maxTokens: typeof parsed.maxTokens === 'number' ? parsed.maxTokens : undefined,
      temperature: typeof parsed.temperature === 'number' ? parsed.temperature : undefined,
      topP: typeof parsed.topP === 'number' ? parsed.topP : undefined,
      frequencyPenalty: typeof parsed.frequencyPenalty === 'number' ? parsed.frequencyPenalty : undefined,
      presencePenalty: typeof parsed.presencePenalty === 'number' ? parsed.presencePenalty : undefined,
      repetitionPenalty: typeof parsed.repetitionPenalty === 'number' ? parsed.repetitionPenalty : undefined,
      reasoningEffort: parsed.reasoningEffort,
      cachingEnabled: !!parsed.cachingEnabled,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function setAiSettings(settings: AiSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Builds the provider/model/generation-parameter portion of a writingComplete
// call from the current settings, applying the per-feature default max
// tokens only when the user hasn't overridden it (directive §8.5: "Defaults:
// max tokens 1024 (editor actions) / 1500 (chat), everything else provider
// default (omitted unless changed)").
export function aiSettingsToRequest(settings: AiSettings, defaultMaxTokens: number): Omit<WritingCompleteInput, 'prompt' | 'system'> {
  return {
    provider: settings.provider,
    model: settings.model,
    maxTokens: settings.maxTokens ?? defaultMaxTokens,
    temperature: settings.temperature,
    topP: settings.topP,
    frequencyPenalty: settings.frequencyPenalty,
    presencePenalty: settings.presencePenalty,
    repetitionPenalty: settings.repetitionPenalty,
    reasoningEffort: settings.reasoningEffort,
    cachingEnabled: settings.cachingEnabled,
  };
}

// ---- Knob applicability (directive §8.5 table — verified current API
// behavior, not a guess: sending an unsupported parameter is a hard 400) ----

export interface KnobState { enabled: boolean; reason?: string }
export interface KnobSupport {
  temperature: KnobState;
  topP: KnobState;
  frequencyPenalty: KnobState;
  presencePenalty: KnobState;
  repetitionPenalty: KnobState;
  reasoning: KnobState;
  caching: KnobState;
}

const SAMPLING_REJECTED = 'Rejected (400) on this model — omit temperature/top-p for Sonnet 5+, Opus 4.7/4.8, and Fable.';

// Sonnet 4.6 / Opus 4.6 (and Haiku, not called out as rejecting) still accept
// temperature/top-p; everything newer — Sonnet 5, Opus 4.7/4.8, Fable 5, and
// any unlisted/future dated id — is treated as rejecting them, per the
// directive's explicit examples. This defaults conservatively (disabled) for
// models the directive doesn't name.
function anthropicRejectsSampling(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m) return true;
  if (/sonnet-4-6|opus-4-6/.test(m)) return false;
  if (/haiku/.test(m)) return false;
  return true;
}

function isOpenAiReasoningModel(model: string): boolean {
  return /^o\d|^gpt-5/i.test(model.trim());
}

export function knobSupport(provider: AiProvider, model: string): KnobSupport {
  if (provider === 'anthropic') {
    const rejects = anthropicRejectsSampling(model);
    return {
      temperature: rejects ? { enabled: false, reason: SAMPLING_REJECTED } : { enabled: true },
      topP: rejects ? { enabled: false, reason: SAMPLING_REJECTED } : { enabled: true },
      frequencyPenalty: { enabled: false, reason: 'Not supported by the Anthropic API.' },
      presencePenalty: { enabled: false, reason: 'Not supported by the Anthropic API.' },
      repetitionPenalty: { enabled: false, reason: 'OpenRouter-specific parameter.' },
      reasoning: { enabled: true },
      caching: { enabled: true },
    };
  }
  if (provider === 'openai') {
    const reasoning = isOpenAiReasoningModel(model);
    return {
      temperature: reasoning ? { enabled: false, reason: 'Reasoning models (o-series, GPT-5) reject temperature.' } : { enabled: true },
      topP: reasoning ? { enabled: false, reason: 'Reasoning models (o-series, GPT-5) reject top-p.' } : { enabled: true },
      frequencyPenalty: reasoning ? { enabled: false, reason: 'Not supported on reasoning models.' } : { enabled: true },
      presencePenalty: reasoning ? { enabled: false, reason: 'Not supported on reasoning models.' } : { enabled: true },
      repetitionPenalty: { enabled: false, reason: 'OpenRouter-specific parameter.' },
      reasoning: reasoning ? { enabled: true } : { enabled: false, reason: 'Only reasoning models (o-series, GPT-5) support an effort setting.' },
      caching: { enabled: false, reason: 'OpenAI caches automatically — no toggle needed.' },
    };
  }
  // openrouter
  const isAnthropicModel = model.trim().toLowerCase().startsWith('anthropic/');
  return {
    temperature: { enabled: true },
    topP: { enabled: true },
    frequencyPenalty: { enabled: true },
    presencePenalty: { enabled: true },
    repetitionPenalty: { enabled: true },
    reasoning: { enabled: true },
    caching: isAnthropicModel ? { enabled: true } : { enabled: false, reason: 'Caching passes through only for anthropic/* models on OpenRouter.' },
  };
}

// ---- Dynamic model lists ----------------------------------------------
// Anthropic/OpenAI lists are proxied server-side using the caller's own key
// (directive §8.6 — kills the old hardcoded 3-model Anthropic allowlist).
// OpenRouter keeps its existing public, no-key-required list. All three are
// cached in-memory per session/page-load.

export interface ModelOption { id: string; name: string }

const modelCache = new Map<AiProvider, ModelOption[]>();

async function fetchProxiedModels(provider: 'anthropic' | 'openai'): Promise<ModelOption[]> {
  const cached = modelCache.get(provider);
  if (cached) return cached;
  const headers = await authHeader();
  const res = await fetch(`/api/writing/ai?action=models&provider=${provider}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Could not load ${provider} models (${res.status}).`);
  const models = (Array.isArray(data) ? data : []) as ModelOption[];
  modelCache.set(provider, models);
  return models;
}

export const fetchAnthropicModels = () => fetchProxiedModels('anthropic');
export const fetchOpenAiModels = () => fetchProxiedModels('openai');

export async function fetchOpenRouterModels(): Promise<ModelOption[]> {
  const cached = modelCache.get('openrouter');
  if (cached) return cached;
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`Could not load OpenRouter models (${res.status}).`);
  const data = await res.json() as { data?: Array<{ id?: string; name?: string }> };
  const models = (data.data ?? [])
    .filter((m): m is { id: string; name?: string } => typeof m.id === 'string')
    .map(m => ({ id: m.id, name: m.name || m.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  modelCache.set('openrouter', models);
  return models;
}
