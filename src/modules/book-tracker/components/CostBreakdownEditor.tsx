import { Plus, Trash2 } from 'lucide-react';
import type { CostLineItem } from '../types';
import { COST_CATEGORIES } from '../types';

interface Props {
  items: CostLineItem[];
  onChange: (next: CostLineItem[]) => void;
}

export default function CostBreakdownEditor({ items, onChange }: Props) {
  const total = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

  function update(idx: number, patch: Partial<CostLineItem>) {
    const next = items.map((item, i) => (i === idx ? { ...item, ...patch } : item));
    onChange(next);
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  function add() {
    onChange([...items, { category: 'Editing', amount: 0 }]);
  }

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-sm text-content-muted italic">No cost lines yet. Add the first one below.</p>
      )}
      {items.map((item, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <select
            value={COST_CATEGORIES.includes(item.category as any) ? item.category : '__custom'}
            onChange={e => {
              const v = e.target.value;
              update(idx, { category: v === '__custom' ? item.category : v });
            }}
            className="px-2 py-1.5 border border-edge-strong rounded-control text-sm bg-surface min-w-[140px]"
          >
            {COST_CATEGORIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value="__custom">Custom…</option>
          </select>
          {!COST_CATEGORIES.includes(item.category as any) && (
            <input
              type="text"
              value={item.category}
              onChange={e => update(idx, { category: e.target.value })}
              placeholder="Category"
              className="px-2 py-1.5 border border-edge-strong rounded-control text-sm flex-1"
            />
          )}
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-content-muted text-sm">$</span>
            <input
              type="number"
              step="0.01"
              value={item.amount}
              onChange={e => update(idx, { amount: Number(e.target.value) })}
              className="pl-6 pr-2 py-1.5 border border-edge-strong rounded-control text-sm w-28"
            />
          </div>
          <button
            type="button"
            onClick={() => remove(idx)}
            className="p-1.5 text-content-muted hover:text-rose-600 hover:bg-rose-50 rounded-control"
            aria-label="Remove line"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-content border border-edge-strong rounded-control hover:bg-surface-hover"
        >
          <Plus className="w-3.5 h-3.5" /> Add line
        </button>
        <div className="text-sm text-content-secondary">
          Total: <span className="font-semibold text-content">${total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
