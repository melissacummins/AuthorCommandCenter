// Client wrapper for the planner AI endpoint. Attaches the user's Supabase
// access token so the serverless handler can authenticate, and surfaces a clean
// error when AI isn't configured (no ANTHROPIC_API_KEY set in Vercel yet).
import { supabase } from '../../lib/supabase';

export interface PlannerCompleteInput {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
}

export async function plannerComplete(input: PlannerCompleteInput): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');

  const res = await fetch('/api/planner/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
