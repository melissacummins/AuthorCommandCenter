import { useState } from 'react';
import { Upload, FileText, ScanLine, Loader2, Check, Trash2, ArrowUpToLine, AlertTriangle, PenLine } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import CatalogBookPicker from '../../../components/CatalogBookPicker';
import { extractHtmlFromFile, detectChaptersFromHtml } from '../lib/import';
import { createManuscript, saveChapters } from '../api';
import { countWords } from '../types';
import type { Book } from '../../catalog/types';
import type { ChapterDraft, Manuscript } from '../types';

// New manuscript flow: pick a source (upload a file, or start blank), scan
// into chapters, review/adjust the breakdown (merge, rename, delete) — this
// review step is the fix for both legacy apps flattening imports into one
// blob — then accept, which creates the manuscript row and saves its chapters
// in one go.
export default function ImportWizard({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (manuscript: Manuscript) => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [sourceFilename, setSourceFilename] = useState<string | null>(null);
  const [bookId, setBookId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ChapterDraft[] | null>(null);
  const [busy, setBusy] = useState<null | 'file' | 'save'>(null);
  const [error, setError] = useState<string | null>(null);

  function titleFromFilename(name: string): string {
    return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled manuscript';
  }

  async function onFile(file: File) {
    setBusy('file');
    setError(null);
    try {
      const html = await extractHtmlFromFile(file);
      const fallbackTitle = titleFromFilename(file.name);
      setSourceFilename(file.name);
      if (!title.trim()) setTitle(fallbackTitle);
      setDrafts(detectChaptersFromHtml(html, fallbackTitle));
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not read that file.');
    } finally {
      setBusy(null);
    }
  }

  function startBlank() {
    setSourceFilename(null);
    setDrafts([{ title: 'Chapter 1', content_html: '' }]);
  }

  function editTitle(i: number, value: string) {
    setDrafts(prev => (prev ? prev.map((d, j) => (j === i ? { ...d, title: value } : d)) : prev));
  }
  function remove(i: number) {
    setDrafts(prev => (prev ? prev.filter((_, j) => j !== i) : prev));
  }
  function mergeUp(i: number) {
    setDrafts(prev => {
      if (!prev || i === 0) return prev;
      const merged = [...prev];
      merged[i - 1] = {
        title: merged[i - 1].title,
        content_html: `${merged[i - 1].content_html}\n${merged[i].content_html}`,
      };
      merged.splice(i, 1);
      return merged;
    });
  }

  async function create() {
    if (!user || !drafts || !drafts.length || !title.trim()) return;
    setBusy('save');
    setError(null);
    try {
      const manuscript = await createManuscript(user.id, {
        title: title.trim(),
        book_id: bookId,
        source_filename: sourceFilename,
      });
      await saveChapters(manuscript.id, user.id, drafts);
      onCreated(manuscript);
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not save the manuscript.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Title</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Manuscript title"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Link to a book (optional)</label>
        <CatalogBookPicker value={bookId} onChange={(id: string, _book: Book) => setBookId(id)} />
      </div>

      {drafts === null && (
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg bg-lime-600 hover:bg-lime-700 cursor-pointer disabled:opacity-50">
            {busy === 'file' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Import a file
            <input
              type="file"
              accept=".docx,.txt,.md,.markdown,text/plain"
              className="hidden"
              disabled={!!busy}
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
          </label>
          <button
            onClick={startBlank}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <PenLine className="w-4 h-4" /> Start blank
          </button>
          <span className="text-xs text-slate-400">.docx and .txt/.md today — PDF import coming soon</span>
        </div>
      )}

      {error && (
        <p className="text-sm text-rose-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0" /> {error}</p>
      )}

      {drafts !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
              <ScanLine className="w-4 h-4 text-lime-500" />
              {drafts.length} chapter{drafts.length === 1 ? '' : 's'} detected — review & accept
            </p>
            <button
              onClick={create}
              disabled={busy === 'save' || !drafts.length || !title.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Create manuscript
            </button>
          </div>

          <div className="space-y-1.5">
            {drafts.map((d, i) => (
              <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg border border-slate-100">
                <span className="text-xs text-slate-400 w-6 mt-2">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <input
                    value={d.title}
                    onChange={e => editTitle(i, e.target.value)}
                    className="w-full px-2 py-1 text-sm font-medium border border-slate-200 rounded-md mb-1"
                  />
                  <p className="text-xs text-slate-400 truncate flex items-center gap-1">
                    <FileText className="w-3 h-3 shrink-0" />
                    {countWords(d.content_html).toLocaleString()} words
                  </p>
                </div>
                {i > 0 && (
                  <button onClick={() => mergeUp(i)} title="Merge into previous" className="text-slate-300 hover:text-lime-600 mt-1">
                    <ArrowUpToLine className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => remove(i)} title="Delete chapter" className="text-slate-300 hover:text-rose-600 mt-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <button onClick={() => setDrafts(null)} disabled={!!busy} className="text-xs text-slate-500 hover:underline">
            Start over
          </button>
        </div>
      )}

      <div className="pt-2 border-t border-slate-100">
        <button onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700">
          Cancel
        </button>
      </div>
    </div>
  );
}
