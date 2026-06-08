import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Loader2, X } from 'lucide-react';
import type { AiResult } from './aiAssist';
import type { PlannerTask } from './types';

// Shared overlay for the three AI planning features. Shows a spinner while
// Claude thinks, the error if the call fails (e.g. no API key configured), or a
// checklist of suggestions you can trim before applying. Violet accents mark it
// as the AI surface, matching the Orbit star.
export function AiSuggestPanel({
  open, title, intro, loading, error, result, tasksById, showDates, onApply, onClose,
}: {
  open: boolean;
  title: string;
  intro: string;
  loading: boolean;
  error: string | null;
  result: AiResult | null;
  tasksById: Record<string, PlannerTask>;
  showDates: boolean;
  onApply: (picks: { id: string; date: string | null }[]) => void;
  onClose: () => void;
}) {
  // Which suggestion ids are checked (and so will be applied). Defaults to all
  // suggestions when a fresh result lands.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (result) setChecked(new Set(result.suggestions.map(s => s.id)));
  }, [result]);

  if (!open) return null;

  // Suggestions whose task we can actually resolve (skip stale ids).
  const rows = (result?.suggestions ?? []).filter(s => tasksById[s.id]);
  const applyCount = rows.filter(s => checked.has(s.id)).length;

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function apply() {
    const picks = rows.filter(s => checked.has(s.id)).map(s => ({ id: s.id, date: s.date }));
    onApply(picks);
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:pt-24 bg-black/30" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <Sparkles className="w-4 h-4 text-violet-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-800 truncate">{title}</h3>
            <p className="text-xs text-slate-400 truncate">{intro}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0"><X className="w-4 h-4" /></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 text-violet-600 animate-spin" /> Thinking…
          </div>
        ) : error ? (
          <div className="px-4 py-6">
            <p className="text-sm text-rose-600">{error}</p>
            <div className="mt-4 text-right">
              <button onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-700 rounded-lg px-3 py-1.5">Close</button>
            </div>
          </div>
        ) : result ? (
          <>
            {result.summary && <p className="px-4 pt-3 text-sm text-slate-600">{result.summary}</p>}
            {rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">No suggestions this time.</p>
            ) : (
              <ul className="max-h-[50vh] overflow-y-auto px-2 py-2 space-y-0.5">
                {rows.map(s => {
                  const task = tasksById[s.id];
                  const on = checked.has(s.id);
                  return (
                    <li key={s.id}>
                      <label className="flex items-start gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(s.id)}
                          className="mt-0.5 w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500 shrink-0"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="flex-1 text-sm text-slate-700 truncate">{task.title || 'Untitled'}</span>
                            {showDates && s.date && (
                              <span className="text-xs font-medium text-violet-600 shrink-0">{shortDate(s.date)}</span>
                            )}
                          </span>
                          {s.reason && <span className="block text-xs text-slate-400 mt-0.5">{s.reason}</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {rows.length > 0 && (
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-100">
                <button onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-700 rounded-lg px-3 py-1.5">Cancel</button>
                <button
                  onClick={apply}
                  disabled={applyCount === 0}
                  className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
                    applyCount > 0 ? 'bg-violet-600 text-white hover:bg-violet-700' : 'bg-slate-100 text-slate-300 cursor-default'
                  }`}
                >
                  Apply {applyCount}
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

// "Mon Jun 9" — short, day-of-week-prefixed label for a YYYY-MM-DD date.
function shortDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
