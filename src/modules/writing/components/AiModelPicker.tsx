import { useEffect, useState } from 'react';
import { getAiSettings, setAiSettings, anthropicModelOptions, fetchOpenRouterModels } from '../lib/ai';
import type { AiSettings } from '../lib/ai';

// Compact provider + model selector, persisted to localStorage (directive:
// "fine for v1" — no server-side preset/favorite management). Anthropic
// offers the small fixed allowlist the server accepts; OpenRouter fetches
// its public model list (no key needed to browse) with a text filter.
export default function AiModelPicker({ onChange }: { onChange?: (settings: AiSettings) => void }) {
  const [settings, setSettings] = useState<AiSettings>(() => getAiSettings());
  const [openRouterModels, setOpenRouterModels] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    if (settings.provider !== 'openrouter' || openRouterModels.length > 0) return;
    setLoadingModels(true);
    fetchOpenRouterModels()
      .then(setOpenRouterModels)
      .catch(() => undefined)
      .finally(() => setLoadingModels(false));
  }, [settings.provider, openRouterModels.length]);

  function update(next: AiSettings) {
    setSettings(next);
    setAiSettings(next);
    onChange?.(next);
  }

  const filteredModels = query.trim()
    ? openRouterModels.filter(m => m.name.toLowerCase().includes(query.trim().toLowerCase()) || m.id.toLowerCase().includes(query.trim().toLowerCase()))
    : openRouterModels;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
        <button
          onClick={() => update({ provider: 'anthropic', model: anthropicModelOptions()[0].id })}
          className={`px-2.5 py-1.5 font-medium ${settings.provider === 'anthropic' ? 'bg-lime-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
        >
          Claude
        </button>
        <button
          onClick={() => update({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4-6' })}
          className={`px-2.5 py-1.5 font-medium ${settings.provider === 'openrouter' ? 'bg-lime-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
        >
          OpenRouter
        </button>
      </div>

      {settings.provider === 'anthropic' ? (
        <select
          value={settings.model}
          onChange={e => update({ provider: 'anthropic', model: e.target.value })}
          className="px-2 py-1.5 border border-slate-200 rounded-lg text-slate-600 bg-white"
        >
          {anthropicModelOptions().map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={loadingModels ? 'Loading models…' : 'Filter models…'}
            className="w-32 px-2 py-1.5 border border-slate-200 rounded-lg text-slate-600"
          />
          <select
            value={settings.model}
            onChange={e => update({ provider: 'openrouter', model: e.target.value })}
            className="max-w-[10rem] px-2 py-1.5 border border-slate-200 rounded-lg text-slate-600 bg-white"
          >
            <option value={settings.model}>{settings.model}</option>
            {filteredModels.filter(m => m.id !== settings.model).slice(0, 200).map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
