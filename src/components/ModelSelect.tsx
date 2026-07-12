import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { listModelFavorites, addModelFavorite, removeModelFavorite } from '../lib/modelFavorites';
import type { ModelOption } from '../modules/writing/lib/ai';

// Favorites-aware model dropdown. Starred models pin to the top of the list
// under a ★ group; the star button beside the select toggles the current
// model. Favorites persist per account (model_favorites) and are shared by
// every AI surface in the app.

// Module-level cache so multiple pickers on one page don't refetch.
let favoritesCache: { userId: string; set: Set<string> } | null = null;
const favListeners = new Set<() => void>();

function favKey(provider: string, modelId: string): string {
  return `${provider}::${modelId}`;
}

async function loadFavorites(userId: string): Promise<Set<string>> {
  if (favoritesCache?.userId === userId) return favoritesCache.set;
  const rows = await listModelFavorites(userId);
  const set = new Set(rows.map(r => favKey(r.provider, r.model_id)));
  favoritesCache = { userId, set };
  return set;
}

interface Props {
  provider: string;
  model: string;
  models: ModelOption[];
  onChange: (modelId: string) => void;
  className?: string;
}

export default function ModelSelect({ provider, model, models, onChange, className }: Props) {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const refresh = () => { loadFavorites(user.id).then(s => { if (!cancelled) setFavorites(new Set(s)); }).catch(() => undefined); };
    refresh();
    favListeners.add(refresh);
    return () => { cancelled = true; favListeners.delete(refresh); };
  }, [user]);

  async function toggleFavorite() {
    if (!user || !model) return;
    const key = favKey(provider, model);
    const isFav = favorites.has(key);
    // Optimistic update, then persist.
    const next = new Set(favorites);
    if (isFav) next.delete(key); else next.add(key);
    setFavorites(next);
    favoritesCache = { userId: user.id, set: next };
    favListeners.forEach(fn => { if (fn !== undefined) fn(); });
    try {
      if (isFav) await removeModelFavorite(user.id, provider, model);
      else await addModelFavorite(user.id, provider, model);
    } catch {
      // Roll back on failure.
      favoritesCache = null;
      loadFavorites(user.id).then(s => setFavorites(new Set(s))).catch(() => undefined);
    }
  }

  const favModels = models.filter(m => favorites.has(favKey(provider, m.id)));
  const restModels = favModels.length ? models.filter(m => !favorites.has(favKey(provider, m.id))) : models;
  const currentIsFav = favorites.has(favKey(provider, model));
  const currentInList = models.some(m => m.id === model);

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={model}
        onChange={e => onChange(e.target.value)}
        className={className ?? 'w-full px-2 py-1.5 border border-slate-200 rounded-lg text-slate-600 bg-white text-xs'}
      >
        {(!model || !currentInList) && (
          <option value={model}>{model || '— pick a model —'}</option>
        )}
        {favModels.length > 0 && (
          <optgroup label="★ Favorites">
            {favModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </optgroup>
        )}
        {favModels.length > 0 ? (
          <optgroup label="All models">
            {restModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </optgroup>
        ) : (
          restModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)
        )}
      </select>
      <button
        type="button"
        onClick={toggleFavorite}
        disabled={!model}
        title={currentIsFav ? 'Remove from favorites' : 'Add to favorites'}
        className={`p-1.5 rounded-md shrink-0 transition-colors ${currentIsFav ? 'text-amber-500 hover:text-amber-600' : 'text-slate-300 hover:text-amber-500'} disabled:opacity-40`}
      >
        <Star className={`w-4 h-4 ${currentIsFav ? 'fill-amber-400' : ''}`} />
      </button>
    </div>
  );
}
