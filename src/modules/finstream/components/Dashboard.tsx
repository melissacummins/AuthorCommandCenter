import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Loader2 } from 'lucide-react';
import { getMonthlySummaries } from '../api';
import type { MonthlySummary } from '../api';

export default function Dashboard() {
  const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMonthlySummaries(12).then(data => {
      setSummaries(data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <div className="text-center py-16 bg-surface rounded-card border border-edge">
        <DollarSign className="w-12 h-12 text-content-faint mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-content mb-1">No transactions yet</h3>
        <p className="text-sm text-content-muted">Import bank transactions from the Transactions tab to see your financial overview.</p>
      </div>
    );
  }

  const totalIncome = summaries.reduce((s, m) => s + m.income, 0);
  const totalExpenses = summaries.reduce((s, m) => s + m.expenses, 0);
  const totalNet = totalIncome - totalExpenses;

  return (
    <div className="space-y-6">
      {/* Overall Totals */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Total Income"
          value={totalIncome}
          color="text-emerald-600"
          bg="bg-emerald-50"
          icon={TrendingUp}
        />
        <StatCard
          label="Total Expenses"
          value={totalExpenses}
          color="text-red-600"
          bg="bg-red-50"
          icon={TrendingDown}
        />
        <StatCard
          label="Net Cash Flow"
          value={totalNet}
          color={totalNet >= 0 ? 'text-emerald-600' : 'text-red-600'}
          bg={totalNet >= 0 ? 'bg-emerald-50' : 'bg-red-50'}
          icon={DollarSign}
        />
      </div>

      {/* Monthly Trend */}
      <div className="bg-surface rounded-card border border-edge overflow-hidden">
        <div className="p-4 border-b border-edge-soft">
          <h3 className="font-semibold text-content">Monthly Trend</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-hover text-left">
                <th className="px-4 py-3 font-medium text-content-secondary">Month</th>
                <th className="px-4 py-3 font-medium text-content-secondary text-right">Income</th>
                <th className="px-4 py-3 font-medium text-content-secondary text-right">Expenses</th>
                <th className="px-4 py-3 font-medium text-content-secondary text-right">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-soft">
              {summaries.map(s => (
                <tr key={s.month} className="hover:bg-surface-hover">
                  <td className="px-4 py-3 font-medium text-content">{formatMonth(s.month)}</td>
                  <td className="px-4 py-3 text-right text-emerald-600">{formatCurrency(s.income)}</td>
                  <td className="px-4 py-3 text-right text-red-600">{formatCurrency(s.expenses)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${s.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(s.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Categories (all time) */}
      {(() => {
        const allCats = new Map<string, { amount: number; type: 'income' | 'expense' }>();
        for (const s of summaries) {
          for (const cat of s.categoryBreakdown) {
            const existing = allCats.get(cat.category);
            if (existing) {
              existing.amount += cat.amount;
            } else {
              allCats.set(cat.category, { amount: cat.amount, type: cat.type });
            }
          }
        }
        const sorted = Array.from(allCats.entries())
          .map(([category, data]) => ({ category, ...data }))
          .sort((a, b) => b.amount - a.amount);

        if (sorted.length === 0) return null;
        const maxAmount = sorted[0].amount;

        return (
          <div className="bg-surface rounded-card border border-edge p-5">
            <h3 className="font-semibold text-content mb-4">Top Categories</h3>
            <div className="space-y-3">
              {sorted.slice(0, 10).map((cat, i) => {
                const pct = maxAmount > 0 ? (cat.amount / maxAmount) * 100 : 0;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-sm text-content-secondary w-40 truncate">{cat.category}</span>
                    <div className="flex-1 h-6 bg-surface-sunken rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${cat.type === 'income' ? 'bg-emerald-400' : 'bg-red-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={`text-sm font-medium w-24 text-right ${cat.type === 'income' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {formatCurrency(cat.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function StatCard({ label, value, color, bg, icon: Icon }: {
  label: string;
  value: number;
  color: string;
  bg: string;
  icon: typeof DollarSign;
}) {
  return (
    <div className="bg-surface rounded-card border border-edge p-5">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 ${bg} rounded-control flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div>
          <p className="text-xs text-content-secondary">{label}</p>
          <p className={`text-xl font-bold ${color}`}>{formatCurrency(value)}</p>
        </div>
      </div>
    </div>
  );
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

function formatMonth(m: string): string {
  const [y, mo] = m.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(mo, 10) - 1]} ${y}`;
}
