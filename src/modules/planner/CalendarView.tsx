import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, CalendarDays, Plus, X, ExternalLink, Check, Circle, Link2Off,
} from 'lucide-react';
import type { UseGoogleCalendar } from './useGoogleCalendar';
import type { GCalEvent } from './google';
import { formatMinutes, type PlannerTask } from './types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Local YYYY-MM-DD for a Date.
function isoLocal(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// 42-cell (6-week) grid starting on the Sunday on/before the 1st of the month.
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function timeLabel(ev: GCalEvent): string {
  if (ev.start?.date) return 'All day';
  if (!ev.start?.dateTime) return '';
  return new Date(ev.start.dateTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function CalendarView({
  tasks, today, onPatch, cal,
}: {
  tasks: PlannerTask[];
  today: string;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  cal: {
    gc: UseGoogleCalendar;
    calVersion: number;
    onTimeBlock: (task: PlannerTask, time: string) => void;
    onUnblock: (task: PlannerTask) => void;
  };
}) {
  const { gc, calVersion, onTimeBlock, onUnblock } = cal;
  const [cursor, setCursor] = useState(() => { const d = new Date(today + 'T00:00:00'); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [selected, setSelected] = useState(today);
  const [events, setEvents] = useState<GCalEvent[]>([]);
  const [scheduling, setScheduling] = useState<{ taskId: string; time: string } | null>(null);

  // Which days in view have scheduled to-dos (for the dots on the grid).
  const tasksByDay = useMemo(() => {
    const m: Record<string, PlannerTask[]> = {};
    for (const t of tasks) {
      if (t.kind !== 'task' || t.done || !t.due_date) continue;
      (m[t.due_date] ??= []).push(t);
    }
    return m;
  }, [tasks]);

  // Load the selected day's Google events. Extracted so we can re-run it right
  // after adding/removing a time block (otherwise the new event wouldn't show
  // until the day or calendar changed).
  const loadEvents = useCallback(async () => {
    if (!gc.connected || !gc.calendarId) { setEvents([]); return; }
    const start = new Date(selected + 'T00:00:00');
    const end = new Date(start); end.setDate(start.getDate() + 1);
    const evs = await gc.fetchEvents(start.toISOString(), end.toISOString());
    setEvents(evs);
    // calVersion is included so a time block added from a list view also
    // refreshes this day panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, gc.connected, gc.calendarId, gc.fetchEvents, calVersion]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const grid = monthGrid(cursor.y, cursor.m);
  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const dayTasks = tasksByDay[selected] ?? [];

  function shiftMonth(delta: number) {
    setCursor(c => { const d = new Date(c.y, c.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  }

  // Time-blocking is handled by the shared bridge (so the Calendar tab and the
  // list views stay consistent); the day panel refreshes via calVersion.
  function addToCalendar(task: PlannerTask, time: string) {
    onTimeBlock(task, time);
    setScheduling(null);
  }

  function removeFromCalendar(task: PlannerTask) {
    onUnblock(task);
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <CalendarDays className="w-6 h-6 text-sky-500" />
        <h2 className="text-2xl font-bold text-slate-800">Calendar</h2>
        <div className="ml-auto">
          <ConnectionControls gc={gc} />
        </div>
      </div>

      {gc.error && (
        <div className="mb-4 flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2">
          <span className="flex-1">{gc.error}</span>
          <button onClick={() => gc.setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {!gc.configured && <NotConfiguredCard />}

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6">
        {/* Month grid */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-semibold text-slate-700">{monthName}</span>
            <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map(w => <div key={w} className="text-center text-[10px] font-semibold uppercase text-slate-400">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {grid.map(d => {
              const iso = isoLocal(d);
              const inMonth = d.getMonth() === cursor.m;
              const isToday = iso === today;
              const isSel = iso === selected;
              const count = (tasksByDay[iso] ?? []).length;
              return (
                <button
                  key={iso}
                  onClick={() => setSelected(iso)}
                  className={`relative aspect-square rounded-lg text-sm flex items-center justify-center transition-colors
                    ${isSel ? 'bg-teal-600 text-white font-semibold' : isToday ? 'bg-teal-50 text-teal-700 font-semibold' : inMonth ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 hover:bg-slate-50'}`}
                >
                  {d.getDate()}
                  {count > 0 && (
                    <span className={`absolute bottom-1 w-1 h-1 rounded-full ${isSel ? 'bg-white' : 'bg-teal-500'}`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected day */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-bold text-slate-700 mb-3">
            {new Date(selected + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </h3>

          {/* Google events */}
          {gc.connected && (
            <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">On your calendar</p>
              {events.length === 0 ? (
                <p className="text-sm text-slate-400">No events.</p>
              ) : (
                <ul className="space-y-1">
                  {events.map(ev => (
                    <li key={ev.id} className="flex items-center gap-2 text-sm">
                      <span className="text-xs font-medium text-slate-400 w-16 shrink-0">{timeLabel(ev)}</span>
                      <span className="flex-1 text-slate-600 truncate">{ev.summary || '(no title)'}</span>
                      {ev.htmlLink && (
                        <a href={ev.htmlLink} target="_blank" rel="noreferrer" className="text-slate-300 hover:text-sky-500"><ExternalLink className="w-3.5 h-3.5" /></a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* To-dos scheduled for this day */}
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">To-dos</p>
          {dayTasks.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing scheduled.</p>
          ) : (
            <ul className="space-y-1">
              {dayTasks.map(t => (
                <li key={t.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <button onClick={() => onPatch(t.id, { done: true })} className="text-slate-300 hover:text-teal-600 shrink-0"><Circle className="w-4 h-4" /></button>
                    <span className="flex-1 text-slate-700 truncate">{t.title}</span>
                    {t.estimate_minutes ? <span className="text-xs text-slate-400">{formatMinutes(t.estimate_minutes)}</span> : null}
                    {t.gcal_event_id ? (
                      <button onClick={() => removeFromCalendar(t)} className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-rose-500" title="Remove time block">
                        <Check className="w-3.5 h-3.5" />
                        {t.start_at && new Date(t.start_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        <Link2Off className="w-3.5 h-3.5" />
                      </button>
                    ) : gc.connected ? (
                      <button
                        onClick={() => setScheduling({ taskId: t.id, time: '09:00' })}
                        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-teal-600"
                        title="Add to calendar as a time block"
                      >
                        <Plus className="w-3.5 h-3.5" /> Time block
                      </button>
                    ) : null}
                  </div>
                  {scheduling?.taskId === t.id && (
                    <div className="flex items-center gap-2 mt-1 ml-6">
                      <input
                        type="time"
                        value={scheduling.time}
                        onChange={e => setScheduling({ taskId: t.id, time: e.target.value })}
                        className="text-sm border border-slate-200 rounded px-2 py-1"
                      />
                      <span className="text-xs text-slate-400">for {formatMinutes(t.estimate_minutes ?? 30)}</span>
                      <button onClick={() => addToCalendar(t, scheduling.time)} className="text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded px-2 py-1">Add</button>
                      <button onClick={() => setScheduling(null)} className="text-xs text-slate-400">Cancel</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectionControls({ gc }: { gc: UseGoogleCalendar }) {
  if (!gc.configured) return null;
  if (!gc.connected) {
    return (
      <button
        onClick={gc.connect}
        disabled={gc.busy}
        className="inline-flex items-center gap-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg px-3 py-1.5 disabled:opacity-60"
      >
        <CalendarDays className="w-4 h-4" /> {gc.busy ? 'Connecting…' : 'Connect Google Calendar'}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <select
        value={gc.calendarId}
        onChange={e => gc.chooseCalendar(e.target.value)}
        className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 max-w-[12rem]"
      >
        {gc.calendars.map(c => <option key={c.id} value={c.id}>{c.summary}</option>)}
      </select>
      <button onClick={gc.disconnect} className="text-xs text-slate-400 hover:text-rose-500">Disconnect</button>
    </div>
  );
}

function NotConfiguredCard() {
  return (
    <div className="mb-6 bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-200 rounded-2xl p-5">
      <h3 className="font-semibold text-sky-800 mb-1 flex items-center gap-2"><CalendarDays className="w-4 h-4" /> Connect your Google Calendar</h3>
      <p className="text-sm text-sky-700 leading-relaxed">
        Calendar sync is built and ready — it just needs a one-time Google sign-in key (a free OAuth
        client ID) added as <code className="bg-white/60 px-1 rounded">VITE_GOOGLE_CLIENT_ID</code>.
        Ask Claude for the step-by-step setup and you'll be able to see your events here and turn
        to-dos into time blocks (with reminders) — no extra app or subscription needed.
      </p>
    </div>
  );
}
