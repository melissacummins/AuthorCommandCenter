import { useState } from 'react';
import { Sparkles, Loader2, ChevronDown, ChevronRight, Check } from 'lucide-react';
import type { AudiobookChapter, AudiobookSegment } from '../types';
import type { AttributeProgress } from '../lib/attribution';
import ReviewStep from './ReviewStep';

// Step 3 — per chapter, let AI tag who speaks each line, then review & correct.
// AI pre-fills the speaker for every segment; you skim and fix the few it gets
// wrong (editing a line's text re-flags it to render fresh).
export default function ScriptStep({
  chapters, segmentsByChapter, onAnalyzeChapter, onUpdateSegment, onDeleteSegment,
}: {
  chapters: AudiobookChapter[];
  segmentsByChapter: Record<string, AudiobookSegment[]>;
  onAnalyzeChapter: (chapter: AudiobookChapter, onProgress: (p: AttributeProgress) => void) => Promise<number>;
  onUpdateSegment: (id: string, patch: Partial<AudiobookSegment>) => void;
  onDeleteSegment: (id: string) => void;
}) {
  const [allBusy, setAllBusy] = useState(false);
  const [allProgress, setAllProgress] = useState<{ chapter: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!chapters.length) {
    return <p className="text-sm text-slate-400">Scan and accept chapters in the first step, then come back here.</p>;
  }

  const pendingChapters = chapters.filter(c => (segmentsByChapter[c.id]?.length ?? 0) === 0);

  async function analyzeAll() {
    setAllBusy(true); setError(null);
    try {
      const todo = chapters.filter(c => (segmentsByChapter[c.id]?.length ?? 0) === 0);
      for (let i = 0; i < todo.length; i++) {
        setAllProgress({ chapter: i + 1, total: todo.length });
        await onAnalyzeChapter(todo[i], () => { /* per-chapter progress shown inline below */ });
      }
    } catch (e) { setError((e as Error)?.message ?? 'Analysis failed.'); }
    finally { setAllBusy(false); setAllProgress(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={analyzeAll} disabled={allBusy || pendingChapters.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50">
          {allBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {allBusy && allProgress ? `Analyzing chapter ${allProgress.chapter}/${allProgress.total}` : `Analyze ${pendingChapters.length || 'all'} pending chapter${pendingChapters.length === 1 ? '' : 's'}`}
        </button>
        <span className="text-sm text-slate-400">{chapters.length - pendingChapters.length}/{chapters.length} analyzed</span>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="space-y-2">
        {chapters.map((c, i) => (
          <ChapterPanel key={c.id} index={i} chapter={c} segments={segmentsByChapter[c.id] ?? []}
            onAnalyze={onAnalyzeChapter} onUpdateSegment={onUpdateSegment} onDeleteSegment={onDeleteSegment} />
        ))}
      </div>
    </div>
  );
}

function ChapterPanel({
  index, chapter, segments, onAnalyze, onUpdateSegment, onDeleteSegment,
}: {
  index: number;
  chapter: AudiobookChapter;
  segments: AudiobookSegment[];
  onAnalyze: (chapter: AudiobookChapter, onProgress: (p: AttributeProgress) => void) => Promise<number>;
  onUpdateSegment: (id: string, patch: Partial<AudiobookSegment>) => void;
  onDeleteSegment: (id: string) => void;
}) {
  const [open, setOpen] = useState(index === 0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AttributeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const analyzed = segments.length > 0;

  async function analyze() {
    setBusy(true); setError(null); setProgress({ done: 0, total: 0 });
    try { await onAnalyze(chapter, setProgress); setOpen(true); }
    catch (e) { setError((e as Error)?.message ?? 'Analysis failed.'); }
    finally { setBusy(false); setProgress(null); }
  }

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex items-center gap-2 p-3">
        <button onClick={() => setOpen(o => !o)} className="text-slate-400 hover:text-slate-600">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <span className="text-xs text-slate-400 w-6">{index + 1}</span>
        <span className="flex-1 text-sm font-medium text-slate-800 truncate">{chapter.title}</span>
        {analyzed
          ? <span className="text-xs text-emerald-600 flex items-center gap-1"><Check className="w-3 h-3" /> {segments.length} segments</span>
          : <span className="text-xs text-slate-400">not analyzed</span>}
        <button onClick={analyze} disabled={busy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {busy && progress ? `${progress.done}/${progress.total || '…'}` : analyzed ? 'Re-analyze' : 'Analyze'}
        </button>
      </div>
      {error && <p className="text-xs text-rose-600 px-3 pb-2">{error}</p>}
      {open && analyzed && (
        <div className="border-t border-slate-100 p-3">
          <ReviewStep segments={segments} onUpdate={onUpdateSegment} onDelete={onDeleteSegment} />
        </div>
      )}
    </div>
  );
}
