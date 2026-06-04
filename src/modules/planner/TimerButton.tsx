import { useEffect, useState } from 'react';
import { Play, Square } from 'lucide-react';
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
      ? <span className="text-xs font-medium text-slate-400 shrink-0">{formatMinutes(base)}</span>
      : null;
  }

  const sessionMs = running ? Math.max(0, Date.now() - new Date(task.timer_started_at!).getTime()) : 0;

  function toggle() {
    if (running) onPatch(task.id, { actual_minutes: base + Math.round(sessionMs / 60_000), timer_started_at: null });
    else onPatch(task.id, { timer_started_at: new Date().toISOString() });
  }

  return (
    <button
      onClick={toggle}
      title={running ? 'Stop timer' : base > 0 ? `Resume timer · ${formatMinutes(base)} tracked` : 'Start timer'}
      className={`inline-flex items-center gap-1 text-xs font-medium shrink-0 ${
        running ? 'text-rose-600' : base > 0 ? 'text-slate-500 hover:text-teal-600' : 'text-slate-300 hover:text-teal-600'
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

// "1:02:09" / "7:09" — live stopwatch from milliseconds.
function formatStopwatch(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}
