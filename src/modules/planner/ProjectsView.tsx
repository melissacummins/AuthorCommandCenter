import { useMemo, useState } from 'react';
import { LayoutGrid, Star, Clock, ArrowUp, ArrowDown } from 'lucide-react';
import { formatMinutes, type PlannerNote, type PlannerTask, type PlannerTimeSession } from './types';

// Project Overview: every list is a "project", shown as a progress ring (done vs
// total) so you can see at a glance what's moving, what's stalled, and what still
// has the most to do. Click a card to open that list. Progress counts only
// to-dos (headings are ignored); a list with no to-dos yet reads as "empty".
type Row = {
  note: PlannerNote;
  total: number;
  done: number;
  open: number;
  pct: number;
  flaggedOpen: number;
  trackedMinutes: number;
};

type SortKey = 'todo' | 'progress' | 'name';

export default function ProjectsView({
  notes, tasks, sessions, onOpenList,
}: {
  notes: PlannerNote[];
  tasks: PlannerTask[];
  sessions: PlannerTimeSession[];
  onOpenList: (noteId: string) => void;
}) {
  const [sort, setSort] = useState<SortKey>('todo');
  // Direction: 'desc' = most-to-do / highest-progress / Z–A; 'asc' = the reverse.
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  // Click the active sort to flip its direction; a new sort starts at its
  // natural default (A–Z ascending, everything else most/highest first).
  function pickSort(k: SortKey) {
    if (k === sort) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(k); setDir(k === 'name' ? 'asc' : 'desc'); }
  }

  const rows = useMemo<Row[]>(() => {
    // Minutes tracked, per to-do, so a list can roll up its worked time.
    const minutesByTask: Record<string, number> = {};
    for (const s of sessions) minutesByTask[s.task_id] = (minutesByTask[s.task_id] ?? 0) + s.minutes;

    const byNote: Record<string, PlannerTask[]> = {};
    for (const t of tasks) {
      if (t.kind !== 'task' || !t.note_id) continue;
      (byNote[t.note_id] ??= []).push(t);
    }
    return notes.map(note => {
      const items = byNote[note.id] ?? [];
      const total = items.length;
      const done = items.filter(t => t.done).length;
      const open = total - done;
      const flaggedOpen = items.filter(t => !t.done && t.flagged).length;
      const trackedMinutes = items.reduce((m, t) => m + (minutesByTask[t.id] ?? 0), 0);
      return { note, total, done, open, pct: total ? Math.round((done / total) * 100) : 0, flaggedOpen, trackedMinutes };
    });
  }, [notes, tasks, sessions]);

  const sorted = useMemo(() => {
    const r = [...rows];
    // Base comparators are ascending (least / lowest / A–Z); 'desc' reverses.
    const cmp = sort === 'name'
      ? (a: Row, b: Row) => (a.note.title || '').localeCompare(b.note.title || '')
      : sort === 'progress'
        ? (a: Row, b: Row) => (a.pct - b.pct) || (a.open - b.open)
        : (a: Row, b: Row) => (a.open - b.open) || (a.total - b.total) || (a.note.title || '').localeCompare(b.note.title || '');
    r.sort(cmp);
    if (dir === 'desc') r.reverse();
    return r;
  }, [rows, sort, dir]);

  const totals = useMemo(() => {
    let total = 0, done = 0;
    for (const r of rows) { total += r.total; done += r.done; }
    return { projects: rows.length, total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [rows]);

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <LayoutGrid className="w-6 h-6 text-brand-500" />
        <h2 className="text-2xl font-bold text-content">Lists Progress</h2>
      </div>
      <p className="text-sm text-content-muted mb-5">
        Each list's progress — how far along it is, and what still needs you.
        {totals.total > 0 && <> · {totals.done}/{totals.total} to-dos done ({totals.pct}%) across {totals.projects} list{totals.projects === 1 ? '' : 's'}</>}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-edge p-10 text-center text-sm text-content-muted">
          No lists yet. Create a list and its progress will show up here.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 mb-4">
            <span className="text-xs text-content-muted mr-1">Sort</span>
            {([['todo', 'To do'], ['progress', 'Progress'], ['name', 'Name']] as [SortKey, string][]).map(([k, label]) => (
              <button
                key={k}
                onClick={() => pickSort(k)}
                title={sort === k ? 'Click to reverse the order' : `Sort by ${label.toLowerCase()}`}
                className={`inline-flex items-center gap-1 text-xs font-medium rounded-control px-2.5 py-1 transition-colors ${sort === k ? 'bg-brand-600 text-brand-fg' : 'text-content-secondary hover:bg-surface-sunken'}`}
              >
                {label}
                {sort === k && (dir === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sorted.map(r => (
              <button
                key={r.note.id}
                onClick={() => onOpenList(r.note.id)}
                className="rounded-card border border-edge bg-surface hover:border-brand-300 hover:shadow-sm transition-all p-4 flex flex-col items-center text-center"
                title={`Open ${r.note.title || 'Untitled list'}`}
              >
                <Ring pct={r.pct} empty={r.total === 0} />
                <span className="mt-3 text-sm font-semibold text-content break-words leading-snug line-clamp-2">{r.note.title || 'Untitled list'}</span>
                <span className="mt-1 text-[11px] text-content-muted">
                  {r.total === 0 ? 'No to-dos yet' : r.open === 0 ? `All ${r.total} done` : `${r.open} left · ${r.done}/${r.total} done`}
                </span>
                <span className="mt-1.5 flex items-center gap-2 text-[11px] text-content-muted min-h-[1rem]">
                  {r.flaggedOpen > 0 && <span className="inline-flex items-center gap-0.5 text-amber-500"><Star className="w-3 h-3" fill="currentColor" />{r.flaggedOpen}</span>}
                  {r.trackedMinutes > 0 && <span className="inline-flex items-center gap-0.5"><Clock className="w-3 h-3" />{formatMinutes(r.trackedMinutes)}</span>}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// A progress donut. Color shifts from amber (just started) through brand (mid)
// to emerald (done); an empty project reads as a faint dashed placeholder.
function Ring({ pct, empty }: { pct: number; empty: boolean }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const color = empty ? 'var(--edge, #cbd5e1)' : pct >= 100 ? '#10b981' : pct >= 50 ? '#14b8a6' : pct > 0 ? '#f59e0b' : '#f43f5e';
  return (
    <div className="relative w-[86px] h-[86px]">
      <svg viewBox="0 0 68 68" className="w-full h-full -rotate-90">
        <circle cx="34" cy="34" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-edge-soft" strokeDasharray={empty ? '3 4' : undefined} />
        {!empty && (
          <circle cx="34" cy="34" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-base font-bold text-content">
        {empty ? '—' : `${pct}%`}
      </span>
    </div>
  );
}
