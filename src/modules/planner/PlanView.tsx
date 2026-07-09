import { useMemo, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, ChevronDown, Star, Clock, RotateCcw, Check, CalendarPlus } from 'lucide-react';
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent,
} from '@dnd-kit/core';
import {
  addDaysISO, blockMinutes, dayRange, formatMinutes,
  type PlannerNote, type PlannerSettings, type PlannerTask, type PlannerTimeBlock, type ResetSection,
} from './types';

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
  tasks, blocks, settings, notesById, today, onOpenDay, onOpenList, onPatch,
}: {
  tasks: PlannerTask[];
  blocks: PlannerTimeBlock[];
  settings: PlannerSettings;
  notesById: Record<string, PlannerNote>;
  today: string;
  onOpenDay: (iso: string) => void;
  // Open the list a to-do lives in (used to click into reset-tray items).
  onOpenList?: (noteId: string) => void;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
}) {
  const [range, setRange] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(today);
  const target = settings.daily_capacity_minutes;
  // Reset tray: whole-panel + per-section collapse (it can hold dozens of items,
  // so it's grouped and tidy rather than one big wall of chips).
  const [trayOpen, setTrayOpen] = useState(true);
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set<string>(['Priorities']));

  // Scheduled to-dos grouped by their due day — including completed ones, so a
  // day shows what you PLANNED and what you DID. Open to-dos sort before done.
  const byDay = useMemo(() => {
    const m: Record<string, PlannerTask[]> = {};
    for (const t of tasks) {
      if (t.kind !== 'task' || t.someday || !t.due_date) continue;
      (m[t.due_date] ??= []).push(t);
    }
    for (const day of Object.keys(m)) {
      m[day].sort((a, b) => (Number(a.done) - Number(b.done)) || (a.sort_order - b.sort_order));
    }
    return m;
  }, [tasks]);

  // To-dos captured from a Weekly Reset that aren't on a day yet — shown in a
  // tray you drag onto a day.
  const resetTray = useMemo(
    () => tasks.filter(t => t.kind === 'task' && !t.done && !t.someday && !t.due_date && !!t.reset_week),
    [tasks],
  );
  // Grouped by section for a readable, collapsible tray — priorities first.
  const traySections = useMemo(() => {
    const defs: { key: ResetSection; label: string; star?: boolean }[] = [
      { key: 'priorities', label: 'Priorities', star: true },
      { key: 'meetings', label: 'Meetings' },
      { key: 'quick', label: 'Quick tasks' },
      { key: 'feel_good', label: 'What would feel good' },
      { key: 'brain_dump', label: 'Brain dump' },
    ];
    const known = new Set(defs.map(d => d.key));
    const groups = defs
      .map(d => ({ ...d, items: resetTray.filter(t => t.reset_section === d.key) }))
      .filter(g => g.items.length);
    // Anything tagged from a reset but without a known section → "Other".
    const other = resetTray.filter(t => !t.reset_section || !known.has(t.reset_section as ResetSection));
    if (other.length) groups.push({ key: 'brain_dump' as ResetSection, label: 'Other', items: other });
    return groups;
  }, [resetTray]);

  function toggleSection(label: string) {
    setOpenSections(prev => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n; });
  }

  // Planned minutes for a day (time blocks + loose estimates), for the capacity
  // hint. Completed to-dos don't count as planned load.
  function plannedOn(day: string): number {
    const dayTasks = (byDay[day] ?? []).filter(t => !t.done);
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
    if (!dest.startsWith('d:')) return;
    const due = dest.slice(2);
    if (due !== task.due_date) onPatch(id, { due_date: due, someday: false, block_id: null });
  }

  // Schedule a to-do onto a day without dragging — the mobile-friendly path used
  // by the tray's Schedule menu (same effect as a drop onto that day).
  function scheduleTask(id: string, day: string) {
    const task = tasks.find(t => t.id === id);
    if (task && day !== task.due_date) onPatch(id, { due_date: day, someday: false, block_id: null });
  }

  function shift(dir: number) {
    setAnchor(a => range === 'week'
      ? addDaysISO(a, dir * 7)
      : isoOf(new Date(new Date(a + 'T00:00:00').getFullYear(), new Date(a + 'T00:00:00').getMonth() + dir, 1)));
  }

  // The seven days (Mon–Sun) of the anchored week.
  const weekDays = useMemo(() => dayRange(weekStartMon(anchor), 7), [anchor]);
  const monthGrid = useMemo(() => {
    const d = new Date(anchor + 'T00:00:00');
    const first = isoOf(new Date(d.getFullYear(), d.getMonth(), 1));
    return dayRange(weekStartMon(first), 42);
  }, [anchor]);
  const monthIndex = new Date(anchor + 'T00:00:00').getMonth();

  const rangeLabel = range === 'week'
    ? `Week ${isoWeek(weekDays[0])} · ${labelDate(weekDays[0])} – ${labelDate(weekDays[6])}`
    : new Date(anchor + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
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
          // Two roomy rows (4 + 3) instead of a tight single row of 7, so each
          // day card is wide enough to actually read its to-dos.
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 auto-rows-fr">
            {weekDays.map(day => (
              <DayPlanCard
                key={day}
                day={day}
                isToday={day === today}
                items={byDay[day] ?? []}
                planned={plannedOn(day)}
                over={plannedOn(day) > target}
                notesById={notesById}
                today={today}
                onOpenDay={onOpenDay}
              />
            ))}
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

        {/* Unscheduled items from a Weekly Reset — grouped & collapsible so a big
            reset doesn't become a wall of chips. Drag a row onto a day above. */}
        {resetTray.length > 0 && (
          <div className="mt-6 pt-4 border-t border-slate-200">
            <button
              onClick={() => setTrayOpen(o => !o)}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700"
            >
              {trayOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <RotateCcw className="w-3.5 h-3.5 text-violet-500" /> From your weekly reset
              <span className="text-slate-400 font-medium normal-case tracking-normal">({resetTray.length})</span>
            </button>
            {trayOpen && (
              <>
                <p className="text-xs text-slate-400 mt-1 mb-2 ml-5">Open a group and drag a to-do onto a day — or tap its <CalendarPlus className="inline w-3 h-3 -mt-0.5" /> to pick a day (handy on mobile).</p>
                <div className="space-y-1.5">
                  {traySections.map(g => (
                    <TraySection
                      key={g.label}
                      label={g.label}
                      star={g.star}
                      items={g.items}
                      open={openSections.has(g.label)}
                      onToggle={() => toggleSection(g.label)}
                      notesById={notesById}
                      onOpenList={onOpenList}
                      weekDays={weekDays}
                      today={today}
                      onSchedule={scheduleTask}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </DndContext>
    </div>
  );
}

function labelDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// One day of the week view: a droppable column showing that day's to-dos.
function DayPlanCard({
  day, isToday, items, planned, over, notesById, today, onOpenDay,
}: {
  day: string;
  isToday: boolean;
  items: PlannerTask[];
  planned: number;
  over: boolean;
  notesById: Record<string, PlannerNote>;
  today: string;
  onOpenDay: (iso: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `d:${day}` });
  const d = new Date(day + 'T00:00:00');
  return (
    <div
      ref={setNodeRef}
      className={`rounded-2xl border bg-white p-3 min-h-[12rem] flex flex-col transition-colors ${
        isOver ? 'border-teal-400 ring-2 ring-teal-100' : isToday ? 'border-teal-300' : 'border-slate-200'
      }`}
    >
      <button onClick={() => onOpenDay(day)} className="flex items-baseline justify-between mb-2 text-left w-full">
        <span className={`text-sm font-bold ${isToday ? 'text-teal-700' : 'text-slate-700'}`}>
          {d.toLocaleDateString(undefined, { weekday: 'short' })}
          <span className="ml-1.5 text-xs font-medium text-slate-400">{d.getDate()}</span>
        </span>
        {planned > 0 && (
          <span className={`text-[11px] font-medium shrink-0 ${over ? 'text-rose-500' : 'text-slate-400'}`}>{formatMinutes(planned)}</span>
        )}
      </button>
      {items.length === 0 ? (
        <button onClick={() => onOpenDay(day)} className="text-xs text-slate-300 flex-1 text-left hover:text-slate-400">
          Drag a to-do here
        </button>
      ) : (
        <ul className="space-y-1">
          {items.map(t => <TaskChip key={t.id} task={t} notesById={notesById} today={today} onOpenDay={onOpenDay} />)}
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
      {task.done
        ? <Check className="w-3 h-3 text-teal-500 shrink-0" />
        : task.flagged
          ? <Star className="w-3 h-3 text-amber-400 shrink-0" fill="currentColor" />
          : <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />}
      <span className={`flex-1 truncate ${task.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{task.title || 'Untitled'}</span>
      {showDay && task.due_date && (
        <span className={`shrink-0 ${overdue ? 'text-rose-500' : 'text-slate-400'}`}>
          {new Date(task.due_date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' })}
        </span>
      )}
      {task.estimate_minutes ? <span className="text-slate-400 shrink-0 inline-flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{formatMinutes(task.estimate_minutes)}</span> : null}
    </li>
  );
}

// A collapsible group in the weekly-reset tray: a header with a count, and when
// open, its draggable to-dos as a readable one-per-line list.
function TraySection({
  label, star, items, open, onToggle, notesById, onOpenList, weekDays, today, onSchedule,
}: {
  label: string;
  star?: boolean;
  items: PlannerTask[];
  open: boolean;
  onToggle: () => void;
  notesById: Record<string, PlannerNote>;
  onOpenList?: (noteId: string) => void;
  weekDays: string[];
  today: string;
  onSchedule: (id: string, day: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
        {star && <Star className="w-3.5 h-3.5 text-amber-400 shrink-0" fill="currentColor" />}
        <span className="flex-1 text-sm font-semibold text-slate-700">{label}</span>
        <span className="text-xs text-slate-400">{items.length}</span>
      </button>
      {open && (
        <ul className="px-2 pb-2 space-y-0.5 border-t border-slate-100 pt-1">
          {items.map(t => (
            <TrayRow key={t.id} task={t} onOpenList={onOpenList} weekDays={weekDays} today={today} onSchedule={onSchedule} />
          ))}
        </ul>
      )}
    </div>
  );
}

// A full-width draggable row for the reset tray. The title wraps (rather than
// truncating) so long brain-dump items stay readable. Drag it onto a day to
// schedule (desktop) or tap the calendar to pick a day (mobile); click the title
// to open its list and edit it.
function TrayRow({
  task, onOpenList, weekDays, today, onSchedule,
}: {
  task: PlannerTask;
  onOpenList?: (noteId: string) => void;
  weekDays: string[];
  today: string;
  onSchedule: (id: string, day: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;
  const canOpen = !!(task.note_id && onOpenList);
  const [pickOpen, setPickOpen] = useState(false);
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group flex items-start gap-2 text-sm rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing hover:bg-slate-50 ${isDragging ? 'opacity-60 shadow-lg bg-white ring-1 ring-slate-200' : ''}`}
    >
      {task.flagged
        ? <Star className="w-3 h-3 mt-1 text-amber-400 shrink-0" fill="currentColor" />
        : <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-teal-400 shrink-0" />}
      {/* The title is the click target (drag still works via the surrounding
          row); a plain drag won't fire the click thanks to the 6px threshold. */}
      <button
        type="button"
        onClick={() => { if (task.note_id && onOpenList) onOpenList(task.note_id); }}
        disabled={!canOpen}
        title={canOpen ? 'Open in its list to edit' : undefined}
        className={`flex-1 min-w-0 text-left break-words ${canOpen ? 'text-slate-700 hover:text-teal-600 cursor-pointer' : 'text-slate-700'}`}
      >
        {task.title || 'Untitled'}
      </button>
      {task.estimate_minutes ? <span className="mt-0.5 text-slate-400 shrink-0 inline-flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{formatMinutes(task.estimate_minutes)}</span> : null}
      {/* Tap-to-schedule — the mobile alternative to dragging. stopPropagation on
          pointer-down keeps the drag sensor from swallowing the tap. */}
      <div className="relative shrink-0">
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); setPickOpen(o => !o); }}
          title="Schedule on a day"
          className="mt-0.5 text-slate-300 hover:text-teal-600 sm:opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity"
        >
          <CalendarPlus className="w-4 h-4" />
        </button>
        {pickOpen && (
          <SchedulePopover
            weekDays={weekDays}
            today={today}
            onPick={day => { onSchedule(task.id, day); setPickOpen(false); }}
            onClose={() => setPickOpen(false)}
          />
        )}
      </div>
    </li>
  );
}

// A compact day picker for tap-to-schedule: the seven days of the week currently
// shown above. Backdrop closes it on an outside tap.
function SchedulePopover({
  weekDays, today, onPick, onClose,
}: {
  weekDays: string[];
  today: string;
  onPick: (day: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={e => { e.stopPropagation(); onClose(); }} />
      <div className="absolute right-0 top-7 z-50 w-44 rounded-xl border border-slate-200 bg-white shadow-lg p-1.5">
        <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Schedule for…</div>
        {weekDays.map(day => {
          const d = new Date(day + 'T00:00:00');
          return (
            <button
              key={day}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onPick(day); }}
              className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-sm hover:bg-teal-50 ${day === today ? 'text-teal-700 font-medium' : 'text-slate-600'}`}
            >
              <span>{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="text-xs text-slate-400">
                {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{day === today ? ' · Today' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
