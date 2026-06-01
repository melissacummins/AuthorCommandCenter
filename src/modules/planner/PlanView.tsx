import { useMemo, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addDaysISO, blockMinutes, dayRange, formatMinutes,
  type PlannerSettings, type PlannerTask, type PlannerTimeBlock,
} from './types';

// Local YYYY-MM-DD for a Date.
function isoOf(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// The Sunday on/before a given day.
function weekStart(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return addDaysISO(iso, -d.getDay());
}

// Plan a stretch of days at a glance: each day gets a capacity bar (planned vs
// your daily target) so you can see where the week/month is overloaded and
// where there's room — then click a day to open it in My Day.
//
// Capacity here counts time blocks + scheduled to-do estimates (a planning
// projection); it doesn't pull each day's Google events the way My Day does.
export default function PlanView({
  tasks, blocks, settings, today, onOpenDay,
}: {
  tasks: PlannerTask[];
  blocks: PlannerTimeBlock[];
  settings: PlannerSettings;
  today: string;
  onOpenDay: (iso: string) => void;
}) {
  const [range, setRange] = useState<'week' | 'month'>('week');
  // Anchor day inside the visible week/month; paged by prev/next.
  const [anchor, setAnchor] = useState(today);
  const target = settings.daily_capacity_minutes;

  const days = useMemo(() => {
    if (range === 'week') return dayRange(weekStart(anchor), 7);
    const d = new Date(anchor + 'T00:00:00');
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const count = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return dayRange(isoOf(first), count);
  }, [range, anchor]);

  // Planned minutes + open-task count for a single day.
  const dayInfo = useMemo(() => {
    const info: Record<string, { planned: number; count: number }> = {};
    for (const day of days) {
      const dayBlocks = blocks.filter(b => b.day === day);
      const dayTasks = tasks.filter(t => t.kind === 'task' && !t.done && t.due_date === day);
      let planned = 0;
      for (const b of dayBlocks) planned += blockMinutes(b, dayTasks.filter(t => t.block_id === b.id));
      for (const t of dayTasks) if (!t.block_id) planned += t.estimate_minutes ?? 0;
      info[day] = { planned, count: dayTasks.length };
    }
    return info;
  }, [days, tasks, blocks]);

  const totalPlanned = days.reduce((s, d) => s + (dayInfo[d]?.planned ?? 0), 0);

  function shift(dir: number) {
    setAnchor(a => range === 'week'
      ? addDaysISO(a, dir * 7)
      : isoOf(new Date(new Date(a + 'T00:00:00').getFullYear(), new Date(a + 'T00:00:00').getMonth() + dir, 1)));
  }

  const rangeLabel = range === 'week'
    ? (() => {
        const start = days[0], end = days[days.length - 1];
        const s = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00');
        return `${s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
      })()
    : new Date(anchor + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <CalendarRange className="w-6 h-6 text-sky-500" />
        <h2 className="text-2xl font-bold text-slate-800">Plan</h2>
        <div className="ml-auto inline-flex rounded-lg border border-slate-200 overflow-hidden">
          {(['week', 'month'] as const).map(r => (
            <button
              key={r}
              onClick={() => { setRange(r); setAnchor(today); }}
              className={`px-3 py-1.5 text-sm font-medium capitalize transition-colors ${range === r ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <button onClick={() => shift(-1)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><ChevronLeft className="w-5 h-5" /></button>
        <div className="text-center">
          <div className="text-sm font-semibold text-slate-700">{rangeLabel}</div>
          <div className="text-xs text-slate-400">{formatMinutes(totalPlanned) || '0m'} planned · {formatMinutes(target * days.length)} capacity</div>
        </div>
        <button onClick={() => shift(1)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><ChevronRight className="w-5 h-5" /></button>
      </div>

      <ul className="space-y-2">
        {days.map(day => {
          const { planned, count } = dayInfo[day] ?? { planned: 0, count: 0 };
          const pct = target > 0 ? Math.min(100, Math.round((planned / target) * 100)) : 0;
          const over = planned > target;
          const isToday = day === today;
          const d = new Date(day + 'T00:00:00');
          return (
            <li key={day}>
              <button
                onClick={() => onOpenDay(day)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors hover:bg-slate-50 ${
                  isToday ? 'border-teal-300 bg-teal-50/40' : 'border-slate-200'
                }`}
              >
                <div className="w-11 text-center shrink-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                  <div className={`text-xl font-bold leading-none ${isToday ? 'text-teal-700' : 'text-slate-800'}`}>{d.getDate()}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className={`font-medium ${over ? 'text-rose-600' : planned > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
                      {planned > 0 ? `${formatMinutes(planned)} planned` : 'Open'}
                      {over && ` · over by ${formatMinutes(planned - target)}`}
                    </span>
                    {count > 0 && <span className="text-slate-400">{count} {count === 1 ? 'task' : 'tasks'}</span>}
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${over ? 'bg-rose-500' : pct > 80 ? 'bg-amber-500' : 'bg-teal-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
