import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BookOpen, Download, Filter, Mail, Megaphone, Plus, Search, Users,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { listBooks } from '../catalog/api';
import type { Book } from '../catalog/types';
import {
  addReaderBook, bulkUpdateReaderBook, bulkUpdateStatus, createArcReader, deleteArcReader,
  dismissUnmatchedTitle, getArcReader, listArcReaders, removeReaderBook, updateArcReader,
} from './api';
import type { ArcReader, ArcStatus, ReaderBookRelationship } from './types';
import { readerBookCount, STATUS_COLORS, STATUS_LABELS, STATUS_ORDER } from './types';
import ImportTab from './components/ImportTab';
import ReaderForm, { type ReaderFormSubmit } from './components/ReaderForm';

type View =
  | { mode: 'list'; tab: Tab }
  | { mode: 'new' }
  | { mode: 'edit'; reader: ArcReader };
type Tab = 'all' | 'pending' | 'current' | 'reviewed' | 'import';

export default function ARCsModule() {
  const { user } = useAuth();
  const [readers, setReaders] = useState<ArcReader[]>([]);
  const [catalogBooks, setCatalogBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<View>({ mode: 'list', tab: 'all' });

  // Filters
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ArcStatus | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<ArcStatus | ''>('');
  const [bulkField, setBulkField] = useState<ReaderBookRelationship | ''>('');
  // Catalog book_id selected for bulk operations (was a free-text title pre-Phase-2).
  const [bulkBookId, setBulkBookId] = useState<string>('');
  const [bulkAction, setBulkAction] = useState<'add' | 'remove'>('add');

  async function reload() {
    if (!user) return;
    setLoading(true);
    try {
      const [r, b] = await Promise.all([listArcReaders(user.id), listBooks(user.id)]);
      setReaders(r);
      setCatalogBooks(b);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  // Walk the desired final book_id list against the current junction
  // state and emit add/remove calls for the deltas. Avoids no-op writes
  // and lets the form treat its book lists as plain UI state.
  async function reconcileBookHistory(
    userId: string,
    readerId: string,
    desired: ReaderFormSubmit['bookHistory'],
    initial: ArcReader | null,
  ) {
    const current = {
      applied:  new Set((initial?.reader_books ?? []).filter(b => b.relationship === 'applied').map(b => b.book_id)),
      received: new Set((initial?.reader_books ?? []).filter(b => b.relationship === 'received').map(b => b.book_id)),
      reviewed: new Set((initial?.reader_books ?? []).filter(b => b.relationship === 'reviewed').map(b => b.book_id)),
    };
    const ops: Promise<void>[] = [];
    (['applied', 'received', 'reviewed'] as const).forEach(rel => {
      const want = new Set(desired[rel]);
      for (const id of want) if (!current[rel].has(id)) ops.push(addReaderBook(userId, readerId, id, rel));
      for (const id of current[rel]) if (!want.has(id)) ops.push(removeReaderBook(readerId, id, rel));
    });
    await Promise.all(ops);
  }

  async function handleCreate(submit: ReaderFormSubmit) {
    if (!user) return;
    setSaving(true);
    try {
      const created = await createArcReader(user.id, submit.reader);
      await reconcileBookHistory(user.id, created.id, submit.bookHistory, null);
      const fresh = await getArcReader(created.id);
      if (fresh) setReaders(prev => [...prev, fresh].sort((a, b) => a.name.localeCompare(b.name)));
      setView({ mode: 'list', tab: 'all' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, submit: ReaderFormSubmit, initial: ArcReader) {
    if (!user) return;
    setSaving(true);
    try {
      await updateArcReader(id, submit.reader);
      await reconcileBookHistory(user.id, id, submit.bookHistory, initial);
      const fresh = await getArcReader(id);
      if (fresh) setReaders(prev => prev.map(r => (r.id === id ? fresh : r)).sort((a, b) => a.name.localeCompare(b.name)));
      setView({ mode: 'list', tab: 'all' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDismissUnmatched(readerId: string, title: string, relationship: ReaderBookRelationship) {
    try {
      await dismissUnmatchedTitle(readerId, relationship, title);
      const fresh = await getArcReader(readerId);
      if (fresh) setReaders(prev => prev.map(r => (r.id === readerId ? fresh : r)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteArcReader(id);
      setReaders(prev => prev.filter(r => r.id !== id));
      setView({ mode: 'list', tab: 'all' });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function applyBulk() {
    if (!bulkStatus || selectedIds.size === 0) return;
    setSaving(true);
    try {
      await bulkUpdateStatus(Array.from(selectedIds), bulkStatus);
      await reload();
      setSelectedIds(new Set());
      setBulkStatus('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function applyBulkBook() {
    if (!user || !bulkField || !bulkBookId || selectedIds.size === 0) return;
    setSaving(true);
    try {
      await bulkUpdateReaderBook(
        user.id,
        Array.from(selectedIds),
        bulkBookId,
        bulkField,
        bulkAction,
      );
      await reload();
      setSelectedIds(new Set());
      setBulkField('');
      setBulkBookId('');
      setBulkAction('add');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Filter readers based on current tab + filter + query
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@+/, '');
    return readers.filter(r => {
      const t = view.mode === 'list' ? view.tab : 'all';
      if (t === 'pending') {
        if (!['new', 'awaiting_arc', 'awaiting_review'].includes(r.status)) return false;
      } else if (t === 'current') {
        if (r.status !== 'current_arc_member') return false;
      } else if (t === 'reviewed') {
        if (readerBookCount(r, 'reviewed') === 0) return false;
      }
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (q) {
        const hay = [
          r.name,
          r.email ?? '',
          r.primary_sm ?? '',
          r.ig_profile_url ?? '',
          r.tt_profile_url ?? '',
          r.threads_profile_url ?? '',
          r.fb_profile_url ?? '',
          r.goodreads_profile_url ?? '',
          r.amazon_reviewer_url ?? '',
          r.blog_url ?? '',
          // Search book titles via the joined junction (and the legacy
          // arrays during the cutover so backfilled but un-relinked
          // titles still surface).
          ...(r.reader_books ?? []).map(rb => rb.book_title),
          ...r.applied_for,
          ...r.received,
          ...r.reviewed,
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [readers, query, statusFilter, view]);

  const exportableCount = useMemo(
    () => filtered.filter(r => r.email && r.email.trim()).length,
    [filtered],
  );

  function exportEmails() {
    const withEmail = filtered.filter(r => r.email && r.email.trim());
    if (withEmail.length === 0) return;
    const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = [
      'email,name',
      ...withEmail.map(r => `${escape(r.email!.trim())},${escape(r.name)}`),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `arc-readers_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const statusCounts = useMemo(() => {
    const c: Record<ArcStatus, number> = Object.fromEntries(STATUS_ORDER.map(s => [s, 0])) as Record<ArcStatus, number>;
    for (const r of readers) c[r.status]++;
    return c;
  }, [readers]);

  // --- Detail / new view ---
  if (view.mode !== 'list') {
    const isEdit = view.mode === 'edit';
    const initial = isEdit ? view.reader : null;
    return (
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        <button
          onClick={() => setView({ mode: 'list', tab: 'all' })}
          className="inline-flex items-center gap-2 text-sm text-content-secondary hover:text-content mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to ARCs
        </button>
        <h1 className="text-2xl font-bold text-content mb-6">
          {isEdit ? initial?.name : 'Add reader'}
        </h1>
        {error && (
          <div className="mb-4 p-3 rounded-control bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
        )}
        <ReaderForm
          initial={initial}
          catalogBooks={catalogBooks}
          saving={saving}
          onCancel={() => setView({ mode: 'list', tab: 'all' })}
          onSubmit={submit => (isEdit && initial ? handleUpdate(initial.id, submit, initial) : handleCreate(submit))}
          onDelete={isEdit && initial ? () => handleDelete(initial.id) : undefined}
          onDismissUnmatched={isEdit && initial ? (title, rel) => handleDismissUnmatched(initial.id, title, rel) : undefined}
        />
      </div>
    );
  }

  // --- List view ---
  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-content flex items-center gap-2">
            <Users className="w-6 h-6 text-pink-500" /> ARCs
          </h1>
          <p className="text-content-secondary mt-1 text-sm">
            Your ARC readers across every launch — track who's gotten what, who reviewed,
            who's awaiting a copy, and where they post.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {view.tab !== 'import' && (
            <button
              onClick={exportEmails}
              disabled={exportableCount === 0}
              title={
                exportableCount === 0
                  ? 'No readers with email in the current view'
                  : `Export ${exportableCount} email${exportableCount === 1 ? '' : 's'} as CSV for Bookfunnel`
              }
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-content bg-surface border border-edge-strong hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-control shadow-sm"
            >
              <Download className="w-4 h-4" /> Export emails
              {exportableCount > 0 && (
                <span className="text-xs text-content-secondary">({exportableCount})</span>
              )}
            </button>
          )}
          <button
            onClick={() => setView({ mode: 'new' })}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-control shadow-sm"
          >
            <Plus className="w-4 h-4" /> Add reader
          </button>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 border-b border-edge mb-5 overflow-x-auto">
        <TabButton active={view.tab === 'all'} onClick={() => setView({ mode: 'list', tab: 'all' })}>
          All {readers.length > 0 && <Counter n={readers.length} />}
        </TabButton>
        <TabButton active={view.tab === 'pending'} onClick={() => setView({ mode: 'list', tab: 'pending' })}>
          Pending action
        </TabButton>
        <TabButton active={view.tab === 'current'} onClick={() => setView({ mode: 'list', tab: 'current' })}>
          Current ARC <Counter n={statusCounts.current_arc_member} />
        </TabButton>
        <TabButton active={view.tab === 'reviewed'} onClick={() => setView({ mode: 'list', tab: 'reviewed' })}>
          Reviewed
        </TabButton>
        <TabButton active={view.tab === 'import'} onClick={() => setView({ mode: 'list', tab: 'import' })}>
          Import
        </TabButton>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-control bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      {view.tab === 'import' ? (
        <ImportTab userId={user!.id} catalogBooks={catalogBooks} onImported={reload} />
      ) : loading ? (
        <div className="text-center py-16 text-content-secondary text-sm">Loading readers…</div>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative flex-1 min-w-[14rem] max-w-md">
              <Search className="w-4 h-4 text-content-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search name, email, handle, or book title"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-control border border-edge-strong"
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Filter className="w-4 h-4 text-content-secondary" />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as ArcStatus | 'all')}
                className="rounded-control border border-edge-strong px-2 py-2 text-sm bg-surface"
              >
                <option value="all">All statuses</option>
                {STATUS_ORDER.map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s]} ({statusCounts[s]})</option>
                ))}
              </select>
            </div>
            <div className="ml-auto text-xs text-content-secondary">
              {filtered.length} of {readers.length} shown
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-card p-3 text-sm mb-3 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium text-indigo-800">{selectedIds.size} selected</span>
                <select
                  value={bulkStatus}
                  onChange={e => setBulkStatus(e.target.value as ArcStatus)}
                  className="rounded-control border border-edge-strong px-2 py-1 text-sm bg-surface"
                >
                  <option value="">Change status to…</option>
                  {STATUS_ORDER.map(s => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
                <button
                  onClick={applyBulk}
                  disabled={!bulkStatus || saving}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-edge-strong rounded-control"
                >
                  Apply
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-sunken rounded-control ml-auto"
                >
                  Clear selection
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-indigo-200">
                <select
                  value={bulkAction}
                  onChange={e => setBulkAction(e.target.value as 'add' | 'remove')}
                  className="rounded-control border border-edge-strong px-2 py-1 text-sm bg-surface"
                >
                  <option value="add">Add</option>
                  <option value="remove">Remove</option>
                </select>
                <select
                  value={bulkField}
                  onChange={e => setBulkField(e.target.value as ReaderBookRelationship | '')}
                  className="rounded-control border border-edge-strong px-2 py-1 text-sm bg-surface"
                >
                  <option value="">Field…</option>
                  <option value="applied">Applied for</option>
                  <option value="received">Received</option>
                  <option value="reviewed">Reviewed</option>
                </select>
                <select
                  value={bulkBookId}
                  onChange={e => setBulkBookId(e.target.value)}
                  className="rounded-control border border-edge-strong px-2 py-1 text-sm bg-surface max-w-xs"
                >
                  <option value="">Book…</option>
                  {catalogBooks.map(b => (
                    <option key={b.id} value={b.id}>{b.title}</option>
                  ))}
                </select>
                <button
                  onClick={applyBulkBook}
                  disabled={!bulkField || !bulkBookId || saving}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-edge-strong rounded-control"
                >
                  Apply
                </button>
              </div>
            </div>
          )}

          {filtered.length === 0 ? (
            <EmptyState
              hasAny={readers.length > 0}
              onAdd={() => setView({ mode: 'new' })}
              onImport={() => setView({ mode: 'list', tab: 'import' })}
            />
          ) : (
            <div className="bg-surface rounded-card border border-edge overflow-hidden">
              <div className="overflow-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-surface-hover text-content-secondary font-medium sticky top-0">
                    <tr>
                      <th className="px-3 py-2 w-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
                          onChange={e => {
                            if (e.target.checked) setSelectedIds(new Set(filtered.map(r => r.id)));
                            else setSelectedIds(new Set());
                          }}
                        />
                      </th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Received</th>
                      <th className="px-3 py-2">Reviewed</th>
                      <th className="px-3 py-2 whitespace-nowrap">Opt-ins</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-edge-soft">
                    {filtered.map(r => (
                      <tr
                        key={r.id}
                        className={`hover:bg-surface-hover cursor-pointer ${selectedIds.has(r.id) ? 'bg-indigo-50/50' : ''}`}
                        onClick={() => setView({ mode: 'edit', reader: r })}
                      >
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(r.id)}
                            onChange={() => {
                              setSelectedIds(s => {
                                const next = new Set(s);
                                if (next.has(r.id)) next.delete(r.id);
                                else next.add(r.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-content">{r.name}</div>
                          {r.email && <div className="text-xs text-content-secondary truncate max-w-[16rem]">{r.email}</div>}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[r.status]}`}>
                            {STATUS_LABELS[r.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2"><BookCount count={readerBookCount(r, 'received')} /></td>
                        <td className="px-3 py-2"><BookCount count={readerBookCount(r, 'reviewed')} /></td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 text-content-secondary">
                            {r.newsletter_subscribed && <Mail className="w-4 h-4 text-emerald-500" />}
                            {r.promo_team && <Megaphone className="w-4 h-4 text-amber-500" />}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
        active ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-content-secondary hover:text-content'
      }`}
    >
      {children}
    </button>
  );
}

function Counter({ n }: { n: number }) {
  return <span className="ml-1 text-xs text-content-muted">({n})</span>;
}

function BookCount({ count }: { count: number }) {
  if (count === 0) return <span className="text-xs text-content-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-content">
      <BookOpen className="w-3.5 h-3.5 text-content-muted" /> {count}
    </span>
  );
}

function EmptyState({
  hasAny, onAdd, onImport,
}: { hasAny: boolean; onAdd: () => void; onImport: () => void }) {
  return (
    <div className="text-center py-16 bg-surface rounded-card border border-dashed border-edge-strong">
      <Users className="w-10 h-10 text-pink-400 mx-auto mb-3" />
      <h3 className="text-lg font-semibold text-content mb-1">
        {hasAny ? 'No readers match these filters' : 'No ARC readers yet'}
      </h3>
      <p className="text-sm text-content-secondary mb-5 max-w-sm mx-auto">
        {hasAny
          ? 'Try clearing the search or changing the status filter.'
          : 'Import your Notion ARC database, or add readers one at a time.'}
      </p>
      {!hasAny && (
        <div className="inline-flex gap-2">
          <button onClick={onAdd} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-control">
            <Plus className="w-4 h-4" /> Add reader
          </button>
          <button onClick={onImport} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-content bg-surface border border-edge-strong hover:bg-surface-hover rounded-control">
            Import from Notion
          </button>
        </div>
      )}
    </div>
  );
}
