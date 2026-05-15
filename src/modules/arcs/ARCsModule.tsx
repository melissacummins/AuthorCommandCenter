import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BookOpen, Download, Filter, Mail, Megaphone, Plus, Search, Users,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { listBooks } from '../catalog/api';
import type { Book } from '../catalog/types';
import {
  bulkUpdateStatus, createArcReader, deleteArcReader, listArcReaders, updateArcReader,
} from './api';
import type { ArcReader, ArcReaderInsert, ArcStatus } from './types';
import { STATUS_COLORS, STATUS_LABELS, STATUS_ORDER } from './types';
import ImportTab from './components/ImportTab';
import ReaderForm from './components/ReaderForm';

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

  async function handleCreate(input: ArcReaderInsert) {
    if (!user) return;
    setSaving(true);
    try {
      const created = await createArcReader(user.id, input);
      setReaders(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setView({ mode: 'list', tab: 'all' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, input: ArcReaderInsert) {
    setSaving(true);
    try {
      const updated = await updateArcReader(id, input);
      setReaders(prev => prev.map(r => (r.id === id ? updated : r)).sort((a, b) => a.name.localeCompare(b.name)));
      setView({ mode: 'list', tab: 'all' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
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

  const exportableCount = useMemo(
    () => filtered.filter(r => r.email && r.email.trim()).length,
    [filtered],
  );

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

  // Filter readers based on current tab + filter + query
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return readers.filter(r => {
      const t = view.mode === 'list' ? view.tab : 'all';
      if (t === 'pending') {
        if (!['new', 'awaiting_arc', 'awaiting_review'].includes(r.status)) return false;
      } else if (t === 'current') {
        if (r.status !== 'current_arc_member') return false;
      } else if (t === 'reviewed') {
        if (r.reviewed.length === 0) return false;
      }
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (q) {
        const hay = [r.name, r.email ?? '', r.primary_sm ?? '', ...r.applied_for, ...r.received, ...r.reviewed]
          .join(' ')
          .toLowerCase();
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
          className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to ARCs
        </button>
        <h1 className="text-2xl font-bold text-slate-800 mb-6">
          {isEdit ? initial?.name : 'Add reader'}
        </h1>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
        )}
        <ReaderForm
          initial={initial}
          catalogBooks={catalogBooks}
          saving={saving}
          onCancel={() => setView({ mode: 'list', tab: 'all' })}
          onSubmit={input => (isEdit && initial ? handleUpdate(initial.id, input) : handleCreate(input))}
          onDelete={isEdit && initial ? () => handleDelete(initial.id) : undefined}
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
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Users className="w-6 h-6 text-pink-500" /> ARCs
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
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
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm"
            >
              <Download className="w-4 h-4" /> Export emails
              {exportableCount > 0 && (
                <span className="text-xs text-slate-500">({exportableCount})</span>
              )}
            </button>
          )}
          <button
            onClick={() => setView({ mode: 'new' })}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm"
          >
            <Plus className="w-4 h-4" /> Add reader
          </button>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 border-b border-slate-200 mb-5 overflow-x-auto">
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
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      {view.tab === 'import' ? (
        <ImportTab userId={user!.id} catalogBooks={catalogBooks} onImported={reload} />
      ) : loading ? (
        <div className="text-center py-16 text-slate-500 text-sm">Loading readers…</div>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative flex-1 min-w-[14rem] max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search name, email, or book title"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Filter className="w-4 h-4 text-slate-500" />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as ArcStatus | 'all')}
                className="rounded-lg border border-slate-300 px-2 py-2 text-sm bg-white"
              >
                <option value="all">All statuses</option>
                {STATUS_ORDER.map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s]} ({statusCounts[s]})</option>
                ))}
              </select>
            </div>
            <div className="ml-auto text-xs text-slate-500">
              {filtered.length} of {readers.length} shown
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex flex-wrap items-center gap-3 text-sm mb-3">
              <span className="font-medium text-indigo-800">{selectedIds.size} selected</span>
              <select
                value={bulkStatus}
                onChange={e => setBulkStatus(e.target.value as ArcStatus)}
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm bg-white"
              >
                <option value="">Change status to…</option>
                {STATUS_ORDER.map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
              <button
                onClick={applyBulk}
                disabled={!bulkStatus || saving}
                className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded-lg"
              >
                Apply
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg ml-auto"
              >
                Clear selection
              </button>
            </div>
          )}

          {filtered.length === 0 ? (
            <EmptyState
              hasAny={readers.length > 0}
              onAdd={() => setView({ mode: 'new' })}
              onImport={() => setView({ mode: 'list', tab: 'import' })}
            />
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="overflow-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 font-medium sticky top-0">
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
                      <th className="px-3 py-2">Awaiting</th>
                      <th className="px-3 py-2 whitespace-nowrap">Opt-ins</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map(r => (
                      <tr
                        key={r.id}
                        className={`hover:bg-slate-50 cursor-pointer ${selectedIds.has(r.id) ? 'bg-indigo-50/50' : ''}`}
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
                          <div className="font-medium text-slate-800">{r.name}</div>
                          {r.email && <div className="text-xs text-slate-500 truncate max-w-[16rem]">{r.email}</div>}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[r.status]}`}>
                            {STATUS_LABELS[r.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2"><BookCount count={r.received.length} /></td>
                        <td className="px-3 py-2"><BookCount count={r.reviewed.length} /></td>
                        <td className="px-3 py-2"><BookCount count={r.awaiting_review_for.length} /></td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 text-slate-500">
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

function BookCount({ count }: { count: number }) {
  if (count === 0) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-700">
      <BookOpen className="w-3.5 h-3.5 text-slate-400" /> {count}
    </span>
  );
}

function EmptyState({
  hasAny, onAdd, onImport,
}: { hasAny: boolean; onAdd: () => void; onImport: () => void }) {
  return (
    <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300">
      <Users className="w-10 h-10 text-pink-400 mx-auto mb-3" />
      <h3 className="text-lg font-semibold text-slate-800 mb-1">
        {hasAny ? 'No readers match these filters' : 'No ARC readers yet'}
      </h3>
      <p className="text-sm text-slate-500 mb-5 max-w-sm mx-auto">
        {hasAny
          ? 'Try clearing the search or changing the status filter.'
          : 'Import your Notion ARC database, or add readers one at a time.'}
      </p>
      {!hasAny && (
        <div className="inline-flex gap-2">
          <button onClick={onAdd} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg">
            <Plus className="w-4 h-4" /> Add reader
          </button>
          <button onClick={onImport} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg">
            Import from Notion
          </button>
        </div>
      )}
    </div>
  );
}
