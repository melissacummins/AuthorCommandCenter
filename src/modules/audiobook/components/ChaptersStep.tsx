import { useState } from 'react';
import { Upload, ScanLine, Sparkles, Loader2, Check, Trash2, ArrowUpToLine, AlertTriangle } from 'lucide-react';
import type { AudiobookChapter, AudiobookProject, AudiobookProjectUpdate, ChapterDraft, NarrationMode } from '../types';
import { detectChapters, splitByMarkers, extractTextFromFile } from '../lib/chapters';
import { scanChaptersWithAI } from '../lib/client';

// Step 1 — paste/upload the whole manuscript, scan it into chapters (instant
// heading detection, or AI for unconventional headings), review/adjust the
// breakdown, then accept. Accepting replaces any existing chapters + audio.
export default function ChaptersStep({
  project, chapters, onChange, onAccept, books, onAttachBook,
}: {
  project: AudiobookProject;
  chapters: AudiobookChapter[];
  onChange: (patch: AudiobookProjectUpdate) => void;
  onAccept: (drafts: ChapterDraft[]) => Promise<void>;
  books: { id: string; title: string }[];
  onAttachBook: (bookId: string | null) => void;
}) {
  const [text, setText] = useState(project.manuscript || '');
  const [drafts, setDrafts] = useState<ChapterDraft[] | null>(null);
  const [busy, setBusy] = useState<null | 'scan' | 'ai' | 'file' | 'save'>(null);
  const [error, setError] = useState<string | null>(null);

  const modes: { id: NarrationMode; label: string; desc: string }[] = [
    { id: 'narrator_plus_two', label: 'Narrator + two voices', desc: 'A narrator reads description & action; a man voices male dialogue, a woman voices female dialogue.' },
    { id: 'duet', label: 'Two-voice duet', desc: 'Two voices — all female parts by the woman, all male parts by the man. One of them also narrates.' },
  ];

  async function onFile(file: File) {
    setBusy('file'); setError(null);
    try {
      const extracted = await extractTextFromFile(file);
      setText(extracted);
      onChange({ manuscript: extracted });
    } catch (e) { setError((e as Error)?.message ?? 'Could not read that file.'); }
    finally { setBusy(null); }
  }

  function scanHeadings() {
    if (text.trim().length < 20) { setError('Paste or upload a manuscript first.'); return; }
    setError(null);
    onChange({ manuscript: text });
    setDrafts(detectChapters(text));
  }

  async function scanAI() {
    if (text.trim().length < 20) { setError('Paste or upload a manuscript first.'); return; }
    setBusy('ai'); setError(null);
    onChange({ manuscript: text });
    try {
      const markers = await scanChaptersWithAI(text);
      setDrafts(splitByMarkers(text, markers));
    } catch (e) { setError((e as Error)?.message ?? 'AI scan failed.'); }
    finally { setBusy(null); }
  }

  function editTitle(i: number, title: string) {
    setDrafts(prev => prev ? prev.map((d, j) => (j === i ? { ...d, title } : d)) : prev);
  }
  function remove(i: number) {
    setDrafts(prev => prev ? prev.filter((_, j) => j !== i) : prev);
  }
  function mergeUp(i: number) {
    setDrafts(prev => {
      if (!prev || i === 0) return prev;
      const merged = [...prev];
      merged[i - 1] = { title: merged[i - 1].title, source_text: `${merged[i - 1].source_text}\n\n${merged[i].source_text}` };
      merged.splice(i, 1);
      return merged;
    });
  }

  async function accept() {
    if (!drafts || !drafts.length) return;
    if (chapters.length > 0 && !confirm('Accepting replaces the current chapters, their segments, and any rendered audio. Continue?')) return;
    setBusy('save'); setError(null);
    try { await onAccept(drafts); setDrafts(null); }
    catch (e) { setError((e as Error)?.message ?? 'Could not save chapters.'); }
    finally { setBusy(null); }
  }

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
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{text.length.toLocaleString()} characters</span>
            <label className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline cursor-pointer">
              {busy === 'file' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload .txt / .docx
              <input type="file" accept=".txt,.md,.docx,text/plain" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            </label>
          </div>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={10}
          placeholder="Paste your whole manuscript here, or upload a file…"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono leading-relaxed" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={scanHeadings} disabled={!!busy}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50">
          <ScanLine className="w-4 h-4" /> Scan into chapters
        </button>
        <button onClick={scanAI} disabled={!!busy}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-50">
          {busy === 'ai' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Rescan with AI
        </button>
        {chapters.length > 0 && drafts === null && (
          <span className="text-xs text-slate-400">Saved: {chapters.length} chapter{chapters.length === 1 ? '' : 's'}</span>
        )}
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {/* Saved chapters (no pending scan) */}
      {drafts === null && chapters.length > 0 && (
        <div className="space-y-1.5">
          {chapters.map((c, i) => (
            <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-100">
              <span className="text-xs text-slate-400 w-6">{i + 1}</span>
              <span className="flex-1 text-sm font-medium text-slate-700 truncate">{c.title}</span>
              <span className="text-xs text-slate-400">{c.source_text.length.toLocaleString()} chars</span>
            </div>
          ))}
        </div>
      )}

      {/* Pending scan to review + accept */}
      {drafts !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">{drafts.length} chapter{drafts.length === 1 ? '' : 's'} detected — review & accept</p>
            <button onClick={accept} disabled={busy === 'save' || !drafts.length}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50">
              {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Accept {drafts.length} chapter{drafts.length === 1 ? '' : 's'}
            </button>
          </div>
          {chapters.length > 0 && (
            <p className="text-xs text-amber-600 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Accepting replaces the current {chapters.length} saved chapter{chapters.length === 1 ? '' : 's'} and their audio.
            </p>
          )}
          <div className="space-y-1.5">
            {drafts.map((d, i) => (
              <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg border border-slate-100">
                <span className="text-xs text-slate-400 w-6 mt-2">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <input value={d.title} onChange={e => editTitle(i, e.target.value)}
                    className="w-full px-2 py-1 text-sm font-medium border border-slate-200 rounded-md mb-1" />
                  <p className="text-xs text-slate-400 truncate">{d.source_text.replace(/\s+/g, ' ').slice(0, 140)}…</p>
                  <span className="text-[11px] text-slate-400">{d.source_text.length.toLocaleString()} chars</span>
                </div>
                {i > 0 && (
                  <button onClick={() => mergeUp(i)} title="Merge into previous" className="text-slate-300 hover:text-violet-600 mt-1">
                    <ArrowUpToLine className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => remove(i)} title="Delete chapter" className="text-slate-300 hover:text-rose-600 mt-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
