import { useEffect, useMemo, useState } from 'react';
import { Library, Plus, BookOpen, ArrowLeft, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { createBook, deleteBook, listBooks, updateBook } from './api';
import type { Book, BookInsert } from './types';
import { STATUS_COLORS, STATUS_LABELS } from './types';
import BookForm from './components/BookForm';

type View =
  | { mode: 'list' }
  | { mode: 'new' }
  | { mode: 'edit'; book: Book };

export default function CatalogModule() {
  const { user } = useAuth();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ mode: 'list' });
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    listBooks(user.id)
      .then(rows => { if (!cancelled) setBooks(rows); })
      .catch(err => { if (!cancelled) setError(err.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return books;
    return books.filter(b =>
      [b.title, b.subtitle, b.series, ...(b.tropes ?? [])]
        .filter(Boolean)
        .some(v => (v as string).toLowerCase().includes(q))
    );
  }, [books, query]);

  async function handleCreate(input: BookInsert) {
    if (!user) return;
    setSaving(true);
    try {
      const created = await createBook(user.id, input);
      setBooks(prev => [created, ...prev]);
      setView({ mode: 'list' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, input: BookInsert) {
    setSaving(true);
    try {
      const updated = await updateBook(id, input);
      setBooks(prev => prev.map(b => (b.id === id ? updated : b)));
      setView({ mode: 'list' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteBook(id);
      setBooks(prev => prev.filter(b => b.id !== id));
      setView({ mode: 'list' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (view.mode !== 'list') {
    const isEdit = view.mode === 'edit';
    const initial = isEdit ? view.book : null;
    return (
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        <button
          onClick={() => setView({ mode: 'list' })}
          className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Catalog
        </button>
        <h1 className="text-2xl font-bold text-slate-800 mb-6">
          {isEdit ? `Edit: ${initial?.title}` : 'Add a book'}
        </h1>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
            {error}
          </div>
        )}
        <BookForm
          initial={initial}
          saving={saving}
          onCancel={() => setView({ mode: 'list' })}
          onSubmit={input => (isEdit && initial ? handleUpdate(initial.id, input) : handleCreate(input))}
          onDelete={isEdit && initial ? () => handleDelete(initial.id) : undefined}
        />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Library className="w-6 h-6 text-indigo-500" /> Catalog
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            Every book in one place — status, covers, ISBNs, series, tropes, and marketing copy.
          </p>
        </div>
        <button
          onClick={() => setView({ mode: 'new' })}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" /> Add book
        </button>
      </div>

      {/* Search */}
      {books.length > 0 && (
        <div className="relative mb-5 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by title, series, or trope"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
          />
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-500 text-sm">Loading catalog…</div>
      ) : filtered.length === 0 ? (
        <EmptyState onAdd={() => setView({ mode: 'new' })} hasBooks={books.length > 0} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(book => (
            <BookCard key={book.id} book={book} onClick={() => setView({ mode: 'edit', book })} />
          ))}
        </div>
      )}
    </div>
  );
}

function BookCard({ book, onClick }: { book: Book; onClick: () => void }) {
  const seriesLine = book.series
    ? book.series + (book.series_position ? ` · #${book.series_position}` : '')
    : null;
  return (
    <button
      onClick={onClick}
      className="text-left bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md hover:border-slate-300 transition-all flex gap-4"
    >
      <div className="w-16 h-24 rounded-lg bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center shrink-0">
        {book.cover_url ? (
          <img src={book.cover_url} alt="" className="w-full h-full object-cover rounded-lg" />
        ) : (
          <BookOpen className="w-6 h-6 text-indigo-400" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-semibold text-slate-800 leading-tight line-clamp-2">{book.title}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[book.status]}`}>
            {STATUS_LABELS[book.status]}
          </span>
        </div>
        {book.subtitle && (
          <p className="text-xs text-slate-500 line-clamp-1 mb-1">{book.subtitle}</p>
        )}
        {seriesLine && (
          <p className="text-xs text-indigo-600 font-medium mb-2">{seriesLine}</p>
        )}
        {book.tropes.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {book.tropes.slice(0, 3).map(t => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">{t}</span>
            ))}
            {book.tropes.length > 3 && (
              <span className="text-[10px] px-1.5 py-0.5 text-slate-400">+{book.tropes.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

function EmptyState({ onAdd, hasBooks }: { onAdd: () => void; hasBooks: boolean }) {
  return (
    <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl shadow-lg shadow-indigo-500/25 mb-4">
        <Library className="w-8 h-8 text-white" />
      </div>
      <h3 className="text-lg font-semibold text-slate-800 mb-1">
        {hasBooks ? 'No matches' : 'No books yet'}
      </h3>
      <p className="text-sm text-slate-500 mb-5 max-w-sm mx-auto">
        {hasBooks
          ? 'Try a different search term.'
          : 'Add your first book to start building out your catalog.'}
      </p>
      {!hasBooks && (
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm"
        >
          <Plus className="w-4 h-4" /> Add your first book
        </button>
      )}
    </div>
  );
}
