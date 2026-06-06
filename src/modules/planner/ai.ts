// Client wrapper for the planner AI endpoint. Attaches the user's Supabase
// access token so the serverless handler can authenticate the caller and look
// up their own (BYOK) Anthropic key. Mirrors the Media module's key client.
import { supabase } from '../../lib/supabase';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  return { Authorization: `Bearer ${token}` };
}

export interface AnthropicKeyStatus {
  has_key: boolean;
  hint: string | null;
  updated_at: string | null;
}

export async function getAnthropicKeyStatus(): Promise<AnthropicKeyStatus> {
  const headers = await authHeader();
  const res = await fetch('/api/planner/ai?action=key', { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Key status failed (${res.status}).`);
  return data as AnthropicKeyStatus;
}

export async function setAnthropicKey(key: string): Promise<AnthropicKeyStatus> {
  const headers = await authHeader();
  const res = await fetch('/api/planner/ai?action=key', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Failed to save key (${res.status}).`);
  return { has_key: true, hint: data.hint ?? null, updated_at: new Date().toISOString() };
}

export async function removeAnthropicKey(): Promise<void> {
  const headers = await authHeader();
  const res = await fetch('/api/planner/ai?action=key', { method: 'DELETE', headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(typeof data?.error === 'string' ? data.error : `Failed to remove key (${res.status}).`);
  }
}

export interface PlannerCompleteInput {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
}

export async function plannerComplete(input: PlannerCompleteInput): Promise<string> {
  const headers = await authHeader();
  const res = await fetch('/api/planner/ai', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
