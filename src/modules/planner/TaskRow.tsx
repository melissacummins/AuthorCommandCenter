import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Check, Circle, Trash2, Repeat, Clock, CalendarClock, CalendarPlus, Link2Off,
  Star, Moon, Orbit as OrbitIcon, MoreHorizontal, Plus, ChevronRight, ChevronLeft, ChevronDown,
  Pencil, ListPlus, Inbox,
} from 'lucide-react';
import { TimerButton } from './TimerButton';
import { TaskNotes } from './TaskNotes';
import { newChecklistItem } from './api';
import {
  checklistProgress, formatDue, formatMinutes, ESTIMATE_PRESETS,
  RECURRENCE_PRESETS, recurrenceLabel, parseCustomRecurrence, customRecurrence,
  type ChecklistItem, type PlannerNote, type PlannerTask, type Recurrence, type RecurrenceUnit,
} from './types';

// ---------------------------------------------------------------------------
// The unified to-do row used by every planner view (My Day + list/bucket).
//
// Principle: capture stays dumb-simple; detail is opt-in.
//   Resting:  [drag handle] · checkbox · title · {quiet chips when set}
//   Hover:    a single ⋯ "More" button (+ drag handle where draggable)
//   Click title (not done) → a calm detail card expands beneath the row.
//
// All metadata edits flow through onPatch. Capabilities are opt-in props so each
// view only lights up what applies. Headings are NOT routed through this row.
// ---------------------------------------------------------------------------

export interface TaskRowProps {
  task: PlannerTask;
  today: string;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  // Enables "Move to list…" + the list-name chip.
  lists?: PlannerNote[];
  // Resolved current list name for the chip (omit/empty to hide — e.g. in that
  // list's own page).
  listName?: string;
  // Click the list-name chip to open it (list views).
  onOpenList?: () => void;
  // Pre-built handle from the caller (My Day useDraggable / list sortable).
  dragHandle?: ReactNode;
  showTimer?: boolean;
  canFlag?: boolean;
  orbitEnabled?: boolean;
  canSomeday?: boolean;
  enableRecurrence?: boolean;
  enableChecklist?: boolean;
  calConnected?: boolean;
  onTimeBlock?: (time: string) => void;
  onUnblock?: () => void;
  // Overdue rows: a small "→ Today" affordance.
  onMoveToToday?: () => void;
  // Keyboard add flow (list views).
  focusId?: string | null;
  onFocused?: () => void;
  onEnter?: () => void;
}

export function TaskRow(props: TaskRowProps) {
  const {
    task, today, onPatch, onDelete, lists, listName, onOpenList, dragHandle,
    showTimer = false, canFlag = false, orbitEnabled = false, canSomeday = false,
    enableRecurrence = false, enableChecklist = false, calConnected = false,
    onTimeBlock, onUnblock, onMoveToToday, focusId, onFocused, onEnter,
  } = props;

  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const hasNotes = !!task.notes?.trim();
  const overdue = !task.done && !!task.due_date && task.due_date < today;
  const progress = checklistProgress(task);
  const running = !!task.timer_started_at;

  // The keyboard add flow points focus at a freshly created row: open a light
  // inline title edit (NOT the detail card), so rapid capture stays thin — type
  // a title, Enter commits + spawns the next sibling. The card is opt-in.
  useEffect(() => {
    if (focusId && focusId === task.id) { setEditing(true); setDraft(task.title); onFocused?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, task.id]);

  // Light inline rename (the row title) — distinct from the opt-in detail card.
  function blurCommit() {
    setEditing(false);
    const next = draft.trim();
    if (!next) { if (!task.title) onDelete(task.id); else setDraft(task.title); return; }
    if (next !== task.title) onPatch(task.id, { title: next });
  }
  function enterCommit() {
    const next = draft.trim();
    if (!next) { setEditing(false); if (!task.title) onDelete(task.id); return; }
    if (next !== task.title) onPatch(task.id, { title: next });
    setEditing(false);
    onEnter?.();  // spawn + focus the next sibling (stays thin)
  }

  return (
    <div className="py-1.5 group">
      <div className="flex items-center gap-2">
        {dragHandle}
        <button
          onClick={() => onPatch(task.id, { done: !task.done })}
          className={`shrink-0 transition-colors ${task.done ? 'text-teal-600' : 'text-slate-300 hover:text-teal-600'}`}
          title={task.done ? 'Mark not done' : 'Mark done'}
        >
          {task.done
            ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-teal-600 text-white"><Check className="w-3.5 h-3.5" /></span>
            : <Circle className="w-5 h-5" />}
        </button>

        {editing && !task.done ? (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={blurCommit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); enterCommit(); }
              if (e.key === 'Escape') { setDraft(task.title); setEditing(false); }
            }}
            placeholder="To-do title…"
            className="flex-1 min-w-0 text-sm bg-transparent outline-none border-b border-teal-400 text-slate-700"
          />
        ) : (
          <button
            onClick={() => { if (!task.done) { setDraft(task.title); setEditing(true); } }}
            className={`flex-1 min-w-0 text-left text-sm truncate ${task.done ? 'text-slate-400 line-through cursor-default' : 'text-slate-700 cursor-text'}`}
            title={task.done ? undefined : 'Click to rename · chevron or ⋯ for details'}
          >
            {task.title || 'Untitled'}
          </button>
        )}

        {/* Quiet chips — only shown when the value is set. Non-interactive-looking. */}
        {!task.done && (
          <div className="flex items-center gap-1.5 shrink-0">
            {running && (
              <span className="inline-flex items-center" title="Timer running">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500" />
                </span>
              </span>
            )}
            {task.due_date && (
              <span className={`text-[11px] font-medium ${overdue ? 'text-rose-500' : 'text-slate-400'}`}>
                {formatDue(task.due_date, today)}
              </span>
            )}
            {task.estimate_minutes ? (
              <span className="text-[11px] font-medium text-slate-400">{formatMinutes(task.estimate_minutes)}</span>
            ) : null}
            {enableRecurrence && task.recurrence && (
              <Repeat className="w-3.5 h-3.5 text-slate-400" />
            )}
            {canFlag && task.flagged && (
              <Star className="w-3.5 h-3.5 text-amber-400" fill="currentColor" />
            )}
            {orbitEnabled && task.in_orbit && (
              <OrbitIcon className="w-3.5 h-3.5 text-violet-400" />
            )}
            {progress.total > 0 && (
              <span className="text-[11px] font-medium text-slate-400 tabular-nums">{progress.done}/{progress.total}</span>
            )}
            {listName && (
              <button
                onClick={onOpenList}
                className="text-[11px] text-slate-400 hover:text-teal-600 truncate max-w-[8rem]"
                title="Open list"
              >
                {listName}
              </button>
            )}
          </div>
        )}

        {/* Done rows show their tracked time (TimerButton renders it read-only). */}
        {task.done && showTimer && <TimerButton task={task} onPatch={onPatch} />}

        {/* Overdue rows keep the high-value "→ Today" affordance. */}
        {onMoveToToday && !task.done && (
          <button
            onClick={onMoveToToday}
            className="text-xs font-medium text-teal-600 hover:text-teal-700 shrink-0"
            title="Move to today"
          >
            → Today
          </button>
        )}

        {/* Hover: open the detail card (opt-in), then the ⋯ "More" menu. */}
        {!task.done && (
          <button
            onClick={() => { setEditing(false); setExpanded(v => !v); }}
            className="text-slate-300 hover:text-teal-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            title={expanded ? 'Close details' : 'Open details'}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        )}
        {!task.done && (
          <TaskActionsMenu
            task={task}
            today={today}
            onPatch={onPatch}
            onDelete={onDelete}
            onEditDetails={() => setExpanded(true)}
            lists={lists}
            canFlag={canFlag}
            orbitEnabled={orbitEnabled}
            canSomeday={canSomeday}
            enableRecurrence={enableRecurrence}
            calConnected={calConnected}
            onTimeBlock={onTimeBlock}
            onUnblock={onUnblock}
          />
        )}

        {/* Done rows still need a way out. */}
        {task.done && (
          <button
            onClick={() => onDelete(task.id)}
            className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* The calm detail card — expands beneath the row when opened. */}
      {expanded && !task.done && (
        <TaskDetail
          task={task}
          today={today}
          onPatch={onPatch}
          onDelete={onDelete}
          onClose={() => setExpanded(false)}
          lists={lists}
          showTimer={showTimer}
          canFlag={canFlag}
          enableRecurrence={enableRecurrence}
          enableChecklist={enableChecklist}
          autoFocusTitle={false}
        />
      )}

      {/* A subtle one-line notes preview when the card is closed (keeps the My
          Day notes-preview behaviour without a dedicated icon). */}
      {!expanded && !task.done && hasNotes && (
        <button
          onClick={() => setExpanded(true)}
          className="ml-7 mt-0.5 block text-left text-xs text-slate-400 hover:text-slate-600 truncate max-w-full"
        >
          {task.notes!.trim().split('\n')[0]}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The ⋯ "More" menu — a vertical action list that portals + flips on-screen.
// Items appear conditionally based on the capabilities passed in. Pickers
// (Schedule / Estimate / Repeat / Move to list) open as a second-level view
// inside the same popover via the shared option-list helpers below.
// ---------------------------------------------------------------------------

type SubView = 'root' | 'schedule' | 'estimate' | 'repeat' | 'list';

export function TaskActionsMenu({
  task, today, onPatch, onDelete, onEditDetails, lists,
  canFlag = false, orbitEnabled = false, canSomeday = false, enableRecurrence = false,
  calConnected = false, onTimeBlock, onUnblock,
}: {
  task: PlannerTask;
  today: string;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  onEditDetails: () => void;
  lists?: PlannerNote[];
  canFlag?: boolean;
  orbitEnabled?: boolean;
  canSomeday?: boolean;
  enableRecurrence?: boolean;
  calConnected?: boolean;
  onTimeBlock?: (time: string) => void;
  onUnblock?: () => void;
}) {
  return (
    <Popover
      icon={<MoreHorizontal className="w-4 h-4 text-slate-300 hover:text-slate-600" />}
      title="More"
      triggerClassName="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
    >
      {close => (
        <MenuBody
          task={task}
          today={today}
          onPatch={onPatch}
          onDelete={onDelete}
          onEditDetails={onEditDetails}
          lists={lists}
          canFlag={canFlag}
          orbitEnabled={orbitEnabled}
          canSomeday={canSomeday}
          enableRecurrence={enableRecurrence}
          calConnected={calConnected}
          onTimeBlock={onTimeBlock}
          onUnblock={onUnblock}
          close={close}
        />
      )}
    </Popover>
  );
}

function MenuBody({
  task, today, onPatch, onDelete, onEditDetails, lists,
  canFlag, orbitEnabled, canSomeday, enableRecurrence, calConnected, onTimeBlock, onUnblock, close,
}: {
  task: PlannerTask;
  today: string;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  onEditDetails: () => void;
  lists?: PlannerNote[];
  canFlag?: boolean;
  orbitEnabled?: boolean;
  canSomeday?: boolean;
  enableRecurrence?: boolean;
  calConnected?: boolean;
  onTimeBlock?: (time: string) => void;
  onUnblock?: () => void;
  close: () => void;
}) {
  const [view, setView] = useState<SubView>('root');

  if (view === 'schedule') {
    return <SubPanel title="Schedule" onBack={() => setView('root')}>
      <SchedulePicker task={task} onPatch={onPatch} onDone={close} />
    </SubPanel>;
  }
  if (view === 'estimate') {
    return <SubPanel title="Estimate" onBack={() => setView('root')}>
      <EstimateOptions task={task} onPatch={onPatch} onDone={close} />
    </SubPanel>;
  }
  if (view === 'repeat') {
    return <SubPanel title="Repeat" onBack={() => setView('root')}>
      <RepeatOptions task={task} today={today} onPatch={onPatch} onDone={close} />
    </SubPanel>;
  }
  if (view === 'list') {
    return <SubPanel title="Move to list" onBack={() => setView('root')}>
      <ListOptions task={task} lists={lists ?? []} onPatch={onPatch} onDone={close} />
    </SubPanel>;
  }

  return (
    <div className="py-1 min-w-[12rem]">
      <MenuItem icon={<Pencil className="w-4 h-4" />} label="Edit details" onClick={() => { onEditDetails(); close(); }} />
      <MenuItem icon={<CalendarClock className="w-4 h-4" />} label="Schedule…" onClick={() => setView('schedule')} chevron />
      <MenuItem icon={<Clock className="w-4 h-4" />} label="Estimate…" onClick={() => setView('estimate')} chevron />
      {enableRecurrence && (
        <MenuItem icon={<Repeat className="w-4 h-4" />} label="Repeat…" onClick={() => setView('repeat')} chevron />
      )}
      {lists && (
        <MenuItem icon={<ListPlus className="w-4 h-4" />} label="Move to list…" onClick={() => setView('list')} chevron />
      )}
      {canFlag && (
        <MenuItem
          icon={<Star className="w-4 h-4" fill={task.flagged ? 'currentColor' : 'none'} />}
          label={task.flagged ? 'Unflag' : 'Flag as Important'}
          onClick={() => { onPatch(task.id, { flagged: !task.flagged }); close(); }}
        />
      )}
      {orbitEnabled && (
        <MenuItem
          icon={<OrbitIcon className="w-4 h-4" />}
          label={task.in_orbit ? 'Remove from Orbit' : 'Add to Orbit'}
          onClick={() => { onPatch(task.id, { in_orbit: !task.in_orbit }); close(); }}
        />
      )}
      {canSomeday && (
        <MenuItem
          icon={<Moon className="w-4 h-4" />}
          label={task.someday ? 'Move to Anytime' : 'Move to Someday'}
          onClick={() => {
            onPatch(task.id, { someday: !task.someday, due_date: null, ...(!task.someday ? { recurrence: null } : {}) });
            close();
          }}
        />
      )}
      {calConnected && onTimeBlock && (
        task.gcal_event_id
          ? <MenuItem
              icon={<Link2Off className="w-4 h-4" />}
              label={`Remove time block${task.start_at ? ` · ${new Date(task.start_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}`}
              onClick={() => { onUnblock?.(); close(); }}
            />
          : <TimeBlockItem onTimeBlock={t => { onTimeBlock(t); close(); }} />
      )}
      <div className="my-1 border-t border-slate-100" />
      <MenuItem icon={<Trash2 className="w-4 h-4" />} label="Delete" rose onClick={() => { onDelete(task.id); close(); }} />
    </div>
  );
}

function MenuItem({
  icon, label, onClick, chevron = false, rose = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  chevron?: boolean;
  rose?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-sm rounded hover:bg-slate-100 ${rose ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700'}`}
    >
      <span className={rose ? 'text-rose-500' : 'text-slate-400'}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {chevron && <ChevronRight className="w-3.5 h-3.5 text-slate-300" />}
    </button>
  );
}

function SubPanel({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="min-w-[12rem]">
      <button onClick={onBack} className="flex w-full items-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 border-b border-slate-100">
        <ChevronLeft className="w-3.5 h-3.5" /> {title}
      </button>
      {children}
    </div>
  );
}

// A time-block sub-item with an inline time input (used inside the ⋯ menu).
function TimeBlockItem({ onTimeBlock }: { onTimeBlock: (time: string) => void }) {
  const [time, setTime] = useState('09:00');
  return (
    <div className="px-3 py-1.5 flex items-center gap-2">
      <CalendarPlus className="w-4 h-4 text-slate-400 shrink-0" />
      <input
        type="time"
        value={time}
        onChange={e => setTime(e.target.value)}
        className="text-sm border border-slate-200 rounded px-1.5 py-0.5 w-[6.5rem]"
      />
      <button onClick={() => onTimeBlock(time)} className="text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded px-2 py-1">Block</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-pickers — reused by both the ⋯ menu and the expand card's chip-row.
// Each calls onPatch and then onDone (to close the popover it sits in).
// ---------------------------------------------------------------------------

export function SchedulePicker({
  task, onPatch, onDone,
}: {
  task: PlannerTask;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDone: () => void;
}) {
  return (
    <div className="p-2">
      <input
        type="date"
        autoFocus
        value={task.due_date ?? ''}
        onChange={e => { onPatch(task.id, { due_date: e.target.value || null, someday: false }); onDone(); }}
        className="text-sm border border-slate-200 rounded px-2 py-1 w-full"
      />
      {task.due_date && (
        <button
          onClick={() => { onPatch(task.id, { due_date: null, someday: false }); onDone(); }}
          className="mt-1 block w-full text-left px-1 py-1 text-xs text-slate-400 hover:text-slate-600"
        >
          Clear (→ Anytime)
        </button>
      )}
    </div>
  );
}

export function EstimateOptions({
  task, onPatch, onDone,
}: {
  task: PlannerTask;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDone: () => void;
}) {
  return (
    <div className="py-1">
      {ESTIMATE_PRESETS.map(p => (
        <button
          key={p}
          onClick={() => { onPatch(task.id, { estimate_minutes: p }); onDone(); }}
          className={`block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-slate-100 ${task.estimate_minutes === p ? 'text-teal-600 font-medium' : 'text-slate-700'}`}
        >
          {formatMinutes(p)}
        </button>
      ))}
      <button
        onClick={() => { onPatch(task.id, { estimate_minutes: null }); onDone(); }}
        className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-slate-100 text-slate-400"
      >
        No estimate
      </button>
    </div>
  );
}

export function RepeatOptions({
  task, today, onPatch, onDone,
}: {
  task: PlannerTask;
  today: string;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDone: () => void;
}) {
  const current = parseCustomRecurrence(task.recurrence);
  const [showCustom, setShowCustom] = useState(!!current);
  const [count, setCount] = useState(String(current?.n ?? 2));
  const [unit, setUnit] = useState<RecurrenceUnit>(current?.unit ?? 'week');

  // Setting a recurrence on an unscheduled task also schedules it for today.
  function choose(r: Recurrence) {
    onPatch(task.id, { recurrence: r, ...(task.due_date ? {} : { due_date: today, someday: false }) });
    onDone();
  }
  function applyCustom() {
    const n = parseInt(count, 10);
    if (!n || n < 1) return;
    choose(customRecurrence(n, unit));
  }

  return (
    <div className="py-1 min-w-[12rem]">
      {RECURRENCE_PRESETS.map(r => (
        <button
          key={r}
          onClick={() => choose(r)}
          className={`block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-slate-100 ${task.recurrence === r ? 'text-teal-600 font-medium' : 'text-slate-700'}`}
        >
          {recurrenceLabel(r)}
        </button>
      ))}

      {showCustom ? (
        <div className="px-3 py-1.5 flex items-center gap-1.5">
          <span className="text-sm text-slate-500">Every</span>
          <input
            type="number"
            min="1"
            value={count}
            onChange={e => setCount(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyCustom(); }}
            className="w-12 text-sm border border-slate-200 rounded px-1.5 py-0.5"
          />
          <select
            value={unit}
            onChange={e => setUnit(e.target.value as RecurrenceUnit)}
            className="text-sm border border-slate-200 rounded px-1 py-0.5"
          >
            <option value="day">days</option>
            <option value="week">weeks</option>
            <option value="month">months</option>
          </select>
          <button onClick={applyCustom} className="text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded px-2 py-1">Set</button>
        </div>
      ) : (
        <button
          onClick={() => setShowCustom(true)}
          className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-slate-100 text-slate-700"
        >
          Custom…
        </button>
      )}

      <button
        onClick={() => { onPatch(task.id, { recurrence: null }); onDone(); }}
        className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-slate-100 text-slate-400 border-t border-slate-100"
      >
        Don’t repeat
      </button>
    </div>
  );
}

export function ListOptions({
  task, lists, onPatch, onDone,
}: {
  task: PlannerTask;
  lists: PlannerNote[];
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDone: () => void;
}) {
  return (
    <div className="py-1">
      {lists.map(l => (
        <button
          key={l.id}
          onClick={() => { onPatch(task.id, { note_id: l.id }); onDone(); }}
          className={`block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-slate-100 truncate ${task.note_id === l.id ? 'text-teal-600 font-medium' : 'text-slate-700'}`}
        >
          {l.title.trim() || 'Untitled list'}
        </button>
      ))}
      <button
        onClick={() => { onPatch(task.id, { note_id: null }); onDone(); }}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm rounded hover:bg-slate-100 border-t border-slate-100 ${task.note_id ? 'text-slate-500' : 'text-teal-600 font-medium'}`}
      >
        <Inbox className="w-4 h-4 text-slate-400" /> Inbox (no list)
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The expand detail card — a calm editor that renders below the row.
// Editable title, notes, a chip-row of pickers (Date · Estimate · Repeat ·
// List · Flag), and the checklist editor where enabled.
// ---------------------------------------------------------------------------

export function TaskDetail({
  task, today, onPatch, onDelete, onClose, lists, showTimer = false,
  canFlag = false, enableRecurrence = false, enableChecklist = false,
  autoFocusTitle = true, onEnter,
}: {
  task: PlannerTask;
  today: string;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  lists?: PlannerNote[];
  showTimer?: boolean;
  canFlag?: boolean;
  enableRecurrence?: boolean;
  enableChecklist?: boolean;
  autoFocusTitle?: boolean;
  onEnter?: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  useEffect(() => { setTitle(task.title); }, [task.id, task.title]);

  // Commit on blur; a brand-new blank row left empty is removed (mirrors the old
  // blurCommit). Enter commits + spawns the next sibling (the keyboard flow).
  function blurCommit() {
    const next = title.trim();
    if (!next) { if (!task.title) onDelete(task.id); else setTitle(task.title); return; }
    if (next !== task.title) onPatch(task.id, { title: next });
  }
  function enterCommit() {
    const next = title.trim();
    if (!next) { if (!task.title) onDelete(task.id); onClose(); return; }
    if (next !== task.title) onPatch(task.id, { title: next });
    // Close this card; the keyboard flow spawns + focuses the next sibling, which
    // opens its own card. Without onEnter, just commit and collapse.
    onClose();
    onEnter?.();
  }

  function setChecklist(items: ChecklistItem[]) { onPatch(task.id, { checklist: items }); }

  return (
    <div className="ml-7 mt-2 mb-1 rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          autoFocus={autoFocusTitle}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={blurCommit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); enterCommit(); }
            if (e.key === 'Escape') { setTitle(task.title); onClose(); }
          }}
          placeholder="To-do title…"
          className="flex-1 text-sm font-medium bg-transparent outline-none border-b border-transparent focus:border-teal-400 text-slate-800"
        />
        {showTimer && <TimerButton task={task} onPatch={onPatch} />}
        <button onClick={onClose} className="text-xs font-medium text-slate-400 hover:text-teal-600 shrink-0" title="Close">
          Done
        </button>
      </div>

      <TaskNotes task={task} onPatch={onPatch} />

      {/* Chip-row of actions — each opens the same picker as the ⋯ menu. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <ChipPicker
          active={!!task.due_date}
          icon={<CalendarClock className="w-3.5 h-3.5" />}
          label={task.due_date ? formatDue(task.due_date, today) : 'Date'}
        >
          {close => <SchedulePicker task={task} onPatch={onPatch} onDone={close} />}
        </ChipPicker>

        <ChipPicker
          active={!!task.estimate_minutes}
          icon={<Clock className="w-3.5 h-3.5" />}
          label={task.estimate_minutes ? formatMinutes(task.estimate_minutes) : 'Estimate'}
        >
          {close => <EstimateOptions task={task} onPatch={onPatch} onDone={close} />}
        </ChipPicker>

        {enableRecurrence && (
          <ChipPicker
            active={!!task.recurrence}
            icon={<Repeat className="w-3.5 h-3.5" />}
            label={task.recurrence ? recurrenceLabel(task.recurrence) : 'Repeat'}
          >
            {close => <RepeatOptions task={task} today={today} onPatch={onPatch} onDone={close} />}
          </ChipPicker>
        )}

        {lists && (
          <ChipPicker
            active={!!task.note_id}
            icon={<ListPlus className="w-3.5 h-3.5" />}
            label="List"
          >
            {close => <ListOptions task={task} lists={lists} onPatch={onPatch} onDone={close} />}
          </ChipPicker>
        )}

        {canFlag && (
          <button
            onClick={() => onPatch(task.id, { flagged: !task.flagged })}
            className={`inline-flex items-center gap-1 text-xs font-medium rounded-lg border px-2 py-1 transition-colors ${
              task.flagged ? 'border-amber-200 bg-amber-50 text-amber-600' : 'border-slate-200 text-slate-500 hover:text-amber-500 hover:border-amber-200'
            }`}
            title={task.flagged ? 'Unflag' : 'Flag as Important'}
          >
            <Star className="w-3.5 h-3.5" fill={task.flagged ? 'currentColor' : 'none'} />
            Flag
          </button>
        )}
      </div>

      {/* Checklist editor (where enabled). */}
      {enableChecklist && (
        <ChecklistEditor items={task.checklist ?? []} onChange={setChecklist} />
      )}
    </div>
  );
}

// A small chip button that opens a picker popover beneath it.
function ChipPicker({
  active, icon, label, children,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  return (
    <Popover
      align="left"
      title={label}
      icon={
        <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-lg border px-2 py-1 transition-colors ${
          active ? 'border-teal-200 bg-teal-50 text-teal-700' : 'border-slate-200 text-slate-500 hover:text-teal-600 hover:border-teal-200'
        }`}>
          {icon}{label}
        </span>
      }
    >
      {children}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// The checklist editor — moved here from PlannerModule's old TaskRow so both
// views get it inside the detail card. Always shows the add-step input.
// ---------------------------------------------------------------------------

export function ChecklistEditor({
  items, onChange,
}: {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function toggle(id: string) { onChange(items.map(i => (i.id === id ? { ...i, done: !i.done } : i))); }
  function rename(id: string, title: string) { onChange(items.map(i => (i.id === id ? { ...i, title } : i))); }
  function remove(id: string) { onChange(items.filter(i => i.id !== id)); }
  function add() {
    const title = draft.trim();
    if (!title) return;
    onChange([...items, newChecklistItem(title)]);
    setDraft('');
  }

  return (
    <div className="pl-3 border-l-2 border-slate-200 space-y-1">
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2 group/ci">
          <button
            onClick={() => toggle(item.id)}
            className={`shrink-0 ${item.done ? 'text-teal-600' : 'text-slate-300 hover:text-teal-600'}`}
          >
            {item.done
              ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-teal-600 text-white"><Check className="w-2.5 h-2.5" /></span>
              : <Circle className="w-4 h-4" />}
          </button>
          <input
            value={item.title}
            onChange={e => rename(item.id, e.target.value)}
            className={`flex-1 text-sm bg-transparent outline-none ${item.done ? 'text-slate-400 line-through' : 'text-slate-600'}`}
          />
          <button
            onClick={() => remove(item.id)}
            className="text-slate-300 hover:text-rose-500 opacity-0 group-hover/ci:opacity-100 transition-opacity shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Plus className="w-3.5 h-3.5 text-slate-300 shrink-0" />
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); }}
          placeholder="Add a sub-step…"
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-300 text-slate-600"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Popover — a click-to-open menu portalled to <body> and flipped to stay
// on-screen. Generalised from MiniMenu so it can anchor right (the ⋯ menu) or
// left (the chip pickers), and exposes a `triggerClassName` for hover-reveal.
// ---------------------------------------------------------------------------

function Popover({
  icon, title, children, align = 'right', triggerClassName = '',
}: {
  icon: ReactNode;
  title: string;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < 280 && r.top > spaceBelow;
      setPos({
        left: align === 'right' ? Math.max(8, r.right) : r.left,
        ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    }
    setOpen(o => !o);
  }

  return (
    <>
      <button ref={btnRef} onClick={toggle} title={title} className={triggerClassName || 'shrink-0'}>
        {icon}
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 min-w-[8rem] max-h-[70vh] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-0.5"
            style={{ top: pos.top, bottom: pos.bottom, left: pos.left, transform: align === 'right' ? 'translateX(-100%)' : undefined }}
          >
            {children(() => setOpen(false))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
