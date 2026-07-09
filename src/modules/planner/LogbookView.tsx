import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { BookCheck, Search, RotateCcw, Trash2, Clock, Check } from 'lucide-react';
import {
  formatMinutes, reviewDays,
  type PlannerNote, type PlannerTask, type PlannerTimeSession,
  type ReviewDay, type ReviewEntry, type ReviewEntrySession,
} from './types';

// The daily review — one place to see "what did I actually do." For each day it
// lists every to-do you COMPLETED or LOGGED TIME on, with the hours worked, the
// timer ranges (timesheet-style), and whether it was finished that day. A day's
// totals here come from the same fields Stats uses (completions by done_at,
// time by the session log), so the two always agree. Click any to-do to open it.
export default function LogbookView({
  tasks, sessions, notesById, today, focus, onPatch, onDelete, onOpenList, onOpenDay,
}: {
  tasks: PlannerTask[];
  sessions: PlannerTimeSession[];
  notesById: Record<string, PlannerNote>;
  today: string;
  // A nudge (from Stats) to scroll to and highlight a specific day.
  focus?: { iso: string; n: number };
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  onOpenList: (noteId: string) => void;
  onOpenDay: (iso: string) => void;
}) {
  const [query, setQuery] = useState('');

  const allDays = useMemo(() => reviewDays(tasks, sessions), [tasks, sessions]);

  // Search filters to days that still have a matching to-do.
  const days = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allDays;
    return allDays
      .map(d => ({ ...d, entries: d.entries.filter(e => e.task.title.toLowerCase().includes(q)) }))
      .filter(d => d.entries.length > 0);
  }, [allDays, query]);

  const totals = useMemo(() => {
    let completed = 0, minutes = 0;
    for (const d of allDays) { completed += d.completedCount; minutes += d.totalMinutes; }
    return { completed, minutes };
  }, [allDays]);

  // Scroll to (and briefly ring) a day when Stats sends us here.
  const dayRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  useEffect(() => {
    if (!focus || !focus.n) return;
    const has = allDays.some(d => d.day === focus.iso);
    setMissing(has ? null : focus.iso);
    setFlash(has ? focus.iso : null);
    if (has) {
      dayRefs.current[focus.iso]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const t = setTimeout(() => setFlash(null), 1600);
      return () => clearTimeout(t);
    }
  }, [focus, allDays]);

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <BookCheck className="w-6 h-6 text-emerald-500" />
        <h2 className="text-2xl font-bold text-slate-800">Logbook</h2>
      </div>
      <p className="text-sm text-slate-400 mb-5">
        What you’ve completed or tracked, by day
        {totals.completed > 0 && <> · {totals.completed} done</>}
        {totals.minutes > 0 && <> · {formatMinutes(totals.minutes)} tracked</>}
      </p>

      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 mb-6">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search what you worked on…"
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400 text-slate-700"
        />
      </div>

      {missing && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          Nothing was completed or tracked on <span className="font-medium text-slate-700">{dayLabel(missing, today)}</span>.
          Only work you check off or run a timer on shows up here.
        </div>
      )}

      {days.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
          {query ? 'Nothing matches that search.' : 'Nothing yet. Check a to-do off — or track time on one — and it’ll land here.'}
        </div>
      ) : (
        <div className="space-y-6">
          {days.map(day => (
            <DayCard
              key={day.day}
              ref={el => { dayRefs.current[day.day] = el; }}
              day={day}
              today={today}
              flash={flash === day.day}
              notesById={notesById}
              onPatch={onPatch}
              onDelete={onDelete}
              onOpenList={onOpenList}
              onOpenDay={onOpenDay}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const DayCard = forwardRef<HTMLDivElement, {
  day: ReviewDay;
  today: string;
  flash: boolean;
  notesById: Record<string, PlannerNote>;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  onOpenList: (noteId: string) => void;
  onOpenDay: (iso: string) => void;
}>(function DayCard({ day, today, flash, notesById, onPatch, onDelete, onOpenList, onOpenDay }, ref) {
  return (
    <div ref={ref} className={`scroll-mt-4 rounded-2xl transition-shadow ${flash ? 'ring-2 ring-teal-400 ring-offset-2' : ''}`}>
      <div className="flex items-baseline gap-2 mb-2">
        <h3 className="text-sm font-semibold text-slate-700">{dayLabel(day.day, today)}</h3>
        {day.completedCount > 0 && <span className="text-xs text-slate-400">{day.completedCount} done</span>}
        {day.totalMinutes > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-slate-500" title="Time tracked this day">
            <Clock className="w-3.5 h-3.5" /> {formatMinutes(day.totalMinutes)}
          </span>
        )}
      </div>
      <ul className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        {day.entries.map(e => (
          <EntryRow
            key={e.task.id}
            entry={e}
            day={day.day}
            listName={e.task.note_id ? (notesById[e.task.note_id]?.title.trim() || 'Untitled list') : undefined}
            // Open where the to-do actually lives: its list, else the day it's
            // scheduled on (not the day it happened to be worked, which may be
            // different and would land on an empty My Day).
            onOpen={() => (e.task.note_id ? onOpenList(e.task.note_id) : onOpenDay(e.task.due_date ?? day.day))}
            onPatch={onPatch}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </div>
  );
});

function EntryRow({
  entry, day, listName, onOpen, onPatch, onDelete,
}: {
  entry: ReviewEntry;
  day: string;
  listName?: string;
  onOpen: () => void;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
}) {
  const { task, minutes, completedToday, sessions } = entry;
  return (
    <li className="flex items-center gap-2 px-4 py-2 group">
      {/* Completed that day → green check; worked but not finished → hollow clock. */}
      {completedToday ? (
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white shrink-0" title="Completed this day">
          <Check className="w-2.5 h-2.5" strokeWidth={3} />
        </span>
      ) : (
        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-amber-400 text-amber-500 shrink-0" title="Worked on, not finished">
          <Clock className="w-2.5 h-2.5" />
        </span>
      )}

      <button
        onClick={onOpen}
        className="flex-1 min-w-0 text-left text-sm text-slate-600 truncate hover:text-teal-600 transition-colors"
        title="Open this to-do"
      >
        {task.title || 'Untitled'}
      </button>

      {listName && <span className="text-xs text-slate-400 truncate max-w-[9rem] shrink-0">{listName}</span>}

      {/* Timesheet detail: the timer ranges worked this day. */}
      {sessions.length > 0 && (
        <span className="text-xs text-slate-400 shrink-0" title="When you worked on it">
          {sessions.length === 1 ? rangeLabel(sessions[0]) : `${sessions.length} sessions`}
        </span>
      )}

      {minutes > 0 && (
        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-500 shrink-0" title="Time tracked this day">
          <Clock className="w-3 h-3" />{formatMinutes(minutes)}
        </span>
      )}
      {!minutes && task.estimate_minutes ? (
        <span className="text-xs text-slate-300 shrink-0" title="Estimate (no time tracked)">~{formatMinutes(task.estimate_minutes)}</span>
      ) : null}

      {/* Uncomplete / delete only make sense for to-dos finished this day. */}
      {completedToday ? (
        <>
          <button
            onClick={() => onPatch(task.id, { done: false })}
            className="text-slate-300 hover:text-teal-600 opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity shrink-0"
            title="Mark not done (move back to your lists)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(task.id)}
            className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity shrink-0"
            title="Delete permanently"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </>
      ) : (
        <span className="text-[10px] uppercase tracking-wide text-amber-500/80 shrink-0" title={`Tracked on ${day}, not completed`}>worked</span>
      )}
    </li>
  );
}

function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  const d = new Date(day + 'T00:00:00');
  const yest = new Date(today + 'T00:00:00'); yest.setDate(yest.getDate() - 1);
  if (d.getTime() === yest.getTime()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

// "2:22–4:16 AM" — the timer run's start–end, like a timesheet entry.
function rangeLabel(s: ReviewEntrySession): string {
  const f = (ts: string) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${f(s.started_at)}–${f(s.ended_at)}`;
}
