import { useEffect, useRef, useState } from 'react';
import {
  Video, Loader2, Plus, Trash2, Download, ArrowLeft, Music, Upload as UploadIcon,
  FolderOpen, X, Wand2, Play, Package,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import type { Book } from '../../catalog/types';
import {
  listHooks, listCreatives, insertCreative, updateCreative, deleteCreative,
  uploadBackground, listLibraryVideos, generateMusic,
  type ContentCreative,
} from '../api';
import type { ContentHook } from '../types';
import { runJsonTask } from '../lib/ai';
import { buildScriptPrompt } from '../lib/prompts';
import { downloadBlob, DEFAULT_SLIDE_STYLE, type SlideStyle } from '../lib/slides';
import {
  exportWebm, renderCaptionPng, activeLineAt, totalDuration,
  type VideoPayload, type CaptionLine,
} from '../lib/video';

// Video Composer: timed script text over a video background (Melissa's
// Claude-cowork HTML demo, productized). Live preview in the browser; export
// as WebM (TikTok web upload accepts it) or a transparent caption-PNG bundle
// for CapCut. MP4 is deliberately out of scope for v1.

export default function VideosTab({ book }: { book: Book }) {
  const { user } = useAuth();
  const [creatives, setCreatives] = useState<ContentCreative[]>([]);
  const [hooks, setHooks] = useState<ContentHook[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([listCreatives(user.id, book.id, 'video'), listHooks(user.id, book.id)])
      .then(([c, h]) => { if (!cancelled) { setCreatives(c); setHooks(h); } })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, book.id]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (!user) return null;

  const open = openId ? creatives.find(c => c.id === openId) : null;
  if (open) {
    return (
      <VideoEditor
        key={open.id}
        userId={user.id}
        creative={open}
        onBack={() => setOpenId(null)}
        onChanged={next => setCreatives(prev => prev.map(c => c.id === next.id ? next : c))}
      />
    );
  }

  const approved = hooks.filter(h => h.status === 'approved');

  return (
    <div className="space-y-5 max-w-4xl">
      {creating ? (
        <NewVideoForm
          userId={user.id}
          book={book}
          approvedHooks={approved}
          onCancel={() => setCreating(false)}
          onCreated={c => { setCreatives(prev => [c, ...prev]); setCreating(false); setOpenId(c.id); }}
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Video className="w-4 h-4 text-slate-400" /> Videos
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {approved.length
                ? 'Timed script text over a video background, with optional music. Export WebM or the assets for CapCut.'
                : 'Approve a hook on the Hooks tab first — video scripts are written from approved hooks.'}
            </p>
          </div>
          <button onClick={() => setCreating(true)} disabled={!approved.length}
            className="px-4 py-2 rounded-lg bg-pink-600 text-white text-sm font-medium hover:bg-pink-700 disabled:opacity-40 flex items-center gap-2">
            <Plus className="w-4 h-4" /> New video
          </button>
        </div>
      )}

      {creatives.length === 0 && !creating ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center">
          <p className="text-slate-500 text-sm">No videos yet for this book.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {creatives.map(c => {
            const p = c.payload as unknown as VideoPayload;
            return (
              <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start justify-between gap-2">
                <button className="text-left min-w-0 flex-1" onClick={() => setOpenId(c.id)}>
                  <p className="text-sm font-medium text-slate-800 truncate">{c.title || 'Untitled video'}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {p.lines?.length ?? 0} lines · ~{Math.round(totalDuration(p.lines ?? []))}s · {new Date(c.updated_at).toLocaleDateString()}
                  </p>
                </button>
                <button
                  onClick={async () => { if (!confirm('Delete this video?')) return; await deleteCreative(c.id); setCreatives(prev => prev.filter(x => x.id !== c.id)); }}
                  className="p-1.5 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 shrink-0"
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

// ---------------- Creation ----------------

function NewVideoForm({ userId, book, approvedHooks, onCancel, onCreated }: {
  userId: string;
  book: Book;
  approvedHooks: ContentHook[];
  onCancel: () => void;
  onCreated: (c: ContentCreative) => void;
}) {
  const [hookId, setHookId] = useState(approvedHooks[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [seconds, setSeconds] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    const hook = approvedHooks.find(h => h.id === hookId);
    if (!hook) return;
    setBusy(true); setError(null);
    try {
      const out = await runJsonTask<{ lines: Array<{ text: string; seconds: number }> }>({
        userId, task: 'script',
        prompt: buildScriptPrompt(hook.hook_text, hook.scene_excerpt, notes, seconds),
        maxTokens: 1024,
      });
      const lines: CaptionLine[] = (out.lines ?? [])
        .filter(l => l.text?.trim())
        .map(l => ({ text: l.text.trim(), seconds: Math.min(Math.max(Math.round(l.seconds) || 3, 1), 10) }));
      if (!lines.length) throw new Error('The model returned no script lines — try again.');
      const payload: VideoPayload = { bg_url: null, lines, music_url: null, style: { ...DEFAULT_SLIDE_STYLE } };
      const created = await insertCreative(userId, {
        book_id: book.id, hook_id: hook.id, type: 'video',
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
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-slate-800">New video script</h3>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Hook</label>
        <select value={hookId} onChange={e => setHookId(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">
          {approvedHooks.map(h => <option key={h.id} value={h.id}>{h.hook_text.slice(0, 90)}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Direction notes (optional)</label>
        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
          placeholder='e.g. "slow burn pacing", "end on his line"'
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Target length</label>
          <select value={seconds} onChange={e => setSeconds(Number(e.target.value))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white">
            {[10, 15, 20, 30, 45, 60].map(s => <option key={s} value={s}>{s}s</option>)}
          </select>
        </div>
        <div className="flex gap-2 ml-auto">
          <button onClick={onCancel} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
          <button onClick={generate} disabled={busy || !hookId}
            className="px-4 py-2 rounded-lg bg-pink-600 text-white text-sm font-medium hover:bg-pink-700 disabled:opacity-50 flex items-center gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Write script
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

// ---------------- Editor ----------------

function VideoEditor({ userId, creative, onBack, onChanged }: {
  userId: string;
  creative: ContentCreative;
  onBack: () => void;
  onChanged: (c: ContentCreative) => void;
}) {
  const initial = creative.payload as unknown as VideoPayload;
  const [payload, setPayload] = useState<VideoPayload>({
    bg_url: initial.bg_url ?? null,
    lines: initial.lines ?? [],
    music_url: initial.music_url ?? null,
    style: initial.style ?? { ...DEFAULT_SLIDE_STYLE },
  });
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [library, setLibrary] = useState<Array<{ id: string; url: string; prompt: string }> | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [musicPrompt, setMusicPrompt] = useState('dark, moody, cinematic tension with a slow heartbeat pulse');
  const [currentTime, setCurrentTime] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  function commit(next: VideoPayload) {
    setPayload(next);
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const updated = await updateCreative(creative.id, { payload: next as unknown as Record<string, unknown> });
        onChanged(updated);
        setSaveState('saved');
      } catch (err) {
        setError((err as Error).message);
      }
    }, 1200);
  }

  function patchLine(i: number, patch: Partial<CaptionLine>) {
    commit({ ...payload, lines: payload.lines.map((l, j) => j === i ? { ...l, ...patch } : l) });
  }

  async function pickUpload(file: File, kind: 'video' | 'audio') {
    setBusy(kind); setError(null);
    try {
      const url = await uploadBackground(userId, file);
      commit(kind === 'video' ? { ...payload, bg_url: url } : { ...payload, music_url: url });
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(null); }
  }

  async function makeMusic() {
    setBusy('music'); setError(null);
    try {
      const url = await generateMusic(musicPrompt, Math.max(10, Math.round(totalDuration(payload.lines))));
      commit({ ...payload, music_url: url });
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(null); }
  }

  async function doExport() {
    setExportProgress(0); setError(null);
    try {
      const blob = await exportWebm(payload, setExportProgress);
      downloadBlob(blob, `${(creative.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.webm`);
    } catch (err) { setError((err as Error).message); }
    finally { setExportProgress(null); }
  }

  async function exportAssets() {
    setBusy('assets'); setError(null);
    try {
      for (let i = 0; i < payload.lines.length; i++) {
        const l = payload.lines[i];
        const blob = await renderCaptionPng(l.text, payload.style);
        downloadBlob(blob, `caption-${String(i + 1).padStart(2, '0')}-${l.seconds}s.png`);
        await new Promise(r => setTimeout(r, 350));
      }
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(null); }
  }

  function syncPlay() {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v) return;
    if (v.paused) { v.currentTime = 0; if (a) { a.currentTime = 0; a.play().catch(() => undefined); } v.play().catch(() => undefined); }
    else { v.pause(); a?.pause(); }
  }

  const active = activeLineAt(payload.lines, currentTime);
  const dur = totalDuration(payload.lines);

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center gap-2 text-xs">
        <button onClick={onBack} className="p-1.5 rounded-md text-slate-400 hover:text-slate-700"><ArrowLeft className="w-4 h-4" /></button>
        <span className="text-sm font-medium text-slate-800 truncate max-w-60">{creative.title}</span>
        <span className="text-slate-400">~{Math.round(dur)}s · 1080×1920</span>
        <span className="text-[11px] text-slate-400 ml-auto">{saveState === 'saving' ? 'Saving…' : 'Saved'}</span>
        <button onClick={exportAssets} disabled={busy === 'assets'}
          className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5">
          {busy === 'assets' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />} Assets for CapCut
        </button>
        <button onClick={doExport} disabled={exportProgress !== null || !payload.bg_url}
          title={!payload.bg_url ? 'Pick a background video first' : 'Records in real time — takes as long as the video runs'}
          className="px-3 py-2 rounded-lg bg-slate-800 text-white font-medium hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1.5">
          {exportProgress !== null ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {exportProgress !== null ? `Recording ${Math.round(exportProgress * 100)}%` : 'Export WebM'}
        </button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        {/* Preview */}
        <div className="space-y-2">
          <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-black" style={{ aspectRatio: '9 / 16' }}>
            {payload.bg_url ? (
              <video
                ref={videoRef}
                src={payload.bg_url}
                muted
                loop
                playsInline
                crossOrigin="anonymous"
                className="absolute inset-0 w-full h-full object-cover"
                onTimeUpdate={e => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-slate-500 text-xs px-6 text-center">
                Pick a background video below — generate one in the Media module, upload your own, or choose from your library.
              </div>
            )}
            {active && (
              <div className={`absolute inset-x-3 flex justify-center ${payload.style.position === 'top' ? 'top-[12%]' : payload.style.position === 'bottom' ? 'bottom-[18%]' : 'top-1/2 -translate-y-1/2'}`}>
                <p className="text-center font-bold leading-snug"
                  style={{
                    fontSize: { sm: 12, md: 15, lg: 19 }[payload.style.size],
                    color: payload.style.color === 'white' ? '#fff' : '#0f172a',
                    textShadow: payload.style.shadow ? '0 1px 8px rgba(0,0,0,.85)' : 'none',
                  }}>
                  {active.text}
                </p>
              </div>
            )}
            {payload.bg_url && (
              <button onClick={syncPlay} className="absolute bottom-2 left-2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70">
                <Play className="w-4 h-4" />
              </button>
            )}
          </div>
          {payload.music_url && <audio ref={audioRef} src={payload.music_url} loop />}

          <div className="flex flex-wrap gap-2 text-xs">
            <label className="flex items-center gap-1 text-slate-600 hover:text-pink-600 cursor-pointer">
              <UploadIcon className="w-3.5 h-3.5" /> Upload video
              <input type="file" accept="video/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) pickUpload(f, 'video'); e.target.value = ''; }} />
            </label>
            <button onClick={async () => { setLibraryOpen(true); if (!library) setLibrary(await listLibraryVideos(userId).catch(() => [])); }}
              className="flex items-center gap-1 text-slate-600 hover:text-pink-600">
              <FolderOpen className="w-3.5 h-3.5" /> Library
            </button>
            {busy === 'video' && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
            <p className="text-xs font-medium text-slate-600 flex items-center gap-1.5"><Music className="w-3.5 h-3.5" /> Music</p>
            {payload.music_url ? (
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <audio src={payload.music_url} controls className="h-8 flex-1" />
                <button onClick={() => commit({ ...payload, music_url: null })} className="text-slate-400 hover:text-rose-600"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <>
                <textarea rows={2} value={musicPrompt} onChange={e => setMusicPrompt(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
                <div className="flex gap-2">
                  <button onClick={makeMusic} disabled={busy === 'music'}
                    className="px-2.5 py-1.5 rounded-lg bg-pink-600 text-white text-xs hover:bg-pink-700 disabled:opacity-50 flex items-center gap-1">
                    {busy === 'music' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />} ElevenLabs
                  </button>
                  <label className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-600 hover:bg-slate-50 cursor-pointer">
                    Upload track
                    <input type="file" accept="audio/*" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) pickUpload(f, 'audio'); e.target.value = ''; }} />
                  </label>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Script lines */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            Caption style:
            <select value={payload.style.size} onChange={e => commit({ ...payload, style: { ...payload.style, size: e.target.value as SlideStyle['size'] } })}
              className="rounded border border-slate-200 px-1.5 py-1 bg-white"><option value="sm">S</option><option value="md">M</option><option value="lg">L</option></select>
            <select value={payload.style.position} onChange={e => commit({ ...payload, style: { ...payload.style, position: e.target.value as SlideStyle['position'] } })}
              className="rounded border border-slate-200 px-1.5 py-1 bg-white"><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select>
            <select value={payload.style.color} onChange={e => commit({ ...payload, style: { ...payload.style, color: e.target.value as SlideStyle['color'] } })}
              className="rounded border border-slate-200 px-1.5 py-1 bg-white"><option value="white">White</option><option value="black">Black</option></select>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={payload.style.shadow} onChange={e => commit({ ...payload, style: { ...payload.style, shadow: e.target.checked } })} /> shadow
            </label>
          </div>

          {payload.lines.map((line, i) => (
            <div key={i} className={`bg-white rounded-xl border p-3 flex items-start gap-2 ${active === line ? 'border-pink-300' : 'border-slate-200'}`}>
              <span className="text-[10px] text-slate-400 pt-2.5 w-4">{i + 1}</span>
              <textarea
                rows={1}
                value={line.text}
                onChange={e => patchLine(i, { text: e.target.value })}
                className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm resize-none focus:border-pink-500 outline-none"
              />
              <select value={line.seconds} onChange={e => patchLine(i, { seconds: Number(e.target.value) })}
                className="rounded border border-slate-200 px-1.5 py-1.5 bg-white text-xs">
                {[1, 2, 3, 4, 5, 6, 8, 10].map(s => <option key={s} value={s}>{s}s</option>)}
              </select>
              <button onClick={() => commit({ ...payload, lines: payload.lines.filter((_, j) => j !== i) })}
                className="p-1.5 text-slate-300 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <button onClick={() => commit({ ...payload, lines: [...payload.lines, { text: '', seconds: 3 }] })}
            className="text-sm text-pink-600 hover:text-pink-700 flex items-center gap-1"><Plus className="w-4 h-4" /> Add line</button>
        </div>
      </div>

      {libraryOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={() => setLibraryOpen(false)}>
          <div className="bg-white rounded-xl p-4 max-w-2xl w-full max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-slate-800">Video library</h4>
              <button onClick={() => setLibraryOpen(false)} className="p-1 text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
            </div>
            {!library ? (
              <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
            ) : library.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">No completed videos in your Media library — generate one in the Media module first.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {library.map(v => (
                  <button key={v.id} title={v.prompt}
                    onClick={() => { commit({ ...payload, bg_url: v.url }); setLibraryOpen(false); }}
                    className="aspect-[9/16] rounded-lg overflow-hidden border border-slate-200 hover:ring-2 hover:ring-pink-400 bg-black">
                    <video src={v.url} muted className="w-full h-full object-cover" />
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
