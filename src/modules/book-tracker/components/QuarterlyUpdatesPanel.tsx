import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { QuarterlyUpdate, TrackedBook } from '../types';

interface Props {
  book: TrackedBook;
  updates: QuarterlyUpdate[];
  onAdd: (quarter_label: string, profit: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function suggestQuarterLabel(): string {
  const d = new Date();
  const m = d.getMonth() + 1;
  const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
  return `Q${q} ${d.getFullYear()}`;
}

export default function QuarterlyUpdatesPanel({ book, updates, onAdd, onDelete }: Props) {
  const [label, setLabel] = useState(suggestQuarterLabel());
  const [profit, setProfit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const p = Number(profit);
    if (!label.trim() || Number.isNaN(p)) {
      setError('Add a quarter label and a profit number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAdd(label.trim(), p);
      setProfit('');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...updates].sort((a, b) => (a.sort_key < b.sort_key ? -1 : 1));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800">Quarterly updates</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Log each quarter's profit. The timeline and payoff status recompute automatically.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Quarter</label>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm w-32"
            placeholder="Q4 2024"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Profit</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
            <input
              type="number"
              step="0.01"
              value={profit}
              onChange={e => setProfit(e.target.value)}
              className="pl-6 pr-2 py-1.5 border border-slate-300 rounded-lg text-sm w-32"
              placeholder="0.00"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> {busy ? 'Saving…' : 'Add'}
        </button>
      </form>
      {error && <p className="text-xs text-rose-600">{error}</p>}

      {sorted.length > 0 ? (
        <div className="border-t border-slate-200 pt-3">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-sm">
            {sorted.map(u => (
              <div key={u.id} className="contents">
                <div className="text-slate-700">{u.quarter_label}</div>
                <div className="text-slate-900 font-medium tabular-nums">${Number(u.profit).toFixed(2)}</div>
                <button
                  onClick={() => onDelete(u.id)}
                  className="text-slate-400 hover:text-rose-600 px-1"
                  aria-label="Delete update"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-200 mt-2 pt-2 flex justify-between text-sm">
            <span className="text-slate-600">Cumulative</span>
            <span className="font-semibold text-slate-800">${book.cumulative_profit.toFixed(2)}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-400 italic">No updates yet.</p>
      )}
    </div>
  );
}
