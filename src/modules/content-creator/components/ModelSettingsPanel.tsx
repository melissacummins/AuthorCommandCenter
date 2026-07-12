import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  fetchAnthropicModels, fetchOpenAiModels, fetchOpenRouterModels,
  type AiProvider, type ModelOption,
} from '../../writing/lib/ai';
import ModelSelect from '../../../components/ModelSelect';
import { listModelSettings, saveModelSetting } from '../api';
import { ALL_TASKS, DEFAULT_MODELS, TASK_LABELS } from '../lib/models';
import type { AiTask, ModelSetting } from '../types';

const PROVIDER_LABELS: Record<AiProvider, string> = { anthropic: 'Claude', openai: 'OpenAI', openrouter: 'OpenRouter' };

// Per-task model settings: one provider + model row per AI task, options
// pulled from the live provider model lists, favorites pinned on top. No
// model id is hard-coded anywhere else (directive ground rule 3).
export default function ModelSettingsPanel({ onSaved }: { onSaved?: () => void }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Map<AiTask, ModelSetting>>(new Map());
  const [models, setModels] = useState<Partial<Record<AiProvider, ModelOption[]>>>({});
  const [modelErrors, setModelErrors] = useState<Partial<Record<AiProvider, string>>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listModelSettings(user.id)
      .then(rows => { if (!cancelled) setSettings(new Map(rows.map(r => [r.task, r]))); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  // Load each provider's model list lazily, once, as soon as any task row
  // uses that provider.
  useEffect(() => {
    const needed = new Set<AiProvider>();
    for (const task of ALL_TASKS) {
      needed.add((settings.get(task) ?? DEFAULT_MODELS[task]).provider as AiProvider);
    }
    for (const provider of needed) {
      if (models[provider] || modelErrors[provider]) continue;
      const loader = provider === 'anthropic' ? fetchAnthropicModels : provider === 'openai' ? fetchOpenAiModels : fetchOpenRouterModels;
      loader()
        .then(list => setModels(prev => ({ ...prev, [provider]: list })))
        .catch(err => setModelErrors(prev => ({ ...prev, [provider]: (err as Error).message })));
    }
  }, [settings, models, modelErrors]);

  async function update(task: AiTask, provider: string, modelId: string) {
    if (!user) return;
    setSettings(prev => new Map(prev).set(task, { task, provider, model_id: modelId }));
    if (modelId) {
      await saveModelSetting(user.id, task, provider, modelId).catch(() => undefined);
      onSaved?.();
    }
  }

  if (loading) return <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Which model runs each task. Defaults are just starting points — if a model is ever retired, re-point it here; nothing else changes. ★ a model to pin it to the top everywhere.
      </p>
      {ALL_TASKS.map(task => {
        const current = settings.get(task) ?? DEFAULT_MODELS[task];
        const provider = current.provider as AiProvider;
        const list = models[provider];
        const err = modelErrors[provider];
        return (
          <div key={task} className="grid gap-2 sm:grid-cols-[220px_130px_1fr] sm:items-center">
            <div>
              <p className="text-sm font-medium text-slate-700">{TASK_LABELS[task].name}</p>
              <p className="text-[11px] text-slate-400">{TASK_LABELS[task].hint}</p>
            </div>
            <select
              value={provider}
              onChange={e => update(task, e.target.value, '')}
              className="px-2 py-1.5 border border-slate-200 rounded-lg text-slate-600 bg-white text-xs"
            >
              {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map(p => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
            {err ? (
              <p className="text-xs text-rose-600">{err}</p>
            ) : !list ? (
              <p className="text-xs text-slate-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading models…</p>
            ) : (
              <ModelSelect
                provider={provider}
                model={current.model_id}
                models={list}
                onChange={id => update(task, provider, id)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
