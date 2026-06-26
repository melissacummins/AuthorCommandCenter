import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  ImagePlus, Wand2, Trash2, Download, Upload, X, Plus, Folder, Sparkles, Loader2, AlertCircle, RefreshCw, RotateCw, Check, ExternalLink, Layers,
  ChevronLeft, ChevronRight as ChevronRightIcon,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { MODELS, findModel, maxImagesForGroup, supportsReferenceImages, type GptImage1Quality, type IdeogramRenderingSpeed, type SizeHandling } from './lib/models';

// Pick the closest supported aspect-ratio string (e.g. "3:4") for a
// model whose size field carries that list. Mirrors the server-side
// closestAspectRatio() so the UI hint matches what the request will
// actually send.
function closestAspectRatio(width: number, height: number, supported: string[]): string {
  if (!width || !height) return 'auto';
  const target = width / height;
  let best = supported[0] ?? 'auto';
  let bestDiff = Infinity;
  for (const ratio of supported) {
    const [w, h] = ratio.split(':').map((n) => parseInt(n, 10));
    if (!w || !h) continue;
    const diff = Math.abs(Math.log(target) - Math.log(w / h));
    if (diff < bestDiff) { bestDiff = diff; best = ratio; }
  }
  return best;
}

function snap16(n: number): number {
  return Math.max(16, Math.round(n / 16) * 16);
}

// Returns a one-line "what we'll actually send" string for the current
// (model, dimensions) combo. Returns null when the size you picked
// goes through unchanged.
function describeEffectiveSize(
  size: SizeHandling | undefined,
  width: number,
  height: number,
  hasReference: boolean,
): string | null {
  if (!size) return null;
  switch (size.type) {
    case 'pixels':
      return null;
    case 'pixelsStringSnap16': {
      const w = snap16(width), h = snap16(height);
      if (w === width && h === height) return null;
      return `Sent as ${w}×${h} (snapped to multiple of 16)`;
    }
    case 'aspectRatio': {
      const ar = closestAspectRatio(width, height, size.ratios);
      return `Sent as aspect ratio ${ar} — model picks its own resolution`;
    }
    case 'preserveInput':
      return hasReference
        ? 'Output keeps the reference image\'s aspect ratio — your size selection is ignored'
        : 'Output dimensions match the input image';
    case 'fixed':
      return 'Model uses its own default size — your size selection is ignored';
  }
}
import { SIZE_PRESETS, type SizePreset } from './lib/sizePresets';
import {
  requestGeneration, pollGenerationStatus, uploadInputImage, describeImage,
  getFalKeyStatus, getOpenaiKeyStatus, getIdeogramKeyStatus, type FalKeyStatus,
} from './lib/client';
import type { MediaCollection, MediaCustomModel, MediaGeneration } from './lib/types';

const POLL_INTERVAL_MS = 4000;
// Cap on simultaneously-in-flight Generate clicks. High enough that you
// can keep iterating, low enough that a stuck loop can't blow the bill.
const MAX_CONCURRENT_GENERATIONS = 5;

export default function MediaModule() {
  const { user } = useAuth();
  const userId = user?.id;

  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState<string>(MODELS[0].id);
  const [sizePresetId, setSizePresetId] = useState<string>('aspect-4-5');
  const [customWidth, setCustomWidth] = useState<number>(1024);
  const [customHeight, setCustomHeight] = useState<number>(1024);
  const [useCustomSize, setUseCustomSize] = useState(false);

  const [inputImages, setInputImages] = useState<{ url: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [gptImage1Quality, setGptImage1Quality] = useState<GptImage1Quality>('medium');

  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);

  // Image-to-prompt panel state. The user uploads a reference image,
  // we get a description back from Florence-2, and let them seed/append
  // it to the prompt textarea.
  const [describeImageUrl, setDescribeImageUrl] = useState<string | null>(null);
  const [describeThumbDataUrl, setDescribeThumbDataUrl] = useState<string | null>(null);
  const [describing, setDescribing] = useState(false);
  const [caption, setCaption] = useState('');

  // Counter, not boolean — lets the user kick off multiple generations
  // without waiting for the previous one to finish. Capped by MAX_CONCURRENT
  // so a runaway loop can't fan out unbounded API calls.
  const [inflightCount, setInflightCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Lightbox state — id of the generation being previewed, or null.
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [promptHistoryOpen, setPromptHistoryOpen] = useState(false);

  const [history, setHistory] = useState<MediaGeneration[]>([]);
  const [collections, setCollections] = useState<MediaCollection[]>([]);
  const [customModels, setCustomModels] = useState<MediaCustomModel[]>([]);
  const [showAllModels, setShowAllModels] = useState(false);
  const [customModelsDrawerOpen, setCustomModelsDrawerOpen] = useState(false);
  const [keyStatus, setKeyStatus] = useState<FalKeyStatus | null>(null);
  const [openaiKeyStatus, setOpenaiKeyStatus] = useState<FalKeyStatus | null>(null);
  const [ideogramKeyStatus, setIdeogramKeyStatus] = useState<FalKeyStatus | null>(null);
  const [ideogramSpeed, setIdeogramSpeed] = useState<IdeogramRenderingSpeed>('DEFAULT');

  const [filterCollectionId, setFilterCollectionId] = useState<string | null>(null);
  const [collectionsDrawerOpen, setCollectionsDrawerOpen] = useState(false);
  // Selection set for bulk delete / move-to-collection.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Set of generation ids currently downloading so we can show a spinner
  // on the row button while the blob is being fetched.
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

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
        size: curated.size,
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
      size: first.size,
      isCustom: false,
    };
  }, [modelId, customModels]);

  // True when this run will route to the model's edit endpoint
  // (dual-mode model + a reference attached). Drives the edit-mode
  // banner, Generate button label, and cost display.
  // Provider routing per model:
  //   - GPT Image 2 → OpenAI direct if a key is configured (cheaper).
  //   - Ideogram v3 / v3-edit → Ideogram direct if a key is configured.
  //   - Everything else → Fal.
  const gptImage1Provider: 'fal' | 'openai' =
    model.id === 'gpt-image-2' && openaiKeyStatus?.has_key ? 'openai' : 'fal';
  // ideogram-v4 is generate-only via direct API. Keys also unlock
  // v3 (generate + edit) since the same Ideogram account works for both.
  const isIdeogramDirectModel =
    model.id === 'ideogram-v3' || model.id === 'ideogram-v3-edit' || model.id === 'ideogram-v4';
  const ideogramProvider: 'fal' | 'ideogram' =
    isIdeogramDirectModel && ideogramKeyStatus?.has_key ? 'ideogram' : 'fal';
  // When routed via OpenAI or Ideogram direct, ANY reference image
  // becomes an edit (the direct endpoints handle both modes).
  const isEditMode = model.id === 'gpt-image-2' && gptImage1Provider === 'openai'
    ? inputImages.length > 0
    : isIdeogramDirectModel && ideogramProvider === 'ideogram'
      ? inputImages.length > 0
      : (model.hasDualMode && inputImages.length > 0);
  const sizePreset = useMemo<SizePreset | null>(
    () => SIZE_PRESETS.find((p) => p.id === sizePresetId) ?? null,
    [sizePresetId],
  );
  // Keep the chosen quantity within the current model's max.
  useEffect(() => {
    setQuantity((q) => Math.min(Math.max(1, q), model.maxImages));
  }, [model.maxImages]);

  // ---------- data load ----------
  const loadAll = useCallback(async () => {
    if (!userId) return;

    const [genRes, colRes, customRes] = await Promise.all([
      supabase.from('media_generations').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(80),
      supabase.from('media_collections').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
      supabase.from('media_custom_models').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
    ]);

    setHistory((genRes.data ?? []) as MediaGeneration[]);
    setCollections((colRes.data ?? []) as MediaCollection[]);
    setCustomModels((customRes.data ?? []) as MediaCustomModel[]);

    try {
      setKeyStatus(await getFalKeyStatus());
    } catch {
      setKeyStatus({ has_key: false, hint: null, updated_at: null });
    }
    try {
      setOpenaiKeyStatus(await getOpenaiKeyStatus());
    } catch {
      setOpenaiKeyStatus({ has_key: false, hint: null, updated_at: null });
    }
    try {
      setIdeogramKeyStatus(await getIdeogramKeyStatus());
    } catch {
      setIdeogramKeyStatus({ has_key: false, hint: null, updated_at: null });
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
    setInflightCount((n) => n + 1);
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
      const { generations: gens, error: failureMessage } = await requestGeneration({
        model: model.id,
        prompt: prompt.trim(),
        full_prompt: prompt.trim(),
        style_preset_id: null,
        width,
        height,
        source_image_urls: model.canReference ? inputImages.map((i) => i.url) : [],
        num_images: num,
        quality: model.id === 'gpt-image-2' ? gptImage1Quality : undefined,
        rendering_speed: isIdeogramDirectModel && ideogramProvider === 'ideogram' ? ideogramSpeed : undefined,
        collection_id: selectedCollectionId,
      });

      // Add returned rows to history regardless of outcome — the
      // server includes the failed row in error responses too, so the
      // user sees a failed card with the full provider message
      // immediately instead of having to refresh.
      if (gens.length > 0) setHistory((prev) => [...gens, ...prev]);
      if (failureMessage) setError(failureMessage);
      gens.filter((g) => g.status === 'pending').forEach((g) => startPolling(g.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setInflightCount((n) => Math.max(0, n - 1));
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

  async function handleDescribeImage(file: File) {
    setDescribing(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onload = () => setDescribeThumbDataUrl(typeof reader.result === 'string' ? reader.result : null);
      reader.readAsDataURL(file);
      const url = await uploadInputImage(file);
      setDescribeImageUrl(url);
      const text = await describeImage(url);
      setCaption(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to describe image');
    } finally {
      setDescribing(false);
    }
  }

  function handleClearDescribe() {
    setDescribeImageUrl(null);
    setDescribeThumbDataUrl(null);
    setCaption('');
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

  // Force a real download instead of a new tab. The output URLs are on
  // Supabase's storage origin, so the browser ignores <a download> for
  // cross-origin links. Fetch into a Blob, mint a blob: URL, and click
  // a synthetic anchor.
  async function handleDownload(gen: MediaGeneration) {
    if (!gen.output_url) return;
    setDownloadingIds((prev) => { const next = new Set(prev); next.add(gen.id); return next; });
    try {
      const res = await fetch(gen.output_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const ext = gen.kind === 'video' ? 'mp4' : 'png';
      const a = document.createElement('a');
      a.href = url;
      a.download = `${gen.model}-${gen.id.slice(0, 8)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? `Download failed: ${err.message}` : 'Download failed');
    } finally {
      setDownloadingIds((prev) => { const next = new Set(prev); next.delete(gen.id); return next; });
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} item${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    const { error: delErr } = await supabase
      .from('media_generations')
      .delete()
      .in('id', ids);
    if (delErr) { setError(delErr.message); return; }
    setHistory((prev) => prev.filter((g) => !selectedIds.has(g.id)));
    setSelectedIds(new Set());
  }

  async function handleBulkMoveToCollection(collectionId: string | null) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const { error: upErr } = await supabase
      .from('media_generations')
      .update({ collection_id: collectionId })
      .in('id', ids);
    if (upErr) { setError(upErr.message); return; }
    setHistory((prev) => prev.map((g) => (selectedIds.has(g.id) ? { ...g, collection_id: collectionId } : g)));
    setSelectedIds(new Set());
  }

  // Pre-fill all controls from a past generation so the user can rerun
  // it with the same prompt + model + size + style. Quality / rendering
  // speed aren't stored on the row, so they keep whatever's currently
  // selected (user can tweak before hitting Generate). References:
  // we only stored the first source_image_url, so that's what gets
  // re-attached.
  function handleRetry(gen: MediaGeneration) {
    setPrompt(gen.prompt);
    setModelId(gen.model);
    if (gen.collection_id) setSelectedCollectionId(gen.collection_id);
    if (gen.width && gen.height) {
      // Match a known size preset if the dimensions line up; else use Custom.
      const preset = SIZE_PRESETS.find((p) => p.width === gen.width && p.height === gen.height);
      if (preset) {
        setSizePresetId(preset.id);
        setUseCustomSize(false);
      } else {
        setCustomWidth(gen.width);
        setCustomHeight(gen.height);
        setUseCustomSize(true);
      }
    }
    if (gen.source_image_url) {
      setInputImages([{ url: gen.source_image_url, name: 'previous reference' }]);
    } else {
      setInputImages([]);
    }
    setLightboxId(null);
    // Scroll the controls back into view in case the user clicked
    // retry from deep in the history grid.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- derived ----------
  const filteredHistory = useMemo(() => {
    if (!filterCollectionId) return history;
    if (filterCollectionId === '__uncategorised__') return history.filter((g) => !g.collection_id);
    return history.filter((g) => g.collection_id === filterCollectionId);
  }, [history, filterCollectionId]);

  // ---------- render ----------
  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-br from-fuchsia-500 to-purple-600 rounded-xl shadow-lg shadow-fuchsia-500/25">
          <ImagePlus className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Media</h1>
          <p className="text-sm text-slate-500">Generate Pinterest pins, new release art, social images, and short video clips.</p>
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
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-semibold">Add your Fal.AI API key to get started.</p>
            <p className="text-amber-800/80 text-xs mt-1">
              Each generation is billed to your own Fal account, not ours.{' '}
              <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer" className="underline font-medium inline-flex items-center gap-0.5">
                Get a key <ExternalLink className="w-3 h-3" />
              </a>
              , then paste it in <RouterLink to="/settings" className="underline font-medium">Settings → Media generator keys</RouterLink>.
            </p>
          </div>
          <RouterLink to="/settings" className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 shrink-0">
            Open Settings
          </RouterLink>
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
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Image — edit">
                      {visibleCurated.filter((m) => m.group === 'image-edit').map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </optgroup>
                    {forceShowAll && visibleCurated.some((m) => m.group === 'image-upscale') && (
                      <optgroup label="Image — upscale & utility">
                        {visibleCurated.filter((m) => m.group === 'image-upscale').map((m) => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Video">
                      {visibleCurated.filter((m) => m.group === 'video').map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </optgroup>
                    {customModels.length > 0 && (
                      <optgroup label="Your custom models">
                        {customModels.map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
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
            {model.id === 'gpt-image-2' && (
              <p className="text-[11px] mt-1">
                {gptImage1Provider === 'openai' ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">
                    via OpenAI direct (cheaper)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                    via Fal
                    {openaiKeyStatus !== null && !openaiKeyStatus.has_key && (
                      <>
                        {' — '}<RouterLink to="/settings" className="underline">add an OpenAI key</RouterLink>{' for ~3× lower cost'}
                      </>
                    )}
                  </span>
                )}
              </p>
            )}
            {isIdeogramDirectModel && (
              <p className="text-[11px] mt-1">
                {ideogramProvider === 'ideogram' ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium">
                    via Ideogram direct (cheaper)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                    via Fal
                    {ideogramKeyStatus !== null && !ideogramKeyStatus.has_key && (
                      <>
                        {' — '}<RouterLink to="/settings" className="underline">add an Ideogram key</RouterLink>{' to unlock Turbo (~2× cheaper)'}
                      </>
                    )}
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Describe an image — drop a reference to seed your prompt. */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" /> Describe an image
            </label>
            {!describeImageUrl ? (
              <label className={`flex flex-col items-center justify-center gap-1.5 px-3 py-4 rounded-lg border-2 border-dashed text-xs cursor-pointer transition-colors ${describing ? 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700' : 'border-slate-200 text-slate-500 hover:border-fuchsia-300 hover:bg-fuchsia-50/40'}`}>
                {describing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Reading image…
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span>Drop an image to get a prompt-style description</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  disabled={describing}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleDescribeImage(f);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2">
                <div className="flex items-start gap-2">
                  {describeThumbDataUrl && (
                    <img src={describeThumbDataUrl} alt="Reference" className="w-14 h-14 rounded object-cover border border-slate-200 shrink-0" />
                  )}
                  <textarea
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    rows={4}
                    placeholder={describing ? 'Reading image…' : 'Caption appears here — edit before using'}
                    className="flex-1 px-2 py-1.5 rounded border border-slate-200 text-xs bg-white"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    disabled={!caption.trim()}
                    onClick={() => setPrompt(caption.trim())}
                    className="px-2.5 py-1 rounded-md bg-fuchsia-600 text-white text-[11px] font-semibold hover:bg-fuchsia-700 disabled:opacity-40"
                  >
                    Use as prompt
                  </button>
                  <button
                    disabled={!caption.trim()}
                    onClick={() => setPrompt((p) => (p.trim() ? `${p.trim()}\n\n${caption.trim()}` : caption.trim()))}
                    className="px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-700 text-[11px] font-semibold hover:bg-slate-100 disabled:opacity-40"
                  >
                    Append to prompt
                  </button>
                  <button
                    onClick={handleClearDescribe}
                    className="ml-auto px-2 py-1 rounded-md text-slate-400 hover:text-slate-700 text-[11px]"
                  >
                    Clear
                  </button>
                </div>
              </div>
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
                <optgroup label="Aspect ratio">
                  {SIZE_PRESETS.filter((p) => p.group === 'aspect').map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Social platform">
                  {SIZE_PRESETS.filter((p) => p.group === 'social').map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Book">
                  {SIZE_PRESETS.filter((p) => p.group === 'book').map((p) => (
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
              {(() => {
                const w = useCustomSize ? customWidth : sizePreset?.width ?? 0;
                const h = useCustomSize ? customHeight : sizePreset?.height ?? 0;
                const note = describeEffectiveSize(model.size, w, h, inputImages.length > 0);
                return note ? (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0 text-slate-400" />
                    <span>{note}</span>
                  </p>
                ) : null;
              })()}
            </div>
          )}

          {/* GPT Image 1 quality */}
          {model.id === 'gpt-image-2' && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Quality</label>
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
                Lower quality is fine for drafts; High has the best detail.
              </p>
            </div>
          )}

          {/* Ideogram v3 rendering speed — only when routed via Ideogram direct. */}
          {isIdeogramDirectModel && ideogramProvider === 'ideogram' && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Rendering speed</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['TURBO', 'DEFAULT', 'QUALITY'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setIdeogramSpeed(s)}
                    className={`py-2 rounded-lg text-xs font-medium border transition-colors ${
                      ideogramSpeed === s
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {s[0] + s.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Turbo is fast; Quality has the best detail.
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
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">Prompt</label>
              <button
                onClick={() => setPromptHistoryOpen(true)}
                className="text-xs text-fuchsia-600 hover:text-fuchsia-700 flex items-center gap-1"
                title="Browse past prompts"
              >
                <Sparkles className="w-3 h-3" /> Recent prompts
              </button>
            </div>
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
                  This request will route to <code className="font-mono">{model.label.split(' —')[0]}</code>'s edit endpoint.
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
            disabled={inflightCount >= MAX_CONCURRENT_GENERATIONS || !prompt.trim() || uploading || (keyStatus !== null && !keyStatus.has_key)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-fuchsia-500 to-purple-600 text-white font-semibold shadow-lg shadow-fuchsia-500/25 hover:shadow-fuchsia-500/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Wand2 className="w-4 h-4" /> {isEditMode ? 'Edit' : 'Generate'}{model.kind === 'image' && quantity > 1 ? ` ${quantity}×` : ''}
          </button>
          {inflightCount > 0 && (
            <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              {inflightCount} request{inflightCount > 1 ? 's' : ''} in flight
              {inflightCount >= MAX_CONCURRENT_GENERATIONS && ' — wait for one to finish to queue more'}
            </p>
          )}
        </div>

        {/* History */}
        <div>
          {/* Bulk action toolbar — only when there's a selection. */}
          {selectedIds.size > 0 && (
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 mb-3 bg-fuchsia-50 border border-fuchsia-200 rounded-xl px-3 py-2 text-sm">
              <span className="font-semibold text-fuchsia-900">{selectedIds.size} selected</span>
              <select
                value=""
                onChange={(e) => handleBulkMoveToCollection(e.target.value || null)}
                className="text-xs px-2 py-1.5 rounded-lg border border-fuchsia-200 bg-white text-slate-700"
              >
                <option value="" disabled>Move to collection…</option>
                <option value="">Uncategorised</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                onClick={handleBulkDelete}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete {selectedIds.size}
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="ml-auto text-xs text-fuchsia-700 hover:text-fuchsia-900 underline"
              >
                Clear selection
              </button>
            </div>
          )}
          {/* Collection filter chips */}
          <div className="flex flex-wrap items-center gap-2 mb-4 pb-1">
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
                  selected={selectedIds.has(g.id)}
                  downloading={downloadingIds.has(g.id)}
                  onToggleSelected={() => toggleSelected(g.id)}
                  onDownload={() => handleDownload(g)}
                  onDelete={() => handleDelete(g)}
                  onUseAsInput={() => handleUseAsInput(g)}
                  onRetry={() => handleRetry(g)}
                  onMoveCollection={(cid) => handleMoveToCollection(g.id, cid)}
                  onOpenLightbox={() => setLightboxId(g.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {collectionsDrawerOpen && (
        <CollectionsDrawer
          collections={collections}
          onClose={() => setCollectionsDrawerOpen(false)}
          onSave={handleSaveCollection}
          onDelete={handleDeleteCollection}
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
      {promptHistoryOpen && (
        <PromptHistoryDrawer
          history={history}
          currentPrompt={prompt}
          onClose={() => setPromptHistoryOpen(false)}
          onPick={(p) => { setPrompt(p); setPromptHistoryOpen(false); }}
        />
      )}
      {lightboxId && (() => {
        const lightboxItem = history.find((g) => g.id === lightboxId);
        if (!lightboxItem || !lightboxItem.output_url) return null;
        // Allow prev/next navigation through the filtered history so
        // the user can flip through results without closing the modal.
        const idx = filteredHistory.findIndex((g) => g.id === lightboxId);
        const prev = idx > 0 ? filteredHistory[idx - 1] : null;
        const next = idx >= 0 && idx < filteredHistory.length - 1 ? filteredHistory[idx + 1] : null;
        return (
          <Lightbox
            generation={lightboxItem}
            prev={prev}
            next={next}
            onClose={() => setLightboxId(null)}
            onJump={(id) => setLightboxId(id)}
            onDownload={() => handleDownload(lightboxItem)}
            onRetry={() => handleRetry(lightboxItem)}
          />
        );
      })()}
    </div>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================

function MediaCard({
  generation, collections, selected, downloading,
  onToggleSelected, onDownload, onDelete, onUseAsInput, onRetry, onMoveCollection, onOpenLightbox,
}: {
  generation: MediaGeneration;
  collections: MediaCollection[];
  selected: boolean;
  downloading: boolean;
  onToggleSelected: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onUseAsInput: () => void;
  onRetry: () => void;
  onMoveCollection: (collectionId: string | null) => void;
  onOpenLightbox: () => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const pending = generation.status === 'pending';
  const failed = generation.status === 'failed';

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden flex flex-col ${selected ? 'border-fuchsia-500 ring-2 ring-fuchsia-200' : 'border-slate-200'}`}>
      <div className="aspect-square bg-slate-100 relative">
        {/* Selection checkbox — top-left overlay. */}
        {!pending && !failed && (
          <button
            onClick={onToggleSelected}
            className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
              selected
                ? 'bg-fuchsia-600 border-fuchsia-600 text-white'
                : 'bg-white/80 border-white hover:border-fuchsia-400'
            }`}
            title={selected ? 'Deselect' : 'Select'}
          >
            {selected && <Check className="w-4 h-4" />}
          </button>
        )}
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
            <button
              onClick={onOpenLightbox}
              className="w-full h-full block focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
              title="Preview larger"
            >
              <img src={generation.output_url} alt={generation.prompt} className="w-full h-full object-cover hover:opacity-90 transition-opacity cursor-zoom-in" />
            </button>
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

        <div className="flex items-center text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            {generation.model} · {generation.width && generation.height ? `${generation.width}×${generation.height}` : generation.kind}
            {generation.source_image_url && (
              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-medium">edited</span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-1 mt-1">
          {generation.output_url && !pending && (
            <button
              onClick={onDownload}
              disabled={downloading}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
              title="Download"
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            </button>
          )}
          {!pending && (
            <button
              onClick={onRetry}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              title="Generate again with the same prompt and settings"
            >
              <RotateCw className="w-4 h-4" />
            </button>
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
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <select
            value={generation.collection_id ?? ''}
            onChange={(e) => onMoveCollection(e.target.value || null)}
            className="ml-auto min-w-0 max-w-[140px] text-[11px] px-2 py-1 rounded border border-slate-200 bg-white"
          >
            <option value="">Uncategorised</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
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
  const [costDollars] = useState('0');
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
      setAcceptsInputImage(false); setSupportsCustomSize(true); setDescription('');
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

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Kind</label>
          <select value={kind} onChange={(e) => { const k = e.target.value as 'image' | 'video'; setKind(k); setIsAsync(k === 'video'); }} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white">
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
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

// Browse and reuse past prompts. Pulled from the user's media_generations
// history (already loaded), de-duped, most recent first, with a search
// box so finding a specific phrasing is fast.
function PromptHistoryDrawer({
  history, currentPrompt, onClose, onPick,
}: {
  history: MediaGeneration[];
  currentPrompt: string;
  onClose: () => void;
  onPick: (prompt: string) => void;
}) {
  const [query, setQuery] = useState('');
  const unique = useMemo(() => {
    const seen = new Set<string>();
    const out: { prompt: string; lastUsed: string; uses: number }[] = [];
    for (const g of history) {
      const p = g.prompt.trim();
      if (!p) continue;
      const existing = out.find((o) => o.prompt === p);
      if (existing) {
        existing.uses += 1;
      } else if (!seen.has(p)) {
        seen.add(p);
        out.push({ prompt: p, lastUsed: g.created_at, uses: 1 });
      }
    }
    return out;
  }, [history]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return unique;
    return unique.filter((u) => u.prompt.toLowerCase().includes(q));
  }, [unique, query]);

  return (
    <Drawer title="Recent prompts" onClose={onClose}>
      <p className="text-sm text-slate-500 mb-3">Every prompt you've used, most recent first. Click one to load it into the prompt box.</p>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter…"
        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm mb-4"
        autoFocus
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No prompts {query ? 'match that filter' : 'yet'}.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((u) => (
            <button
              key={u.prompt}
              onClick={() => onPick(u.prompt)}
              className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-colors ${
                u.prompt === currentPrompt
                  ? 'bg-fuchsia-50 border-fuchsia-300 text-fuchsia-900'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }`}
            >
              <p className="whitespace-pre-wrap line-clamp-3">{u.prompt}</p>
              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400">
                <span>{new Date(u.lastUsed).toLocaleDateString()}</span>
                {u.uses > 1 && <span>used {u.uses}×</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </Drawer>
  );
}

// Click-to-zoom modal preview for a generated image. Lets you see
// detail before deciding whether to download / discard. Arrow keys
// navigate through the visible history.
function Lightbox({
  generation, prev, next, onClose, onJump, onDownload, onRetry,
}: {
  generation: MediaGeneration;
  prev: MediaGeneration | null;
  next: MediaGeneration | null;
  onClose: () => void;
  onJump: (id: string) => void;
  onDownload: () => void;
  onRetry: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && prev) onJump(prev.id);
      else if (e.key === 'ArrowRight' && next) onJump(next.id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose, onJump]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4 sm:p-8"
      onClick={onClose}
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
        title="Close (Esc)"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Prev */}
      {prev && (
        <button
          onClick={(e) => { e.stopPropagation(); onJump(prev.id); }}
          className="absolute left-2 sm:left-4 p-3 rounded-full bg-white/10 text-white hover:bg-white/20"
          title="Previous (←)"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      {/* Next */}
      {next && (
        <button
          onClick={(e) => { e.stopPropagation(); onJump(next.id); }}
          className="absolute right-2 sm:right-4 p-3 rounded-full bg-white/10 text-white hover:bg-white/20"
          title="Next (→)"
        >
          <ChevronRightIcon className="w-6 h-6" />
        </button>
      )}

      {/* Image + footer */}
      <div
        className="flex flex-col items-center gap-4 max-w-[95vw] max-h-[95vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {generation.output_url && (
          generation.kind === 'video' ? (
            <video src={generation.output_url} controls className="max-w-full max-h-[80vh] rounded-lg" />
          ) : (
            <img src={generation.output_url} alt={generation.prompt} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
          )
        )}
        <div className="bg-white/95 backdrop-blur rounded-xl px-4 py-3 max-w-2xl w-full">
          <p className="text-xs text-slate-500 whitespace-pre-wrap line-clamp-4">{generation.prompt}</p>
          <div className="flex items-center justify-between mt-2 text-[11px] text-slate-400">
            <span>{generation.model} · {generation.width && generation.height ? `${generation.width}×${generation.height}` : generation.kind}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={(e) => { e.stopPropagation(); onRetry(); }}
                className="inline-flex items-center gap-1 text-fuchsia-600 hover:text-fuchsia-700 font-medium"
                title="Generate again with these settings"
              >
                <RotateCw className="w-3.5 h-3.5" /> Generate again
              </button>
              {generation.output_url && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDownload(); }}
                  className="inline-flex items-center gap-1 text-fuchsia-600 hover:text-fuchsia-700 font-medium"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
