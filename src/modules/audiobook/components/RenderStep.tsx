import { useRef, useState } from 'react';
import { Play, Loader2, AudioLines, Download, AlertTriangle, RefreshCw } from 'lucide-react';
import type { AudiobookSegment } from '../types';

// Step 4 — turn the reviewed segments into audio. Renders pending segments one at
// a time (sequential keeps the user's ElevenLabs concurrency happy and lets us
// show clear progress), then offers per-clip playback and a stitched download.
export default function RenderStep({
  segments, castReady, voiceMissingFor, renderOne, getAudioUrl, onDownloadAll,
}: {
  segments: AudiobookSegment[];
  castReady: boolean;
  voiceMissingFor: (s: AudiobookSegment) => boolean;
  renderOne: (s: AudiobookSegment) => Promise<void>;
  getAudioUrl: (path: string) => Promise<string>;
  onDownloadAll: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const pending = segments.filter(s => s.status !== 'rendered');
  const rendered = segments.filter(s => s.status === 'rendered').length;

  async function renderAll() {
    const todo = segments.filter(s => s.status !== 'rendered' && !voiceMissingFor(s));
    if (!todo.length) return;
    setBusy(true); setError(null);
    let done = 0;
    setProgress({ done: 0, total: todo.length });
    try {
      for (const s of todo) {
        await renderOne(s);
        done += 1;
        setProgress({ done, total: todo.length });
      }
    } catch (e) {
      setError((e as Error)?.message ?? 'Rendering failed.');
    } finally {
      setBusy(false); setProgress(null);
    }
  }

  async function play(path: string) {
    try {
      const url = await getAudioUrl(path);
      if (audioRef.current) { audioRef.current.src = url; await audioRef.current.play(); }
    } catch { /* ignore playback errors */ }
  }

  async function download() {
    setDownloading(true); setError(null);
    try { await onDownloadAll(); }
    catch (e) { setError((e as Error)?.message ?? 'Could not build the download.'); }
    finally { setDownloading(false); }
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
        <button onClick={renderAll} disabled={busy || pending.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <AudioLines className="w-4 h-4" />}
          {busy && progress ? `Rendering ${progress.done}/${progress.total}` : `Render ${pending.length || 'all'} pending`}
        </button>
        <button onClick={download} disabled={downloading || rendered === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download audiobook (.mp3)
        </button>
        <span className="text-sm text-slate-400">{rendered}/{segments.length} rendered</span>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <audio ref={audioRef} preload="none" />

      <div className="space-y-1.5">
        {segments.map((s, i) => (
          <div key={s.id} className="flex items-center gap-3 p-2 rounded-lg border border-slate-100 text-sm">
            <span className="text-xs text-slate-400 w-8 shrink-0">{i + 1}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${s.speaker === 'female' ? 'bg-pink-50 text-pink-600' : s.speaker === 'male' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
              {s.speaker}
            </span>
            <span className="flex-1 truncate text-slate-600">{s.text}</span>
            {voiceMissingFor(s) ? (
              <span className="text-xs text-amber-600">no voice</span>
            ) : s.status === 'rendered' && s.audio_path ? (
              <>
                <button onClick={() => play(s.audio_path!)} className="text-slate-400 hover:text-violet-600"><Play className="w-4 h-4" /></button>
                <button onClick={() => renderOne(s)} title="Re-render" className="text-slate-300 hover:text-slate-600"><RefreshCw className="w-3.5 h-3.5" /></button>
              </>
            ) : s.status === 'error' ? (
              <span className="text-xs text-rose-600" title={s.error ?? ''}>error</span>
            ) : (
              <span className="text-xs text-slate-300">pending</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
