import { useState } from 'react';
import { Sparkles, Loader2, AlertTriangle } from 'lucide-react';
import type { AudiobookProject, AudiobookProjectUpdate, NarrationMode } from '../types';
import type { AttributeProgress } from '../lib/attribution';

// Step 1 — paste the manuscript, choose how it should be voiced, and let AI tag
// who speaks each line. Re-analyzing replaces any existing segments (and their
// rendered audio), so we warn first.
export default function ManuscriptStep({
  project, onChange, segmentCount, onAnalyze, books, onAttachBook,
}: {
  project: AudiobookProject;
  onChange: (patch: AudiobookProjectUpdate) => void;
  segmentCount: number;
  onAnalyze: (manuscript: string, onProgress: (p: AttributeProgress) => void) => Promise<number>;
  books: { id: string; title: string }[];
  onAttachBook: (bookId: string | null) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AttributeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<number | null>(null);

  async function analyze() {
    if (text.trim().length < 20) { setError('Paste some manuscript text first.'); return; }
    if (segmentCount > 0 && !confirm('Re-analyzing replaces the current segments and any rendered audio. Continue?')) return;
    setBusy(true); setError(null); setResult(null); setProgress({ done: 0, total: 0 });
    try {
      const count = await onAnalyze(text, setProgress);
      setResult(count);
    } catch (e) { setError((e as Error)?.message ?? 'Analysis failed.'); }
    finally { setBusy(false); setProgress(null); }
  }

  const modes: { id: NarrationMode; label: string; desc: string }[] = [
    { id: 'narrator_plus_two', label: 'Narrator + two voices', desc: 'A narrator reads description & action; a man voices male dialogue, a woman voices female dialogue.' },
    { id: 'duet', label: 'Two-voice duet', desc: 'Just two voices — all female parts by the woman, all male parts by the man. One of them also narrates.' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-2">Narration style</label>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {modes.map(m => (
            <button key={m.id} onClick={() => onChange({ narration_mode: m.id })}
              className={`text-left p-3 rounded-xl border ${project.narration_mode === m.id ? 'border-violet-400 bg-violet-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <p className="text-sm font-medium text-slate-800">{m.label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{m.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {books.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Link to a book (optional)</label>
          <select value={project.book_id ?? ''} onChange={e => onAttachBook(e.target.value || null)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
            <option value="">— none —</option>
            {books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-slate-500">Manuscript</label>
          <span className="text-xs text-slate-400">{text.length.toLocaleString()} characters</span>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={12}
          placeholder="Paste a chapter or the whole manuscript here…"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono leading-relaxed" />
        <p className="text-xs text-slate-400 mt-1">
          Long manuscripts are analyzed in chunks. You'll review and correct the speaker tags in the next step.
        </p>
      </div>

      {segmentCount > 0 && (
        <p className="text-xs text-amber-600 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> This project already has {segmentCount} segment{segmentCount === 1 ? '' : 's'}. Re-analyzing replaces them.
        </p>
      )}

      <button onClick={analyze} disabled={busy}
        className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {busy && progress ? `Analyzing ${progress.done}/${progress.total || '…'}` : 'Analyze with AI'}
      </button>

      {result !== null && <p className="text-sm text-emerald-600">Done — created {result} segments. Head to the Cast and Review steps.</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}
