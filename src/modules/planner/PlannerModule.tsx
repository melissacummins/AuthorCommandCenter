import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  NotebookPen, Plus, Check, Circle, Trash2, Pin, PinOff, Archive,
  CalendarClock, Layers, Sparkles, Moon, Inbox, X,
} from 'lucide-react';
import {
  listNotes, createNote, updateNote, deleteNote,
  listTasks, createTask, updateTask, deleteTask,
} from './api';
import {
  bucketForTask, formatDue, todayISO,
  type PlannerNote, type PlannerTask, type Bucket,
} from './types';

type Selection = { kind: 'view'; bucket: Bucket } | { kind: 'note'; id: string };

const VIEWS: { bucket: Bucket; label: string; icon: typeof Inbox; color: string }[] = [
  { bucket: 'today',    label: 'Today',    icon: Sparkles,      color: 'text-amber-500' },
  { bucket: 'upcoming', label: 'Upcoming', icon: CalendarClock, color: 'text-rose-500' },
  { bucket: 'anytime',  label: 'Anytime',  icon: Layers,        color: 'text-teal-600' },
  { bucket: 'someday',  label: 'Someday',  icon: Moon,          color: 'text-indigo-500' },
];

export default function PlannerModule() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<PlannerNote[]>([]);
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'view', bucket: 'today' });
  const today = todayISO();

  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([listNotes(user.id), listTasks(user.id)])
      .then(([n, t]) => { if (active) { setNotes(n); setTasks(t); } })
      .catch(e => { if (active) setError(e?.message ?? 'Could not load your planner.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

  const notesById = useMemo(() => Object.fromEntries(notes.map(n => [n.id, n])), [notes]);
  const openCountByNote = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of tasks) if (t.note_id && !t.done) m[t.note_id] = (m[t.note_id] ?? 0) + 1;
    return m;
  }, [tasks]);

  const viewCounts = useMemo(() => {
    const c: Record<Bucket, number> = { today: 0, upcoming: 0, anytime: 0, someday: 0 };
    for (const t of tasks) if (!t.done) c[bucketForTask(t, today)]++;
    return c;
  }, [tasks, today]);

  // ---- mutations (optimistic where it helps responsiveness) ----

  async function handleNewNote() {
    if (!user) return;
    try {
      const note = await createNote(user.id, '');
      setNotes(prev => [note, ...prev]);
      setSelection({ kind: 'note', id: note.id });
    } catch (e) { setError((e as Error)?.message ?? 'Could not create note.'); }
  }

  function patchNoteLocal(id: string, patch: Partial<PlannerNote>) {
    setNotes(prev => prev.map(n => (n.id === id ? { ...n, ...patch } : n)));
  }

  async function saveNote(id: string, patch: Partial<PlannerNote>) {
    patchNoteLocal(id, patch);
    try { await updateNote(id, patch); }
    catch (e) { setError((e as Error)?.message ?? 'Could not save note.'); }
  }

  async function removeNote(id: string) {
    if (!confirm('Delete this note and its checklist? This can’t be undone.')) return;
    setNotes(prev => prev.filter(n => n.id !== id));
    setTasks(prev => prev.filter(t => t.note_id !== id));
    setSelection({ kind: 'view', bucket: 'today' });
    try { await deleteNote(id); }
    catch (e) { setError((e as Error)?.message ?? 'Could not delete note.'); }
  }

  async function addTask(input: { title: string; note_id?: string | null; due_date?: string | null; someday?: boolean }) {
    if (!user || !input.title.trim()) return;
    try {
      const task = await createTask(user.id, { ...input, title: input.title.trim() });
      setTasks(prev => [...prev, task]);
    } catch (e) { setError((e as Error)?.message ?? 'Could not add to-do.'); }
  }

  async function patchTask(id: string, patch: Partial<PlannerTask>) {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
    try { await updateTask(id, patch); }
    catch (e) { setError((e as Error)?.message ?? 'Could not update to-do.'); }
  }

  async function removeTask(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id));
    try { await deleteTask(id); }
    catch (e) { setError((e as Error)?.message ?? 'Could not delete to-do.'); }
  }

  const selectedNote = selection.kind === 'note' ? notesById[selection.id] : undefined;

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail: smart views + notes */}
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-slate-50/60 flex flex-col overflow-y-auto">
        <nav className="p-3 space-y-1">
          {VIEWS.map(v => {
            const Icon = v.icon;
            const active = selection.kind === 'view' && selection.bucket === v.bucket;
            const count = viewCounts[v.bucket];
            return (
              <button
                key={v.bucket}
                onClick={() => setSelection({ kind: 'view', bucket: v.bucket })}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                <Icon className={`w-4 h-4 ${v.color}`} />
                <span className="flex-1 text-left">{v.label}</span>
                {count > 0 && <span className="text-xs text-slate-400 font-medium">{count}</span>}
              </button>
            );
          })}
        </nav>

        <div className="px-4 pt-3 pb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Notes</span>
          <button onClick={handleNewNote} className="text-slate-400 hover:text-teal-600" title="New note">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <nav className="px-3 pb-4 space-y-1">
          {notes.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-400">No notes yet. Hit + to name one out.</p>
          )}
          {notes.map(n => {
            const active = selection.kind === 'note' && selection.id === n.id;
            const open = openCountByNote[n.id] ?? 0;
            return (
              <button
                key={n.id}
                onClick={() => setSelection({ kind: 'note', id: n.id })}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                {n.pinned ? <Pin className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <NotebookPen className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                <span className="flex-1 text-left truncate">{n.title.trim() || 'Untitled note'}</span>
                {open > 0 && <span className="text-xs text-slate-400">{open}</span>}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Detail */}
      <section className="flex-1 min-w-0 overflow-y-auto">
        {error && (
          <div className="m-4 flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}
        {loading ? (
          <div className="p-8 text-slate-400">Loading your planner…</div>
        ) : selection.kind === 'view' ? (
          <ViewPane
            bucket={selection.bucket}
            tasks={tasks}
            today={today}
            notesById={notesById}
            onAdd={addTask}
            onPatch={patchTask}
            onDelete={removeTask}
            onOpenNote={id => setSelection({ kind: 'note', id })}
          />
        ) : selectedNote ? (
          <NotePane
            key={selectedNote.id}
            note={selectedNote}
            tasks={tasks.filter(t => t.note_id === selectedNote.id)}
            today={today}
            onSaveNote={saveNote}
            onDeleteNote={removeNote}
            onAdd={addTask}
            onPatch={patchTask}
            onDelete={removeTask}
          />
        ) : (
          <div className="p-8 text-slate-400">Select a note or view.</div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ViewPane({
  bucket, tasks, today, notesById, onAdd, onPatch, onDelete, onOpenNote,
}: {
  bucket: Bucket;
  tasks: PlannerTask[];
  today: string;
  notesById: Record<string, PlannerNote>;
  onAdd: (i: { title: string; due_date?: string | null; someday?: boolean }) => void;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  onOpenNote: (id: string) => void;
}) {
  const meta = VIEWS.find(v => v.bucket === bucket)!;
  const Icon = meta.icon;
  const [draft, setDraft] = useState('');

  const items = tasks
    .filter(t => !t.done && bucketForTask(t, today) === bucket)
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));

  // Quick-add defaults that land the new task in this view.
  const addDefaults =
    bucket === 'today' ? { due_date: today } :
    bucket === 'someday' ? { someday: true } :
    {};

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Icon className={`w-6 h-6 ${meta.color}`} />
        <h2 className="text-2xl font-bold text-slate-800">{meta.label}</h2>
      </div>

      <QuickAdd
        value={draft}
        onChange={setDraft}
        placeholder={`Add to ${meta.label}…`}
        onSubmit={() => { onAdd({ title: draft, ...addDefaults }); setDraft(''); }}
      />

      {items.length === 0 ? (
        <p className="text-sm text-slate-400 mt-4">Nothing here right now.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {items.map(t => (
            <TaskRow
              key={t.id}
              task={t}
              today={today}
              noteName={t.note_id ? (notesById[t.note_id]?.title.trim() || 'Untitled note') : undefined}
              onOpenNote={t.note_id ? () => onOpenNote(t.note_id!) : undefined}
              onPatch={onPatch}
              onDelete={onDelete}
              showSchedule
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotePane({
  note, tasks, today, onSaveNote, onDeleteNote, onAdd, onPatch, onDelete,
}: {
  note: PlannerNote;
  tasks: PlannerTask[];
  today: string;
  onSaveNote: (id: string, patch: Partial<PlannerNote>) => void;
  onDeleteNote: (id: string) => void;
  onAdd: (i: { title: string; note_id: string }) => void;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [draft, setDraft] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  // Brand-new untitled notes open with the cursor in the title.
  useEffect(() => { if (!note.title) titleRef.current?.focus(); }, [note.id, note.title]);

  const open = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-start gap-3 mb-2">
        <input
          ref={titleRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (title !== note.title) onSaveNote(note.id, { title }); }}
          placeholder="Untitled note"
          className="flex-1 text-2xl font-bold text-slate-800 bg-transparent outline-none placeholder:text-slate-300"
        />
        <div className="flex items-center gap-1 pt-2">
          <button
            onClick={() => onSaveNote(note.id, { pinned: !note.pinned })}
            className={`p-2 rounded-lg hover:bg-slate-100 ${note.pinned ? 'text-amber-500' : 'text-slate-400'}`}
            title={note.pinned ? 'Unpin' : 'Pin to top'}
          >
            {note.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </button>
          <button
            onClick={() => onSaveNote(note.id, { archived: true })}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-100"
            title="Archive"
          >
            <Archive className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDeleteNote(note.id)}
            className="p-2 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500"
            title="Delete note"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        onBlur={() => { if (body !== note.body) onSaveNote(note.id, { body }); }}
        placeholder="Notes, links, anything you want to remember…"
        rows={3}
        className="w-full text-sm text-slate-600 bg-transparent outline-none resize-y placeholder:text-slate-400 mb-5"
      />

      <QuickAdd
        value={draft}
        onChange={setDraft}
        placeholder="Add a to-do…"
        onSubmit={() => { onAdd({ title: draft, note_id: note.id }); setDraft(''); }}
      />

      <ul className="mt-2 divide-y divide-slate-100">
        {open.map(t => (
          <TaskRow key={t.id} task={t} today={today} onPatch={onPatch} onDelete={onDelete} showSchedule />
        ))}
      </ul>

      {done.length > 0 && (
        <div className="mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Done</p>
          <ul className="divide-y divide-slate-100">
            {done.map(t => (
              <TaskRow key={t.id} task={t} today={today} onPatch={onPatch} onDelete={onDelete} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function QuickAdd({
  value, onChange, onSubmit, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <Plus className="w-4 h-4 text-slate-400 shrink-0" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSubmit(); }}
        placeholder={placeholder}
        className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400 text-slate-700"
      />
    </div>
  );
}

function TaskRow({
  task, today, noteName, onOpenNote, onPatch, onDelete, showSchedule = false,
}: {
  task: PlannerTask;
  today: string;
  noteName?: string;
  onOpenNote?: () => void;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  onDelete: (id: string) => void;
  showSchedule?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const overdue = !task.done && !!task.due_date && task.due_date < today;

  function commitTitle() {
    setEditing(false);
    const next = title.trim();
    if (next && next !== task.title) onPatch(task.id, { title: next });
    else setTitle(task.title);
  }

  return (
    <li className="flex items-center gap-3 py-2 group">
      <button
        onClick={() => onPatch(task.id, { done: !task.done })}
        className={`shrink-0 transition-colors ${task.done ? 'text-teal-600' : 'text-slate-300 hover:text-teal-600'}`}
        title={task.done ? 'Mark not done' : 'Mark done'}
      >
        {task.done
          ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-teal-600 text-white"><Check className="w-3.5 h-3.5" /></span>
          : <Circle className="w-5 h-5" />}
      </button>

      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setTitle(task.title); setEditing(false); } }}
          className="flex-1 text-sm bg-transparent outline-none border-b border-teal-400 text-slate-700"
        />
      ) : (
        <span
          onClick={() => !task.done && setEditing(true)}
          className={`flex-1 text-sm cursor-text ${task.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}
        >
          {task.title || 'Untitled'}
        </span>
      )}

      {noteName && (
        <button
          onClick={onOpenNote}
          className="text-xs text-slate-400 hover:text-teal-600 truncate max-w-[10rem] shrink-0"
        >
          {noteName}
        </button>
      )}

      {showSchedule && !task.done && (
        <div className="flex items-center gap-1 shrink-0">
          {task.due_date && (
            <span className={`text-xs font-medium ${overdue ? 'text-rose-500' : 'text-slate-500'}`}>
              {formatDue(task.due_date, today)}
            </span>
          )}
          <label className="relative cursor-pointer text-slate-300 hover:text-teal-600" title="Schedule a day">
            <CalendarClock className="w-4 h-4" />
            <input
              type="date"
              value={task.due_date ?? ''}
              onChange={e => onPatch(task.id, { due_date: e.target.value || null, someday: false })}
              className="absolute inset-0 opacity-0 cursor-pointer w-4"
            />
          </label>
          <button
            onClick={() => onPatch(task.id, { someday: !task.someday, due_date: null })}
            className={`${task.someday ? 'text-indigo-500' : 'text-slate-300 hover:text-indigo-500'}`}
            title={task.someday ? 'In Someday — click to move to Anytime' : 'Move to Someday'}
          >
            <Moon className="w-4 h-4" />
          </button>
        </div>
      )}

      <button
        onClick={() => onDelete(task.id)}
        className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        title="Delete"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </li>
  );
}
