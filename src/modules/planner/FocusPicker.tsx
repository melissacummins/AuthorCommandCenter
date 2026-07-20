import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Play, X, Clock, Plus, Check, Orbit as OrbitIcon } from 'lucide-react';
import { formatMinutes, type PlannerNote, type PlannerTask } from './types';

const LOG_PRESETS = [15, 30, 45, 60, 90];

// A quick search-and-start modal: pick any open to-do and start its timer, or
// log time you already worked (forgot to start the timer) — without scheduling
// it or hunting for its row first.
export function FocusPicker({
  tasks, notesById, orbitEnabled = false, onStart, onLogTime, onClose,
}: {
  tasks: PlannerTask[];
  notesById: Record<string, PlannerNote>;
  orbitEnabled?: boolean;
  onStart: (id: string) => void;
  onLogTime: (id: string, minutes: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [logId, setLogId] = useState<string | null>(null);
  const [justLogged, setJustLogged] = useState<string | null>(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks
      .filter(t => t.kind === 'task' && !t.done && (!q || t.title.toLowerCase().includes(q)))
      .sort((a, b) =>
        // When Orbit is on, currently-relevant to-dos surface first.
        (orbitEnabled ? Number(b.in_orbit) - Number(a.in_orbit) : 0)
        || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
      .slice(0, 60);
  }, [tasks, query, orbitEnabled]);

  function log(id: string, minutes: number) {
    onLogTime(id, minutes);
    setLogId(null);
    setJustLogged(id);
    setTimeout(() => setJustLogged(j => (j === id ? null : j)), 1500);
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:pt-24 bg-black/30" onClick={onClose}>
      <div className="w-full max-w-lg bg-surface rounded-card shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-edge-soft">
          <Search className="w-4 h-4 text-content-muted shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && items[0]) { onStart(items[0].id); onClose(); } }}
            placeholder="Search a to-do to start or log time…"
            className="flex-1 text-sm outline-none placeholder:text-content-muted text-content"
          />
          <button onClick={onClose} className="text-content-muted hover:text-content-secondary shrink-0"><X className="w-4 h-4" /></button>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {items.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-content-muted">No matching to-dos.</li>
          ) : items.map(t => {
            const list = t.note_id ? notesById[t.note_id] : undefined;
            const logging = logId === t.id;
            return (
              <li key={t.id} className="px-2">
                <div className="flex items-center gap-2 px-2 py-2 rounded-control hover:bg-surface-hover">
                  <button onClick={() => { onStart(t.id); onClose(); }} className="flex items-center gap-2 flex-1 min-w-0 text-left" title="Start a timer">
                    <Play className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                    {orbitEnabled && t.in_orbit && <OrbitIcon className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                    <span className="flex-1 truncate text-sm text-content">{t.title || 'Untitled'}</span>
                  </button>
                  {list && <span className="text-xs text-content-muted truncate max-w-[7rem] shrink-0">{list.title.trim() || 'Untitled list'}</span>}
                  {t.actual_minutes > 0 && (
                    <span className="text-xs text-content-muted inline-flex items-center gap-0.5 shrink-0"><Clock className="w-3 h-3" />{formatMinutes(t.actual_minutes)}</span>
                  )}
                  {justLogged === t.id ? (
                    <span className="text-xs text-emerald-600 inline-flex items-center gap-0.5 shrink-0"><Check className="w-3.5 h-3.5" /> logged</span>
                  ) : (
                    <button
                      onClick={() => setLogId(logging ? null : t.id)}
                      className={`shrink-0 inline-flex items-center gap-0.5 text-xs rounded px-1.5 py-1 ${logging ? 'text-teal-600' : 'text-content-muted hover:text-teal-600'}`}
                      title="Log time you already worked"
                    >
                      <Plus className="w-3.5 h-3.5" /> log
                    </button>
                  )}
                </div>
                {logging && (
                  <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 pl-8">
                    {LOG_PRESETS.map(m => (
                      <button
                        key={m}
                        onClick={() => log(t.id, m)}
                        className="text-xs font-medium text-content-secondary border border-edge rounded-control px-2 py-1 hover:border-teal-400 hover:text-teal-600"
                      >
                        +{formatMinutes(m)}
                      </button>
                    ))}
                    <CustomLog onLog={m => log(t.id, m)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

function CustomLog({ onLog }: { onLog: (minutes: number) => void }) {
  const [value, setValue] = useState('');
  function submit() {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n > 0) { onLog(n); setValue(''); }
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min="1"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        placeholder="min"
        className="w-14 text-xs border border-edge rounded-control px-1.5 py-1 outline-none focus:border-teal-400"
      />
      <button onClick={submit} disabled={!value.trim()} className={`text-xs font-medium rounded-control px-2 py-1 ${value.trim() ? 'bg-teal-600 text-white hover:bg-teal-700' : 'text-content-faint'}`}>
        Log
      </button>
    </span>
  );
}
