import { useEffect, useMemo, useState } from 'react';
import { Library, Plus, BookOpen, ArrowLeft, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePenNames } from '../../contexts/PenNameContext';
import { createBook, deleteBook, listBooks, logWordCount, removeBookCover, updateBook, uploadBookCover } from './api';
import type { Book, BookInsert } from './types';
import { STATUS_COLORS, STATUS_LABELS, languageLabel } from './types';
import BookForm from './components/BookForm';
import BookView from './components/BookView';
import CatalogOverview from './components/CatalogOverview';
import PenNameChip from '../../components/PenNameChip';
import { fetchSelectedKeywordCountsByBook } from '../kdp-optimizer/api';

// Local (not UTC) YYYY-MM-DD for "today", so the word-count snapshot lands on
// the day matching the user's clock.
function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

type Tab = 'overview' | 'books';
type View =
  | { mode: 'list'; tab: Tab }
  | { mode: 'new' }
  | { mode: 'view'; book: Book }
  | { mode: 'edit'; book: Book };

export default function CatalogModule() {
  const { user } = useAuth();
  const { selectedPenNameId, penNames } = usePenNames();
  const penNameById = useMemo(() => new Map(penNames.map(p => [p.id, p])), [penNames]);
  const [books, setBooks] = useState<Book[]>([]);
  const [kdpKeywordCounts, setKdpKeywordCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ mode: 'list', tab: 'overview' });
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listBooks(user.id),
      fetchSelectedKeywordCountsByBook(user.id).catch(() => ({} as Record<string, number>)),
    ])
      .then(([rows, counts]) => {
        if (cancelled) return;
        setBooks(rows);
        setKdpKeywordCounts(counts);
      })
      .catch(err => { if (!cancelled) setError(err.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byPen = selectedPenNameId
      ? books.filter(b => b.pen_name_id === selectedPenNameId)
      : books;
    if (!q) return byPen;
    return byPen.filter(b =>
      [b.title, b.subtitle, b.series, ...(b.tropes ?? [])]
        .filter(Boolean)
        .some(v => (v as string).toLowerCase().includes(q))
    );
  }, [books, query, selectedPenNameId]);

  // Group books into parents + their translation children. The list
  // view renders one card per parent with the language chips nested
  // underneath; orphaned translations (parent filtered out) still
  // render as top-level so they aren't lost.
  const grouped = useMemo(() => {
    const childrenByParent = new Map<string, Book[]>();
    for (const b of filtered) {
      if (b.parent_book_id) {
        const list = childrenByParent.get(b.parent_book_id) ?? [];
        list.push(b);
        childrenByParent.set(b.parent_book_id, list);
      }
    }
    const visibleIds = new Set(filtered.map(b => b.id));
    const parents = filtered.filter(b => !b.parent_book_id || !visibleIds.has(b.parent_book_id));
    return parents.map(p => ({ parent: p, children: childrenByParent.get(p.id) ?? [] }));
  }, [filtered]);

  async function handleCreate(input: BookInsert, coverFile: File | null) {
    if (!user) return;
    setSaving(true);
    try {
      const created = await createBook(user.id, input);
      let final = created;
      if (coverFile) {
        const url = await uploadBookCover(user.id, created.id, coverFile);
        final = await updateBook(created.id, { cover_url: url });
      }
      if (input.word_count != null) {
        await logWordCount(user.id, final.id, todayISO(), input.word_count).catch(() => undefined);
      }
      setBooks(prev => [final, ...prev]);
      setView({ mode: 'list', tab: 'books' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, input: BookInsert, coverFile: File | null, coverCleared: boolean) {
    if (!user) return;
    setSaving(true);
    try {
      let patch: BookInsert & { cover_url?: string | null } = { ...input };
      if (coverFile) {
        const url = await uploadBookCover(user.id, id, coverFile);
        patch.cover_url = url;
      } else if (coverCleared) {
        await removeBookCover(user.id, id);
        patch.cover_url = null;
      }
      const updated = await updateBook(id, patch);
      if (input.word_count != null) {
        await logWordCount(user.id, id, todayISO(), input.word_count).catch(() => undefined);
      }
      setBooks(prev => prev.map(b => (b.id === id ? updated : b)));
      setView({ mode: 'view', book: updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!user) return;
    try {
      await removeBookCover(user.id, id).catch(() => undefined);
      await deleteBook(id);
      setBooks(prev => prev.filter(b => b.id !== id));
      setView({ mode: 'list', tab: 'books' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (view.mode === 'view') {
    const b = books.find(x => x.id === view.book.id) ?? view.book;
    const pen = b.pen_name_id ? penNameById.get(b.pen_name_id) ?? null : null;
    return (
      <div className="p-6 lg:p-8">
        <BookView
          book={b}
          penName={pen ? { name: pen.name, color: pen.color } : null}
          onBack={() => setView({ mode: 'list', tab: 'books' })}
          onEdit={() => setView({ mode: 'edit', book: b })}
          onBookUpdated={async patch => {
            const updated = await updateBook(b.id, patch);
            setBooks(prev => prev.map(x => (x.id === b.id ? updated : x)));
          }}
        />
      </div>
    );
  }

  if (view.mode !== 'list') {
    const isEdit = view.mode === 'edit';
    const initial = isEdit ? view.book : null;
    return (
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        <button
          onClick={() => setView({ mode: 'list', tab: 'books' })}
          className="inline-flex items-center gap-2 text-sm text-content-secondary hover:text-content mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Catalog
        </button>
        <h1 className="text-2xl font-bold text-content mb-6">
          {isEdit ? `Edit: ${initial?.title}` : 'Add a book'}
        </h1>
        {error && (
          <div className="mb-4 p-3 rounded-control bg-rose-50 border border-rose-200 text-sm text-rose-700">
            {error}
          </div>
        )}
        <BookForm
          initial={initial}
          saving={saving}
          onCancel={() => setView({ mode: 'list', tab: 'books' })}
          onSubmit={(input, file, cleared) =>
            isEdit && initial
              ? handleUpdate(initial.id, input, file, cleared)
              : handleCreate(input, file)
          }
          onDelete={isEdit && initial ? () => handleDelete(initial.id) : undefined}
          onAutosave={isEdit && initial ? async input => {
            const updated = await updateBook(initial.id, input).catch(() => null);
            if (updated) setBooks(prev => prev.map(b => (b.id === initial.id ? updated : b)));
          } : undefined}
        />
      </div>
    );
  }

  const activeTab: Tab = view.mode === 'list' ? view.tab : 'overview';

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-content flex items-center gap-2">
            <Library className="w-6 h-6 text-brand-500" /> Catalog
          </h1>
          <p className="text-content-secondary mt-1 text-sm">
            Every book in one place — status, covers, ISBNs, series, tropes, and marketing copy.
          </p>
        </div>
        <button
          onClick={() => setView({ mode: 'new' })}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 rounded-control shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" /> Add book
        </button>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 border-b border-edge mb-5">
        <TabButton active={activeTab === 'overview'} onClick={() => setView({ mode: 'list', tab: 'overview' })}>
          Overview
        </TabButton>
        <TabButton active={activeTab === 'books'} onClick={() => setView({ mode: 'list', tab: 'books' })}>
          Books {books.length > 0 && <span className="ml-1 text-xs text-content-muted">({books.length})</span>}
        </TabButton>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-control bg-rose-50 border border-rose-200 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-content-secondary text-sm">Loading catalog…</div>
      ) : activeTab === 'overview' ? (
        <CatalogOverview
          books={books}
          kdpKeywordCounts={kdpKeywordCounts}
          onOpenBook={book => setView({ mode: 'view', book })}
        />
      ) : (
        <>
          {/* Search */}
          {books.length > 0 && (
            <div className="relative mb-5 max-w-md">
              <Search className="w-4 h-4 text-content-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by title, series, or trope"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-control border border-edge-strong bg-surface focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              />
            </div>
          )}

          {filtered.length === 0 ? (
            <EmptyState onAdd={() => setView({ mode: 'new' })} hasBooks={books.length > 0} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {grouped.map(({ parent, children }) => (
                <BookCard
                  key={parent.id}
                  book={parent}
                  translations={children}
                  penName={penNameById.get(parent.pen_name_id ?? '')}
                  onClick={() => setView({ mode: 'view', book: parent })}
                  onClickTranslation={t => setView({ mode: 'view', book: t })}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-brand-500 text-brand-600'
          : 'border-transparent text-content-secondary hover:text-content'
      }`}
    >
      {children}
    </button>
  );
}

function BookCard({
  book, translations = [], penName, onClick, onClickTranslation,
}: {
  book: Book;
  translations?: Book[];
  penName?: { name: string; color: import('../../lib/penNames').PenNameColor };
  onClick: () => void;
  onClickTranslation?: (t: Book) => void;
}) {
  const seriesLine = book.series
    ? book.series + (book.series_position ? ` · #${book.series_position}` : '')
    : null;
  return (
    <div className="bg-surface rounded-card border border-edge hover:shadow-md hover:border-edge-strong transition-all">
      <button
        onClick={onClick}
        className="text-left p-5 w-full flex gap-4 items-center"
      >
        <div className="w-16 h-24 rounded-control bg-gradient-to-br from-brand-100 to-brand-100 flex items-center justify-center shrink-0 overflow-hidden">
          {book.cover_url ? (
            <img src={book.cover_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <BookOpen className="w-6 h-6 text-brand-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2 mb-1">
            {seriesLine && (
              <p className="text-xs text-brand-600 font-medium truncate">{seriesLine}</p>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[book.status]}`}>
              {STATUS_LABELS[book.status]}
            </span>
          </div>
          <h3 className="font-semibold text-content leading-tight break-words">{book.title}</h3>
          {penName && (
            <div className="mt-1.5">
              <PenNameChip name={penName.name} color={penName.color} />
            </div>
          )}
        </div>
      </button>

      {translations.length > 0 && (
        <div className="border-t border-edge-soft px-5 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-content-muted mb-1.5">
            Translations
          </div>
          <div className="flex flex-wrap gap-1.5">
            {translations.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={(e) => { e.stopPropagation(); onClickTranslation?.(t); }}
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-surface-sunken text-content hover:bg-edge"
                title={t.title}
              >
                <span className="font-medium">{languageLabel(t.language) ?? '—'}</span>
                <span className={`text-[10px] px-1 py-0.5 rounded ${STATUS_COLORS[t.status]}`}>
                  {STATUS_LABELS[t.status]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onAdd, hasBooks }: { onAdd: () => void; hasBooks: boolean }) {
  return (
    <div className="text-center py-16 bg-surface rounded-card border border-dashed border-edge-strong">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-brand-500 to-brand-600 rounded-card shadow-lg shadow-brand-500/25 mb-4">
        <Library className="w-8 h-8 text-white" />
      </div>
      <h3 className="text-lg font-semibold text-content mb-1">
        {hasBooks ? 'No matches' : 'No books yet'}
      </h3>
      <p className="text-sm text-content-secondary mb-5 max-w-sm mx-auto">
        {hasBooks
          ? 'Try a different search term.'
          : 'Add your first book to start building out your catalog.'}
      </p>
      {!hasBooks && (
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 rounded-control shadow-sm"
        >
          <Plus className="w-4 h-4" /> Add your first book
        </button>
      )}
    </div>
  );
}
