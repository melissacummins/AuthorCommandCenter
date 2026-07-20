import { useEffect, useState } from 'react';
import { Play, Square, Plus } from 'lucide-react';
import { formatMinutes, type PlannerTask } from './types';

// Start/stop time tracker for a single to-do. Routes through onPatch so the
// central handler can enforce "one timer at a time" and bank time on complete:
//   start → { timer_started_at: now }
//   stop  → { actual_minutes: banked + elapsed, timer_started_at: null }
// While running it ticks once a second and counts up live (banked + session).
// Hidden until row-hover when there's nothing to show; always visible once
// there's tracked time or a run in progress. Lives in a `group` row.
export function TimerButton({
  task, onPatch,
}: {
  task: PlannerTask;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
}) {
  const running = !!task.timer_started_at;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const base = task.actual_minutes ?? 0;

  // Completed to-dos just show their tracked time (no controls).
  if (task.done) {
    return base > 0
      ? <span className="text-xs font-medium text-content-muted shrink-0">{formatMinutes(base)}</span>
      : null;
  }

  const sessionMs = running ? Math.max(0, Date.now() - new Date(task.timer_started_at!).getTime()) : 0;

  function toggle() {
    if (running) onPatch(task.id, stopTimerPatch(task));
    else onPatch(task.id, { timer_started_at: new Date().toISOString() });
  }

  return (
    <button
      onClick={toggle}
      title={running ? 'Stop timer' : base > 0 ? `Resume timer · ${formatMinutes(base)} tracked` : 'Start timer'}
      className={`inline-flex items-center gap-1 text-xs font-medium shrink-0 ${
        running ? 'text-rose-600' : base > 0 ? 'text-content-secondary hover:text-teal-600' : 'text-content-faint hover:text-teal-600'
      }`}
    >
      {running
        ? <span className="relative flex w-3.5 h-3.5 items-center justify-center"><Square className="w-3 h-3 fill-current" /></span>
        : <Play className="w-3.5 h-3.5" />}
      {running
        ? <span className="tabular-nums">{formatStopwatch(base * 60_000 + sessionMs)}</span>
        : base > 0 ? <span>{formatMinutes(base)}</span> : null}
    </button>
  );
}

// The patch that stops a running timer: bank the elapsed minutes into the
// to-do's running total and clear the active run. (patchTask additionally logs
// a session row off the timer_started_at → null transition.)
export function stopTimerPatch(task: PlannerTask): Partial<PlannerTask> {
  const add = task.timer_started_at
    ? Math.max(0, Math.round((Date.now() - new Date(task.timer_started_at).getTime()) / 60_000))
    : 0;
  return { actual_minutes: (task.actual_minutes ?? 0) + add, timer_started_at: null };
}

// A floating control shown across the planner while a timer is running, so it
// can be stopped (or its to-do opened / pulled into today) from anywhere.
export function RunningTimerBar({
  task, onStop, onOpen, onAddToday, inToday,
}: {
  task: PlannerTask;
  onStop: () => void;
  onOpen: () => void;
  onAddToday: () => void;
  inToday: boolean;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = task.timer_started_at ? Math.max(0, Date.now() - new Date(task.timer_started_at).getTime()) : 0;
  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-3 bg-slate-900 text-white rounded-full shadow-xl pl-4 pr-2 py-2 max-w-[min(92vw,24rem)]">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
      </span>
      <button onClick={onOpen} className="flex-1 min-w-0 text-left truncate text-sm font-medium hover:underline" title="Open this to-do">
        {task.title || 'Untitled'}
      </button>
      <span className="tabular-nums text-sm text-[#cbd5e1] shrink-0">{formatStopwatch(ms)}</span>
      {!inToday && (
        <button
          onClick={onAddToday}
          className="shrink-0 inline-flex items-center gap-1 text-[#cbd5e1] hover:text-white text-xs font-medium px-1.5"
          title="Add to today"
        >
          <Plus className="w-3.5 h-3.5" /> Today
        </button>
      )}
      <button
        onClick={onStop}
        className="shrink-0 inline-flex items-center gap-1 bg-rose-500 hover:bg-rose-600 rounded-full px-3 py-1 text-xs font-semibold"
        title="Stop timer"
      >
        <Square className="w-3 h-3 fill-current" /> Stop
      </button>
    </div>
  );
}

// "1:02:09" / "7:09" — live stopwatch from milliseconds.
function formatStopwatch(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}
