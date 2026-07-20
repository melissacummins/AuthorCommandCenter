import type { TrackedBook, QuarterlyUpdate } from '../types';

interface Props {
  book: TrackedBook;
  updates: QuarterlyUpdate[];
}

// Cumulative-profit-vs-dev-cost stacked bars per quarter. The bar fills
// from gray (still in the red) to emerald (paid off) once the running
// total clears dev_cost. A horizontal dev-cost line shows the goalpost.
export default function BookTimeline({ book, updates }: Props) {
  const sorted = [...updates].sort((a, b) => (a.sort_key < b.sort_key ? -1 : 1));
  if (sorted.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-edge-strong p-6 text-center text-sm text-content-secondary">
        No quarterly updates yet. Log one to start the timeline.
      </div>
    );
  }

  let running = 0;
  const points = sorted.map(u => {
    running += Number(u.profit) || 0;
    return { ...u, running };
  });

  const maxValue = Math.max(book.dev_cost, ...points.map(p => p.running), 1);
  const devCostPct = (book.dev_cost / maxValue) * 100;

  return (
    <div className="bg-surface rounded-card border border-edge p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-content">Payoff timeline</h3>
          <p className="text-xs text-content-secondary mt-0.5">
            Cumulative profit per quarter vs. dev cost (${book.dev_cost.toFixed(2)})
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-content-secondary">Cumulative</div>
          <div className="font-semibold text-content">${running.toFixed(2)}</div>
        </div>
      </div>

      <div className="relative pl-2 pr-2">
        {/* dev cost target line */}
        <div
          className="absolute left-2 right-2 border-t-2 border-dashed border-amber-400 z-10 pointer-events-none"
          style={{ bottom: `calc(${devCostPct}% + 28px)` }}
          title={`Dev cost target: $${book.dev_cost.toFixed(2)}`}
        >
          <span className="absolute -top-2 right-0 text-[10px] font-medium text-amber-600 bg-surface px-1 rounded">
            dev cost
          </span>
        </div>

        <div className="flex items-end gap-1.5 h-48 relative">
          {points.map((p, i) => {
            const pct = (p.running / maxValue) * 100;
            const paid = book.dev_cost > 0 && p.running >= book.dev_cost;
            return (
              <div key={p.id ?? i} className="flex-1 flex flex-col items-center gap-1 group min-w-0">
                <div className="relative w-full" style={{ height: `${pct}%`, minHeight: 2 }}>
                  <div
                    className={`absolute inset-0 rounded-t-control transition-colors ${
                      paid
                        ? 'bg-gradient-to-t from-emerald-500 to-emerald-400'
                        : 'bg-gradient-to-t from-brand-500 to-brand-400'
                    }`}
                  />
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap bg-slate-900 text-white text-[10px] px-2 py-1 rounded z-20">
                    ${p.running.toFixed(2)} (+${(Number(p.profit) || 0).toFixed(2)})
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-1.5 mt-1 text-[10px] text-content-secondary">
          {points.map((p, i) => (
            <div key={i} className="flex-1 text-center truncate min-w-0" title={p.quarter_label}>
              {p.quarter_label}
            </div>
          ))}
        </div>
      </div>

      {book.payoff_quarter && (
        <div className="mt-4 flex items-center gap-2 text-sm bg-emerald-50 border border-emerald-200 rounded-control px-3 py-2 text-emerald-800">
          <span className="font-medium">Paid off:</span>
          <span>{book.payoff_quarter}</span>
          {book.months_to_payoff !== null && (
            <span className="text-emerald-600">
              · {book.months_to_payoff} {book.months_to_payoff === 1 ? 'month' : 'months'} from launch
            </span>
          )}
        </div>
      )}
    </div>
  );
}
