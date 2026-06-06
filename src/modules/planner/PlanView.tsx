import { useMemo, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, Star, Clock } from 'lucide-react';
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent,
} from '@dnd-kit/core';
import {
  addDaysISO, blockMinutes, dayRange, formatMinutes,
  type PlannerNote, type PlannerSettings, type PlannerTask, type PlannerTimeBlock,
} from './types';

const WEEKS_SHOWN = 6;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Local YYYY-MM-DD for a Date.
function isoOf(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
// The Monday on/before a given day (ISO weeks).
function weekStartMon(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return addDaysISO(iso, -((d.getDay() + 6) % 7));
}
// ISO week number.
function isoWeek(iso: string): number {
  const d = new Date(iso + 'T00:00:00');
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3);
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  firstThu.setUTCDate(firstThu.getUTCDate() - ((firstThu.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((date.getTime() - firstThu.getTime()) / (7 * 86_400_000));
}

// Plan ahead by deciding what you'll work on in each week or month. Drag a
// to-do between weeks (or onto a day in month view) to reschedule it.
export default function PlanView({
  tasks, blocks, settings, notesById, today, onOpenDay, onPatch,
}: {
  tasks: PlannerTask[];
  blocks: PlannerTimeBlock[];
  settings: PlannerSettings;
  notesById: Record<string, PlannerNote>;
  today: string;
  onOpenDay: (iso: string) => void;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
}) {
  const [range, setRange] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(today);
  const target = settings.daily_capacity_minutes;

  // Open, scheduled to-dos grouped by their due day.
  const byDay = useMemo(() => {
    const m: Record<string, PlannerTask[]> = {};
    for (const t of tasks) {
      if (t.kind !== 'task' || t.done || t.someday || !t.due_date) continue;
      (m[t.due_date] ??= []).push(t);
    }
    return m;
  }, [tasks]);

  // Planned minutes for a day (time blocks + loose estimates), for the capacity hint.
  function plannedOn(day: string): number {
    const dayTasks = byDay[day] ?? [];
    let planned = 0;
    for (const b of blocks.filter(b => b.day === day)) planned += blockMinutes(b, dayTasks.filter(t => t.block_id === b.id));
    for (const t of dayTasks) if (!t.block_id) planned += t.estimate_minutes ?? 0;
    return planned;
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const id = String(active.id);
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const dest = String(over.id);
    let due: string;
    if (dest.startsWith('d:')) {
      due = dest.slice(2);
    } else if (dest.startsWith('w:')) {
      // Keep the weekday, just move into the dropped week.
      const wk = dest.slice(2);
      const offset = task.due_date ? (new Date(task.due_date + 'T00:00:00').getDay() + 6) % 7 : 0;
      due = addDaysISO(wk, offset);
    } else return;
    if (due !== task.due_date) onPatch(id, { due_date: due, someday: false, block_id: null });
  }

  function shift(dir: number) {
    setAnchor(a => range === 'week'
      ? addDaysISO(a, dir * 7 * WEEKS_SHOWN)
      : isoOf(new Date(new Date(a + 'T00:00:00').getFullYear(), new Date(a + 'T00:00:00').getMonth() + dir, 1)));
  }

  const weeks = useMemo(() => dayRange(weekStartMon(anchor), WEEKS_SHOWN * 7).filter((_, i) => i % 7 === 0), [anchor]);
  const monthGrid = useMemo(() => {
    const d = new Date(anchor + 'T00:00:00');
    const first = isoOf(new Date(d.getFullYear(), d.getMonth(), 1));
    return dayRange(weekStartMon(first), 42);
  }, [anchor]);
  const monthIndex = new Date(anchor + 'T00:00:00').getMonth();

  const rangeLabel = range === 'week'
    ? `${labelDate(weeks[0])} – ${labelDate(addDaysISO(weeks[weeks.length - 1], 6))}`
    : new Date(anchor + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <CalendarRange className="w-6 h-6 text-sky-500" />
        <h2 className="text-2xl font-bold text-slate-800">Planning</h2>
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
        <div className="text-sm font-semibold text-slate-700">{rangeLabel}</div>
        <button onClick={() => shift(1)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><ChevronRight className="w-5 h-5" /></button>
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {range === 'week' ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {weeks.map(wk => {
              const days = dayRange(wk, 7);
              const items = days.flatMap(d => byDay[d] ?? []);
              const planned = days.reduce((s, d) => s + plannedOn(d), 0);
              const capacity = target * 7;
              const over = planned > capacity;
              const isThisWeek = wk === weekStartMon(today);
              return (
                <WeekCard
                  key={wk}
                  weekStart={wk}
                  isThisWeek={isThisWeek}
                  items={items}
                  planned={planned}
                  over={over}
                  notesById={notesById}
                  today={today}
                  onOpenDay={onOpenDay}
                />
              );
            })}
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map(w => <div key={w} className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 text-center">{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthGrid.map(day => (
                <DayCell
                  key={day}
                  day={day}
                  inMonth={new Date(day + 'T00:00:00').getMonth() === monthIndex}
                  isToday={day === today}
                  items={byDay[day] ?? []}
                  over={plannedOn(day) > target}
                  onOpenDay={onOpenDay}
                />
              ))}
            </div>
          </div>
        )}
      </DndContext>
    </div>
  );
}

function labelDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function WeekCard({
  weekStart, isThisWeek, items, planned, over, notesById, today, onOpenDay,
}: {
  weekStart: string;
  isThisWeek: boolean;
  items: PlannerTask[];
  planned: number;
  over: boolean;
  notesById: Record<string, PlannerNote>;
  today: string;
  onOpenDay: (iso: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `w:${weekStart}` });
  const end = addDaysISO(weekStart, 6);
  return (
    <div
      ref={setNodeRef}
      className={`rounded-2xl border bg-white p-3 min-h-[9rem] flex flex-col transition-colors ${
        isOver ? 'border-teal-400 ring-2 ring-teal-100' : isThisWeek ? 'border-teal-300' : 'border-slate-200'
      }`}
    >
      <div className="flex items-baseline justify-between mb-2">
        <div className={`text-sm font-bold ${isThisWeek ? 'text-teal-700' : 'text-slate-700'}`}>
          Week {isoWeek(weekStart)}
          <span className="ml-1.5 text-xs font-medium text-slate-400">{labelDate(weekStart)} – {labelDate(end)}</span>
        </div>
        {planned > 0 && (
          <span className={`text-[11px] font-medium shrink-0 ${over ? 'text-rose-500' : 'text-slate-400'}`}>{formatMinutes(planned)}</span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-300 flex-1">Nothing planned. Drag a to-do here.</p>
      ) : (
        <ul className="space-y-1">
          {items.map(t => <TaskChip key={t.id} task={t} notesById={notesById} today={today} onOpenDay={onOpenDay} showDay />)}
        </ul>
      )}
    </div>
  );
}

function DayCell({
  day, inMonth, isToday, items, over, onOpenDay,
}: {
  day: string;
  inMonth: boolean;
  isToday: boolean;
  items: PlannerTask[];
  over: boolean;
  onOpenDay: (iso: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `d:${day}` });
  const shown = items.slice(0, 3);
  const extra = items.length - shown.length;
  return (
    <div
      ref={setNodeRef}
      onClick={() => onOpenDay(day)}
      className={`min-h-[5.5rem] rounded-lg border p-1.5 text-left cursor-pointer transition-colors ${
        isOver ? 'border-teal-400 ring-2 ring-teal-100 bg-teal-50/40'
          : isToday ? 'border-teal-300 bg-teal-50/30'
          : inMonth ? 'border-slate-200 hover:bg-slate-50' : 'border-slate-100 bg-slate-50/40'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-semibold ${isToday ? 'text-teal-700' : inMonth ? 'text-slate-600' : 'text-slate-300'}`}>
          {new Date(day + 'T00:00:00').getDate()}
        </span>
        {over && <span className="w-1.5 h-1.5 rounded-full bg-rose-400" title="Over capacity" />}
      </div>
      <div className="space-y-0.5">
        {shown.map(t => (
          <div
            key={t.id}
            onClick={e => { e.stopPropagation(); onOpenDay(day); }}
            className={`text-[11px] leading-tight truncate rounded px-1 py-0.5 ${t.flagged ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}
            title={t.title}
          >
            {t.title || 'Untitled'}
          </div>
        ))}
        {extra > 0 && <div className="text-[10px] text-slate-400 px-1">+{extra} more</div>}
      </div>
    </div>
  );
}

// A draggable to-do chip used in the week cards.
function TaskChip({
  task, notesById, today, onOpenDay, showDay,
}: {
  task: PlannerTask;
  notesById: Record<string, PlannerNote>;
  today: string;
  onOpenDay: (iso: string) => void;
  showDay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;
  const list = task.note_id ? notesById[task.note_id] : undefined;
  const overdue = !!task.due_date && task.due_date < today;
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => task.due_date && onOpenDay(task.due_date)}
      className={`group flex items-center gap-1.5 text-xs rounded-lg border border-slate-200 bg-white px-2 py-1 cursor-grab active:cursor-grabbing hover:border-slate-300 ${isDragging ? 'opacity-50 shadow-lg' : ''}`}
    >
      {task.flagged
        ? <Star className="w-3 h-3 text-amber-400 shrink-0" fill="currentColor" />
        : <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />}
      <span className="flex-1 truncate text-slate-700">{task.title || 'Untitled'}</span>
      {showDay && task.due_date && (
        <span className={`shrink-0 ${overdue ? 'text-rose-500' : 'text-slate-400'}`}>
          {new Date(task.due_date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' })}
        </span>
      )}
      {task.estimate_minutes ? <span className="text-slate-400 shrink-0 inline-flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{formatMinutes(task.estimate_minutes)}</span> : null}
      {list && <span className="text-slate-300 truncate max-w-[5rem] shrink-0">{list.title.trim() || 'list'}</span>}
    </li>
  );
}
