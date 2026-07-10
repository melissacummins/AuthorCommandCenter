import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Trash2, FileText } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import CatalogBookPicker from '../../../components/CatalogBookPicker';
import { getManuscript, listChapters, updateManuscript, attachBook, deleteManuscript } from '../api';
import { STATUS_LABELS, STATUS_COLORS } from '../types';
import type { Book } from '../../catalog/types';
import type { Manuscript, ManuscriptChapter, ManuscriptStatus } from '../types';

// Read view for a saved manuscript: chapter sidebar (order, title, word
// count) plus a serif reading pane for the selected chapter's content. Title,
// status, and the linked Catalog book are editable here; chapter content
// editing lands in Phase 2 with the TipTap editor.
export default function ManuscriptReader({
  manuscriptId,
  onBack,
  onDeleted,
}: {
  manuscriptId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const { user } = useAuth();
  const [manuscript, setManuscript] = useState<Manuscript | null>(null);
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingTitle, setSavingTitle] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getManuscript(manuscriptId), listChapters(manuscriptId)])
      .then(([m, cs]) => {
        if (cancelled) return;
        setManuscript(m);
        setChapters(cs);
        setActiveChapterId(cs[0]?.id ?? null);
      })
      .catch(err => { if (!cancelled) setError(err?.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [manuscriptId]);

  const activeChapter = useMemo(
    () => chapters.find(c => c.id === activeChapterId) ?? null,
    [chapters, activeChapterId],
  );

  async function saveTitle(title: string) {
    if (!manuscript || !title.trim() || title === manuscript.title) return;
    setSavingTitle(true);
    try {
      const updated = await updateManuscript(manuscript.id, { title: title.trim() });
      setManuscript(updated);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    } finally {
      setSavingTitle(false);
    }
  }

  async function changeStatus(status: ManuscriptStatus) {
    if (!manuscript) return;
    try {
      const updated = await updateManuscript(manuscript.id, { status });
      setManuscript(updated);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    }
  }

  async function changeBook(bookId: string | null) {
    if (!manuscript || !user) return;
    try {
      const updated = await attachBook(manuscript.id, user.id, bookId);
      setManuscript(updated);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    }
  }

  async function handleDelete() {
    if (!manuscript) return;
    if (!confirm(`Delete "${manuscript.title}"? This removes all its chapters too.`)) return;
    try {
      await deleteManuscript(manuscript.id);
      onDeleted();
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    }
  }

  if (loading) {
    return <div className="text-center py-16 text-slate-500 text-sm">Loading manuscript…</div>;
  }
  if (!manuscript) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-rose-600 mb-3">{error ?? 'Manuscript not found.'}</p>
        <button onClick={onBack} className="text-sm text-slate-500 hover:underline">Back to manuscripts</button>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to manuscripts
      </button>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="flex-1 min-w-[240px]">
          <input
            defaultValue={manuscript.title}
            onBlur={e => saveTitle(e.target.value)}
            disabled={savingTitle}
            className="text-2xl font-bold text-slate-800 w-full px-1 -mx-1 rounded-md border border-transparent hover:border-slate-200 focus:border-lime-400 outline-none bg-transparent"
          />
          <p className="text-sm text-slate-500 mt-1">{manuscript.word_count.toLocaleString()} words · {chapters.length} chapter{chapters.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={manuscript.status}
            onChange={e => changeStatus(e.target.value as ManuscriptStatus)}
            className={`text-xs px-2.5 py-1.5 rounded-full border-0 font-medium ${STATUS_COLORS[manuscript.status]}`}
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button onClick={handleDelete} title="Delete manuscript" className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mb-6 max-w-sm">
        <label className="block text-xs font-medium text-slate-500 mb-1">Linked book</label>
        <CatalogBookPicker value={manuscript.book_id} onChange={(id: string, _book: Book) => changeBook(id)} />
      </div>

      {chapters.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300">
          <BookOpen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">This manuscript has no chapters yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
          <div className="space-y-1">
            {chapters.map((c, i) => (
              <button
                key={c.id}
                onClick={() => setActiveChapterId(c.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm ${
                  c.id === activeChapterId
                    ? 'border-lime-300 bg-lime-50 text-lime-900'
                    : 'border-transparent hover:bg-slate-50 text-slate-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 w-5 shrink-0">{i + 1}</span>
                  <span className="flex-1 truncate font-medium">{c.title || 'Untitled chapter'}</span>
                </div>
                <p className="text-xs text-slate-400 pl-7">{c.word_count.toLocaleString()} words</p>
              </button>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 lg:p-10 min-h-[50vh]">
            {activeChapter ? (
              <>
                <h2 className="font-serif text-2xl text-slate-800 mb-4">{activeChapter.title || 'Untitled chapter'}</h2>
                {activeChapter.content_html ? (
                  <div
                    className="font-serif text-[17px] leading-relaxed text-slate-700 max-w-prose [&_p]:mb-4"
                    dangerouslySetInnerHTML={{ __html: activeChapter.content_html }}
                  />
                ) : (
                  <p className="text-sm text-slate-400 flex items-center gap-1.5"><FileText className="w-4 h-4" /> This chapter is empty.</p>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-400">Select a chapter.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
