import { useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, Tooltip } from 'recharts';
import { getBook, listWordLogs } from '../../catalog/api';
import type { Book, BookWordLog } from '../../catalog/types';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Small header widget shown when a manuscript is linked to a Catalog book:
// current words vs the book's target, plus a 30-day sparkline of daily word
// counts (reusing Catalog's existing book_word_logs history).
export default function ProgressWidget({ bookId, currentWordCount }: { bookId: string; currentWordCount: number }) {
  const [book, setBook] = useState<Book | null>(null);
  const [logs, setLogs] = useState<BookWordLog[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getBook(bookId), listWordLogs(bookId)])
      .then(([b, l]) => { if (!cancelled) { setBook(b); setLogs(l); } })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [bookId]);

  if (!book) return null;

  const target = book.target_word_count;
  const pct = target ? Math.min(100, Math.round((currentWordCount / target) * 100)) : null;
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const recent = logs.filter(l => new Date(l.day).getTime() >= cutoff);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex items-center gap-6">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-1.5">
          <p className="text-sm font-medium text-slate-700">
            {currentWordCount.toLocaleString()} words{target ? ` of ${target.toLocaleString()}` : ''}
          </p>
          {pct !== null && <p className="text-xs text-slate-400 shrink-0">{pct}%</p>}
        </div>
        {target ? (
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-lime-500 rounded-full" style={{ width: `${pct}%` }} />
          </div>
        ) : (
          <p className="text-xs text-slate-400">Set a target word count on the linked book to track progress.</p>
        )}
      </div>

      {recent.length > 1 && (
        <div className="w-40 h-12 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={recent}>
              <defs>
                <linearGradient id="writingProgressFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#84cc16" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#84cc16" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="word_count" stroke="#65a30d" strokeWidth={2} fill="url(#writingProgressFill)" />
              <Tooltip
                formatter={(value: number) => [`${value.toLocaleString()} words`, '']}
                labelFormatter={(label: string) => new Date(label).toLocaleDateString()}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
