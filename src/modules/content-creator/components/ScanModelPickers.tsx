import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  fetchAnthropicModels, fetchOpenAiModels, fetchOpenRouterModels,
  type AiProvider, type ModelOption,
} from '../../writing/lib/ai';
import ModelSelect from '../../../components/ModelSelect';
import { listModelSettings, saveModelSetting } from '../api';
import { DEFAULT_MODELS } from '../lib/models';
import { invalidateTaskModelCache } from '../lib/ai';
import type { AiTask, ModelSetting } from '../types';

const PROVIDER_LABELS: Record<AiProvider, string> = { anthropic: 'Claude', openai: 'OpenAI', openrouter: 'OpenRouter' };

// The two models a scan uses, pickable right where the scan runs (quality
// problems trace straight to the model, so the choice shouldn't hide in a
// collapsed panel two tabs away). Same settings rows as ModelSettingsPanel.
const SCAN_TASKS: Array<{ task: AiTask; label: string; hint: string }> = [
  { task: 'extract', label: 'Finds scenes', hint: 'Reads every chapter; only locates and copies moments — cheap model is fine.' },
  { task: 'rank', label: 'Writes & checks hooks', hint: 'Writes the hooks from those moments and fact-checks each one — quality lives here.' },
];

export default function ScanModelPickers({ disabled }: { disabled?: boolean }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Map<AiTask, ModelSetting>>(new Map());
  const [models, setModels] = useState<Partial<Record<AiProvider, ModelOption[]>>>({});
  const [modelErrors, setModelErrors] = useState<Partial<Record<AiProvider, string>>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listModelSettings(user.id)
      .then(rows => { if (!cancelled) setSettings(new Map(rows.map(r => [r.task, r]))); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!loaded) return;
    const needed = new Set<AiProvider>();
    for (const { task } of SCAN_TASKS) {
      needed.add((settings.get(task) ?? DEFAULT_MODELS[task]).provider as AiProvider);
    }
    for (const provider of needed) {
      if (models[provider] || modelErrors[provider]) continue;
      const loader = provider === 'anthropic' ? fetchAnthropicModels : provider === 'openai' ? fetchOpenAiModels : fetchOpenRouterModels;
      loader()
        .then(list => setModels(prev => ({ ...prev, [provider]: list })))
        .catch(err => setModelErrors(prev => ({ ...prev, [provider]: (err as Error).message })));
    }
  }, [loaded, settings, models, modelErrors]);

  async function update(task: AiTask, provider: string, modelId: string) {
    if (!user) return;
    setSettings(prev => new Map(prev).set(task, { task, provider, model_id: modelId }));
    if (modelId) {
      await saveModelSetting(user.id, task, provider, modelId).catch(() => undefined);
      invalidateTaskModelCache();
    }
  }

  if (!loaded) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {SCAN_TASKS.map(({ task, label, hint }) => {
        const current = settings.get(task) ?? DEFAULT_MODELS[task];
        const provider = current.provider as AiProvider;
        const list = models[provider];
        const err = modelErrors[provider];
        return (
          <div key={task}>
            <p className="text-[11px] font-medium text-content-secondary mb-1" title={hint}>{label}</p>
            <div className="flex items-center gap-1.5">
              <select
                value={provider}
                disabled={disabled}
                onChange={e => update(task, e.target.value, '')}
                className="px-2 py-1.5 border border-edge rounded-control text-content-secondary bg-surface text-xs shrink-0 disabled:opacity-50"
              >
                {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map(p => (
                  <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                ))}
              </select>
              {err ? (
                <p className="text-[11px] text-rose-600">{err}</p>
              ) : !list ? (
                <p className="text-[11px] text-content-muted flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</p>
              ) : (
                <div className={`flex-1 min-w-0 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                  <ModelSelect
                    provider={provider}
                    model={current.model_id}
                    models={list}
                    onChange={id => update(task, provider, id)}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
