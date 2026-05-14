import { useEffect, useMemo, useState } from 'react';
import { Search, BookOpen, Tag, Upload, Plus, Trash2, Edit3, Link as LinkIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { listBooks } from '../catalog/api';
import type { Book } from '../catalog/types';
import {
  createTrope, deleteTrope, listKdpBooks, listKeywords, listTropes, updateTrope,
} from './api';
import type { KdpBook, Keyword, Trope } from './types';
import BookOptimizer from './components/BookOptimizer';
import ImportTab from './components/ImportTab';

type Tab = 'overview' | 'books' | 'tropes' | 'import';

export default function KDPOptimizerModule() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [tropes, setTropes] = useState<Trope[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [kdpBooks, setKdpBooks] = useState<KdpBook[]>([]);
  const [catalogBooks, setCatalogBooks] = useState<Book[]>([]);
  const [activeBook, setActiveBook] = useState<KdpBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!user) return;
    setLoading(true);
    try {
      const [t, k, b, cb] = await Promise.all([
        listTropes(user.id),
        listKeywords(user.id),
        listKdpBooks(user.id),
        listBooks(user.id),
      ]);
      setTropes(t);
      setKeywords(k);
      setKdpBooks(b);
      setCatalogBooks(cb);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const keywordsByTrope = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of keywords) m.set(k.trope_id, (m.get(k.trope_id) ?? 0) + 1);
    return m;
  }, [keywords]);

  if (activeBook) {
    return (
      <div className="p-6 lg:p-8 max-w-6xl mx-auto">
        <BookOptimizer
          book={activeBook}
          tropes={tropes}
          keywords={keywords}
          catalogBooks={catalogBooks}
          onBack={() => setActiveBook(null)}
          onSaved={updated => {
            setKdpBooks(prev => prev.map(b => (b.id === updated.id ? updated : b)));
            setActiveBook(updated);
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-start gap-3 mb-4">
        <div className="inline-flex items-center justify-center w-10 h-10 bg-gradient-to-br from-rose-500 to-rose-600 rounded-xl shadow-lg shadow-rose-500/25 shrink-0">
          <Search className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">KDP Optimizer</h1>
          <p className="text-slate-500 text-sm mt-1">
            Manage keyword research by trope, pick the best ones per book, and feed them back into your Catalog.
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-5">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</TabButton>
        <TabButton active={tab === 'books'} onClick={() => setTab('books')}>
          Books {kdpBooks.length > 0 && <Counter n={kdpBooks.length} />}
        </TabButton>
        <TabButton active={tab === 'tropes'} onClick={() => setTab('tropes')}>
          Tropes {tropes.length > 0 && <Counter n={tropes.length} />}
        </TabButton>
        <TabButton active={tab === 'import'} onClick={() => setTab('import')}>Import</TabButton>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-500 text-sm">Loading…</div>
      ) : tab === 'overview' ? (
        <Overview tropes={tropes} keywords={keywords} kdpBooks={kdpBooks} onOpen={b => setActiveBook(b)} />
      ) : tab === 'books' ? (
        <BooksTab
          kdpBooks={kdpBooks}
          catalogBooks={catalogBooks}
          tropeCounts={tropeCounts(kdpBooks)}
          onOpen={b => setActiveBook(b)}
        />
      ) : tab === 'tropes' ? (
        <TropesTab
          userId={user!.id}
          tropes={tropes}
          keywordsByTrope={keywordsByTrope}
          onChange={reload}
        />
      ) : (
        <ImportTab userId={user!.id} onImported={reload} />
      )}
    </div>
  );
}

function tropeCounts(books: KdpBook[]): Record<string, { tropes: number; keywords: number }> {
  const out: Record<string, { tropes: number; keywords: number }> = {};
  for (const b of books) {
    out[b.id] = {
      tropes: b.assigned_trope_ids.length,
      keywords: b.selected_keyword_ids.length,
    };
  }
  return out;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}

function Counter({ n }: { n: number }) {
  return <span className="ml-1 text-xs text-slate-400">({n})</span>;
}

// ============================================
// OVERVIEW TAB
// ============================================
function Overview({
  tropes, keywords, kdpBooks, onOpen,
}: {
  tropes: Trope[]; keywords: Keyword[]; kdpBooks: KdpBook[]; onOpen: (b: KdpBook) => void;
}) {
  const booksWithSelections = kdpBooks.filter(b => b.selected_keyword_ids.length > 0);
  const booksNeedingSetup = kdpBooks.filter(b => b.selected_keyword_ids.length === 0);
  const unlinked = kdpBooks.filter(b => !b.book_id);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Tropes" value={tropes.length} icon={Tag} color="text-rose-600" />
        <StatCard label="Keywords researched" value={keywords.length} icon={Search} color="text-indigo-600" />
        <StatCard label="KDP books" value={kdpBooks.length} icon={BookOpen} color="text-purple-600" />
        <StatCard label="With selections" value={booksWithSelections.length} icon={BookOpen} color="text-emerald-600" />
      </div>

      {kdpBooks.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300">
          <Upload className="w-8 h-8 text-rose-400 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            Nothing here yet — head to the Import tab to bring in your JSON.
          </p>
        </div>
      ) : (
        <>
          {booksNeedingSetup.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Books needing keyword selection</h2>
              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {booksNeedingSetup.map(b => (
                  <button
                    key={b.id}
                    onClick={() => onOpen(b)}
                    className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">{b.title}</div>
                      {b.series && <div className="text-xs text-indigo-600">{b.series}</div>}
                    </div>
                    <span className="text-xs text-slate-500">
                      {b.assigned_trope_ids.length} tropes
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {unlinked.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Not linked to a Catalog book</h2>
              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {unlinked.map(b => (
                  <button
                    key={b.id}
                    onClick={() => onOpen(b)}
                    className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">{b.title}</div>
                    </div>
                    <span className="text-xs text-amber-600">Link to Catalog →</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: typeof Tag; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <Icon className={`w-4 h-4 ${color} mb-2`} />
      <div className="text-2xl font-bold text-slate-800">{value.toLocaleString()}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

// ============================================
// BOOKS TAB
// ============================================
function BooksTab({
  kdpBooks, catalogBooks, tropeCounts, onOpen,
}: {
  kdpBooks: KdpBook[];
  catalogBooks: Book[];
  tropeCounts: Record<string, { tropes: number; keywords: number }>;
  onOpen: (b: KdpBook) => void;
}) {
  const catalogById = useMemo(() => new Map(catalogBooks.map(b => [b.id, b])), [catalogBooks]);

  if (kdpBooks.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500">
        No KDP books yet. Import on the Import tab to bring yours in.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {kdpBooks.map(b => {
        const counts = tropeCounts[b.id] ?? { tropes: 0, keywords: 0 };
        const linked = b.book_id ? catalogById.get(b.book_id) : null;
        return (
          <button
            key={b.id}
            onClick={() => onOpen(b)}
            className="text-left bg-white rounded-2xl border border-slate-200 p-4 hover:shadow-md hover:border-slate-300 transition-all"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="font-semibold text-slate-800 truncate">{b.title}</h3>
              {linked ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                  <LinkIcon className="w-3 h-3" /> Linked
                </span>
              ) : (
                <span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                  Not linked
                </span>
              )}
            </div>
            {b.subtitle && <p className="text-xs text-slate-500 line-clamp-1">{b.subtitle}</p>}
            {b.series && <p className="text-xs text-indigo-600 font-medium mt-1">{b.series}</p>}
            <div className="flex items-center gap-3 text-xs text-slate-500 mt-3">
              <span>{counts.tropes} tropes</span>
              <span>·</span>
              <span>{counts.keywords} keywords selected</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ============================================
// TROPES TAB
// ============================================
function TropesTab({
  userId, tropes, keywordsByTrope, onChange,
}: {
  userId: string;
  tropes: Trope[];
  keywordsByTrope: Map<string, number>;
  onChange: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await createTrope(userId, newName.trim());
      setNewName('');
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex gap-2">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="New trope name"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          onKeyDown={e => { if (e.key === 'Enter') add(); }}
        />
        <button
          onClick={add}
          disabled={busy || !newName.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded-lg"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      {tropes.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500">
          No tropes yet. Add one above or import from the Import tab.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {tropes.map(t => (
            <TropeRow key={t.id} trope={t} keywordCount={keywordsByTrope.get(t.id) ?? 0} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

function TropeRow({ trope, keywordCount, onChange }: { trope: Trope; keywordCount: number; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(trope.name);
  const [description, setDescription] = useState(trope.description);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await updateTrope(trope.id, { name, description });
      setEditing(false);
      onChange();
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`Delete trope "${trope.name}"? Its ${keywordCount} keyword(s) will be deleted too.`)) return;
    setBusy(true);
    try {
      await deleteTrope(trope.id);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="p-3 space-y-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Optional description"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <button onClick={save} disabled={busy} className="px-3 py-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg">
            Save
          </button>
          <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800 truncate">{trope.name}</div>
        {trope.description && <div className="text-xs text-slate-500 truncate">{trope.description}</div>}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-slate-500">{keywordCount} keywords</span>
        <button onClick={() => setEditing(true)} className="p-1.5 text-slate-500 hover:text-slate-800 rounded">
          <Edit3 className="w-4 h-4" />
        </button>
        <button onClick={remove} disabled={busy} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
