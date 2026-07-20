import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Plus, BookOpen } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePenNames } from '../contexts/PenNameContext';
import { listBooks, createBook } from '../modules/catalog/api';
import type { Book } from '../modules/catalog/types';
import { penNameClasses } from './PenNameChip';

// Reusable picker for selecting a book from Catalog. Used anywhere a
// module needs a book reference instead of free-text title entry.
// Filters by the currently-selected pen name in the header (or shows
// all when none is selected). "Add new" creates a stub Catalog book
// inline with the title + active pen name, then returns that id —
// avoiding the full Catalog form for the common quick-add case.

interface Props {
  value: string | null;
  onChange: (bookId: string, book: Book) => void;
  // When true, hide books that aren't in the currently-selected pen name.
  // Defaults to true since the header picker is the user's filter.
  filterByPenName?: boolean;
  placeholder?: string;
  required?: boolean;
}

export default function CatalogBookPicker({
  value,
  onChange,
  filterByPenName = true,
  placeholder = 'Pick a book from Catalog…',
  required: _required,
}: Props) {
  const { user } = useAuth();
  const { selectedPenNameId, penNames } = usePenNames();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    listBooks(user.id)
      .then(rows => { if (!cancelled) setBooks(rows); })
      .catch(err => { if (!cancelled) setError(err?.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!open) return;
    function onClickAway(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setNewTitle('');
      }
    }
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const filtered = useMemo(() => {
    let list = books;
    if (filterByPenName && selectedPenNameId) {
      list = list.filter(b => b.pen_name_id === selectedPenNameId);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(b =>
        b.title.toLowerCase().includes(q) ||
        (b.series ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [books, selectedPenNameId, filterByPenName, query]);

  const selected = value ? books.find(b => b.id === value) : null;
  const selectedPen = selected?.pen_name_id ? penNames.find(p => p.id === selected.pen_name_id) : null;

  async function handleCreate() {
    if (!user || !newTitle.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createBook(user.id, {
        title: newTitle.trim(),
        subtitle: null,
        series: null,
        series_position: null,
        pen_name_id: selectedPenNameId,
        parent_book_id: null,
        language: null,
        status: 'published',
        publish_date: null,
        pre_order_date: null,
        manuscript_due_date: null,
        ebook_price: null,
        paperback_price: null,
        hardcover_price: null,
        audiobook_price: null,
        blurb: null,
        content_warnings: null,
        kinks: null,
        tropes: [],
        heat_level: null,
        subgenre: null,
        page_count: null,
        word_count: null,
        target_word_count: null,
        current_chapter: null,
        asin: null,
        isbn_ebook: null,
        isbn_paperback: null,
        isbn_audiobook: null,
        isbn_hardcover: null,
        amazon_keywords: [],
        keywords: [],
        bisac_categories: [],
        reviews: [],
        cover_url: null,
        notes: null,
        include_in_arcs: true,
      });
      setBooks(prev => [created, ...prev]);
      onChange(created.id, created);
      setCreating(false);
      setNewTitle('');
      setOpen(false);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 border border-edge-strong rounded-control bg-surface text-sm hover:border-edge-strong"
      >
        <BookOpen className="w-4 h-4 text-content-muted shrink-0" />
        {selected ? (
          <span className="flex-1 truncate text-left">
            <span className="font-medium text-content">{selected.title}</span>
            {selectedPen && (
              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${penNameClasses(selectedPen.color).bg} ${penNameClasses(selectedPen.color).text}`}>
                {selectedPen.name}
              </span>
            )}
          </span>
        ) : (
          <span className="flex-1 text-left text-content-muted">{placeholder}</span>
        )}
        <ChevronDown className="w-4 h-4 text-content-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-surface border border-edge rounded-card shadow-lg z-50">
          <div className="p-2 border-b border-edge-soft">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-content-muted" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search Catalog…"
                className="w-full pl-8 pr-2 py-1.5 border border-edge rounded-control text-sm"
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="p-3 text-sm text-content-secondary">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-3 text-sm text-content-secondary">
                {books.length === 0
                  ? 'No books in Catalog yet.'
                  : filterByPenName && selectedPenNameId
                    ? 'No books in this pen name. Switch pen name or add one.'
                    : 'No matches.'}
              </div>
            ) : (
              filtered.map(book => {
                const pn = book.pen_name_id ? penNames.find(p => p.id === book.pen_name_id) : null;
                return (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => {
                      onChange(book.id, book);
                      setOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-surface-hover text-sm flex items-center gap-2"
                  >
                    <span className="flex-1 truncate">
                      <span className="font-medium text-content">{book.title}</span>
                      {book.series && (
                        <span className="text-xs text-content-secondary ml-2">{book.series}</span>
                      )}
                    </span>
                    {pn && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${penNameClasses(pn.color).bg} ${penNameClasses(pn.color).text}`}>
                        {pn.name}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t border-edge-soft p-2">
            {creating ? (
              <div className="flex gap-1.5">
                <input
                  autoFocus
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="New book title"
                  className="flex-1 px-2 py-1.5 border border-edge rounded-control text-sm"
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                />
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!newTitle.trim() || saving}
                  className="px-3 py-1.5 text-xs bg-indigo-600 text-white font-medium rounded-control hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? '…' : 'Add'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded-control"
              >
                <Plus className="w-3.5 h-3.5" /> Add a new book to Catalog
              </button>
            )}
            {error && <p className="text-xs text-rose-600 mt-1.5">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
