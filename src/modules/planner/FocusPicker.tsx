import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Play, X, Clock } from 'lucide-react';
import { formatMinutes, type PlannerNote, type PlannerTask } from './types';

// A quick search-and-start modal: pick any open to-do and start its timer,
// without scheduling it or hunting for its row first. The running timer then
// rides along in the floating bar.
export function FocusPicker({
  tasks, notesById, onStart, onClose,
}: {
  tasks: PlannerTask[];
  notesById: Record<string, PlannerNote>;
  onStart: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks
      .filter(t => t.kind === 'task' && !t.done && (!q || t.title.toLowerCase().includes(q)))
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
      .slice(0, 60);
  }, [tasks, query]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:pt-24 bg-black/30" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && items[0]) { onStart(items[0].id); onClose(); } }}
            placeholder="Search a to-do to focus on…"
            className="flex-1 text-sm outline-none placeholder:text-slate-400 text-slate-700"
          />
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0"><X className="w-4 h-4" /></button>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {items.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-slate-400">No matching to-dos.</li>
          ) : items.map(t => {
            const list = t.note_id ? notesById[t.note_id] : undefined;
            return (
              <li key={t.id}>
                <button
                  onClick={() => { onStart(t.id); onClose(); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-slate-50"
                >
                  <Play className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                  <span className="flex-1 truncate text-sm text-slate-700">{t.title || 'Untitled'}</span>
                  {list && <span className="text-xs text-slate-400 truncate max-w-[8rem] shrink-0">{list.title.trim() || 'Untitled list'}</span>}
                  {t.actual_minutes > 0 && (
                    <span className="text-xs text-slate-400 inline-flex items-center gap-0.5 shrink-0"><Clock className="w-3 h-3" />{formatMinutes(t.actual_minutes)}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
