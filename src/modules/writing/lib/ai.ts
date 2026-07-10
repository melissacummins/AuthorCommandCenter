// Client wrapper for /api/writing/ai — the Writing module's two-provider AI
// endpoint. Anthropic key management is NOT duplicated here: it already
// lives in Settings → API Keys via src/modules/planner/ai.ts's
// getAnthropicKeyStatus/setAnthropicKey/removeAnthropicKey, and this module
// reuses that same key server-side. Only OpenRouter (new to this module)
// gets its own key functions, added to ApiKeysSection.tsx alongside it.

import { supabase } from '../../../lib/supabase';

export type AiProvider = 'anthropic' | 'openrouter';

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
    }),
  });
  const json = await res.json().catch(() => ({})) as { text?: string; error?: string };
  if (!res.ok) throw new Error(json.error || `AI request failed (${res.status}).`);
  return json.text ?? '';
}

// ---- Provider/model setting (localStorage — directive: "fine for v1") ----

export interface AiSettings {
  provider: AiProvider;
  model: string;
}

const SETTINGS_KEY = 'writing-ai-settings';
const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (default)' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast, cheap)' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (most capable)' },
];
const DEFAULT_SETTINGS: AiSettings = { provider: 'anthropic', model: ANTHROPIC_MODELS[0].id };

export function getAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    if (parsed?.provider === 'openrouter') return { provider: 'openrouter', model: typeof parsed.model === 'string' && parsed.model ? parsed.model : 'anthropic/claude-sonnet-4-6' };
    return { provider: 'anthropic', model: ANTHROPIC_MODELS.some(m => m.id === parsed?.model) ? parsed.model : ANTHROPIC_MODELS[0].id };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function setAiSettings(settings: AiSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function anthropicModelOptions(): { id: string; label: string }[] {
  return ANTHROPIC_MODELS;
}

// ---- OpenRouter model list (public, no key required) ----

export interface OpenRouterModelOption { id: string; name: string }

let cachedModels: OpenRouterModelOption[] | null = null;

export async function fetchOpenRouterModels(): Promise<OpenRouterModelOption[]> {
  if (cachedModels) return cachedModels;
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`Could not load OpenRouter models (${res.status}).`);
  const data = await res.json() as { data?: Array<{ id?: string; name?: string }> };
  const models = (data.data ?? [])
    .filter((m): m is { id: string; name?: string } => typeof m.id === 'string')
    .map(m => ({ id: m.id, name: m.name || m.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  cachedModels = models;
  return models;
}
