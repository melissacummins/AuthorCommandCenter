import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, BookOpen, Tag, Upload, Plus, Trash2, Edit3, Link as LinkIcon, Sparkles, GitMerge,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePenNames } from '../../contexts/PenNameContext';
import { listBooks } from '../catalog/api';
import type { Book } from '../catalog/types';
import {
  createKdpBookFromCatalog, createTrope, deleteTrope, listKdpBooks, listKeywords, listTropes, mergeTropes,
  smartImportKeywords, updateTrope,
} from './api';
import type { KdpBook, Keyword, Trope } from './types';
import BookOptimizer from './components/BookOptimizer';
import ImportTab from './components/ImportTab';
import TropeDetail from './components/TropeDetail';
import CatalogBookPicker from '../../components/CatalogBookPicker';
import PenNameChip from '../../components/PenNameChip';

type Tab = 'overview' | 'books' | 'tropes' | 'import';

export default function KDPOptimizerModule() {
  const { user } = useAuth();
  const { selectedPenNameId, penNames } = usePenNames();
  const [tab, setTab] = useState<Tab>('overview');
  const [tropes, setTropes] = useState<Trope[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [kdpBooks, setKdpBooks] = useState<KdpBook[]>([]);
  const [catalogBooks, setCatalogBooks] = useState<Book[]>([]);
  const [activeBook, setActiveBook] = useState<KdpBook | null>(null);
  const [activeTrope, setActiveTrope] = useState<Trope | null>(null);
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
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
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

  if (activeTrope) {
    const tropeKws = keywords.filter(k => k.trope_id === activeTrope.id);
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <TropeDetail
          trope={activeTrope}
          allTropes={tropes}
          keywords={tropeKws}
          onBack={() => setActiveTrope(null)}
          onChange={reload}
        />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-start gap-3 mb-4">
        <div className="inline-flex items-center justify-center w-10 h-10 bg-gradient-to-br from-rose-500 to-rose-600 rounded-card shadow-lg shadow-rose-500/25 shrink-0">
          <Search className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-content">KDP Optimizer</h1>
          <p className="text-content-secondary text-sm mt-1">
            Manage keyword research by trope, pick the best ones per book, and feed them back into your Catalog.
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-edge mb-5">
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
        <div className="mb-4 p-3 rounded-control bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-content-secondary text-sm">Loading…</div>
      ) : tab === 'overview' ? (
        <Overview tropes={tropes} keywords={keywords} kdpBooks={kdpBooks} onOpen={b => setActiveBook(b)} />
      ) : tab === 'books' ? (
        <BooksTab
          kdpBooks={kdpBooks}
          catalogBooks={catalogBooks}
          tropeCounts={tropeCounts(kdpBooks)}
          selectedPenNameId={selectedPenNameId}
          penNames={penNames}
          onOpen={b => setActiveBook(b)}
          onCreateFromCatalog={async catalogBookId => {
            if (!user) return;
            try {
              const created = await createKdpBookFromCatalog(user.id, catalogBookId);
              setKdpBooks(prev => [...prev, created]);
              setActiveBook(created);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      ) : tab === 'tropes' ? (
        <TropesTab
          userId={user!.id}
          tropes={tropes}
          keywordsByTrope={keywordsByTrope}
          onOpen={t => setActiveTrope(t)}
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
        active ? 'border-brand-500 text-brand-600' : 'border-transparent text-content-secondary hover:text-content'
      }`}
    >
      {children}
    </button>
  );
}

function Counter({ n }: { n: number }) {
  return <span className="ml-1 text-xs text-content-muted">({n})</span>;
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
        <StatCard label="Keywords researched" value={keywords.length} icon={Search} color="text-brand-600" />
        <StatCard label="KDP books" value={kdpBooks.length} icon={BookOpen} color="text-brand-600" />
        <StatCard label="With selections" value={booksWithSelections.length} icon={BookOpen} color="text-emerald-600" />
      </div>

      {kdpBooks.length === 0 ? (
        <div className="text-center py-12 bg-surface rounded-card border border-dashed border-edge-strong">
          <Upload className="w-8 h-8 text-rose-400 mx-auto mb-3" />
          <p className="text-sm text-content-secondary">
            Nothing here yet — head to the Import tab to bring in your JSON.
          </p>
        </div>
      ) : (
        <>
          {booksNeedingSetup.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary mb-2">Books needing keyword selection</h2>
              <div className="bg-surface rounded-card border border-edge divide-y divide-edge-soft">
                {booksNeedingSetup.map(b => (
                  <button
                    key={b.id}
                    onClick={() => onOpen(b)}
                    className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-hover"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-content truncate">{b.title}</div>
                      {b.series && <div className="text-xs text-brand-600">{b.series}</div>}
                    </div>
                    <span className="text-xs text-content-secondary">
                      {b.assigned_trope_ids.length} tropes
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {unlinked.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary mb-2">Not linked to a Catalog book</h2>
              <div className="bg-surface rounded-card border border-edge divide-y divide-edge-soft">
                {unlinked.map(b => (
                  <button
                    key={b.id}
                    onClick={() => onOpen(b)}
                    className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-hover"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-content truncate">{b.title}</div>
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
    <div className="bg-surface rounded-card border border-edge p-4">
      <Icon className={`w-4 h-4 ${color} mb-2`} />
      <div className="text-2xl font-bold text-content">{value.toLocaleString()}</div>
      <div className="text-xs text-content-secondary">{label}</div>
    </div>
  );
}

// ============================================
// BOOKS TAB
// ============================================
function BooksTab({
  kdpBooks, catalogBooks, tropeCounts, selectedPenNameId, penNames, onOpen, onCreateFromCatalog,
}: {
  kdpBooks: KdpBook[];
  catalogBooks: Book[];
  tropeCounts: Record<string, { tropes: number; keywords: number }>;
  selectedPenNameId: string | null;
  penNames: import('../../lib/penNames').PenName[];
  onOpen: (b: KdpBook) => void;
  onCreateFromCatalog: (catalogBookId: string) => Promise<void>;
}) {
  const catalogById = useMemo(() => new Map(catalogBooks.map(b => [b.id, b])), [catalogBooks]);
  const penNameById = useMemo(() => new Map(penNames.map(p => [p.id, p])), [penNames]);
  const [adding, setAdding] = useState(false);

  // Filter KDP books by the active pen name via the linked Catalog
  // book. Books without a Catalog link don't have a pen name to filter
  // by, so they only appear under "All pen names".
  const filteredBooks = selectedPenNameId
    ? kdpBooks.filter(b => {
        const linked = b.book_id ? catalogById.get(b.book_id) : null;
        return linked?.pen_name_id === selectedPenNameId;
      })
    : kdpBooks;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-content-secondary">
          {selectedPenNameId
            ? `Showing books for the active pen name. Pen-name-less KDP books show under "All pen names".`
            : kdpBooks.length > 0
              ? `${kdpBooks.length} ${kdpBooks.length === 1 ? 'book' : 'books'} tracked.`
              : 'Pick a Catalog book to start optimizing keywords for it.'}
        </p>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-brand-600 text-brand-fg font-medium rounded-control hover:bg-brand-700"
          >
            <Plus className="w-4 h-4" /> Optimize a new book
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-surface border border-edge rounded-card p-4 flex items-center gap-2">
          <div className="flex-1">
            <CatalogBookPicker
              value={null}
              onChange={async bookId => {
                setAdding(false);
                await onCreateFromCatalog(bookId);
              }}
              placeholder="Pick a Catalog book to optimize…"
            />
          </div>
          <button
            onClick={() => setAdding(false)}
            className="text-sm text-content-secondary hover:text-content"
          >
            Cancel
          </button>
        </div>
      )}

      {filteredBooks.length === 0 ? (
        <div className="text-center py-12 bg-surface rounded-card border border-dashed border-edge-strong text-sm text-content-secondary">
          {kdpBooks.length === 0
            ? 'No KDP books yet. Pick a Catalog book above, or import on the Import tab to bring yours in.'
            : 'No books for the active pen name.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredBooks.map(b => {
            const counts = tropeCounts[b.id] ?? { tropes: 0, keywords: 0 };
            const linked = b.book_id ? catalogById.get(b.book_id) : null;
            const penName = linked?.pen_name_id ? penNameById.get(linked.pen_name_id) : null;
            // Prefer the Catalog title when linked — that's the source of truth.
            const displayTitle = linked?.title ?? b.title;
            const displaySubtitle = linked?.subtitle ?? b.subtitle;
            const displaySeries = linked?.series ?? b.series;
            return (
              <button
                key={b.id}
                onClick={() => onOpen(b)}
                className="text-left bg-surface rounded-card border border-edge p-4 hover:shadow-md hover:border-edge-strong transition-all"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-content truncate">{displayTitle}</h3>
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
                {displaySubtitle && <p className="text-xs text-content-secondary line-clamp-1">{displaySubtitle}</p>}
                {displaySeries && <p className="text-xs text-brand-600 font-medium mt-1">{displaySeries}</p>}
                {penName && (
                  <div className="mt-2">
                    <PenNameChip name={penName.name} color={penName.color} />
                  </div>
                )}
                <div className="flex items-center gap-3 text-xs text-content-secondary mt-3">
                  <span>{counts.tropes} tropes</span>
                  <span>·</span>
                  <span>{counts.keywords} keywords selected</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================
// TROPES TAB
// ============================================
function TropesTab({
  userId, tropes, keywordsByTrope, onOpen, onChange,
}: {
  userId: string;
  tropes: Trope[];
  keywordsByTrope: Map<string, number>;
  onOpen: (t: Trope) => void;
  onChange: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState('');
  const smartFileRef = useRef<HTMLInputElement>(null);

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

  async function onSmartCsv(file: File) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const text = await file.text();
      const r = await smartImportKeywords(userId, text);
      setInfo(
        `Smart import — ${r.inserted} added, ${r.updated} updated, ${r.tropesCreated} new tropes created (${r.rows} rows).`,
      );
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (smartFileRef.current) smartFileRef.current.value = '';
    }
  }

  function toggleMergeSel(id: string) {
    setMergeSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runMerge() {
    if (!mergeTarget.trim() || mergeSelected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await mergeTropes(userId, mergeTarget.trim(), Array.from(mergeSelected));
      setInfo(`Merged ${mergeSelected.size} trope${mergeSelected.size === 1 ? '' : 's'} into "${mergeTarget.trim()}".`);
      setMergeSelected(new Set());
      setMergeTarget('');
      setMergeMode(false);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Quick actions */}
      <div className="bg-surface rounded-card border border-edge p-4 flex flex-wrap gap-2 items-center">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="New trope name"
          className="flex-1 min-w-[12rem] rounded-control border border-edge-strong px-3 py-2 text-sm"
          onKeyDown={e => { if (e.key === 'Enter') add(); }}
        />
        <button
          onClick={add}
          disabled={busy || !newName.trim()}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 disabled:bg-edge-strong rounded-control"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
        <input
          ref={smartFileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onSmartCsv(f); }}
        />
        <button
          onClick={() => smartFileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-content bg-surface border border-edge-strong hover:bg-surface-hover rounded-control"
          title="Auto-categorize a CSV into existing or new tropes"
        >
          <Sparkles className="w-4 h-4" /> Smart Import CSV
        </button>
        <button
          onClick={() => { setMergeMode(v => !v); setMergeSelected(new Set()); setMergeTarget(''); }}
          className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-control ${
            mergeMode ? 'text-white bg-rose-600 hover:bg-rose-700' : 'text-content bg-surface border border-edge-strong hover:bg-surface-hover'
          }`}
        >
          <GitMerge className="w-4 h-4" /> {mergeMode ? 'Cancel merge' : 'Merge categories'}
        </button>
      </div>

      {error && <div className="p-3 rounded-control bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}
      {info && <div className="p-3 rounded-control bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">{info}</div>}

      {/* Merge panel */}
      {mergeMode && (
        <div className="bg-rose-50 border border-rose-200 rounded-card p-4 space-y-3 text-sm">
          <p className="text-rose-900">
            Pick the source tropes to merge below, then enter a target name. The target is created
            if it doesn't already exist.
          </p>
          <div className="flex gap-2 items-center">
            <input
              value={mergeTarget}
              onChange={e => setMergeTarget(e.target.value)}
              placeholder="Target trope name (e.g. Curvy Girl)"
              className="flex-1 rounded-control border border-edge-strong px-3 py-2 text-sm bg-surface"
            />
            <button
              onClick={runMerge}
              disabled={busy || !mergeTarget.trim() || mergeSelected.size === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:bg-edge-strong rounded-control"
            >
              <GitMerge className="w-4 h-4" /> Merge {mergeSelected.size > 0 ? `(${mergeSelected.size})` : ''}
            </button>
          </div>
        </div>
      )}

      {tropes.length === 0 ? (
        <div className="text-center py-12 bg-surface rounded-card border border-dashed border-edge-strong text-sm text-content-secondary">
          No tropes yet. Add one above or import from the Import tab.
        </div>
      ) : (
        <div className="bg-surface rounded-card border border-edge divide-y divide-edge-soft">
          {tropes.map(t => (
            <TropeRow
              key={t.id}
              trope={t}
              keywordCount={keywordsByTrope.get(t.id) ?? 0}
              onChange={onChange}
              onOpen={() => onOpen(t)}
              mergeMode={mergeMode}
              mergeSelected={mergeSelected.has(t.id)}
              onToggleMerge={() => toggleMergeSel(t.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TropeRow({
  trope, keywordCount, onChange, onOpen, mergeMode, mergeSelected, onToggleMerge,
}: {
  trope: Trope;
  keywordCount: number;
  onChange: () => void;
  onOpen: () => void;
  mergeMode: boolean;
  mergeSelected: boolean;
  onToggleMerge: () => void;
}) {
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
          className="w-full rounded-control border border-edge-strong px-3 py-2 text-sm"
        />
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Optional description"
          className="w-full rounded-control border border-edge-strong px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <button onClick={save} disabled={busy} className="px-3 py-1.5 text-sm text-brand-fg bg-brand-600 hover:bg-brand-700 rounded-control">
            Save
          </button>
          <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-sunken rounded-control">
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 ${mergeSelected ? 'bg-rose-50' : 'hover:bg-surface-hover'}`}>
      {mergeMode && (
        <input type="checkbox" checked={mergeSelected} onChange={onToggleMerge} />
      )}
      <button onClick={onOpen} className="text-left flex-1 min-w-0">
        <div className="text-sm font-medium text-content truncate">{trope.name}</div>
        {trope.description && <div className="text-xs text-content-secondary truncate">{trope.description}</div>}
      </button>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-content-secondary">{keywordCount} keywords</span>
        <button onClick={() => setEditing(true)} className="p-1.5 text-content-secondary hover:text-content rounded">
          <Edit3 className="w-4 h-4" />
        </button>
        <button onClick={remove} disabled={busy} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
