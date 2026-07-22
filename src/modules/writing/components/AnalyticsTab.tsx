import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, Tooltip } from 'recharts';
import { Link2, Target, BarChart3 } from 'lucide-react';
import CatalogBookPicker from '../../../components/CatalogBookPicker';
import { listManuscriptWordLogs, updateManuscript } from '../api';
import type { Book } from '../../catalog/types';
import type { Manuscript, ManuscriptChapter, ManuscriptWordLog } from '../types';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Everything measurement-related, moved out of the Write tab (directive
// §8.2): totals, per-chapter word counts, a manuscript-level goal + progress
// bar (manuscripts.target_word_count — the goal now lives on the manuscript,
// NOT the linked Catalog book), a 30-day daily-words chart sourced from
// manuscript_word_logs (works with no Catalog link at all), and — at the
// bottom — the Connections card, the only remaining home of CatalogBookPicker.
export default function AnalyticsTab({
  manuscript,
  chapters,
  onManuscriptUpdate,
  onChangeBook,
}: {
  manuscript: Manuscript;
  chapters: ManuscriptChapter[];
  onManuscriptUpdate: (updated: Manuscript) => void;
  onChangeBook: (bookId: string | null) => void;
}) {
  const [logs, setLogs] = useState<ManuscriptWordLog[]>([]);
  const [goalDraft, setGoalDraft] = useState(manuscript.target_word_count?.toString() ?? '');
  const [savingGoal, setSavingGoal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listManuscriptWordLogs(manuscript.id).then(rows => { if (!cancelled) setLogs(rows); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [manuscript.id]);

  useEffect(() => {
    setGoalDraft(manuscript.target_word_count?.toString() ?? '');
  }, [manuscript.target_word_count]);

  async function saveGoal() {
    const trimmed = goalDraft.trim();
    const value = trimmed === '' ? null : Math.max(0, Math.round(Number(trimmed)));
    if (value === manuscript.target_word_count || (trimmed !== '' && !Number.isFinite(value))) return;
    setSavingGoal(true);
    try {
      const updated = await updateManuscript(manuscript.id, { target_word_count: value });
      onManuscriptUpdate(updated);
    } finally {
      setSavingGoal(false);
    }
  }

  const target = manuscript.target_word_count;
  const pct = target ? Math.min(100, Math.round((manuscript.word_count / target) * 100)) : null;
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const recent = logs.filter(l => new Date(l.day).getTime() >= cutoff);
  const maxChapterWords = Math.max(1, ...chapters.map(c => c.word_count ?? 0));

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-surface rounded-card border border-edge p-4 flex flex-col justify-center">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-3xl font-bold text-content leading-tight">{manuscript.word_count.toLocaleString()}</p>
          <p className="text-sm text-content-muted">total words · {chapters.length} chapter{chapters.length === 1 ? '' : 's'}</p>
        </div>
      </div>

      <div className="bg-surface rounded-card border border-edge p-4">
        <h3 className="text-sm font-semibold text-content flex items-center gap-1.5 mb-3">
          <Target className="w-4 h-4 text-brand-500" /> Goal
        </h3>
        <div className="flex items-center gap-3 mb-2">
          <input
            type="number"
            min={0}
            value={goalDraft}
            onChange={e => setGoalDraft(e.target.value)}
            onBlur={saveGoal}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="No goal set"
            disabled={savingGoal}
            className="w-40 px-3 py-1.5 border border-edge-strong rounded-control text-sm"
          />
          <span className="text-xs text-content-muted">target word count</span>
          {pct !== null && <span className="text-xs text-content-secondary ml-auto">{pct}%</span>}
        </div>
        {target ? (
          <div className="h-2.5 bg-surface-sunken rounded-full overflow-hidden">
            <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        ) : (
          <p className="text-xs text-content-muted">Set a target word count to track progress toward it.</p>
        )}
      </div>
      </div>

      <div className="bg-surface rounded-card border border-edge p-4">
        <h3 className="text-sm font-semibold text-content flex items-center gap-1.5 mb-3">
          <BarChart3 className="w-4 h-4 text-brand-500" /> Daily words — last 30 days
        </h3>
        {recent.length > 1 ? (
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={recent}>
                <defs>
                  <linearGradient id="writingAnalyticsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#84cc16" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#84cc16" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="word_count" stroke="#65a30d" strokeWidth={2} fill="url(#writingAnalyticsFill)" />
                <Tooltip
                  formatter={(value: number) => [`${value.toLocaleString()} words`, '']}
                  labelFormatter={(label: string) => new Date(label).toLocaleDateString()}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-content-muted">Write and save to start building this chart.</p>
        )}
      </div>

      <div className="bg-surface rounded-card border border-edge p-4">
        <h3 className="text-sm font-semibold text-content mb-3">Per-chapter word counts</h3>
        {chapters.length === 0 ? (
          <p className="text-xs text-content-muted">No chapters yet.</p>
        ) : (
          <div className="space-y-2">
            {chapters.map(c => (
              <div key={c.id} className="flex items-center gap-3">
                <span className="text-xs text-content-secondary w-40 truncate shrink-0">{c.title || 'Untitled chapter'}</span>
                <div className="flex-1 h-3 bg-surface-sunken rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-400 rounded-full"
                    style={{ width: `${Math.max(2, ((c.word_count ?? 0) / maxChapterWords) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-content-muted w-16 text-right shrink-0">{(c.word_count ?? 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-surface rounded-card border border-edge p-4">
        <h3 className="text-sm font-semibold text-content flex items-center gap-1.5 mb-1">
          <Link2 className="w-4 h-4 text-brand-500" /> Connections
        </h3>
        <p className="text-xs text-content-secondary mb-3">Status and word count sync to this book in Catalog.</p>
        <div className="max-w-sm">
          <CatalogBookPicker value={manuscript.book_id} onChange={(id: string, _book: Book) => onChangeBook(id)} />
        </div>
      </div>
    </div>
  );
}
