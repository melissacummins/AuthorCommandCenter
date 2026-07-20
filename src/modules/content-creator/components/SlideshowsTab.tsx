import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GalleryHorizontalEnd, Loader2, Plus, Trash2, ArrowUp, ArrowDown, Copy, Download,
  ImagePlus, Wand2, FolderOpen, Upload as UploadIcon, X, ShieldAlert, ArrowLeft, Check,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import type { Book } from '../../catalog/types';
import {
  listHooks, listCreatives, insertCreative, updateCreative, deleteCreative,
  uploadBackground, listLibraryImages,
  listDefaultBannedWords, listBannedWordOptouts, listRules,
  type ContentCreative,
} from '../api';
import type { ContentHook } from '../types';
import { runJsonTask } from '../lib/ai';
import { buildSlidesPrompt, buildImagePromptPrompt } from '../lib/prompts';
import SendTo from '../../../components/SendTo';
import {
  SLIDE_FORMATS, DEFAULT_SLIDE_STYLE, renderSlideToPng, downloadBlob,
  type Slide, type SlideFormat, type SlideshowPayload, type SlideStyle,
} from '../lib/slides';
import {
  buildActiveBannedWords, scanForBannedWords, maskWord, replaceBannedWord,
  type ActiveBannedWord,
} from '../lib/bannedWords';
import { requestGeneration, pollGenerationStatus } from '../../media/lib/client';
import { MODELS } from '../../media/lib/models';
import { DEFAULT_IMAGE_MODEL } from '../lib/models';

// Slideshow Studio: approved hook -> directed generation -> editable carousel
// (9:16 for TikTok, 4:5 for IG/FB feed — slides re-render, never crop) ->
// per-slide backgrounds -> PNG export.

const IMAGE_MODELS = MODELS.filter(m => m.group === 'image');

export default function SlideshowsTab({ book }: { book: Book }) {
  const { user } = useAuth();
  const [creatives, setCreatives] = useState<ContentCreative[]>([]);
  const [hooks, setHooks] = useState<ContentHook[]>([]);
  const [bannedActive, setBannedActive] = useState<ActiveBannedWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      listCreatives(user.id, book.id, 'slideshow'),
      listHooks(user.id, book.id),
      listDefaultBannedWords(),
      listBannedWordOptouts(user.id),
      listRules(user.id),
    ])
      .then(([c, h, d, o, r]) => {
        if (cancelled) return;
        setCreatives(c);
        setHooks(h);
        setBannedActive(buildActiveBannedWords(d, o, r));
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, book.id]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-content-muted" /></div>;
  if (!user) return null;

  const open = openId ? creatives.find(c => c.id === openId) : null;
  if (open) {
    return (
      <SlideshowEditor
        key={open.id}
        userId={user.id}
        creative={open}
        bannedActive={bannedActive}
        onBack={() => setOpenId(null)}
        onChanged={next => setCreatives(prev => prev.map(c => c.id === next.id ? next : c))}
      />
    );
  }

  const approved = hooks.filter(h => h.status === 'approved');

  return (
    <div className="space-y-5 max-w-4xl">
      {creating ? (
        <NewSlideshowForm
          userId={user.id}
          book={book}
          approvedHooks={approved}
          onCancel={() => setCreating(false)}
          onCreated={c => { setCreatives(prev => [c, ...prev]); setCreating(false); setOpenId(c.id); }}
        />
      ) : (
        <div className="bg-surface rounded-card border border-edge p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-content flex items-center gap-2">
              <GalleryHorizontalEnd className="w-4 h-4 text-content-muted" /> Slideshows
            </h3>
            <p className="text-xs text-content-secondary mt-0.5">
              {approved.length
                ? 'Pick an approved hook, direct it, and generate an editable carousel.'
                : 'Approve a hook on the Hooks tab first — slideshows are built from approved hooks.'}
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            disabled={!approved.length}
            className="px-4 py-2 rounded-control bg-pink-600 text-white text-sm font-medium hover:bg-pink-700 disabled:opacity-40 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> New slideshow
          </button>
        </div>
      )}

      {creatives.length === 0 && !creating ? (
        <div className="bg-surface rounded-card border border-dashed border-edge-strong p-10 text-center">
          <p className="text-content-secondary text-sm">No slideshows yet for this book.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {creatives.map(c => {
            const payload = c.payload as unknown as SlideshowPayload;
            return (
              <div key={c.id} className="bg-surface rounded-card border border-edge p-4 flex items-start justify-between gap-2">
                <button className="text-left min-w-0 flex-1" onClick={() => setOpenId(c.id)}>
                  <p className="text-sm font-medium text-content truncate">{c.title || 'Untitled slideshow'}</p>
                  <p className="text-xs text-content-muted mt-0.5">
                    {payload.slides?.length ?? 0} slides · {payload.format ?? '9:16'} · {new Date(c.updated_at).toLocaleDateString()}
                  </p>
                </button>
                <button
                  onClick={async () => { if (!confirm('Delete this slideshow?')) return; await deleteCreative(c.id); setCreatives(prev => prev.filter(x => x.id !== c.id)); }}
                  className="p-1.5 rounded-control text-content-faint hover:text-rose-600 hover:bg-rose-50 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- Creation form ----------------

function NewSlideshowForm({ userId, book, approvedHooks, onCancel, onCreated }: {
  userId: string;
  book: Book;
  approvedHooks: ContentHook[];
  onCancel: () => void;
  onCreated: (c: ContentCreative) => void;
}) {
  const [hookId, setHookId] = useState(approvedHooks[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [count, setCount] = useState(5);
  const [format, setFormat] = useState<SlideFormat>('9:16');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    const hook = approvedHooks.find(h => h.id === hookId);
    if (!hook) return;
    setBusy(true); setError(null);
    try {
      const out = await runJsonTask<{ slides: Array<{ text: string }> }>({
        userId, task: 'slides',
        prompt: buildSlidesPrompt(hook.hook_text, hook.scene_excerpt, notes, count),
        maxTokens: 2048,
      });
      const slides: Slide[] = (out.slides ?? [])
        .filter(s => s.text?.trim())
        .slice(0, count)
        .map(s => ({ text: s.text.trim(), bg_url: null, style: { ...DEFAULT_SLIDE_STYLE } }));
      if (!slides.length) throw new Error('The model returned no slides — try again or adjust the direction notes.');
      const payload: SlideshowPayload = { format, slides, direction_notes: notes.trim() };
      const created = await insertCreative(userId, {
        book_id: book.id,
        hook_id: hook.id,
        type: 'slideshow',
        title: hook.hook_text.slice(0, 60),
        payload: payload as unknown as Record<string, unknown>,
      });
      onCreated(created);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface rounded-card border border-edge p-5 space-y-4">
      <h3 className="text-sm font-semibold text-content">New slideshow</h3>
      <div>
        <label className="block text-xs font-medium text-content-secondary mb-1">Hook</label>
        <select value={hookId} onChange={e => setHookId(e.target.value)}
          className="w-full rounded-control border border-edge-strong px-3 py-2 text-sm bg-surface">
          {approvedHooks.map(h => <option key={h.id} value={h.id}>{h.hook_text.slice(0, 90)}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-content-secondary mb-1">Direction notes (optional)</label>
        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
          placeholder='e.g. "Open with the POV trend", "keep it soft, no violence words", "end on his line"'
          className="w-full rounded-control border border-edge-strong px-3 py-2 text-sm" />
      </div>
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-content-secondary mb-1">Slides</label>
          <select value={count} onChange={e => setCount(Number(e.target.value))}
            className="rounded-control border border-edge-strong px-3 py-2 text-sm bg-surface">
            {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-content-secondary mb-1">Format</label>
          <FormatToggle value={format} onChange={setFormat} />
        </div>
        <div className="flex gap-2 ml-auto">
          <button onClick={onCancel} className="px-3 py-2 text-sm text-content-secondary hover:text-content">Cancel</button>
          <button onClick={generate} disabled={busy || !hookId}
            className="px-4 py-2 rounded-control bg-pink-600 text-white text-sm font-medium hover:bg-pink-700 disabled:opacity-50 flex items-center gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Generate slides
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

function FormatToggle({ value, onChange }: { value: SlideFormat; onChange: (f: SlideFormat) => void }) {
  return (
    <div className="inline-flex rounded-control border border-edge overflow-hidden">
      {(Object.keys(SLIDE_FORMATS) as SlideFormat[]).map(f => (
        <button key={f} onClick={() => onChange(f)} title={SLIDE_FORMATS[f].hint}
          className={`px-3 py-2 text-xs font-medium ${value === f ? 'bg-pink-600 text-white' : 'bg-surface text-content-secondary hover:bg-surface-hover'}`}>
          {SLIDE_FORMATS[f].label}
        </button>
      ))}
    </div>
  );
}

// ---------------- Editor ----------------

function SlideshowEditor({ userId, creative, bannedActive, onBack, onChanged }: {
  userId: string;
  creative: ContentCreative;
  bannedActive: ActiveBannedWord[];
  onBack: () => void;
  onChanged: (c: ContentCreative) => void;
}) {
  const initial = creative.payload as unknown as SlideshowPayload;
  const [title, setTitle] = useState(creative.title);
  const [payload, setPayload] = useState<SlideshowPayload>({
    format: initial.format ?? '9:16',
    slides: initial.slides ?? [],
    direction_notes: initial.direction_notes ?? '',
  });
  const [guides, setGuides] = useState(true);
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL);
  const [exporting, setExporting] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hookRef = useRef<{ scene: string }>({ scene: '' });

  useEffect(() => {
    // The hook's scene feeds background prompts; fetch it once lazily.
    if (!creative.hook_id || !creative.book_id) return;
    listHooks(userId, creative.book_id).then(hs => {
      const h = hs.find(x => x.id === creative.hook_id);
      if (h) hookRef.current.scene = h.scene_excerpt;
    }).catch(() => undefined);
  }, [userId, creative.hook_id, creative.book_id]);

  function commit(next: SlideshowPayload, nextTitle?: string) {
    setPayload(next);
    if (nextTitle !== undefined) setTitle(nextTitle);
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const updated = await updateCreative(creative.id, {
          title: nextTitle !== undefined ? nextTitle : title,
          payload: next as unknown as Record<string, unknown>,
        });
        onChanged(updated);
        setSaveState('saved');
      } catch (err) {
        setError((err as Error).message);
      }
    }, 1200);
  }

  function patchSlide(i: number, patch: Partial<Slide>) {
    const slides = payload.slides.map((s, j) => j === i ? { ...s, ...patch } : s);
    commit({ ...payload, slides });
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= payload.slides.length) return;
    const slides = [...payload.slides];
    [slides[i], slides[j]] = [slides[j], slides[i]];
    commit({ ...payload, slides });
  }

  const fileBase = (title || 'slideshow').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  async function exportAll() {
    setExporting(true); setError(null);
    try {
      for (let i = 0; i < payload.slides.length; i++) {
        const blob = await renderSlideToPng(payload.slides[i], payload.format);
        downloadBlob(blob, `${fileBase}-${i + 1}.png`);
        // Small gap so browsers don't swallow rapid multi-downloads.
        await new Promise(r => setTimeout(r, 350));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  // Same renders as exportAll, but as blobs for the cloud-export buttons.
  async function renderAllForCloud() {
    const files = [];
    for (let i = 0; i < payload.slides.length; i++) {
      files.push({
        blob: await renderSlideToPng(payload.slides[i], payload.format),
        filename: `${fileBase}-${i + 1}.png`,
      });
    }
    return files;
  }

  const fmt = SLIDE_FORMATS[payload.format];

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="bg-surface rounded-card border border-edge p-4 flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-control text-content-muted hover:text-content"><ArrowLeft className="w-4 h-4" /></button>
        <input
          value={title}
          onChange={e => commit(payload, e.target.value)}
          className="flex-1 min-w-40 text-sm font-medium text-content bg-transparent border-0 focus:outline-none"
        />
        <FormatToggle value={payload.format} onChange={f => commit({ ...payload, format: f })} />
        <label className="flex items-center gap-1.5 text-xs text-content-secondary">
          <input type="checkbox" checked={guides} onChange={e => setGuides(e.target.checked)} /> Safe areas
        </label>
        <span className="text-[11px] text-content-muted w-14">{saveState === 'saving' ? 'Saving…' : 'Saved'}</span>
        <button onClick={exportAll} disabled={exporting}
          className="px-3 py-2 rounded-control bg-slate-800 text-white text-xs font-medium hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1.5">
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Download PNGs ({fmt.width}×{fmt.height})
        </button>
        <SendTo getFiles={renderAllForCloud} disabled={exporting} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-content-secondary">
        <ImagePlus className="w-3.5 h-3.5" /> Background model:
        <select value={imageModel} onChange={e => setImageModel(e.target.value)}
          className="rounded-control border border-edge px-2 py-1 bg-surface">
          {IMAGE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label} (~{(m.estimatedCostCents / 100).toFixed(2)}$)</option>)}
        </select>
        <span className="text-content-muted">billed to your Fal/OpenAI key, same as the Media module</span>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}

      <div className="space-y-4">
        {payload.slides.map((slide, i) => (
          <SlideRow
            key={i}
            index={i}
            total={payload.slides.length}
            slide={slide}
            format={payload.format}
            guides={guides}
            bannedActive={bannedActive}
            imageModel={imageModel}
            userId={userId}
            sceneExcerpt={hookRef.current.scene}
            onPatch={patch => patchSlide(i, patch)}
            onMove={dir => move(i, dir)}
            onDelete={() => commit({ ...payload, slides: payload.slides.filter((_, j) => j !== i) })}
          />
        ))}
      </div>
      <button
        onClick={() => commit({ ...payload, slides: [...payload.slides, { text: '', bg_url: null, style: { ...DEFAULT_SLIDE_STYLE } }] })}
        className="text-sm text-pink-600 hover:text-pink-700 flex items-center gap-1"
      >
        <Plus className="w-4 h-4" /> Add slide
      </button>
    </div>
  );
}

// ---------------- One slide ----------------

function SlideRow({ index, total, slide, format, guides, bannedActive, imageModel, userId, sceneExcerpt, onPatch, onMove, onDelete }: {
  index: number;
  total: number;
  slide: Slide;
  format: SlideFormat;
  guides: boolean;
  bannedActive: ActiveBannedWord[];
  imageModel: string;
  userId: string;
  sceneExcerpt: string;
  onPatch: (patch: Partial<Slide>) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [bgBusy, setBgBusy] = useState(false);
  const [bgError, setBgError] = useState<string | null>(null);
  const [library, setLibrary] = useState<Array<{ id: string; url: string; prompt: string }> | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const matches = scanForBannedWords(slide.text, bannedActive);
  const fmt = SLIDE_FORMATS[format];
  const previewW = 180;
  const previewH = Math.round(previewW * (fmt.height / fmt.width));

  const sizePx = useMemo(() => ({ sm: 9, md: 12, lg: 15 }[slide.style.size]), [slide.style.size]);

  async function generateBg() {
    setBgBusy(true); setBgError(null);
    try {
      const { prompt } = await runJsonTask<{ prompt: string }>({
        userId, task: 'image_prompt',
        prompt: buildImagePromptPrompt(sceneExcerpt, slide.text),
        maxTokens: 256,
      });
      const res = await requestGeneration({ model: imageModel, prompt, width: fmt.width, height: fmt.height });
      if (res.error) throw new Error(res.error);
      let gen = res.generations[0];
      if (!gen) throw new Error('No image came back.');
      // Async models resolve through the standard media poll loop.
      const startedAt = Date.now();
      while (gen.status === 'pending' && Date.now() - startedAt < 120000) {
        await new Promise(r => setTimeout(r, 2500));
        gen = await pollGenerationStatus(gen.id);
      }
      if (gen.status !== 'completed' || !gen.output_url) throw new Error(gen.error_message || 'Generation failed.');
      onPatch({ bg_url: gen.output_url });
    } catch (err) {
      setBgError((err as Error).message);
    } finally {
      setBgBusy(false);
    }
  }

  async function openLibrary() {
    setLibraryOpen(true);
    if (!library) {
      try { setLibrary(await listLibraryImages(userId)); }
      catch (err) { setBgError((err as Error).message); }
    }
  }

  async function uploadBg(file: File) {
    setBgBusy(true); setBgError(null);
    try { onPatch({ bg_url: await uploadBackground(userId, file) }); }
    catch (err) { setBgError((err as Error).message); }
    finally { setBgBusy(false); }
  }

  return (
    <div className="bg-surface rounded-card border border-edge p-4 flex gap-4">
      {/* Preview */}
      <div
        className="relative shrink-0 rounded-control overflow-hidden border border-edge"
        style={{
          width: previewW, height: previewH,
          background: slide.bg_url ? `url(${slide.bg_url}) center/cover` : 'linear-gradient(135deg,#1e1b4b,#831843)',
        }}
      >
        {slide.bg_url && <div className="absolute inset-0 bg-black/20" />}
        {guides && format === '9:16' && (
          <>
            <div className="absolute inset-x-0 top-0 bg-sky-400/20 border-b border-sky-400/50" style={{ height: '10%' }} />
            <div className="absolute inset-x-0 bottom-0 bg-sky-400/20 border-t border-sky-400/50" style={{ height: '16%' }} />
          </>
        )}
        <div
          className={`absolute inset-x-2 flex ${slide.style.position === 'top' ? 'items-start pt-[12%]' : slide.style.position === 'bottom' ? 'items-end pb-[18%]' : 'items-center'} justify-center h-full`}
        >
          <p
            className="text-center font-bold leading-snug"
            style={{
              fontSize: sizePx,
              color: slide.style.color === 'white' ? '#fff' : '#0f172a',
              textShadow: slide.style.shadow ? (slide.style.color === 'white' ? '0 1px 6px rgba(0,0,0,.8)' : '0 1px 6px rgba(255,255,255,.8)') : 'none',
            }}
          >
            {slide.text || '…'}
          </p>
        </div>
        <span className="absolute top-1 left-1 text-[9px] px-1 rounded bg-black/50 text-white">{index + 1}</span>
      </div>

      {/* Controls */}
      <div className="flex-1 min-w-0 space-y-2">
        <textarea
          rows={2}
          value={slide.text}
          onChange={e => onPatch({ text: e.target.value })}
          className="w-full rounded-control border border-edge-strong px-3 py-2 text-sm focus:border-pink-500 outline-none"
          placeholder="Slide text…"
        />
        {matches.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
            {matches.map(m => (
              <span key={m.word} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800">
                "{m.found}":
                {m.replacement && (
                  <button className="underline" onClick={() => onPatch({ text: replaceBannedWord(slide.text, m.word, m.replacement!) })}>use "{m.replacement}"</button>
                )}
                <button className="underline" onClick={() => onPatch({ text: replaceBannedWord(slide.text, m.word, maskWord(m.found)) })}>mask ({maskWord(m.found)})</button>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <StylePicker style={slide.style} onChange={style => onPatch({ style })} />
          <span className="text-content-faint">|</span>
          <button onClick={generateBg} disabled={bgBusy} className="flex items-center gap-1 text-content-secondary hover:text-pink-600 disabled:opacity-50">
            {bgBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Generate bg
          </button>
          <button onClick={openLibrary} className="flex items-center gap-1 text-content-secondary hover:text-pink-600">
            <FolderOpen className="w-3.5 h-3.5" /> Library
          </button>
          <label className="flex items-center gap-1 text-content-secondary hover:text-pink-600 cursor-pointer">
            <UploadIcon className="w-3.5 h-3.5" /> Upload
            <input type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadBg(f); e.target.value = ''; }} />
          </label>
          {slide.bg_url && (
            <button onClick={() => onPatch({ bg_url: null })} className="flex items-center gap-1 text-content-muted hover:text-rose-600">
              <X className="w-3.5 h-3.5" /> Clear bg
            </button>
          )}
        </div>
        {bgError && <p className="text-[11px] text-rose-600">{bgError}</p>}

        <div className="flex items-center gap-1.5 pt-1">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="p-1 rounded text-content-muted hover:text-content disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="p-1 rounded text-content-muted hover:text-content disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
          <button onClick={() => navigator.clipboard.writeText(slide.text)} title="Copy text" className="p-1 rounded text-content-muted hover:text-content"><Copy className="w-3.5 h-3.5" /></button>
          <button
            onClick={async () => { const b = await renderSlideToPng(slide, format); downloadBlob(b, `slide-${index + 1}.png`); }}
            title="Download this slide"
            className="p-1 rounded text-content-muted hover:text-content"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1 rounded text-content-faint hover:text-rose-600 ml-auto"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {libraryOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={() => setLibraryOpen(false)}>
          <div className="bg-surface rounded-card p-4 max-w-2xl w-full max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-content">Media library</h4>
              <button onClick={() => setLibraryOpen(false)} className="p-1 text-content-muted hover:text-content"><X className="w-4 h-4" /></button>
            </div>
            {!library ? (
              <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-content-muted" /></div>
            ) : library.length === 0 ? (
              <p className="text-sm text-content-muted py-6 text-center">No completed images in your Media library yet.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {library.map(img => (
                  <button key={img.id} title={img.prompt}
                    onClick={() => { onPatch({ bg_url: img.url }); setLibraryOpen(false); }}
                    className="aspect-square rounded-control overflow-hidden border border-edge hover:ring-2 hover:ring-pink-400">
                    <img src={img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StylePicker({ style, onChange }: { style: SlideStyle; onChange: (s: SlideStyle) => void }) {
  return (
    <span className="flex items-center gap-1.5">
      <select value={style.size} onChange={e => onChange({ ...style, size: e.target.value as SlideStyle['size'] })}
        className="rounded border border-edge px-1.5 py-1 bg-surface">
        <option value="sm">S</option><option value="md">M</option><option value="lg">L</option>
      </select>
      <select value={style.position} onChange={e => onChange({ ...style, position: e.target.value as SlideStyle['position'] })}
        className="rounded border border-edge px-1.5 py-1 bg-surface">
        <option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option>
      </select>
      <select value={style.color} onChange={e => onChange({ ...style, color: e.target.value as SlideStyle['color'] })}
        className="rounded border border-edge px-1.5 py-1 bg-surface">
        <option value="white">White</option><option value="black">Black</option>
      </select>
      <label className="flex items-center gap-1 text-content-secondary">
        <input type="checkbox" checked={style.shadow} onChange={e => onChange({ ...style, shadow: e.target.checked })} /> <Check className="hidden" />shadow
      </label>
    </span>
  );
}
