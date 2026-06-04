import { useEffect, useRef, useState } from 'react';
import type { PlannerTask } from './types';

// Expandable freeform body for a to-do — a draft, links, context. Local state
// while typing; saved on blur so we don't write on every keystroke. Auto-grows
// to fit its content. Rendered below a to-do row when its notes are open.
export function TaskNotes({
  task, onPatch, autoFocus = false,
}: {
  task: PlannerTask;
  onPatch: (id: string, patch: Partial<PlannerTask>) => void;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(task.notes ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);

  // Re-sync if a different task reuses this slot, or the body changes elsewhere.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setValue(task.notes ?? ''); }, [task.id]);

  // Grow to fit content.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  function commit() {
    const next = value.trim() ? value : null;
    if ((task.notes ?? null) !== (next ?? null)) onPatch(task.id, { notes: next });
  }

  return (
    <textarea
      ref={ref}
      autoFocus={autoFocus}
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={commit}
      placeholder="Notes, a draft, links…"
      className="w-full text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-teal-400 resize-none placeholder:text-slate-300 leading-relaxed min-h-[4.5rem]"
    />
  );
}
