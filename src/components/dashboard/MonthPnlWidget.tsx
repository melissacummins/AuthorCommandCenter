import { DollarSign, TrendingDown, TrendingUp } from 'lucide-react';
import { WidgetCard, useWidgetData } from './WidgetCard';
import { getMonthPnl } from '../../lib/dashboard';
import { formatCurrency } from '../../modules/inventory/utils';

// Month-to-date P&L from the Profit module's records (directive §4 widget 3).
// Profit is manually entered, so the "as of" line is mandatory — a quiet week
// must read as "not entered yet", never as "earned nothing".

export default function MonthPnlWidget() {
  const { data, loading, error } = useWidgetData(() => getMonthPnl(), []);

  const net = data?.monthNet ?? 0;
  const delta = data ? data.monthNet - data.prevMonthNet : 0;

  return (
    <WidgetCard title="This month" icon={DollarSign} href="/profit-track" loading={loading} error={error}>
      {data && (
        data.lastEntryDate === null && data.monthRevenue === 0 && data.monthAdSpend === 0 ? (
          <p className="text-sm text-content-muted py-1">No entries yet this month — log days in Profit and they'll show here.</p>
        ) : (
          <div>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold tabular-nums ${net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatCurrency(net)}
              </span>
              <span className="text-xs text-content-secondary">net</span>
              {data.prevMonthNet !== 0 && (
                <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {delta >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {formatCurrency(Math.abs(delta))} vs last month
                </span>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-2 mt-3">
              <div className="bg-surface-hover rounded-control px-2.5 py-1.5">
                <dt className="text-[11px] text-content-muted">Revenue</dt>
                <dd className="text-sm font-semibold tabular-nums text-content">{formatCurrency(data.monthRevenue)}</dd>
              </div>
              <div className="bg-surface-hover rounded-control px-2.5 py-1.5">
                <dt className="text-[11px] text-content-muted">Ad spend</dt>
                <dd className="text-sm font-semibold tabular-nums text-content">{formatCurrency(data.monthAdSpend)}</dd>
              </div>
            </dl>
            <p className="text-[11px] text-content-muted mt-2.5">
              {data.lastEntryDate
                ? `As of ${new Date(data.lastEntryDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — update in Profit to refresh.`
                : 'Nothing entered for this month yet.'}
            </p>
          </div>
        )
      )}
    </WidgetCard>
  );
}
