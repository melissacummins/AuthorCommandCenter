import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BookOpen, Plus, Upload, Layers, Search, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePenNames } from '../../contexts/PenNameContext';
import PenNameChip from '../../components/PenNameChip';
import {
  listTrackedBooks,
  createTrackedBook,
  updateTrackedBook,
  deleteTrackedBook,
} from './api';
import type { TrackedBook, TrackedBookInsert } from './types';
import { displayTitle } from './types';
import BookForm from './components/BookForm';
import BookDetail from './components/BookDetail';
import BundleManager from './components/BundleManager';
import JsonImportPanel from './components/JsonImportPanel';

type Tab = 'active' | 'paid_off';
type View =
  | { mode: 'list'; tab: Tab }
  | { mode: 'new' }
  | { mode: 'edit'; book: TrackedBook }
  | { mode: 'detail'; book: TrackedBook }
  | { mode: 'bundles' }
  | { mode: 'import' };

export default function BookTrackerModule() {
  const { user } = useAuth();
  const { selectedPenNameId, penNames } = usePenNames();
  const [books, setBooks] = useState<TrackedBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ mode: 'list', tab: 'active' });
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    listTrackedBooks(user.id)
      .then(rows => { if (!cancelled) setBooks(rows); })
      .catch(err => { if (!cancelled) setError(err.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  async function refresh() {
    if (!user) return;
    const rows = await listTrackedBooks(user.id);
    setBooks(rows);
  }

  async function handleCreate(input: TrackedBookInsert) {
    if (!user) return;
    setSaving(true);
    try {
      const created = await createTrackedBook(user.id, input);
      setBooks(prev => [created, ...prev]);
      setView({ mode: 'detail', book: created });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, input: TrackedBookInsert) {
    setSaving(true);
    try {
      const updated = await updateTrackedBook(id, input);
      setBooks(prev => prev.map(b => (b.id === id ? updated : b)));
      setView({ mode: 'detail', book: updated });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this book and all its quarterly updates? This cannot be undone.')) return;
    try {
      await deleteTrackedBook(id);
      setBooks(prev => prev.filter(b => b.id !== id));
      setView({ mode: 'list', tab: 'active' });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }

  function handleBookUpdated(updated: TrackedBook) {
    setBooks(prev => prev.map(b => (b.id === updated.id ? updated : b)));
    setView(v => (v.mode === 'detail' ? { mode: 'detail', book: updated } : v));
  }

  // Routing

  if (view.mode === 'bundles') {
    return <BundleManager books={books} onBack={() => setView({ mode: 'list', tab: 'active' })} />;
  }

  if (view.mode === 'import') {
    return (
      <JsonImportPanel
        onBack={() => setView({ mode: 'list', tab: 'active' })}
        onComplete={refresh}
      />
    );
  }

  if (view.mode === 'detail') {
    const fresh = books.find(b => b.id === view.book.id) ?? view.book;
    return (
      <BookDetail
        book={fresh}
        onBack={() => setView({ mode: 'list', tab: fresh.status === 'paid_off' ? 'paid_off' : 'active' })}
        onEdit={() => setView({ mode: 'edit', book: fresh })}
        onBookUpdated={handleBookUpdated}
      />
    );
  }

  if (view.mode === 'new' || view.mode === 'edit') {
    const initial = view.mode === 'edit' ? view.book : null;
    return (
      <div className="p-6 lg:p-8 max-w-3xl mx-auto">
        <button
          onClick={() => setView(initial ? { mode: 'detail', book: initial } : { mode: 'list', tab: 'active' })}
          className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-2xl font-bold text-slate-800 mb-6">
          {initial ? `Edit: ${initial.title}` : 'Add a book'}
        </h1>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
        )}
        <BookForm
          initial={initial}
          saving={saving}
          onCancel={() => setView(initial ? { mode: 'detail', book: initial } : { mode: 'list', tab: 'active' })}
          onSubmit={input => (initial ? handleUpdate(initial.id, input) : handleCreate(input))}
          onDelete={initial ? () => handleDelete(initial.id) : undefined}
        />
      </div>
    );
  }

  // Filter by selected pen name via the linked catalog book. Books
  // without a catalog link don't have a pen name to filter by, so they
  // only appear under "All pen names".
  const visibleBooks = selectedPenNameId
    ? books.filter(b => b.catalog_book?.pen_name_id === selectedPenNameId)
    : books;

  const penNameById = new Map(penNames.map(p => [p.id, p]));

  // List view
  return <BookList
    books={visibleBooks}
    penNameById={penNameById}
    loading={loading}
    error={error}
    tab={view.tab}
    query={query}
    onTabChange={tab => setView({ mode: 'list', tab })}
    onQueryChange={setQuery}
    onNew={() => setView({ mode: 'new' })}
    onImport={() => setView({ mode: 'import' })}
    onBundles={() => setView({ mode: 'bundles' })}
    onOpen={book => setView({ mode: 'detail', book })}
  />;
}


// ---- List view ----

interface ListProps {
  books: TrackedBook[];
  penNameById: Map<string, { name: string; color: import('../../lib/penNames').PenNameColor }>;
  loading: boolean;
  error: string | null;
  tab: Tab;
  query: string;
  onTabChange: (tab: Tab) => void;
  onQueryChange: (q: string) => void;
  onNew: () => void;
  onImport: () => void;
  onBundles: () => void;
  onOpen: (book: TrackedBook) => void;
}

function BookList({
  books, penNameById, loading, error, tab, query, onTabChange, onQueryChange, onNew, onImport, onBundles, onOpen,
}: ListProps) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books
      .filter(b => (tab === 'paid_off' ? b.status === 'paid_off' : b.status === 'active'))
      .filter(b => (q ? displayTitle(b).toLowerCase().includes(q) : true));
  }, [books, tab, query]);

  const activeCount = books.filter(b => b.status === 'active').length;
  const paidCount = books.filter(b => b.status === 'paid_off').length;

  const totals = useMemo(() => {
    const devCost = books.reduce((s, b) => s + (b.dev_cost || 0), 0);
    const profit = books.reduce((s, b) => s + (b.cumulative_profit || 0), 0);
    return { devCost, profit, net: profit - devCost };
  }, [books]);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-purple-500" /> Book Tracker
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Track development costs per book and watch each title pay for itself.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onBundles}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <Layers className="w-4 h-4" /> Bundles
          </button>
          <button
            onClick={onImport}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <Upload className="w-4 h-4" /> Import JSON
          </button>
          <button
            onClick={onNew}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 shadow-sm"
          >
            <Plus className="w-4 h-4" /> New book
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      {/* Headline stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <SummaryCard label="Total dev cost" value={`$${totals.devCost.toFixed(2)}`} />
        <SummaryCard label="Total profit" value={`$${totals.profit.toFixed(2)}`} />
        <SummaryCard
          label="Net"
          value={`${totals.net >= 0 ? '+' : '-'}$${Math.abs(totals.net).toFixed(2)}`}
          positive={totals.net >= 0}
        />
      </div>

      {/* Tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex bg-slate-100 rounded-lg p-1">
          <TabButton active={tab === 'active'} onClick={() => onTabChange('active')}>
            Active <span className="text-slate-400 ml-1">({activeCount})</span>
          </TabButton>
          <TabButton active={tab === 'paid_off'} onClick={() => onTabChange('paid_off')}>
            Paid off <span className="text-slate-400 ml-1">({paidCount})</span>
          </TabButton>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            placeholder="Search titles…"
            className="pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm w-56"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Loading books…</div>
      ) : filtered.length === 0 ? (
        <EmptyState tab={tab} onNew={onNew} onImport={onImport} hasAny={books.length > 0} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Launch</th>
                <th className="px-4 py-3 text-right">Dev cost</th>
                <th className="px-4 py-3 text-right">Cumulative</th>
                <th className="px-4 py-3 text-right">Net</th>
                {tab === 'paid_off' && <th className="px-4 py-3">Paid off in</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => {
                const net = b.cumulative_profit - b.dev_cost;
                const pn = b.catalog_book?.pen_name_id ? penNameById.get(b.catalog_book.pen_name_id) : null;
                return (
                  <tr
                    key={b.id}
                    onClick={() => onOpen(b)}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{displayTitle(b)}</span>
                        {pn && <PenNameChip name={pn.name} color={pn.color} />}
                        {!b.catalog_book && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            Not in Catalog
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {b.launch_date
                        ? new Date(b.launch_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">${b.dev_cost.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">${b.cumulative_profit.toFixed(2)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {net >= 0 ? '+' : '-'}${Math.abs(net).toFixed(2)}
                    </td>
                    {tab === 'paid_off' && (
                      <td className="px-4 py-2.5 text-slate-600">
                        {b.payoff_quarter ?? '—'}
                        {b.months_to_payoff !== null && (
                          <span className="text-slate-400 text-xs ml-1.5">({b.months_to_payoff}mo)</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
        active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}

function SummaryCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const color =
    positive === undefined
      ? 'text-slate-800'
      : positive
        ? 'text-emerald-700'
        : 'text-rose-700';
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}

function EmptyState({ tab, onNew, onImport, hasAny }: { tab: Tab; onNew: () => void; onImport: () => void; hasAny: boolean }) {
  if (hasAny) {
    return (
      <div className="text-center py-12 text-sm text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
        No {tab === 'paid_off' ? 'paid-off' : 'active'} books yet.
      </div>
    );
  }
  return (
    <div className="text-center py-16 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
      <BookOpen className="w-10 h-10 text-slate-300 mx-auto mb-3" />
      <h3 className="font-semibold text-slate-700 mb-1">No books tracked yet</h3>
      <p className="text-sm text-slate-500 mb-5">Add your first book or import an export from your old tracker.</p>
      <div className="flex justify-center gap-2">
        <button
          onClick={onNew}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700"
        >
          <Plus className="w-4 h-4" /> New book
        </button>
        <button
          onClick={onImport}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          <Upload className="w-4 h-4" /> Import JSON
        </button>
      </div>
    </div>
  );
}
