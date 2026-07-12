import { useEffect, useRef, useState } from 'react';
import { Settings2, Loader2 } from 'lucide-react';
import {
  getAiSettings, setAiSettings, knobSupport,
  fetchAnthropicModels, fetchOpenAiModels, fetchOpenRouterModels,
} from '../lib/ai';
import type { AiSettings, AiProvider, ReasoningEffort, KnobState, ModelOption } from '../lib/ai';
import ModelSelect from '../../../components/ModelSelect';

const PROVIDER_LABELS: Record<AiProvider, string> = { anthropic: 'Claude', openai: 'OpenAI', openrouter: 'OpenRouter' };
const REASONING_LEVELS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

// Full AI generation-parameter settings — replaces the old 3-model dropdown
// (AiModelPicker). One shared popover used by the editor's AI row and the
// chat panel (directive §8.5): provider, dynamic model list, max tokens, and
// every sampling/reasoning/caching knob, each disabled with a one-line reason
// when the current provider+model can't take it rather than hidden — "Melissa
// is selling this; users should see what exists."
export default function AiSettingsPanel({ onChange }: { onChange?: (settings: AiSettings) => void }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AiSettings>(() => getAiSettings());
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingModels(true);
    setModelError(null);
    const loader = settings.provider === 'anthropic' ? fetchAnthropicModels
      : settings.provider === 'openai' ? fetchOpenAiModels
      : fetchOpenRouterModels;
    loader()
      .then(list => { if (!cancelled) setModels(list); })
      .catch(err => { if (!cancelled) setModelError((err as Error)?.message ?? 'Could not load models.'); })
      .finally(() => { if (!cancelled) setLoadingModels(false); });
    return () => { cancelled = true; };
  }, [open, settings.provider]);

  function update(patch: Partial<AiSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    setAiSettings(next);
    onChange?.(next);
  }

  const knobs = knobSupport(settings.provider, settings.model);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        title="AI settings"
        className={`p-1.5 rounded-md hover:bg-slate-50 ${open ? 'text-lime-600 bg-slate-50' : 'text-slate-400 hover:text-lime-600'}`}
      >
        <Settings2 className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 max-h-[70vh] overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg p-4 space-y-3 text-xs">
          <div>
            <label className="block font-medium text-slate-600 mb-1">Provider</label>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden w-full">
              {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map(p => (
                <button
                  key={p}
                  onClick={() => update({ provider: p, model: '' })}
                  className={`flex-1 px-2 py-1.5 font-medium ${settings.provider === p ? 'bg-lime-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-600 mb-1">Model</label>
            {loadingModels ? (
              <p className="text-slate-400 flex items-center gap-1 py-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading models…</p>
            ) : modelError ? (
              <p className="text-rose-600">{modelError}</p>
            ) : (
              <ModelSelect
                provider={settings.provider}
                model={settings.model}
                models={models.map(m => m.id.includes('fable') ? { ...m, name: `${m.name} (~2× Opus billing)` } : m)}
                onChange={model => update({ model })}
              />
            )}
          </div>

          <NumberField label="Max tokens" value={settings.maxTokens} onChange={v => update({ maxTokens: v })} min={64} max={4096} step={1} />
          <KnobField label="Temperature" support={knobs.temperature} value={settings.temperature} onChange={v => update({ temperature: v })} min={0} max={1} step={0.1} />
          <KnobField label="Top-P" support={knobs.topP} value={settings.topP} onChange={v => update({ topP: v })} min={0} max={1} step={0.05} />
          <KnobField label="Frequency penalty" support={knobs.frequencyPenalty} value={settings.frequencyPenalty} onChange={v => update({ frequencyPenalty: v })} min={-2} max={2} step={0.1} />
          <KnobField label="Presence penalty" support={knobs.presencePenalty} value={settings.presencePenalty} onChange={v => update({ presencePenalty: v })} min={-2} max={2} step={0.1} />
          <KnobField label="Repetition penalty" support={knobs.repetitionPenalty} value={settings.repetitionPenalty} onChange={v => update({ repetitionPenalty: v })} min={0} max={2} step={0.1} />

          <div className={knobs.reasoning.enabled ? '' : 'opacity-50'}>
            <label className="block font-medium text-slate-600 mb-1">Reasoning effort</label>
            <select
              disabled={!knobs.reasoning.enabled}
              value={settings.reasoningEffort ?? ''}
              onChange={e => update({ reasoningEffort: (e.target.value || undefined) as ReasoningEffort | undefined })}
              className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-slate-600 bg-white disabled:opacity-50"
            >
              <option value="">Off (provider default)</option>
              {REASONING_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            {!knobs.reasoning.enabled && knobs.reasoning.reason && <p className="text-slate-400 mt-0.5">{knobs.reasoning.reason}</p>}
          </div>

          <div>
            <label className={`flex items-center gap-2 ${knobs.caching.enabled ? '' : 'opacity-50'}`}>
              <input
                type="checkbox"
                disabled={!knobs.caching.enabled}
                checked={!!settings.cachingEnabled}
                onChange={e => update({ cachingEnabled: e.target.checked })}
              />
              <span className="font-medium text-slate-600">Enable caching</span>
            </label>
            {!knobs.caching.enabled && knobs.caching.reason && <p className="text-slate-400 mt-0.5">{knobs.caching.reason}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function NumberField({
  label, value, onChange, min, max, step,
}: {
  label: string;
  value?: number;
  onChange: (v: number | undefined) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div>
      <label className="block font-medium text-slate-600 mb-1">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value ?? ''}
        placeholder="default"
        onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-slate-600"
      />
    </div>
  );
}

function KnobField({
  label, support, value, onChange, min, max, step,
}: {
  label: string;
  support: KnobState;
  value?: number;
  onChange: (v: number | undefined) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div className={support.enabled ? '' : 'opacity-50'}>
      <label className="block font-medium text-slate-600 mb-1">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={!support.enabled}
        value={value ?? ''}
        placeholder="default"
        onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-slate-600 disabled:bg-slate-50"
      />
      {!support.enabled && support.reason && <p className="text-slate-400 mt-0.5">{support.reason}</p>}
    </div>
  );
}
