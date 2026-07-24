import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CircleDashed, Loader2, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import type { Book } from '../types';
import { languageLabel } from '../types';
import {
  getBookChecklist,
  setOpportunityDecision,
  clearOpportunityDecision,
  type BookChecklist as ChecklistData,
} from '../../../lib/dashboard';
import type { Opportunity, OpportunityDecisionValue } from '../../../lib/opportunities';
import PipelineOptions from './PipelineOptions';

// Per-book opportunity checklist (redesign directive §6): the FULL engine
// output for one book — formats, translations, audiobook, keywords, ARC —
// with done ✓ rows derived here and gap rows carrying Start / Planned /
// Dismiss. Decisions write to book_opportunity_decisions, the same table the
// Home widget reads, so a dismissal here disappears there too.
//
// Note: the directive calls this a "tab", but BookView is a stack of
// collapsible sections, not tabs — codebase convention wins, so it ships as
// a section (flagged in the PR).

interface DoneRow {
  key: string;
  label: string;
}

export default function BookChecklist({ book }: { book: Book }) {
  const { user } = useAuth();
  const [data, setData] = useState<ChecklistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);

  const load = useCallback(() => {
    if (!user) return;
    setLoading(true);
    setError(null);
    getBookChecklist(user.id, book.id)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [user, book.id]);

  useEffect(() => { load(); }, [load]);

  // What's already DONE — the engine only reports gaps, but the checklist
  // should celebrate the finished items too.
  const doneRows = useMemo<DoneRow[]>(() => {
    const rows: DoneRow[] = [];
    if (book.ebook_price != null) rows.push({ key: 'format:ebook', label: 'Ebook priced' });
    if (book.paperback_price != null) rows.push({ key: 'format:paperback', label: 'Paperback priced' });
    if (book.hardcover_price != null) rows.push({ key: 'format:hardcover', label: 'Hardcover priced' });
    if (book.isbn_audiobook) rows.push({ key: 'audiobook', label: 'Audiobook published' });
    // Keywords count whether typed here or selected in the KDP Optimizer.
    const keywordCount = book.amazon_keywords.length || (data?.kdpKeywordCount ?? 0);
    if (keywordCount > 0) rows.push({ key: 'kdp', label: `Amazon keywords (${keywordCount})` });
    if (book.include_in_arcs) rows.push({ key: 'arc', label: 'Taking ARC applications' });
    for (const code of data?.translationsDone ?? []) {
      rows.push({ key: `translation:${code}`, label: `${languageLabel(code)} translation` });
    }
    return rows;
  }, [book, data?.translationsDone, data?.kdpKeywordCount]);

  async function decide(o: Opportunity, decision: OpportunityDecisionValue) {
    if (!user || busyKey) return;
    setBusyKey(o.key);
    try {
      if (o.decision === decision) {
        await clearOpportunityDecision(user.id, book.id, o.key);
      } else {
        await setOpportunityDecision(user.id, book.id, o.key, decision);
      }
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusyKey(null);
    }
  }

  // Translations point at their original — their checklist lives there.
  if (book.parent_book_id) {
    return (
      <p className="text-sm text-content-secondary">
        This is a translation{data?.parentTitle ? ` of “${data.parentTitle}”` : ''} — the checklist lives on the original book.
      </p>
    );
  }

  if (loading) {
    return <p className="text-sm text-content-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking what this book could still become…</p>;
  }
  if (error) {
    return <p className="text-sm text-content-secondary">Couldn't load the checklist: {error}</p>;
  }
  if (!data) return null;

  // Sort: actionable first (by score), then planned, then dismissed.
  const gaps = [...data.opportunities].sort((a, b) => {
    const rank = (o: Opportunity) => (o.decision === 'dismissed' ? 2 : o.decision === 'planned' ? 1 : 0);
    return rank(a) - rank(b) || b.score - a.score;
  });

  return (
    <div className="space-y-4">
      {/* Pipeline ring + options */}
      <div className="flex items-center gap-4">
        <PipelineRing percent={data.pipelinePercent} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-content">{data.pipelinePercent}% through the pipeline</p>
          <p className="text-xs text-content-secondary">
            Manuscript → editing → release → formats → audiobook. Dismissed items count as done.
          </p>
        </div>
        <button
          onClick={() => setShowOptions(true)}
          className="ml-auto shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-control text-xs font-medium text-content-secondary hover:text-content hover:bg-surface-hover"
          title="Choose which suggestions the pipeline shows"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" /> Options
        </button>
      </div>

      <PipelineOptions open={showOptions} onClose={() => setShowOptions(false)} onSaved={load} />

      {doneRows.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          {doneRows.map(r => (
            <li key={r.key} className="flex items-center gap-2 text-sm text-content-secondary">
              <Check className="w-4 h-4 text-emerald-500 shrink-0" /> {r.label}
            </li>
          ))}
        </ul>
      )}

      {gaps.length === 0 ? (
        <p className="text-sm text-content-muted">Nothing left to build for this book. 🎉</p>
      ) : (
        <ul className="divide-y divide-edge-soft">
          {gaps.map(o => {
            const dismissed = o.decision === 'dismissed';
            const planned = o.decision === 'planned';
            return (
              <li key={o.key} className={`flex items-center gap-2.5 py-2 text-sm ${dismissed ? 'opacity-50' : ''}`}>
                <CircleDashed className={`w-4 h-4 shrink-0 ${planned ? 'text-brand-500' : 'text-content-faint'}`} />
                <span className={`flex-1 min-w-0 truncate ${dismissed ? 'line-through text-content-muted' : 'text-content'}`} title={o.label}>
                  {o.label}
                </span>
                {planned && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded-control bg-brand-100 text-brand-700 text-[10px] font-semibold uppercase tracking-wide">
                    Planned
                  </span>
                )}
                {dismissed ? (
                  <button
                    onClick={() => decide(o, 'dismissed')}
                    disabled={busyKey === o.key}
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-control text-xs text-content-secondary hover:text-content hover:bg-surface-hover"
                    title="Un-dismiss — suggest this again"
                  >
                    <RotateCcw className="w-3 h-3" /> Not planned
                  </button>
                ) : (
                  <>
                    <Link
                      to={o.href}
                      className="shrink-0 px-2 py-0.5 rounded-control text-xs font-medium text-brand-600 hover:bg-brand-50"
                    >
                      Start
                    </Link>
                    <button
                      onClick={() => decide(o, 'planned')}
                      disabled={busyKey === o.key}
                      className={`shrink-0 px-2 py-0.5 rounded-control text-xs font-medium ${planned ? 'text-content-secondary hover:bg-surface-hover' : 'text-brand-600 hover:bg-brand-50'}`}
                      title={planned ? 'Remove the planned mark' : 'Mark as planned — keeps it on the list as a todo'}
                    >
                      {planned ? 'Unplan' : 'Plan'}
                    </button>
                    <button
                      onClick={() => decide(o, 'dismissed')}
                      disabled={busyKey === o.key}
                      className="shrink-0 p-1 rounded-control text-content-faint hover:text-rose-500 hover:bg-rose-50"
                      title="Not planned — don't suggest this again"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PipelineRing({ percent }: { percent: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" className="shrink-0 -rotate-90">
      <circle cx="34" cy="34" r={r} fill="none" strokeWidth="7" className="stroke-surface-sunken" />
      <circle
        cx="34" cy="34" r={r} fill="none" strokeWidth="7" strokeLinecap="round"
        className="stroke-brand-500"
        strokeDasharray={`${(percent / 100) * c} ${c}`}
      />
      <text x="34" y="34" textAnchor="middle" dominantBaseline="central" className="fill-content rotate-90 origin-center text-sm font-semibold tabular-nums">
        {percent}
      </text>
    </svg>
  );
}
