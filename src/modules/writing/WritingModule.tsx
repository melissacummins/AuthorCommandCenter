import { useEffect, useMemo, useState } from 'react';
import { PenTool, Plus, BookOpen, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePenNames } from '../../contexts/PenNameContext';
import { listManuscripts } from './api';
import { listBooks } from '../catalog/api';
import { STATUS_LABELS, STATUS_COLORS } from './types';
import type { Manuscript } from './types';
import type { Book } from '../catalog/types';
import ImportWizard from './components/ImportWizard';
import ManuscriptReader from './components/ManuscriptReader';

type View =
  | { mode: 'list' }
  | { mode: 'import' }
  | { mode: 'read'; manuscriptId: string };

export default function WritingModule() {
  const { user } = useAuth();
  const { selectedPenNameId } = usePenNames();
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ mode: 'list' });

  // `reloadToken` bumps to re-run the effect below after an import, edit, or
  // delete — same cancellation-safe fetch as the initial load, no duplicate
  // fetch logic for the "come back to the list" case.
  const [reloadToken, setReloadToken] = useState(0);
  function reload() {
    setReloadToken(t => t + 1);
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([listManuscripts(user.id), listBooks(user.id)])
      .then(([m, b]) => { if (!cancelled) { setManuscripts(m); setBooks(b); } })
      .catch(err => { if (!cancelled) setError(err?.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, reloadToken]);

  const bookById = useMemo(() => new Map(books.map(b => [b.id, b])), [books]);

  const filtered = useMemo(() => {
    if (!selectedPenNameId) return manuscripts;
    return manuscripts.filter(m => {
      if (!m.book_id) return false;
      const book = bookById.get(m.book_id);
      return book?.pen_name_id === selectedPenNameId;
    });
  }, [manuscripts, bookById, selectedPenNameId]);

  if (view.mode === 'import') {
    return (
      <div className="p-6 lg:p-8 max-w-3xl mx-auto">
        <button
          onClick={() => setView({ mode: 'list' })}
          className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to manuscripts
        </button>
        <h1 className="text-2xl font-bold text-slate-800 mb-6">New manuscript</h1>
        <ImportWizard
          onCancel={() => setView({ mode: 'list' })}
          onCreated={m => { reload(); setView({ mode: 'read', manuscriptId: m.id }); }}
        />
      </div>
    );
  }

  if (view.mode === 'read') {
    // No max-w wrapper here (directive §8.1) — the manuscript view gets the
    // full viewport width so the draft dominates the screen; ManuscriptReader
    // applies its own px-4 lg:px-6 and centers the text measure internally.
    return (
      <ManuscriptReader
        manuscriptId={view.manuscriptId}
        onBack={() => { reload(); setView({ mode: 'list' }); }}
        onDeleted={() => { reload(); setView({ mode: 'list' }); }}
      />
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <PenTool className="w-6 h-6 text-lime-500" /> Writing
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            Import a manuscript, chapter by chapter, so the rest of the Command Center can use it.
          </p>
        </div>
        <button
          onClick={() => setView({ mode: 'import' })}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-lime-600 hover:bg-lime-700 rounded-lg shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" /> New manuscript
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-500 text-sm">Loading manuscripts…</div>
      ) : filtered.length === 0 ? (
        <EmptyState onAdd={() => setView({ mode: 'import' })} hasAny={manuscripts.length > 0} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(m => (
            <ManuscriptCard
              key={m.id}
              manuscript={m}
              book={m.book_id ? bookById.get(m.book_id) ?? null : null}
              onClick={() => setView({ mode: 'read', manuscriptId: m.id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ManuscriptCard({
  manuscript, book, onClick,
}: {
  manuscript: Manuscript;
  book: Book | null;
  onClick: () => void;
}) {
  const updated = new Date(manuscript.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <button
      onClick={onClick}
      className="text-left bg-white rounded-2xl border border-slate-200 hover:shadow-md hover:border-slate-300 transition-all p-5"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        {book && <p className="text-xs text-lime-600 font-medium truncate">{book.title}</p>}
        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[manuscript.status]}`}>
          {STATUS_LABELS[manuscript.status]}
        </span>
      </div>
      <h3 className="font-semibold text-slate-800 leading-tight break-words mb-2">{manuscript.title}</h3>
      <p className="text-xs text-slate-400">{manuscript.word_count.toLocaleString()} words · updated {updated}</p>
    </button>
  );
}

function EmptyState({ onAdd, hasAny }: { onAdd: () => void; hasAny: boolean }) {
  return (
    <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-lime-500 to-lime-600 rounded-2xl shadow-lg shadow-lime-500/25 mb-4">
        <BookOpen className="w-8 h-8 text-white" />
      </div>
      <h3 className="text-lg font-semibold text-slate-800 mb-1">
        {hasAny ? 'No manuscripts for this pen name' : 'No manuscripts yet'}
      </h3>
      <p className="text-sm text-slate-500 mb-5 max-w-sm mx-auto">
        {hasAny
          ? 'Switch pen name, or link an existing manuscript to a book under this one.'
          : 'Import a DOCX or text file, or start blank, to bring your manuscript into the Command Center.'}
      </p>
      {!hasAny && (
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-lime-600 hover:bg-lime-700 rounded-lg shadow-sm"
        >
          <Plus className="w-4 h-4" /> New manuscript
        </button>
      )}
    </div>
  );
}
