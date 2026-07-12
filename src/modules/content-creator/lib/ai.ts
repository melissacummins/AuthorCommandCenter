import { writingComplete, type AiProvider } from '../../writing/lib/ai';
import { listModelSettings } from '../api';
import { DEFAULT_MODELS } from './models';
import { parseJsonResponse } from './prompts';
import type { AiTask, ModelSetting } from '../types';

// Task runner: resolves the user's model choice for a task (settings row,
// else the DEFAULT_MODELS constant) and completes through the existing
// /api/writing/ai endpoint — same BYOK keys, same three providers; no new
// serverless function needed.

let settingsCache: { userId: string; byTask: Map<AiTask, ModelSetting> } | null = null;

export async function getTaskModel(userId: string, task: AiTask): Promise<ModelSetting> {
  if (settingsCache?.userId !== userId) {
    const rows = await listModelSettings(userId).catch(() => [] as ModelSetting[]);
    settingsCache = { userId, byTask: new Map(rows.map(r => [r.task, r])) };
  }
  return settingsCache.byTask.get(task) ?? DEFAULT_MODELS[task];
}

export function invalidateTaskModelCache(): void {
  settingsCache = null;
}

export interface RunTaskInput {
  userId: string;
  task: AiTask;
  prompt: string;
  system?: string;
  maxTokens?: number;
}

export async function runTask(input: RunTaskInput): Promise<string> {
  const setting = await getTaskModel(input.userId, input.task);
  return writingComplete({
    provider: setting.provider as AiProvider,
    model: setting.model_id,
    prompt: input.prompt,
    system: input.system,
    maxTokens: input.maxTokens ?? 2048,
    // Long stable system preamble (facts + playbook) → prompt caching pays
    // for itself across a multi-chapter scan on Anthropic models.
    cachingEnabled: setting.provider === 'anthropic',
  });
}

// Run a task whose contract is JSON; retries once on a parse failure with an
// explicit reminder before giving up.
export async function runJsonTask<T>(input: RunTaskInput): Promise<T> {
  const first = await runTask(input);
  try {
    return parseJsonResponse<T>(first);
  } catch {
    const retry = await runTask({
      ...input,
      prompt: `${input.prompt}\n\nIMPORTANT: your previous reply was not valid JSON. Respond with ONLY the JSON — no prose, no code fences.`,
    });
    return parseJsonResponse<T>(retry);
  }
}
