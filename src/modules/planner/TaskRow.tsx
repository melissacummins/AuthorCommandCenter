import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Check, Circle, Trash2, Repeat, Clock, CalendarClock, CalendarPlus, Link2Off,
  Star, Moon, Orbit as OrbitIcon, MoreHorizontal, Plus, ChevronRight, ChevronLeft, ChevronDown,
  Pencil, ListPlus, Inbox, History, Zap, Heart, Lock, Bell,
} from 'lucide-react';
import { TimerButton } from './TimerButton';
import { TaskNotes } from './TaskNotes';
import { newChecklistItem, listTaskEvents } from './api';
import {
  checklistProgress, formatDue, formatMinutes, ESTIMATE_PRESETS, QUICK_TASK_MINUTES,
  RECURRENCE_PRESETS, recurrenceLabel, parseCustomRecurrence, customRecurrence,
  type ChecklistItem, type PlannerNote, type PlannerTask, type PlannerTaskEvent, type Recurrence, type RecurrenceUnit,
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
  // Retroactively record time worked on this to-do (minutes, on a given day) —
  // enables the "Log time…" menu item. Omit to hide it.
  onLogTime?: (minutes: number, day: string) => void;
  // Overdue rows: a small "→ Today" affordance.
  onMoveToToday?: () => void;
  // True when this to-do is blocked by an unfinished dependency (shows a badge).
  blocked?: boolean;
  // Open the dependency editor for this to-do (adds a "Dependencies…" action).
  onEditDependencies?: () => void;
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
    onTimeBlock, onUnblock, onLogTime, onMoveToToday, blocked = false, onEditDependencies, focusId, onFocused, onEnter,
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
      <div className="flex items-start gap-2">
        {dragHandle}
        <button
          onClick={() => onPatch(task.id, { done: !task.done })}
          className={`shrink-0 transition-colors ${task.done ? 'text-brand-600' : 'text-content-faint hover:text-brand-600'}`}
          title={task.done ? 'Mark not done' : 'Mark done'}
        >
          {task.done
            ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-600 text-brand-fg"><Check className="w-3.5 h-3.5" /></span>
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
            className="flex-1 min-w-0 text-sm bg-transparent outline-none border-b border-brand-400 text-content"
          />
        ) : (
          <button
            onClick={() => { if (!task.done) { setDraft(task.title); setEditing(true); } }}
            className={`flex-1 min-w-0 text-left text-sm break-words ${task.done ? 'text-content-muted line-through cursor-default' : 'text-content cursor-text'}`}
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
              <span className={`text-[11px] font-medium ${overdue ? 'text-rose-500' : 'text-content-muted'}`}>
                {formatDue(task.due_date, today)}
              </span>
            )}
            {task.estimate_minutes === QUICK_TASK_MINUTES ? (
              <span title="Quick task"><Zap className="w-3.5 h-3.5 text-teal-500" fill="currentColor" /></span>
            ) : task.estimate_minutes ? (
              <span className="text-[11px] font-medium text-content-muted">{formatMinutes(task.estimate_minutes)}</span>
            ) : null}
            {enableRecurrence && task.recurrence && (
              <Repeat className="w-3.5 h-3.5 text-content-muted" />
            )}
            {canFlag && task.flagged && (
              <Star className="w-3.5 h-3.5 text-amber-400" fill="currentColor" />
            )}
            {task.feel_good && (
              <Heart className="w-3.5 h-3.5 text-rose-400" fill="currentColor" />
            )}
            {task.remind_at && !task.done && (
              <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-violet-500" title={`Reminder set for ${new Date(task.remind_at).toLocaleString()}`}>
                <Bell className="w-3 h-3" /> {reminderLabel(task.remind_at)}
              </span>
            )}
            {orbitEnabled && task.in_orbit && (
              <OrbitIcon className="w-3.5 h-3.5 text-brand-400" />
            )}
            {progress.total > 0 && (
              <span className="text-[11px] font-medium text-content-muted tabular-nums">{progress.done}/{progress.total}</span>
            )}
            {blocked && !task.done && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 bg-amber-50 rounded px-1 py-0.5" title="Blocked — waiting on another to-do">
                <Lock className="w-2.5 h-2.5" /> Blocked
              </span>
            )}
            {listName && (
              <button
                onClick={onOpenList}
                className="text-[11px] text-content-muted hover:text-brand-600 truncate max-w-[8rem]"
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
            className="text-xs font-medium text-brand-600 hover:text-brand-700 shrink-0"
            title="Move to today"
          >
            → Today
          </button>
        )}

        {/* Hover: open the detail card (opt-in), then the ⋯ "More" menu. */}
        {!task.done && (
          <button
            onClick={() => { setEditing(false); setExpanded(v => !v); }}
            className="text-content-faint hover:text-brand-600 opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity shrink-0"
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
            onLogTime={onLogTime}
            onEditDependencies={onEditDependencies}
          />
        )}

        {/* Done rows still need a way out. */}
        {task.done && (
          <button
            onClick={() => onDelete(task.id)}
            className="text-content-faint hover:text-rose-500 opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity shrink-0"
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
          className="ml-7 mt-0.5 block text-left text-xs text-content-muted hover:text-content-secondary line-clamp-2 max-w-full break-words"
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

type SubView = 'root' | 'schedule' | 'estimate' | 'repeat' | 'list' | 'logtime';

export function TaskActionsMenu({
  task, today, onPatch, onDelete, onEditDetails, lists,
  canFlag = false, orbitEnabled = false, canSomeday = false, enableRecurrence = false,
  calConnected = false, onTimeBlock, onUnblock, onLogTime, onEditDependencies,
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
  onLogTime?: (minutes: number, day: string) => void;
  onEditDependencies?: () => void;
}) {
  return (
    <Popover
      icon={<MoreHorizontal className="w-4 h-4 text-content-faint hover:text-content-secondary" />}
      title="More"
      triggerClassName="shrink-0 opacity-0 group-hover:opacity-100 touch:opacity-100 transition-opacity"
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
          onLogTime={onLogTime}
          onEditDependencies={onEditDependencies}
          close={close}
        />
      )}
    </Popover>
  );
}

function MenuBody({
  task, today, onPatch, onDelete, onEditDetails, lists,
  canFlag, orbitEnabled, canSomeday, enableRecurrence, calConnected, onTimeBlock, onUnblock, onLogTime, onEditDependencies, close,
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
  onLogTime?: (minutes: number, day: string) => void;
  onEditDependencies?: () => void;
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
  if (view === 'logtime' && onLogTime) {
    return <SubPanel title="Log time worked" onBack={() => setView('root')}>
      <LogTimeOptions task={task} today={today} onLogTime={onLogTime} onDone={close} />
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
      {onLogTime && (
        <MenuItem icon={<History className="w-4 h-4" />} label="Log time…" onClick={() => setView('logtime')} chevron />
      )}
      {enableRecurrence && (
        <MenuItem icon={<Repeat className="w-4 h-4" />} label="Repeat…" onClick={() => setView('repeat')} chevron />
      )}
      {lists && (
        <MenuItem icon={<ListPlus className="w-4 h-4" />} label="Move to list…" onClick={() => setView('list')} chevron />
      )}
      {onEditDependencies && (
        <MenuItem icon={<Lock className="w-4 h-4" />} label="Dependencies…" onClick={() => { onEditDependencies(); close(); }} />
      )}
      {canFlag && (
        <MenuItem
          icon={<Star className="w-4 h-4" fill={task.flagged ? 'currentColor' : 'none'} />}
          label={task.flagged ? 'Unflag' : 'Flag as Important'}
          onClick={() => { onPatch(task.id, { flagged: !task.flagged }); close(); }}
        />
      )}
      {canFlag && (
        <MenuItem
          icon={<Zap className="w-4 h-4" fill={task.estimate_minutes === QUICK_TASK_MINUTES ? 'currentColor' : 'none'} />}
          label={task.estimate_minutes === QUICK_TASK_MINUTES ? 'Not a quick task' : 'Quick task (15 min)'}
          onClick={() => { onPatch(task.id, { estimate_minutes: task.estimate_minutes === QUICK_TASK_MINUTES ? null : QUICK_TASK_MINUTES }); close(); }}
        />
      )}
      {canFlag && (
        <MenuItem
          icon={<Heart className="w-4 h-4" fill={task.feel_good ? 'currentColor' : 'none'} />}
          label={task.feel_good ? 'Remove feel-good' : 'Feel-good'}
          onClick={() => { onPatch(task.id, { feel_good: !task.feel_good }); close(); }}
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
      <div className="my-1 border-t border-edge-soft" />
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
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-sm rounded hover:bg-surface-sunken ${rose ? 'text-rose-600 hover:bg-rose-50' : 'text-content'}`}
    >
      <span className={rose ? 'text-rose-500' : 'text-content-muted'}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {chevron && <ChevronRight className="w-3.5 h-3.5 text-content-faint" />}
    </button>
  );
}

function SubPanel({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="min-w-[12rem]">
      <button onClick={onBack} className="flex w-full items-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-content-secondary hover:text-content border-b border-edge-soft">
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
      <CalendarPlus className="w-4 h-4 text-content-muted shrink-0" />
      <input
        type="time"
        value={time}
        onChange={e => setTime(e.target.value)}
        className="text-sm border border-edge rounded px-1.5 py-0.5 w-[6.5rem]"
      />
      <button onClick={() => onTimeBlock(time)} className="text-xs font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 rounded px-2 py-1">Block</button>
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
        className="text-sm border border-edge rounded px-2 py-1 w-full"
      />
      {task.due_date && (
        <button
          onClick={() => { onPatch(task.id, { due_date: null, someday: false }); onDone(); }}
          className="mt-1 block w-full text-left px-1 py-1 text-xs text-content-muted hover:text-content-secondary"
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
          className={`block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-surface-sunken ${task.estimate_minutes === p ? 'text-brand-600 font-medium' : 'text-content'}`}
        >
          {formatMinutes(p)}
        </button>
      ))}
      <button
        onClick={() => { onPatch(task.id, { estimate_minutes: null }); onDone(); }}
        className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-surface-sunken text-content-muted"
      >
        No estimate
      </button>
    </div>
  );
}

// Set an absolute reminder time. Quick presets cover the common cases; the
// datetime field is there for anything specific. Setting a time clears any
// prior "sent" stamp so a rescheduled reminder fires again.
function ReminderOptions({
  task, onPatch, onDone,
}: {
  task: PlannerTask;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDone: () => void;
}) {
  const [val, setVal] = useState(task.remind_at ? toLocalInput(task.remind_at) : '');
  function apply(d: Date) { onPatch(task.id, { remind_at: d.toISOString(), reminder_sent_at: null }); onDone(); }
  const presets: [string, () => Date][] = [
    ['In 1 hour', () => new Date(Date.now() + 60 * 60_000)],
    ['This evening (6pm)', () => { const d = new Date(); d.setHours(18, 0, 0, 0); if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1); return d; }],
    ['Tomorrow 9am', () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }],
    ['Next week', () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); return d; }],
  ];
  return (
    <div className="p-2 w-60">
      {presets.map(([label, mk]) => (
        <button key={label} onClick={() => apply(mk())} className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-surface-sunken text-content">
          {label}
        </button>
      ))}
      <div className="mt-1 pt-2 border-t border-edge-soft px-1">
        <input
          type="datetime-local"
          value={val}
          onChange={e => setVal(e.target.value)}
          className="w-full text-sm rounded-control border border-edge bg-surface px-2 py-1 text-content"
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => { if (val) apply(new Date(val)); }}
            disabled={!val}
            className={`text-xs font-medium rounded-control px-2.5 py-1 ${val ? 'bg-brand-600 text-brand-fg hover:bg-brand-700' : 'text-content-faint cursor-default'}`}
          >
            Set
          </button>
          {task.remind_at && (
            <button
              onClick={() => { onPatch(task.id, { remind_at: null, reminder_sent_at: null }); onDone(); }}
              className="text-xs font-medium text-content-muted hover:text-rose-500"
            >
              Clear reminder
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ISO (UTC) → the value a <input type="datetime-local"> expects (local, no zone).
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

// A compact chip label for a set reminder: "Bell · Fri 3:00 PM" style, trimmed.
function reminderLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

// Retroactively log time actually worked: pick the day (defaults to the to-do's
// own day) and a duration. Lands in the Logbook + Stats like a timer run would.
function LogTimeOptions({
  task, today, onLogTime, onDone,
}: {
  task: PlannerTask;
  today: string;
  onLogTime: (minutes: number, day: string) => void;
  onDone: () => void;
}) {
  const [day, setDay] = useState(task.due_date ?? today);
  const [custom, setCustom] = useState('');
  const log = (m: number) => { if (m > 0) { onLogTime(m, day); onDone(); } };
  return (
    <div className="p-2 min-w-[12rem]">
      <label className="block text-[11px] font-medium text-content-muted mb-1">Day worked</label>
      <input
        type="date"
        value={day}
        max={today}
        onChange={e => setDay(e.target.value || today)}
        className="text-sm border border-edge rounded px-2 py-1 w-full mb-2"
      />
      <div className="grid grid-cols-3 gap-1 mb-2">
        {ESTIMATE_PRESETS.map(p => (
          <button
            key={p}
            onClick={() => log(p)}
            className="text-xs px-2 py-1 rounded border border-edge text-content hover:bg-surface-sunken"
          >
            {formatMinutes(p)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') log(parseInt(custom, 10) || 0); }}
          placeholder="min"
          className="w-16 text-sm border border-edge rounded px-2 py-1"
        />
        <button
          onClick={() => log(parseInt(custom, 10) || 0)}
          className="flex-1 text-xs font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 rounded px-2 py-1.5"
        >
          Log time
        </button>
      </div>
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
          className={`block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-surface-sunken ${task.recurrence === r ? 'text-brand-600 font-medium' : 'text-content'}`}
        >
          {recurrenceLabel(r)}
        </button>
      ))}

      {showCustom ? (
        <div className="px-3 py-1.5 flex items-center gap-1.5">
          <span className="text-sm text-content-secondary">Every</span>
          <input
            type="number"
            min="1"
            value={count}
            onChange={e => setCount(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyCustom(); }}
            className="w-12 text-sm border border-edge rounded px-1.5 py-0.5"
          />
          <select
            value={unit}
            onChange={e => setUnit(e.target.value as RecurrenceUnit)}
            className="text-sm border border-edge rounded px-1 py-0.5"
          >
            <option value="day">days</option>
            <option value="week">weeks</option>
            <option value="month">months</option>
          </select>
          <button onClick={applyCustom} className="text-xs font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 rounded px-2 py-1">Set</button>
        </div>
      ) : (
        <button
          onClick={() => setShowCustom(true)}
          className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-surface-sunken text-content"
        >
          Custom…
        </button>
      )}

      <button
        onClick={() => { onPatch(task.id, { recurrence: null }); onDone(); }}
        className="block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-surface-sunken text-content-muted border-t border-edge-soft"
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
          className={`block w-full text-left px-3 py-1.5 text-sm rounded hover:bg-surface-sunken truncate ${task.note_id === l.id ? 'text-brand-600 font-medium' : 'text-content'}`}
        >
          {l.title.trim() || 'Untitled list'}
        </button>
      ))}
      <button
        onClick={() => { onPatch(task.id, { note_id: null }); onDone(); }}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm rounded hover:bg-surface-sunken border-t border-edge-soft ${task.note_id ? 'text-content-secondary' : 'text-brand-600 font-medium'}`}
      >
        <Inbox className="w-4 h-4 text-content-muted" /> Inbox (no list)
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
    <div className="ml-7 mt-2 mb-1 rounded-card border border-edge bg-surface-hover/70 p-3 space-y-3">
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
          className="flex-1 text-sm font-medium bg-transparent outline-none border-b border-transparent focus:border-brand-400 text-content"
        />
        {showTimer && <TimerButton task={task} onPatch={onPatch} />}
        <button onClick={onClose} className="text-xs font-medium text-content-muted hover:text-brand-600 shrink-0" title="Close">
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

        <ChipPicker
          active={!!task.remind_at}
          icon={<Bell className="w-3.5 h-3.5" />}
          label={task.remind_at ? reminderLabel(task.remind_at) : 'Remind'}
        >
          {close => <ReminderOptions task={task} onPatch={onPatch} onDone={close} />}
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
            className={`inline-flex items-center gap-1 text-xs font-medium rounded-control border px-2 py-1 transition-colors ${
              task.flagged ? 'border-amber-200 bg-amber-50 text-amber-600' : 'border-edge text-content-secondary hover:text-amber-500 hover:border-amber-200'
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

      {/* Activity history — created / edited / completed / repeated, newest first. */}
      <ActivitySection taskId={task.id} version={task.updated_at} />
    </div>
  );
}

// A collapsible "Activity" feed for a to-do: its recorded history (created,
// scheduled, completed, repeated, …), newest first. Lazily loaded when opened,
// and refreshed whenever the to-do changes (its updated_at moves).
function ActivitySection({ taskId, version }: { taskId: string; version: string }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<PlannerTaskEvent[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    listTaskEvents(taskId)
      .then(e => { if (alive) setEvents(e); })
      .catch(() => { if (alive) setEvents([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, taskId, version]);

  return (
    <div className="border-t border-edge-soft pt-2">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-xs font-medium text-content-muted hover:text-content">
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <History className="w-3.5 h-3.5" /> Activity
      </button>
      {open && (
        <div className="mt-2 pl-1">
          {loading && !events ? (
            <p className="text-xs text-content-muted">Loading…</p>
          ) : !events || events.length === 0 ? (
            <p className="text-xs text-content-muted">No activity recorded yet.</p>
          ) : (
            <ul className="space-y-1">
              {events.map(ev => (
                <li key={ev.id} className="flex items-baseline gap-2 text-xs">
                  <span className="text-content-secondary">{activityLabel(ev)}</span>
                  <span className="ml-auto shrink-0 text-content-muted" title={new Date(ev.created_at).toLocaleString()}>{relativeTime(ev.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// A human phrase for an activity event.
function activityLabel(ev: PlannerTaskEvent): string {
  switch (ev.type) {
    case 'created': return 'Created';
    case 'completed': return 'Completed';
    case 'reopened': return 'Marked not done';
    case 'repeated': return ev.detail ? `Repeated → next ${ev.detail}` : 'Repeated';
    case 'scheduled': return ev.detail ? `Scheduled for ${ev.detail}` : 'Scheduled';
    case 'unscheduled': return 'Unscheduled';
    case 'moved': return ev.detail ? `Moved to ${ev.detail}` : 'Moved to another list';
    case 'flagged': return 'Flagged as Important';
    case 'unflagged': return 'Unflagged';
    case 'estimated': return ev.detail ? `Estimate set to ${ev.detail}` : 'Estimate set';
    case 'renamed': return 'Renamed';
    case 'edited': return ev.detail ? `Edited (${ev.detail})` : 'Edited';
    default: return ev.type;
  }
}

// Compact "3h ago" / "2d ago" relative time; falls back to a date for older.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
        <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-control border px-2 py-1 transition-colors ${
          active ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-edge text-content-secondary hover:text-brand-600 hover:border-brand-200'
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
    <div className="pl-3 border-l-2 border-edge space-y-1">
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2 group/ci">
          <button
            onClick={() => toggle(item.id)}
            className={`shrink-0 ${item.done ? 'text-brand-600' : 'text-content-faint hover:text-brand-600'}`}
          >
            {item.done
              ? <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand-600 text-brand-fg"><Check className="w-2.5 h-2.5" /></span>
              : <Circle className="w-4 h-4" />}
          </button>
          <input
            value={item.title}
            onChange={e => rename(item.id, e.target.value)}
            className={`flex-1 text-sm bg-transparent outline-none ${item.done ? 'text-content-muted line-through' : 'text-content-secondary'}`}
          />
          <button
            onClick={() => remove(item.id)}
            className="text-content-faint hover:text-rose-500 opacity-0 group-hover/ci:opacity-100 touch:opacity-100 transition-opacity shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Plus className="w-3.5 h-3.5 text-content-faint shrink-0" />
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); }}
          placeholder="Add a sub-step…"
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-content-faint text-content-secondary"
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
            className="fixed z-50 min-w-[8rem] max-h-[70vh] overflow-y-auto bg-surface border border-edge rounded-control shadow-lg py-0.5"
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
