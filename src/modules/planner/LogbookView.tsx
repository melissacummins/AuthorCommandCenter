import { useMemo, useState } from 'react';
import { BookCheck, Search, RotateCcw, Trash2, Clock } from 'lucide-react';
import { formatMinutes, localDay, type PlannerNote, type PlannerTask } from './types';

// A full, searchable history of finished to-dos, grouped by the day they were
// completed (newest first). This is where completed to-dos live once they leave
// the smart views — including "loose" ones that were never in a list.
export default function LogbookView({
  tasks, notesById, today, onPatch, onDelete,
}: {
  tasks: PlannerTask[];
  notesById: Record<string, PlannerNote>;
  today: string;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState('');

  const done = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks
      .filter(t => t.kind === 'task' && t.done && t.done_at)
      .filter(t => !q || t.title.toLowerCase().includes(q))
      .sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''));
  }, [tasks, query]);

  // Group into [day, items] pairs, newest day first.
  const groups = useMemo(() => {
    const by: Record<string, PlannerTask[]> = {};
    for (const t of done) (by[localDay(t.done_at!)] ??= []).push(t);
    return Object.entries(by).sort((a, b) => b[0].localeCompare(a[0]));
  }, [done]);

  const totalTracked = useMemo(() => done.reduce((s, t) => s + (t.actual_minutes ?? 0), 0), [done]);

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <BookCheck className="w-6 h-6 text-emerald-500" />
        <h2 className="text-2xl font-bold text-slate-800">Logbook</h2>
      </div>
      <p className="text-sm text-slate-400 mb-5">
        {done.length} completed {done.length === 1 ? 'to-do' : 'to-dos'}
        {totalTracked > 0 && <> · {formatMinutes(totalTracked)} tracked</>}
      </p>

      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 mb-6">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search completed to-dos…"
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400 text-slate-700"
        />
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
          {query ? 'Nothing matches that search.' : 'Nothing completed yet. Check a to-do off and it’ll land here.'}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([day, items]) => (
            <div key={day}>
              <div className="flex items-baseline gap-2 mb-2">
                <h3 className="text-sm font-semibold text-slate-700">{dayLabel(day, today)}</h3>
                <span className="text-xs text-slate-400">{items.length} done</span>
              </div>
              <ul className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
                {items.map(t => {
                  const list = t.note_id ? notesById[t.note_id] : undefined;
                  return (
                    <li key={t.id} className="flex items-center gap-2 px-4 py-2 group">
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white shrink-0">
                        <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 6.5l2.5 2.5 4.5-5" /></svg>
                      </span>
                      <span className="flex-1 text-sm text-slate-600 truncate">{t.title || 'Untitled'}</span>
                      {list && <span className="text-xs text-slate-400 truncate max-w-[10rem] shrink-0">{list.title.trim() || 'Untitled list'}</span>}
                      {t.actual_minutes > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-500 shrink-0" title="Time tracked">
                          <Clock className="w-3 h-3" />{formatMinutes(t.actual_minutes)}
                        </span>
                      )}
                      {t.estimate_minutes ? <span className="text-xs text-slate-300 shrink-0" title="Estimate">~{formatMinutes(t.estimate_minutes)}</span> : null}
                      <span className="text-xs text-slate-400 w-16 text-right shrink-0">{timeLabel(t.done_at!)}</span>
                      <button
                        onClick={() => onPatch(t.id, { done: false })}
                        className="text-slate-300 hover:text-teal-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title="Mark not done (move back to your lists)"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(t.id)}
                        className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title="Delete permanently"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  const d = new Date(day + 'T00:00:00');
  const yest = new Date(today + 'T00:00:00'); yest.setDate(yest.getDate() - 1);
  if (d.getTime() === yest.getTime()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function timeLabel(ts: string): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
