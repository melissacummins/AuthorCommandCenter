import { useRef, useState } from 'react';
import { Play, Loader2, AudioLines, Download, AlertTriangle, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import type { AudiobookChapter, AudiobookSegment } from '../types';

// Step 4 — render the reviewed segments to audio, chapter by chapter. Sequential
// rendering keeps progress clear and is gentle on ElevenLabs rate limits. Each
// chapter exports its own .mp3 (what audiobook platforms want) and there's a
// stitched full-book download too. Per-line re-render fixes a single bad clip.
export default function RenderStep({
  chapters, segmentsByChapter, castReady, voiceMissingFor, renderOne, getAudioUrl, onDownloadChapter, onDownloadAll,
}: {
  chapters: AudiobookChapter[];
  segmentsByChapter: Record<string, AudiobookSegment[]>;
  castReady: boolean;
  voiceMissingFor: (s: AudiobookSegment) => boolean;
  renderOne: (s: AudiobookSegment) => Promise<void>;
  getAudioUrl: (path: string) => Promise<string>;
  onDownloadChapter: (chapterId: string) => Promise<void>;
  onDownloadAll: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null); // chapterId | 'all'
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const allSegments = chapters.flatMap(c => segmentsByChapter[c.id] ?? []);
  const renderedCount = allSegments.filter(s => s.status === 'rendered').length;
  const pendingCount = allSegments.filter(s => s.status !== 'rendered' && !voiceMissingFor(s)).length;

  async function renderList(segs: AudiobookSegment[]) {
    const todo = segs.filter(s => s.status !== 'rendered' && !voiceMissingFor(s));
    if (!todo.length) return;
    setBusy(true); setError(null);
    let done = 0;
    setProgress({ done: 0, total: todo.length });
    try {
      for (const s of todo) { await renderOne(s); done += 1; setProgress({ done, total: todo.length }); }
    } catch (e) { setError((e as Error)?.message ?? 'Rendering failed.'); }
    finally { setBusy(false); setProgress(null); }
  }

  async function play(path: string) {
    try { const url = await getAudioUrl(path); if (audioRef.current) { audioRef.current.src = url; await audioRef.current.play(); } }
    catch { /* ignore playback errors */ }
  }

  async function download(which: string, fn: () => Promise<void>) {
    setDownloading(which); setError(null);
    try { await fn(); }
    catch (e) { setError((e as Error)?.message ?? 'Could not build the download.'); }
    finally { setDownloading(null); }
  }

  if (!castReady) {
    return (
      <p className="text-sm text-amber-600 flex items-center gap-1.5">
        <AlertTriangle className="w-4 h-4" /> Assign a voice to every role in the Cast step before rendering.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => renderList(allSegments)} disabled={busy || pendingCount === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-brand-fg rounded-control bg-brand-600 hover:bg-brand-700 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <AudioLines className="w-4 h-4" />}
          {busy && progress ? `Rendering ${progress.done}/${progress.total}` : `Render ${pendingCount || 'all'} pending`}
        </button>
        <button onClick={() => download('all', onDownloadAll)} disabled={downloading !== null || renderedCount === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-control border border-edge-strong text-content hover:bg-surface-hover disabled:opacity-50">
          {downloading === 'all' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download full audiobook
        </button>
        <span className="text-sm text-content-muted">{renderedCount}/{allSegments.length} rendered</span>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <audio ref={audioRef} preload="none" />

      <div className="space-y-2">
        {chapters.map((c, i) => (
          <ChapterRender
            key={c.id} index={i} chapter={c} segments={segmentsByChapter[c.id] ?? []}
            voiceMissingFor={voiceMissingFor} onRenderChapter={renderList} onRenderOne={renderOne} onPlay={play}
            onDownload={() => download(c.id, () => onDownloadChapter(c.id))} downloading={downloading === c.id} disabledControls={busy}
          />
        ))}
      </div>
    </div>
  );
}

function ChapterRender({
  index, chapter, segments, voiceMissingFor, onRenderChapter, onRenderOne, onPlay, onDownload, downloading, disabledControls,
}: {
  index: number;
  chapter: AudiobookChapter;
  segments: AudiobookSegment[];
  voiceMissingFor: (s: AudiobookSegment) => boolean;
  onRenderChapter: (segs: AudiobookSegment[]) => Promise<void>;
  onRenderOne: (s: AudiobookSegment) => Promise<void>;
  onPlay: (path: string) => void;
  onDownload: () => void;
  downloading: boolean;
  disabledControls: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rendered = segments.filter(s => s.status === 'rendered').length;
  const pending = segments.filter(s => s.status !== 'rendered' && !voiceMissingFor(s)).length;

  return (
    <div className="rounded-card border border-edge">
      <div className="flex items-center gap-2 p-3">
        <button onClick={() => setOpen(o => !o)} className="text-content-muted hover:text-content-secondary">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <span className="text-xs text-content-muted w-6">{index + 1}</span>
        <span className="flex-1 text-sm font-medium text-content truncate">{chapter.title}</span>
        <span className="text-xs text-content-muted">{rendered}/{segments.length}</span>
        <button onClick={() => onRenderChapter(segments)} disabled={disabledControls || pending === 0}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-control border border-brand-200 text-brand-700 hover:bg-brand-50 disabled:opacity-50">
          <AudioLines className="w-3.5 h-3.5" /> Render
        </button>
        <button onClick={onDownload} disabled={downloading || rendered === 0}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-control border border-edge text-content-secondary hover:bg-surface-hover disabled:opacity-50">
          {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} .mp3
        </button>
      </div>
      {open && (
        <div className="border-t border-edge-soft p-2 space-y-1.5">
          {segments.length === 0 && <p className="text-xs text-content-muted px-1">No segments — analyze this chapter in the Script step.</p>}
          {segments.map((s, j) => (
            <div key={s.id} className="flex items-center gap-3 p-2 rounded-control border border-edge-soft text-sm">
              <span className="text-xs text-content-muted w-8 shrink-0">{j + 1}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${s.speaker === 'female' ? 'bg-brand-50 text-brand-600' : s.speaker === 'male' ? 'bg-brand-50 text-brand-600' : 'bg-amber-50 text-amber-600'}`}>
                {s.speaker}
              </span>
              <span className="flex-1 truncate text-content-secondary">{s.text}</span>
              {voiceMissingFor(s) ? (
                <span className="text-xs text-amber-600">no voice</span>
              ) : s.status === 'rendered' && s.audio_path ? (
                <>
                  <button onClick={() => onPlay(s.audio_path!)} className="text-content-muted hover:text-brand-600"><Play className="w-4 h-4" /></button>
                  <button onClick={() => onRenderOne(s)} title="Re-render" className="text-content-faint hover:text-content-secondary"><RefreshCw className="w-3.5 h-3.5" /></button>
                </>
              ) : s.status === 'error' ? (
                <button onClick={() => onRenderOne(s)} title={s.error ?? 'Retry'} className="text-xs text-rose-600 hover:underline">retry</button>
              ) : (
                <span className="text-xs text-content-faint">pending</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
