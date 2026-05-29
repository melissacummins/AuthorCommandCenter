import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ImagePlus, Wand2, Trash2, Download, Upload, X, Plus, Folder, Sparkles, Loader2, AlertCircle, RefreshCw, Settings, Key, ExternalLink, Check, Layers,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { MODELS, findModel, maxImagesForGroup, supportsReferenceImages, gptImage1CostCents, type GptImage1Quality } from './lib/models';
import { SIZE_PRESETS, type SizePreset } from './lib/sizePresets';
import {
  requestGeneration, pollGenerationStatus, uploadInputImage,
  getFalKeyStatus, setFalKey, removeFalKey, type FalKeyStatus,
} from './lib/client';
import type { MediaCollection, MediaCustomModel, MediaGeneration, MediaSettings, MediaStylePreset } from './lib/types';

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

  const [inputImages, setInputImages] = useState<{ url: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [gptImage1Quality, setGptImage1Quality] = useState<GptImage1Quality>('medium');

  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<MediaGeneration[]>([]);
  const [collections, setCollections] = useState<MediaCollection[]>([]);
  const [stylePresets, setStylePresets] = useState<MediaStylePreset[]>([]);
  const [customModels, setCustomModels] = useState<MediaCustomModel[]>([]);
  const [showAllModels, setShowAllModels] = useState(false);
  const [customModelsDrawerOpen, setCustomModelsDrawerOpen] = useState(false);
  const [settings, setSettings] = useState<MediaSettings | null>(null);
  const [monthlySpent, setMonthlySpent] = useState(0);
  const [keyStatus, setKeyStatus] = useState<FalKeyStatus | null>(null);

  const [filterCollectionId, setFilterCollectionId] = useState<string | null>(null);
  const [stylesDrawerOpen, setStylesDrawerOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [collectionsDrawerOpen, setCollectionsDrawerOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollersRef = useRef<Map<string, number>>(new Map());

  // Unified "effective model" — covers both curated (MODELS) and
  // user-defined custom models so the rest of the UI doesn't care
  // where the model came from.
  const model = useMemo(() => {
    const curated = findModel(modelId);
    if (curated) {
      return {
        id: curated.id,
        label: curated.label,
        kind: curated.kind,
        acceptsInputImage: curated.acceptsInputImage,
        canReference: supportsReferenceImages(curated),
        hasDualMode: !!curated.editEndpoint,
        // References are mandatory only for pure-edit models (an edit
        // endpoint with no separate generation endpoint).
        referenceRequired: curated.acceptsInputImage && !curated.editEndpoint,
        supportsCustomSize: curated.supportsCustomSize,
        description: curated.description,
        estimatedCostCents: curated.estimatedCostCents,
        editCostCents: curated.editCostCents ?? curated.estimatedCostCents,
        maxImages: maxImagesForGroup(curated.kind, curated.group),
        isCustom: false,
      };
    }
    const custom = customModels.find((c) => c.id === modelId);
    if (custom) {
      // Custom image generators (no input image) allow batches; edit /
      // i2v style customs and video produce a single output.
      const customMax = custom.kind === 'image' && !custom.accepts_input_image ? 4 : 1;
      return {
        id: custom.id,
        label: custom.label,
        kind: custom.kind,
        acceptsInputImage: custom.accepts_input_image,
        canReference: custom.accepts_input_image,
        hasDualMode: false,
        referenceRequired: false,
        supportsCustomSize: custom.supports_custom_size,
        description: custom.description ?? `Custom: ${custom.endpoint}`,
        estimatedCostCents: custom.estimated_cost_cents,
        editCostCents: custom.estimated_cost_cents,
        maxImages: customMax,
        isCustom: true,
      };
    }
    // Fall back to the first featured curated model.
    const first = MODELS.find((m) => m.isFeatured) ?? MODELS[0];
    return {
      id: first.id,
      label: first.label,
      kind: first.kind,
      acceptsInputImage: first.acceptsInputImage,
      canReference: supportsReferenceImages(first),
      hasDualMode: !!first.editEndpoint,
      referenceRequired: first.acceptsInputImage && !first.editEndpoint,
      supportsCustomSize: first.supportsCustomSize,
      description: first.description,
      estimatedCostCents: first.estimatedCostCents,
      editCostCents: first.editCostCents ?? first.estimatedCostCents,
      maxImages: maxImagesForGroup(first.kind, first.group),
      isCustom: false,
    };
  }, [modelId, customModels]);

  // True when this run will route to the model's edit endpoint
  // (dual-mode model + a reference attached). Drives the edit-mode
  // banner, Generate button label, and cost display.
  const isEditMode = model.hasDualMode && inputImages.length > 0;
  const perImageCostCents = model.id === 'gpt-image-1'
    ? gptImage1CostCents(gptImage1Quality, isEditMode)
    : (isEditMode ? model.editCostCents : model.estimatedCostCents);
  const sizePreset = useMemo<SizePreset | null>(
    () => SIZE_PRESETS.find((p) => p.id === sizePresetId) ?? null,
    [sizePresetId],
  );
  const selectedStyle = useMemo(
    () => stylePresets.find((s) => s.id === selectedStyleId) ?? null,
    [selectedStyleId, stylePresets],
  );

  // Keep the chosen quantity within the current model's max.
  useEffect(() => {
    setQuantity((q) => Math.min(Math.max(1, q), model.maxImages));
  }, [model.maxImages]);

  const fullPrompt = useMemo(() => {
    if (!prompt.trim()) return '';
    if (!selectedStyle) return prompt.trim();
    return `${selectedStyle.prompt_snippet.trim()}\n\n${prompt.trim()}`;
  }, [prompt, selectedStyle]);

  // ---------- data load ----------
  const loadAll = useCallback(async () => {
    if (!userId) return;

    const [genRes, colRes, styleRes, settingsRes, monthRes, customRes] = await Promise.all([
      supabase.from('media_generations').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(80),
      supabase.from('media_collections').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
      supabase.from('media_style_presets').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
      supabase.from('media_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('media_generations').select('cost_cents').eq('user_id', userId).gte('created_at', startOfMonthIso()),
      supabase.from('media_custom_models').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
    ]);

    setHistory((genRes.data ?? []) as MediaGeneration[]);
    setCollections((colRes.data ?? []) as MediaCollection[]);
    setStylePresets((styleRes.data ?? []) as MediaStylePreset[]);
    setSettings((settingsRes.data ?? null) as MediaSettings | null);
    setMonthlySpent(((monthRes.data ?? []) as { cost_cents: number | null }[]).reduce((s, r) => s + (r.cost_cents ?? 0), 0));
    setCustomModels((customRes.data ?? []) as MediaCustomModel[]);

    try {
      setKeyStatus(await getFalKeyStatus());
    } catch {
      setKeyStatus({ has_key: false, hint: null, updated_at: null });
    }
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
    if (model.referenceRequired && inputImages.length === 0) {
      setError(`${model.label} needs at least one reference image.`);
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

      const num = Math.min(Math.max(1, quantity), model.maxImages);
      const gens = await requestGeneration({
        model: model.id,
        prompt: prompt.trim(),
        full_prompt: fullPrompt || prompt.trim(),
        style_preset_id: selectedStyleId,
        width,
        height,
        source_image_urls: model.canReference ? inputImages.map((i) => i.url) : [],
        num_images: num,
        quality: model.id === 'gpt-image-1' ? gptImage1Quality : undefined,
        collection_id: selectedCollectionId,
      });

      setHistory((prev) => [...gens, ...prev]);
      setMonthlySpent((prev) => prev + gens.reduce((s, g) => s + (g.cost_cents ?? 0), 0));
      gens.filter((g) => g.status === 'pending').forEach((g) => startPolling(g.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  async function handleUploadInput(files: FileList) {
    setUploading(true);
    setError(null);
    try {
      const uploaded: { url: string; name: string }[] = [];
      for (const file of Array.from(files)) {
        const url = await uploadInputImage(file);
        uploaded.push({ url, name: file.name });
      }
      setInputImages((prev) => [...prev, ...uploaded]);
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
    setInputImages((prev) => (
      prev.some((i) => i.url === gen.output_url)
        ? prev
        : [...prev, { url: gen.output_url as string, name: `generation-${gen.id.slice(0, 8)}` }]
    ));
    // If the current model can't take a reference, switch to one that
    // can so the next Generate does the obvious thing.
    if (!model.canReference) setModelId('nano-banana');
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

  async function handleSaveFalKey(rawKey: string) {
    const status = await setFalKey(rawKey);
    setKeyStatus(status);
  }

  async function handleRemoveFalKey() {
    await removeFalKey();
    setKeyStatus({ has_key: false, hint: null, updated_at: null });
  }

  async function handleSaveCustomModel(input: Omit<MediaCustomModel, 'id' | 'user_id' | 'created_at' | 'updated_at'>) {
    if (!userId) return;
    if (!input.endpoint.startsWith('fal-ai/')) {
      throw new Error('Endpoint must start with fal-ai/ (e.g. fal-ai/flux-pro/v1.1).');
    }
    const { data, error: insertErr } = await supabase
      .from('media_custom_models')
      .insert({ user_id: userId, ...input, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (insertErr) throw new Error(insertErr.message);
    if (data) setCustomModels((prev) => [...prev, data as MediaCustomModel]);
  }

  async function handleDeleteCustomModel(id: string) {
    const { error: delErr } = await supabase.from('media_custom_models').delete().eq('id', id);
    if (delErr) { setError(delErr.message); return; }
    setCustomModels((prev) => prev.filter((c) => c.id !== id));
    if (modelId === id) {
      const fallback = MODELS.find((m) => m.isFeatured) ?? MODELS[0];
      setModelId(fallback.id);
    }
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

      {keyStatus && !keyStatus.has_key && (
        <div className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 text-sm">
          <Key className="w-5 h-5 mt-0.5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-semibold">Add your Fal.AI API key to get started.</p>
            <p className="text-amber-800/80 text-xs mt-1">
              Each generation is billed to your own Fal account, not ours.{' '}
              <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer" className="underline font-medium inline-flex items-center gap-0.5">
                Get a key <ExternalLink className="w-3 h-3" />
              </a>
              , then paste it in settings.
            </p>
          </div>
          <button onClick={() => setSettingsDrawerOpen(true)} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 shrink-0">
            Add key
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        {/* Controls */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 h-fit space-y-4">
          {/* Model */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Model</label>
              <button onClick={() => setCustomModelsDrawerOpen(true)} className="text-xs text-fuchsia-600 hover:text-fuchsia-700 flex items-center gap-1">
                <Layers className="w-3 h-3" /> Custom models
              </button>
            </div>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
            >
              {(() => {
                // Pick the visible curated set. If the user picked an
                // extended model the dropdown auto-expands so the
                // selection remains visible.
                const selectedCurated = MODELS.find((m) => m.id === modelId);
                const forceShowAll = showAllModels || (selectedCurated && !selectedCurated.isFeatured);
                const visibleCurated = MODELS.filter((m) => forceShowAll || m.isFeatured);
                return (
                  <>
                    <optgroup label="Image — generate">
                      {visibleCurated.filter((m) => m.group === 'image').map((m) => (
                        <option key={m.id} value={m.id}>{m.label} — ~{formatCents(m.estimatedCostCents)}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Image — edit">
                      {visibleCurated.filter((m) => m.group === 'image-edit').map((m) => (
                        <option key={m.id} value={m.id}>{m.label} — ~{formatCents(m.estimatedCostCents)}</option>
                      ))}
                    </optgroup>
                    {forceShowAll && visibleCurated.some((m) => m.group === 'image-upscale') && (
                      <optgroup label="Image — upscale & utility">
                        {visibleCurated.filter((m) => m.group === 'image-upscale').map((m) => (
                          <option key={m.id} value={m.id}>{m.label} — ~{formatCents(m.estimatedCostCents)}</option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Video">
                      {visibleCurated.filter((m) => m.group === 'video').map((m) => (
                        <option key={m.id} value={m.id}>{m.label} — ~{formatCents(m.estimatedCostCents)}</option>
                      ))}
                    </optgroup>
                    {customModels.length > 0 && (
                      <optgroup label="Your custom models">
                        {customModels.map((c) => (
                          <option key={c.id} value={c.id}>{c.label} — ~{formatCents(c.estimated_cost_cents)}</option>
                        ))}
                      </optgroup>
                    )}
                  </>
                );
              })()}
            </select>
            <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-slate-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showAllModels}
                onChange={(e) => setShowAllModels(e.target.checked)}
                className="rounded"
              />
              Show all models ({MODELS.length} total)
            </label>
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

          {/* GPT Image 1 quality */}
          {model.id === 'gpt-image-1' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Quality</label>
                <span className="text-[11px] text-slate-400">~{formatCents(gptImage1CostCents(gptImage1Quality, isEditMode))} each</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {(['low', 'medium', 'high', 'auto'] as const).map((q) => (
                  <button
                    key={q}
                    onClick={() => setGptImage1Quality(q)}
                    className={`py-2 rounded-lg text-xs font-medium border transition-colors ${
                      gptImage1Quality === q
                        ? 'bg-fuchsia-600 text-white border-fuchsia-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {q[0].toUpperCase() + q.slice(1)}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Low ~{formatCents(gptImage1CostCents('low', isEditMode))} · Medium ~{formatCents(gptImage1CostCents('medium', isEditMode))} · High ~{formatCents(gptImage1CostCents('high', isEditMode))}. Lower quality is fine for drafts.
              </p>
            </div>
          )}

          {/* Reference / input images */}
          {model.canReference && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Reference {inputImages.length === 1 ? 'image' : 'images'} {model.referenceRequired ? '(required)' : '(optional)'}
              </label>
              {inputImages.length > 0 && (
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {inputImages.map((img, idx) => (
                    <div key={img.url} className="relative group aspect-square">
                      <img src={img.url} alt={img.name} className="w-full h-full object-cover rounded-lg border border-slate-200" />
                      <button
                        onClick={() => setInputImages((prev) => prev.filter((_, i) => i !== idx))}
                        className="absolute -top-1.5 -right-1.5 bg-white border border-slate-200 rounded-full p-0.5 text-slate-400 hover:text-red-500 shadow-sm"
                        title="Remove"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
              >
                {uploading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                  : <><Upload className="w-4 h-4" /> {inputImages.length > 0 ? 'Add more images' : 'Upload reference images'}</>}
              </button>
              <p className="text-[11px] text-slate-400 mt-1">You can add several — they're all sent to the model as references.</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) handleUploadInput(e.target.files);
                  e.target.value = '';
                }}
              />
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

          {/* Quantity */}
          {model.kind === 'image' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">How many?</label>
                <span className="text-[11px] text-slate-400">Up to {model.maxImages} per run</span>
              </div>
              {model.maxImages > 1 ? (
                <div className="flex gap-1.5">
                  {Array.from({ length: model.maxImages }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      onClick={() => setQuantity(n)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        quantity === n
                          ? 'bg-fuchsia-600 text-white border-fuchsia-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">This model returns a single image per run.</p>
              )}
            </div>
          )}

          {isEditMode && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5 text-xs text-amber-900">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
              <div className="flex-1">
                <p className="font-semibold">
                  Edit mode — {inputImages.length} reference image{inputImages.length > 1 ? 's' : ''} attached.
                </p>
                <p className="text-amber-800/90 mt-0.5">
                  This request will route to <code className="font-mono">{model.label.split(' —')[0]}</code>'s edit endpoint (~{formatCents(model.editCostCents)} per image vs ~{formatCents(model.estimatedCostCents)} to generate).
                </p>
              </div>
              <button
                onClick={() => setInputImages([])}
                className="px-2 py-1 rounded-md bg-amber-600 text-white text-[11px] font-semibold hover:bg-amber-700 shrink-0"
                title="Remove all references and switch back to generation"
              >
                Clear
              </button>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim() || uploading || (keyStatus !== null && !keyStatus.has_key)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-fuchsia-500 to-purple-600 text-white font-semibold shadow-lg shadow-fuchsia-500/25 hover:shadow-fuchsia-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
              : <><Wand2 className="w-4 h-4" /> {isEditMode ? 'Edit' : 'Generate'}{model.kind === 'image' && quantity > 1 ? ` ${quantity}×` : ''} (~{formatCents(perImageCostCents * (model.kind === 'image' ? quantity : 1))})</>}
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
          keyStatus={keyStatus}
          onClose={() => setSettingsDrawerOpen(false)}
          onSave={handleSaveSettings}
          onSaveKey={handleSaveFalKey}
          onRemoveKey={handleRemoveFalKey}
        />
      )}
      {customModelsDrawerOpen && (
        <CustomModelsDrawer
          models={customModels}
          onClose={() => setCustomModelsDrawerOpen(false)}
          onSave={handleSaveCustomModel}
          onDelete={handleDeleteCustomModel}
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
          <span className="flex items-center gap-1">
            {generation.model} · {generation.width && generation.height ? `${generation.width}×${generation.height}` : generation.kind}
            {generation.source_image_url && (
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-medium">edited</span>
            )}
          </span>
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
  cap, keyStatus, onClose, onSave, onSaveKey, onRemoveKey,
}: {
  cap: number;
  keyStatus: FalKeyStatus | null;
  onClose: () => void;
  onSave: (capCents: number) => Promise<void>;
  onSaveKey: (key: string) => Promise<void>;
  onRemoveKey: () => Promise<void>;
}) {
  const [dollars, setDollars] = useState((cap / 100).toFixed(2));
  const [rawKey, setRawKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySaved, setKeySaved] = useState(false);

  async function submitKey() {
    setKeyError(null);
    setKeySaved(false);
    setSavingKey(true);
    try {
      await onSaveKey(rawKey.trim());
      setRawKey('');
      setKeySaved(true);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to save key');
    } finally {
      setSavingKey(false);
    }
  }

  async function removeKey() {
    if (!window.confirm('Remove your stored Fal API key? You will need to paste it again to generate.')) return;
    setRemovingKey(true);
    try {
      await onRemoveKey();
      setKeySaved(false);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to remove key');
    } finally {
      setRemovingKey(false);
    }
  }

  return (
    <Drawer title="Media settings" onClose={onClose}>
      {/* Fal API key */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Key className="w-4 h-4 text-slate-500" />
          <h4 className="font-semibold text-slate-800">Fal.AI API key</h4>
        </div>
        <p className="text-sm text-slate-500 mb-3">
          Each generation is billed to your own Fal account.{' '}
          <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer" className="text-fuchsia-600 hover:text-fuchsia-700 underline inline-flex items-center gap-0.5">
            Get a key <ExternalLink className="w-3 h-3" />
          </a>
          . Keys are encrypted with AES-256-GCM before being stored — only the server can decrypt them on demand.
        </p>

        {keyStatus?.has_key ? (
          <div className="mb-3 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-emerald-800">
            <Check className="w-4 h-4 shrink-0" />
            <span className="flex-1">Key saved (ends in <code className="font-mono">{keyStatus.hint}</code>)</span>
            <button
              onClick={removeKey}
              disabled={removingKey}
              className="text-xs text-emerald-700 hover:text-red-600 underline disabled:opacity-50"
            >
              {removingKey ? 'Removing…' : 'Remove'}
            </button>
          </div>
        ) : (
          <div className="mb-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>No key saved — generation is disabled until you add one.</span>
          </div>
        )}

        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
          {keyStatus?.has_key ? 'Replace key' : 'Paste your key'}
        </label>
        <input
          type="password"
          value={rawKey}
          onChange={(e) => { setRawKey(e.target.value); setKeySaved(false); setKeyError(null); }}
          placeholder="key_xxxx…  or  xxxxxxxx:xxxxxxxx…"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono"
          autoComplete="off"
        />
        {keyError && <p className="text-xs text-red-600 mt-1">{keyError}</p>}
        {keySaved && <p className="text-xs text-emerald-700 mt-1">Saved.</p>}
        <button
          onClick={submitKey}
          disabled={savingKey || rawKey.trim().length < 16}
          className="mt-2 px-4 py-2 rounded-lg bg-fuchsia-600 text-white text-sm font-semibold hover:bg-fuchsia-700 disabled:opacity-50"
        >
          {savingKey ? 'Saving…' : 'Save key'}
        </button>
      </div>

      <div className="border-t border-slate-100 pt-5">
        <h4 className="font-semibold text-slate-800 mb-1">Monthly spend cap</h4>
        <p className="text-sm text-slate-500 mb-3">New generations are refused when the next request would exceed this amount. Costs are estimates based on Fal's published rates.</p>
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
          className="mt-3 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm"
        >
          Save cap
        </button>
        <p className="text-[11px] text-slate-400 mt-3">Set to $0 to disable the cap entirely.</p>
      </div>
    </Drawer>
  );
}

function CustomModelsDrawer({
  models, onClose, onSave, onDelete,
}: {
  models: MediaCustomModel[];
  onClose: () => void;
  onSave: (input: Omit<MediaCustomModel, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [endpoint, setEndpoint] = useState('fal-ai/');
  const [kind, setKind] = useState<'image' | 'video'>('image');
  const [isAsync, setIsAsync] = useState(false);
  const [acceptsInputImage, setAcceptsInputImage] = useState(false);
  const [supportsCustomSize, setSupportsCustomSize] = useState(true);
  const [costDollars, setCostDollars] = useState('0.05');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    setSaving(true);
    try {
      await onSave({
        label: label.trim(),
        endpoint: endpoint.trim(),
        kind,
        is_async: isAsync,
        accepts_input_image: acceptsInputImage,
        supports_custom_size: supportsCustomSize,
        estimated_cost_cents: Math.max(0, Math.round(parseFloat(costDollars) * 100)),
        description: description.trim() || null,
      });
      setLabel(''); setEndpoint('fal-ai/'); setKind('image'); setIsAsync(false);
      setAcceptsInputImage(false); setSupportsCustomSize(true); setCostDollars('0.05'); setDescription('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer title="Custom models" onClose={onClose}>
      <p className="text-sm text-slate-500 mb-4">
        Add any Fal.AI model that isn't in the built-in dropdown. Paste the endpoint from{' '}
        <a href="https://fal.ai/models" target="_blank" rel="noreferrer" className="text-fuchsia-600 underline inline-flex items-center gap-0.5">
          fal.ai/models <ExternalLink className="w-3 h-3" />
        </a>
        {' '}— e.g. <code className="font-mono text-xs bg-slate-100 px-1 rounded">fal-ai/flux-pro/v1.1</code>.
      </p>

      <div className="space-y-2 mb-5">
        {models.length === 0 && <p className="text-sm text-slate-400 italic">No custom models yet.</p>}
        {models.map((m) => (
          <div key={m.id} className="border border-slate-200 rounded-xl p-3">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-slate-800">{m.label}</div>
                <code className="text-[11px] text-slate-500 font-mono">{m.endpoint}</code>
              </div>
              <button onClick={() => onDelete(m.id)} className="text-slate-400 hover:text-red-500 shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1.5 text-[11px]">
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{m.kind}</span>
              {m.is_async && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">async</span>}
              {m.accepts_input_image && <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">input image</span>}
              {m.supports_custom_size && <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">custom size</span>}
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">~${(m.estimated_cost_cents / 100).toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 pt-4 space-y-3">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Add new model</h4>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Display name</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Flux Pro v1.1" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Fal endpoint</label>
          <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="fal-ai/flux-pro/v1.1" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
          <p className="text-[11px] text-slate-400 mt-1">Must start with <code className="font-mono">fal-ai/</code>.</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Kind</label>
            <select value={kind} onChange={(e) => { const k = e.target.value as 'image' | 'video'; setKind(k); setIsAsync(k === 'video'); }} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white">
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Est. cost (USD)</label>
            <input type="number" min={0} step={0.01} value={costDollars} onChange={(e) => setCostDollars(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-1.5 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isAsync} onChange={(e) => setIsAsync(e.target.checked)} />
            <span>Async (uses Fal's queue — required for most video and slow image models)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={acceptsInputImage} onChange={(e) => setAcceptsInputImage(e.target.checked)} />
            <span>Accepts input image (editor / image-to-image / img-to-video)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={supportsCustomSize} onChange={(e) => setSupportsCustomSize(e.target.checked)} />
            <span>Supports custom width/height</span>
          </label>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Description (optional)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this model is good for" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-y" />
        </div>

        {err && <p className="text-xs text-red-600">{err}</p>}

        <button
          disabled={saving || !label.trim() || !endpoint.startsWith('fal-ai/') || endpoint.length < 8}
          onClick={submit}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> {saving ? 'Saving…' : 'Add model'}
        </button>
      </div>
    </Drawer>
  );
}
