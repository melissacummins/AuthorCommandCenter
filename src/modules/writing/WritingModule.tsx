import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PenTool, Plus, BookOpen, ArrowLeft, ArrowUpDown } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePenNames } from '../../contexts/PenNameContext';
import { listManuscripts } from './api';
import { listBooks } from '../catalog/api';
import { STATUS_LABELS, STATUS_COLORS, STATUS_ORDER } from './types';
import type { Manuscript } from './types';
import type { Book } from '../catalog/types';
import ImportWizard from './components/ImportWizard';
import ManuscriptReader from './components/ManuscriptReader';

type View =
  | { mode: 'list' }
  | { mode: 'import' }
  | { mode: 'read'; manuscriptId: string };

// How the manuscript list is ordered. 'status' additionally groups the cards
// under Draft / Revising / Final headers; the rest render as one flat grid.
type SortMode = 'updated' | 'title' | 'words' | 'status';

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'words', label: 'Word count' },
  { value: 'status', label: 'Group by status' },
];

const SORT_STORAGE_KEY = 'writing-list-sort';

function loadSort(): SortMode {
  const v = localStorage.getItem(SORT_STORAGE_KEY);
  return SORT_OPTIONS.some(o => o.value === v) ? (v as SortMode) : 'updated';
}

// Order a list of manuscripts by the chosen mode. Title/status use a
// secondary alphabetical sort so ties are stable and readable.
function sortManuscripts(list: Manuscript[], mode: SortMode): Manuscript[] {
  const byTitle = (a: Manuscript, b: Manuscript) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  const copy = [...list];
  switch (mode) {
    case 'title':
      return copy.sort(byTitle);
    case 'words':
      return copy.sort((a, b) => b.word_count - a.word_count || byTitle(a, b));
    case 'status':
      return copy.sort(
        (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || byTitle(a, b),
      );
    case 'updated':
    default:
      return copy.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
}

export default function WritingModule() {
  const { user } = useAuth();
  const { selectedPenNameId } = usePenNames();
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ mode: 'list' });
  const [sort, setSort] = useState<SortMode>(loadSort);

  function changeSort(next: SortMode) {
    setSort(next);
    localStorage.setItem(SORT_STORAGE_KEY, next);
  }

  // Home's "Continue" deep link (/writing?manuscript=<id>) opens the reader
  // directly; the param is cleared so refresh/back behaves normally.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const manuscriptId = searchParams.get('manuscript');
    if (!manuscriptId) return;
    setView({ mode: 'read', manuscriptId });
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

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

  // Books already linked to a manuscript — hidden from the import picker so a
  // book can't be linked to two manuscripts.
  const linkedBookIds = useMemo(
    () => manuscripts.map(m => m.book_id).filter((id): id is string => !!id),
    [manuscripts],
  );

  const filtered = useMemo(() => {
    const byPen = !selectedPenNameId
      ? manuscripts
      : manuscripts.filter(m => {
          if (!m.book_id) return false;
          const book = bookById.get(m.book_id);
          return book?.pen_name_id === selectedPenNameId;
        });
    return sortManuscripts(byPen, sort);
  }, [manuscripts, bookById, selectedPenNameId, sort]);

  // When grouping by status, split the (already status-sorted) list into
  // per-status buckets so the render can drop a header before each group.
  const statusGroups = useMemo(() => {
    if (sort !== 'status') return null;
    return STATUS_ORDER
      .map(status => ({ status, items: filtered.filter(m => m.status === status) }))
      .filter(g => g.items.length > 0);
  }, [filtered, sort]);

  if (view.mode === 'import') {
    return (
      <div className="p-6 lg:p-8 max-w-3xl mx-auto">
        <button
          onClick={() => setView({ mode: 'list' })}
          className="inline-flex items-center gap-2 text-sm text-content-secondary hover:text-content mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to manuscripts
        </button>
        <h1 className="text-2xl font-bold text-content mb-6">New manuscript</h1>
        <ImportWizard
          onCancel={() => setView({ mode: 'list' })}
          onCreated={m => { reload(); setView({ mode: 'read', manuscriptId: m.id }); }}
          excludeBookIds={linkedBookIds}
        />
      </div>
    );
  }

  if (view.mode === 'read') {
    // No max-w wrapper here — the manuscript view gets the full viewport
    // width so the draft dominates the screen; ManuscriptReader applies its
    // own px-4 lg:px-6 and lets the writing pane fill the remaining width.
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
          <h1 className="text-2xl font-bold text-content flex items-center gap-2">
            <PenTool className="w-6 h-6 text-brand-500" /> Writing
          </h1>
          <p className="text-content-secondary mt-1 text-sm">
            Import a manuscript, chapter by chapter, so the rest of the Command Center can use it.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {manuscripts.length > 1 && (
            <label className="inline-flex items-center gap-1.5 text-sm text-content-secondary">
              <ArrowUpDown className="w-4 h-4 shrink-0" />
              <span className="sr-only">Sort manuscripts</span>
              <select
                value={sort}
                onChange={e => changeSort(e.target.value as SortMode)}
                className="px-2 py-2 text-sm border border-edge rounded-control bg-surface text-content"
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          )}
          <button
            onClick={() => setView({ mode: 'import' })}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 rounded-control shadow-sm"
          >
            <Plus className="w-4 h-4" /> New manuscript
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-control bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-content-secondary text-sm">Loading manuscripts…</div>
      ) : filtered.length === 0 ? (
        <EmptyState onAdd={() => setView({ mode: 'import' })} hasAny={manuscripts.length > 0} />
      ) : statusGroups ? (
        <div className="space-y-8">
          {statusGroups.map(group => (
            <section key={group.status}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[group.status]}`}>
                  {STATUS_LABELS[group.status]}
                </span>
                <span className="text-xs text-content-muted">{group.items.length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {group.items.map(m => (
                  <ManuscriptCard
                    key={m.id}
                    manuscript={m}
                    book={m.book_id ? bookById.get(m.book_id) ?? null : null}
                    onClick={() => setView({ mode: 'read', manuscriptId: m.id })}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
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
      className="text-left bg-surface rounded-card border border-edge hover:shadow-md hover:border-edge-strong transition-all p-5"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        {book && <p className="text-xs text-brand-600 font-medium truncate">{book.title}</p>}
        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[manuscript.status]}`}>
          {STATUS_LABELS[manuscript.status]}
        </span>
      </div>
      <h3 className="font-semibold text-content leading-tight break-words mb-2">{manuscript.title}</h3>
      <p className="text-xs text-content-muted">{manuscript.word_count.toLocaleString()} words · updated {updated}</p>
    </button>
  );
}

function EmptyState({ onAdd, hasAny }: { onAdd: () => void; hasAny: boolean }) {
  return (
    <div className="text-center py-16 bg-surface rounded-card border border-dashed border-edge-strong">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-brand-500 to-brand-600 rounded-card shadow-lg shadow-brand-500/25 mb-4">
        <BookOpen className="w-8 h-8 text-white" />
      </div>
      <h3 className="text-lg font-semibold text-content mb-1">
        {hasAny ? 'No manuscripts for this pen name' : 'No manuscripts yet'}
      </h3>
      <p className="text-sm text-content-secondary mb-5 max-w-sm mx-auto">
        {hasAny
          ? 'Switch pen name, or link an existing manuscript to a book under this one.'
          : 'Import a DOCX or text file, or start blank, to bring your manuscript into the Command Center.'}
      </p>
      {!hasAny && (
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 rounded-control shadow-sm"
        >
          <Plus className="w-4 h-4" /> New manuscript
        </button>
      )}
    </div>
  );
}
