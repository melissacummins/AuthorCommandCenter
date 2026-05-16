import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ImagePlus, Wand2, Trash2, Download, Upload, X, Plus, Folder, Sparkles, Loader2, AlertCircle, RefreshCw, Settings,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { MODELS, findModel } from './lib/models';
import { SIZE_PRESETS, type SizePreset } from './lib/sizePresets';
import { requestGeneration, pollGenerationStatus, uploadInputImage } from './lib/client';
import type { MediaCollection, MediaGeneration, MediaSettings, MediaStylePreset } from './lib/types';

const POLL_INTERVAL_MS = 4000;

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function startOfMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export default function MediaModule() {
  const { user } = useAuth();
  const userId = user?.id;

  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState<string>(MODELS[0].id);
  const [sizePresetId, setSizePresetId] = useState<string>('pinterest');
  const [customWidth, setCustomWidth] = useState<number>(1024);
  const [customHeight, setCustomHeight] = useState<number>(1024);
  const [useCustomSize, setUseCustomSize] = useState(false);

  const [inputImageUrl, setInputImageUrl] = useState<string | null>(null);
  const [inputImageName, setInputImageName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<MediaGeneration[]>([]);
  const [collections, setCollections] = useState<MediaCollection[]>([]);
  const [stylePresets, setStylePresets] = useState<MediaStylePreset[]>([]);
  const [settings, setSettings] = useState<MediaSettings | null>(null);
  const [monthlySpent, setMonthlySpent] = useState(0);

  const [filterCollectionId, setFilterCollectionId] = useState<string | null>(null);
  const [stylesDrawerOpen, setStylesDrawerOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [collectionsDrawerOpen, setCollectionsDrawerOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollersRef = useRef<Map<string, number>>(new Map());

  const model = useMemo(() => findModel(modelId) ?? MODELS[0], [modelId]);
  const sizePreset = useMemo<SizePreset | null>(
    () => SIZE_PRESETS.find((p) => p.id === sizePresetId) ?? null,
    [sizePresetId],
  );
  const selectedStyle = useMemo(
    () => stylePresets.find((s) => s.id === selectedStyleId) ?? null,
    [selectedStyleId, stylePresets],
  );

  const fullPrompt = useMemo(() => {
    if (!prompt.trim()) return '';
    if (!selectedStyle) return prompt.trim();
    return `${selectedStyle.prompt_snippet.trim()}\n\n${prompt.trim()}`;
  }, [prompt, selectedStyle]);

  // ---------- data load ----------
  const loadAll = useCallback(async () => {
    if (!userId) return;

    const [genRes, colRes, styleRes, settingsRes, monthRes] = await Promise.all([
      supabase.from('media_generations').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(80),
      supabase.from('media_collections').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
      supabase.from('media_style_presets').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
      supabase.from('media_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('media_generations').select('cost_cents').eq('user_id', userId).gte('created_at', startOfMonthIso()),
    ]);

    setHistory((genRes.data ?? []) as MediaGeneration[]);
    setCollections((colRes.data ?? []) as MediaCollection[]);
    setStylePresets((styleRes.data ?? []) as MediaStylePreset[]);
    setSettings((settingsRes.data ?? null) as MediaSettings | null);
    setMonthlySpent(((monthRes.data ?? []) as { cost_cents: number | null }[]).reduce((s, r) => s + (r.cost_cents ?? 0), 0));
  }, [userId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Resume polling for any pending video generations after a reload.
  useEffect(() => {
    const pollers = pollersRef.current;
    history
      .filter((g) => g.status === 'pending' && g.kind === 'video')
      .forEach((g) => {
        if (!pollers.has(g.id)) startPolling(g.id);
      });
    return () => {
      // Don't tear down on every render — only on unmount.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.length]);

  // Clear pollers on unmount.
  useEffect(() => {
    const pollers = pollersRef.current;
    return () => {
      pollers.forEach((id) => window.clearInterval(id));
      pollers.clear();
    };
  }, []);

  function startPolling(generationId: string) {
    const pollers = pollersRef.current;
    if (pollers.has(generationId)) return;
    const handle = window.setInterval(async () => {
      try {
        const updated = await pollGenerationStatus(generationId);
        if (updated.status !== 'pending') {
          window.clearInterval(handle);
          pollers.delete(generationId);
        }
        setHistory((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
      } catch {
        // Network blip — keep polling.
      }
    }, POLL_INTERVAL_MS);
    pollers.set(generationId, handle);
  }

  // ---------- mutations ----------
  async function handleGenerate() {
    if (!prompt.trim()) {
      setError('Add a prompt first.');
      return;
    }
    if (model.acceptsInputImage && model.id === 'nano-banana-edit' && !inputImageUrl) {
      setError('Nano Banana edit needs an uploaded image.');
      return;
    }

    setError(null);
    setGenerating(true);
    try {
      let width: number | undefined;
      let height: number | undefined;
      if (model.supportsCustomSize) {
        if (useCustomSize) {
          width = customWidth;
          height = customHeight;
        } else if (sizePreset) {
          width = sizePreset.width;
          height = sizePreset.height;
        }
      }

      const gen = await requestGeneration({
        model: model.id,
        prompt: prompt.trim(),
        full_prompt: fullPrompt || prompt.trim(),
        style_preset_id: selectedStyleId,
        width,
        height,
        source_image_url: model.acceptsInputImage ? inputImageUrl : null,
        collection_id: selectedCollectionId,
      });

      setHistory((prev) => [gen, ...prev]);
      setMonthlySpent((prev) => prev + (gen.cost_cents ?? 0));
      if (gen.status === 'pending') startPolling(gen.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function handleUploadInput(file: File) {
    setUploading(true);
    setError(null);
    try {
      const url = await uploadInputImage(file);
      setInputImageUrl(url);
      setInputImageName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(gen: MediaGeneration) {
    if (!window.confirm('Delete this generation? This cannot be undone.')) return;
    const { error: delErr } = await supabase.from('media_generations').delete().eq('id', gen.id);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    setHistory((prev) => prev.filter((g) => g.id !== gen.id));
  }

  async function handleUseAsInput(gen: MediaGeneration) {
    if (!gen.output_url) return;
    setInputImageUrl(gen.output_url);
    setInputImageName(`generation-${gen.id.slice(0, 8)}`);
    // Auto-switch to nano-banana edit when the user picks "use as input"
    // so the next click on Generate does the obvious thing.
    if (!model.acceptsInputImage) setModelId('nano-banana-edit');
  }

  async function handleSaveStyle(name: string, snippet: string) {
    if (!userId) return;
    const { data, error: insertErr } = await supabase
      .from('media_style_presets')
      .insert({ user_id: userId, name, prompt_snippet: snippet })
      .select()
      .single();
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    if (data) setStylePresets((prev) => [...prev, data as MediaStylePreset]);
  }

  async function handleDeleteStyle(id: string) {
    const { error: delErr } = await supabase.from('media_style_presets').delete().eq('id', id);
    if (delErr) { setError(delErr.message); return; }
    setStylePresets((prev) => prev.filter((s) => s.id !== id));
    if (selectedStyleId === id) setSelectedStyleId(null);
  }

  async function handleSaveCollection(name: string) {
    if (!userId) return;
    const { data, error: insertErr } = await supabase
      .from('media_collections')
      .insert({ user_id: userId, name })
      .select()
      .single();
    if (insertErr) { setError(insertErr.message); return; }
    if (data) setCollections((prev) => [...prev, data as MediaCollection]);
  }

  async function handleDeleteCollection(id: string) {
    if (!window.confirm('Delete this collection? Items inside will be uncategorised, not deleted.')) return;
    const { error: delErr } = await supabase.from('media_collections').delete().eq('id', id);
    if (delErr) { setError(delErr.message); return; }
    setCollections((prev) => prev.filter((c) => c.id !== id));
    if (selectedCollectionId === id) setSelectedCollectionId(null);
    if (filterCollectionId === id) setFilterCollectionId(null);
  }

  async function handleSaveSettings(capCents: number) {
    if (!userId) return;
    const { data, error: upErr } = await supabase
      .from('media_settings')
      .upsert({ user_id: userId, monthly_cap_cents: capCents, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (upErr) { setError(upErr.message); return; }
    if (data) setSettings(data as MediaSettings);
  }

  async function handleMoveToCollection(generationId: string, collectionId: string | null) {
    const { error: upErr } = await supabase
      .from('media_generations')
      .update({ collection_id: collectionId })
      .eq('id', generationId);
    if (upErr) { setError(upErr.message); return; }
    setHistory((prev) => prev.map((g) => (g.id === generationId ? { ...g, collection_id: collectionId } : g)));
  }

  // ---------- derived ----------
  const filteredHistory = useMemo(() => {
    if (!filterCollectionId) return history;
    if (filterCollectionId === '__uncategorised__') return history.filter((g) => !g.collection_id);
    return history.filter((g) => g.collection_id === filterCollectionId);
  }, [history, filterCollectionId]);

  const cap = settings?.monthly_cap_cents ?? 2000;
  const remainingCents = Math.max(0, cap - monthlySpent);
  const capPct = cap > 0 ? Math.min(100, Math.round((monthlySpent / cap) * 100)) : 0;
  const capColor = capPct >= 90 ? 'bg-red-500' : capPct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';

  // ---------- render ----------
  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-br from-fuchsia-500 to-purple-600 rounded-xl shadow-lg shadow-fuchsia-500/25">
            <ImagePlus className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Media</h1>
            <p className="text-sm text-slate-500">Generate Pinterest pins, new release art, social images, and short video clips.</p>
          </div>
        </div>

        {/* Spend indicator */}
        <div className="flex items-center gap-3">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-2 min-w-[220px]">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>This month</span>
              <span>{formatCents(monthlySpent)} / {formatCents(cap)}</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full ${capColor} transition-all`} style={{ width: `${capPct}%` }} />
            </div>
            <div className="text-[11px] text-slate-400 mt-1">{formatCents(remainingCents)} remaining</div>
          </div>
          <button
            onClick={() => setSettingsDrawerOpen(true)}
            className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500"
            title="Spend cap settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        {/* Controls */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 h-fit space-y-4">
          {/* Model */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Model</label>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
            >
              <optgroup label="Image">
                {MODELS.filter((m) => m.kind === 'image').map((m) => (
                  <option key={m.id} value={m.id}>{m.label} — ~{formatCents(m.estimatedCostCents)}</option>
                ))}
              </optgroup>
              <optgroup label="Video">
                {MODELS.filter((m) => m.kind === 'video').map((m) => (
                  <option key={m.id} value={m.id}>{m.label} — ~{formatCents(m.estimatedCostCents)}</option>
                ))}
              </optgroup>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">{model.description}</p>
          </div>

          {/* Style preset */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Style preset</label>
              <button onClick={() => setStylesDrawerOpen(true)} className="text-xs text-fuchsia-600 hover:text-fuchsia-700 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Manage
              </button>
            </div>
            <select
              value={selectedStyleId ?? ''}
              onChange={(e) => setSelectedStyleId(e.target.value || null)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
            >
              <option value="">No style — use prompt as-is</option>
              {stylePresets.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {selectedStyle && (
              <p className="text-[11px] text-slate-400 mt-1 italic">Prepended: "{selectedStyle.prompt_snippet.slice(0, 80)}{selectedStyle.prompt_snippet.length > 80 ? '…' : ''}"</p>
            )}
          </div>

          {/* Collection */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Save to collection</label>
              <button onClick={() => setCollectionsDrawerOpen(true)} className="text-xs text-fuchsia-600 hover:text-fuchsia-700 flex items-center gap-1">
                <Folder className="w-3 h-3" /> Manage
              </button>
            </div>
            <select
              value={selectedCollectionId ?? ''}
              onChange={(e) => setSelectedCollectionId(e.target.value || null)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
            >
              <option value="">Uncategorised</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Size */}
          {model.supportsCustomSize && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Size</label>
              <select
                value={useCustomSize ? '__custom__' : sizePresetId}
                onChange={(e) => {
                  if (e.target.value === '__custom__') setUseCustomSize(true);
                  else { setUseCustomSize(false); setSizePresetId(e.target.value); }
                }}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
              >
                <optgroup label="Social">
                  {SIZE_PRESETS.filter((p) => p.group === 'social').map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Book">
                  {SIZE_PRESETS.filter((p) => p.group === 'book').map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </optgroup>
                <optgroup label="General">
                  {SIZE_PRESETS.filter((p) => p.group === 'general').map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </optgroup>
                <option value="__custom__">Custom…</option>
              </select>
              {useCustomSize && (
                <div className="flex gap-2 mt-2">
                  <input type="number" min={256} max={4096} value={customWidth} onChange={(e) => setCustomWidth(parseInt(e.target.value) || 1024)} className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Width" />
                  <span className="self-center text-slate-400">×</span>
                  <input type="number" min={256} max={4096} value={customHeight} onChange={(e) => setCustomHeight(parseInt(e.target.value) || 1024)} className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm" placeholder="Height" />
                </div>
              )}
            </div>
          )}

          {/* Input image */}
          {model.acceptsInputImage && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Input image {model.id === 'nano-banana-edit' ? '(required)' : '(optional)'}
              </label>
              {inputImageUrl ? (
                <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
                  <img src={inputImageUrl} alt="" className="w-12 h-12 object-cover rounded" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-600 truncate">{inputImageName ?? 'Uploaded image'}</p>
                  </div>
                  <button onClick={() => { setInputImageUrl(null); setInputImageName(null); }} className="text-slate-400 hover:text-red-500">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</> : <><Upload className="w-4 h-4" /> Upload image</>}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUploadInput(file);
                      e.target.value = '';
                    }}
                  />
                </>
              )}
            </div>
          )}

          {/* Prompt */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="Describe what you want to generate…"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-y"
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim() || uploading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-fuchsia-500 to-purple-600 text-white font-semibold shadow-lg shadow-fuchsia-500/25 hover:shadow-fuchsia-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Wand2 className="w-4 h-4" /> Generate (~{formatCents(model.estimatedCostCents)})</>}
          </button>
        </div>

        {/* History */}
        <div>
          {/* Collection filter chips */}
          <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
            <button
              onClick={() => setFilterCollectionId(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${filterCollectionId === null ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
            >
              All ({history.length})
            </button>
            <button
              onClick={() => setFilterCollectionId('__uncategorised__')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${filterCollectionId === '__uncategorised__' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
            >
              Uncategorised
            </button>
            {collections.map((c) => {
              const count = history.filter((g) => g.collection_id === c.id).length;
              return (
                <button
                  key={c.id}
                  onClick={() => setFilterCollectionId(c.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${filterCollectionId === c.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
                >
                  {c.name} ({count})
                </button>
              );
            })}
          </div>

          {filteredHistory.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400">
              <ImagePlus className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p className="text-sm">Nothing here yet. Write a prompt and hit Generate.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredHistory.map((g) => (
                <MediaCard
                  key={g.id}
                  generation={g}
                  collections={collections}
                  onDelete={() => handleDelete(g)}
                  onUseAsInput={() => handleUseAsInput(g)}
                  onMoveCollection={(cid) => handleMoveToCollection(g.id, cid)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {stylesDrawerOpen && (
        <StyleDrawer
          presets={stylePresets}
          onClose={() => setStylesDrawerOpen(false)}
          onSave={handleSaveStyle}
          onDelete={handleDeleteStyle}
        />
      )}
      {collectionsDrawerOpen && (
        <CollectionsDrawer
          collections={collections}
          onClose={() => setCollectionsDrawerOpen(false)}
          onSave={handleSaveCollection}
          onDelete={handleDeleteCollection}
        />
      )}
      {settingsDrawerOpen && (
        <SettingsDrawer
          cap={cap}
          onClose={() => setSettingsDrawerOpen(false)}
          onSave={handleSaveSettings}
        />
      )}
    </div>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================

function MediaCard({
  generation, collections, onDelete, onUseAsInput, onMoveCollection,
}: {
  generation: MediaGeneration;
  collections: MediaCollection[];
  onDelete: () => void;
  onUseAsInput: () => void;
  onMoveCollection: (collectionId: string | null) => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const pending = generation.status === 'pending';
  const failed = generation.status === 'failed';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="aspect-square bg-slate-100 relative">
        {pending && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-500">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="text-xs">{generation.kind === 'video' ? 'Rendering video…' : 'Generating…'}</span>
          </div>
        )}
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-red-500 p-4 text-center">
            <AlertCircle className="w-8 h-8" />
            <span className="text-xs">{generation.error_message ?? 'Generation failed'}</span>
          </div>
        )}
        {!pending && !failed && generation.output_url && (
          generation.kind === 'video' ? (
            <video src={generation.output_url} controls className="w-full h-full object-cover" />
          ) : (
            <img src={generation.output_url} alt={generation.prompt} className="w-full h-full object-cover" />
          )
        )}
      </div>

      <div className="p-3 flex-1 flex flex-col gap-2">
        <button onClick={() => setShowPrompt((v) => !v)} className="text-left text-xs text-slate-600 line-clamp-2 hover:text-slate-900">
          {generation.prompt}
        </button>
        {showPrompt && (
          <p className="text-[11px] text-slate-500 whitespace-pre-wrap bg-slate-50 rounded p-2 max-h-32 overflow-y-auto">{generation.full_prompt}</p>
        )}

        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>{generation.model} · {generation.width && generation.height ? `${generation.width}×${generation.height}` : generation.kind}</span>
          <span>{formatCents(generation.cost_cents)}</span>
        </div>

        <div className="flex items-center gap-1 mt-1">
          {generation.output_url && !pending && (
            <a
              href={generation.output_url}
              target="_blank"
              rel="noreferrer"
              download
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              title="Download"
            >
              <Download className="w-4 h-4" />
            </a>
          )}
          {generation.output_url && generation.kind === 'image' && !pending && (
            <button
              onClick={onUseAsInput}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              title="Use as input for editing"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
          <select
            value={generation.collection_id ?? ''}
            onChange={(e) => onMoveCollection(e.target.value || null)}
            className="flex-1 ml-auto text-[11px] px-2 py-1 rounded border border-slate-200 bg-white"
          >
            <option value="">Uncategorised</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function StyleDrawer({
  presets, onClose, onSave, onDelete,
}: {
  presets: MediaStylePreset[];
  onClose: () => void;
  onSave: (name: string, snippet: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [snippet, setSnippet] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Drawer title="Style presets" onClose={onClose}>
      <p className="text-sm text-slate-500 mb-4">Save a "voice" snippet that gets prepended to your prompts — e.g. brand colors, mood, typography. Pick one in the generator to apply it.</p>

      <div className="space-y-3 mb-5">
        {presets.length === 0 && <p className="text-sm text-slate-400 italic">No styles yet.</p>}
        {presets.map((s) => (
          <div key={s.id} className="border border-slate-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-sm text-slate-800">{s.name}</span>
              <button onClick={() => onDelete(s.id)} className="text-slate-400 hover:text-red-500">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 whitespace-pre-wrap">{s.prompt_snippet}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 pt-4 space-y-2">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Add new</h4>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. 'Moody brand')" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        <textarea value={snippet} onChange={(e) => setSnippet(e.target.value)} rows={4} placeholder="Style snippet to prepend, e.g. 'moody, dark teal background, gold serif text, high contrast, painterly'" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        <button
          disabled={saving || !name.trim() || !snippet.trim()}
          onClick={async () => {
            setSaving(true);
            await onSave(name.trim(), snippet.trim());
            setName(''); setSnippet(''); setSaving(false);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> Save style
        </button>
      </div>
    </Drawer>
  );
}

function CollectionsDrawer({
  collections, onClose, onSave, onDelete,
}: {
  collections: MediaCollection[];
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  return (
    <Drawer title="Collections" onClose={onClose}>
      <p className="text-sm text-slate-500 mb-4">Buckets for organising your history — e.g. "Pinterest", "New Release", "Business Community".</p>

      <div className="space-y-2 mb-5">
        {collections.length === 0 && <p className="text-sm text-slate-400 italic">No collections yet.</p>}
        {collections.map((c) => (
          <div key={c.id} className="flex items-center justify-between border border-slate-200 rounded-lg px-3 py-2">
            <span className="text-sm text-slate-800">{c.name}</span>
            <button onClick={() => onDelete(c.id)} className="text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 pt-4 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New collection name" className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        <button
          disabled={!name.trim()}
          onClick={async () => { await onSave(name.trim()); setName(''); }}
          className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-800 text-white text-sm disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
    </Drawer>
  );
}

function SettingsDrawer({
  cap, onClose, onSave,
}: {
  cap: number;
  onClose: () => void;
  onSave: (capCents: number) => Promise<void>;
}) {
  const [dollars, setDollars] = useState((cap / 100).toFixed(2));
  return (
    <Drawer title="Spend settings" onClose={onClose}>
      <p className="text-sm text-slate-500 mb-4">Set a monthly spending cap. New generations are refused when the next request would exceed this amount. Costs are estimates based on Fal's published rates.</p>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Monthly cap (USD)</label>
      <div className="flex gap-2">
        <span className="self-center text-slate-500">$</span>
        <input
          type="number"
          min={0}
          step={0.5}
          value={dollars}
          onChange={(e) => setDollars(e.target.value)}
          className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm"
        />
      </div>
      <button
        onClick={async () => {
          const cents = Math.max(0, Math.round(parseFloat(dollars) * 100));
          await onSave(cents);
          onClose();
        }}
        className="mt-4 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm"
      >
        Save
      </button>
      <p className="text-[11px] text-slate-400 mt-3">Set to $0 to disable the cap entirely.</p>
    </Drawer>
  );
}
