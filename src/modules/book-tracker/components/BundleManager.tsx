import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Trash2, Sparkles, Layers, X } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  listBundles,
  listBundleMembers,
  createBundle,
  deleteBundle,
  addBookToBundle,
  removeBookFromBundle,
} from '../api';
import type { BookBundle, BundleMember, TrackedBook } from '../types';
import { parseTitleEdition, EDITION_LABELS, displayTitle } from '../types';

interface Props {
  books: TrackedBook[];
  onBack: () => void;
}

interface BundleWithMembers {
  bundle: BookBundle;
  members: TrackedBook[];
}

// Detect translation groups by suffix ("Title - GE", "Title - FR").
function detectTranslationGroups(books: TrackedBook[]): Map<string, TrackedBook[]> {
  const groups = new Map<string, TrackedBook[]>();
  for (const b of books) {
    const { base } = parseTitleEdition(displayTitle(b));
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base)!.push(b);
  }
  // Only keep groups with more than one edition
  for (const [k, v] of groups) {
    if (v.length < 2) groups.delete(k);
  }
  return groups;
}

export default function BundleManager({ books, onBack }: Props) {
  const { user } = useAuth();
  const [bundles, setBundles] = useState<BookBundle[]>([]);
  const [members, setMembers] = useState<BundleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([listBundles(user.id), listBundleMembers(user.id)])
      .then(([b, m]) => {
        if (cancelled) return;
        setBundles(b);
        setMembers(m);
      })
      .catch(err => { if (!cancelled) setError(err.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const bundlesWithMembers: BundleWithMembers[] = useMemo(() => {
    const byBookId = new Map(books.map(b => [b.id, b]));
    return bundles.map(bundle => ({
      bundle,
      members: members
        .filter(m => m.bundle_id === bundle.id)
        .map(m => byBookId.get(m.tracked_book_id))
        .filter((b): b is TrackedBook => !!b),
    }));
  }, [bundles, members, books]);

  const translationGroups = useMemo(() => detectTranslationGroups(books), [books]);

  async function handleCreate(name: string, seedBookIds: string[] = []) {
    if (!user || !name.trim()) return;
    setAdding(true);
    try {
      const created = await createBundle(user.id, name.trim());
      setBundles(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      for (const bookId of seedBookIds) {
        await addBookToBundle(user.id, created.id, bookId);
      }
      if (seedBookIds.length > 0) {
        setMembers(prev => [
          ...prev,
          ...seedBookIds.map(bookId => ({ bundle_id: created.id, tracked_book_id: bookId, user_id: user.id })),
        ]);
      }
      setNewName('');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteBundle(id: string) {
    if (!confirm('Delete this bundle? Books inside it stay, just the grouping goes away.')) return;
    try {
      await deleteBundle(id);
      setBundles(prev => prev.filter(b => b.id !== id));
      setMembers(prev => prev.filter(m => m.bundle_id !== id));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }

  async function handleAddBook(bundleId: string, bookId: string) {
    if (!user) return;
    try {
      await addBookToBundle(user.id, bundleId, bookId);
      setMembers(prev => [...prev, { bundle_id: bundleId, tracked_book_id: bookId, user_id: user.id }]);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }

  async function handleRemoveBook(bundleId: string, bookId: string) {
    try {
      await removeBookFromBundle(bundleId, bookId);
      setMembers(prev => prev.filter(m => !(m.bundle_id === bundleId && m.tracked_book_id === bookId)));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Book Tracker
      </button>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Layers className="w-6 h-6 text-purple-500" /> Bundles
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Group originals with their translations or box-set titles to see combined dev cost vs profit.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      {/* Suggested translation groups */}
      {translationGroups.size > 0 && (
        <section className="mb-6 bg-purple-50 border border-purple-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-purple-600" />
            <h2 className="font-semibold text-purple-900">Suggested groupings</h2>
          </div>
          <p className="text-xs text-purple-700 mb-3">
            Detected from your "- GE" / "- FR" title suffixes. Click to create a bundle with these books.
          </p>
          <div className="space-y-2">
            {[...translationGroups.entries()]
              .filter(([base]) => !bundles.some(b => b.name === base))
              .map(([base, group]) => (
                <div key={base} className="flex items-center justify-between bg-white border border-purple-100 rounded-lg px-3 py-2">
                  <div className="text-sm">
                    <span className="font-medium text-slate-800">{base}</span>
                    <span className="text-slate-500 ml-2">
                      {group.map(g => {
                        const ed = parseTitleEdition(g.title).edition;
                        return ed ? (EDITION_LABELS[ed] ?? ed) : 'Original';
                      }).join(' · ')}
                    </span>
                  </div>
                  <button
                    onClick={() => handleCreate(base, group.map(g => g.id))}
                    disabled={adding}
                    className="px-2.5 py-1 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  >
                    Create bundle
                  </button>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* New bundle form */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-6 flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Bundle name (e.g. Night Series, Dragon Box Set)"
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
        />
        <button
          onClick={() => handleCreate(newName)}
          disabled={!newName.trim() || adding}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> New bundle
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Loading bundles…</div>
      ) : bundlesWithMembers.length === 0 ? (
        <div className="text-center text-sm text-slate-500 py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
          No bundles yet. Use a suggestion above or create one from scratch.
        </div>
      ) : (
        <div className="space-y-4">
          {bundlesWithMembers.map(({ bundle, members: bookMembers }) => (
            <BundleCard
              key={bundle.id}
              bundle={bundle}
              members={bookMembers}
              allBooks={books}
              onAddBook={bookId => handleAddBook(bundle.id, bookId)}
              onRemoveBook={bookId => handleRemoveBook(bundle.id, bookId)}
              onDelete={() => handleDeleteBundle(bundle.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BundleCard({
  bundle,
  members,
  allBooks,
  onAddBook,
  onRemoveBook,
  onDelete,
}: {
  bundle: BookBundle;
  members: TrackedBook[];
  allBooks: TrackedBook[];
  onAddBook: (bookId: string) => void;
  onRemoveBook: (bookId: string) => void;
  onDelete: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const memberIds = new Set(members.map(m => m.id));
  const candidates = allBooks.filter(b => !memberIds.has(b.id));

  const totalDevCost = members.reduce((s, b) => s + (b.dev_cost || 0), 0);
  const totalProfit = members.reduce((s, b) => s + (b.cumulative_profit || 0), 0);
  const net = totalProfit - totalDevCost;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-slate-800">{bundle.name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {members.length} {members.length === 1 ? 'book' : 'books'}
          </p>
        </div>
        <button
          onClick={onDelete}
          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <Stat label="Dev cost" value={`$${totalDevCost.toFixed(2)}`} />
        <Stat label="Profit" value={`$${totalProfit.toFixed(2)}`} />
        <Stat label="Net" value={`${net >= 0 ? '+' : '-'}$${Math.abs(net).toFixed(2)}`} positive={net >= 0} />
      </div>

      <div className="space-y-1.5 mb-3">
        {members.map(m => {
          const ed = parseTitleEdition(displayTitle(m)).edition;
          return (
            <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-50 rounded-lg text-sm">
              <span className="text-slate-700 truncate">
                {displayTitle(m)}
                {ed && <span className="text-slate-400 ml-2 text-xs">{EDITION_LABELS[ed] ?? ed}</span>}
              </span>
              <span className={`text-xs ${m.status === 'paid_off' ? 'text-emerald-600' : 'text-slate-500'}`}>
                {m.status === 'paid_off' ? '✓ paid off' : `$${(m.dev_cost - m.cumulative_profit).toFixed(2)} to go`}
              </span>
              <button
                onClick={() => onRemoveBook(m.id)}
                className="text-slate-400 hover:text-rose-600"
                aria-label="Remove from bundle"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
        {members.length === 0 && (
          <p className="text-sm text-slate-400 italic">No books in this bundle yet.</p>
        )}
      </div>

      {picking ? (
        <div className="border-t border-slate-200 pt-3">
          <select
            onChange={e => {
              if (e.target.value) {
                onAddBook(e.target.value);
                setPicking(false);
              }
            }}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            defaultValue=""
          >
            <option value="" disabled>Pick a book to add…</option>
            {candidates.map(b => (
              <option key={b.id} value={b.id}>{displayTitle(b)}</option>
            ))}
          </select>
          <button
            onClick={() => setPicking(false)}
            className="text-xs text-slate-500 hover:text-slate-700 mt-2"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setPicking(true)}
          disabled={candidates.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> Add book
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="bg-slate-50 rounded-lg p-2 text-center">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div
        className={`text-sm font-semibold mt-0.5 ${
          positive === undefined ? 'text-slate-800' : positive ? 'text-emerald-700' : 'text-rose-700'
        }`}
      >
        {value}
      </div>
    </div>
  );
}
