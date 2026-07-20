import { useEffect, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import type { TrackedBook, TrackedBookInsert, CostLineItem } from '../types';
import CostBreakdownEditor from './CostBreakdownEditor';
import CatalogBookPicker from '../../../components/CatalogBookPicker';

interface Props {
  initial?: TrackedBook | null;
  saving?: boolean;
  onCancel: () => void;
  onSubmit: (input: TrackedBookInsert) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
}

function fromBook(b: TrackedBook): TrackedBookInsert {
  return {
    title: b.title,
    launch_date: b.launch_date,
    dev_cost: b.dev_cost,
    cost_breakdown: b.cost_breakdown ?? [],
    status: b.status,
    notes: b.notes,
    catalog_book_id: b.catalog_book?.id ?? null,
  };
}

function emptyDraft(): TrackedBookInsert {
  return {
    title: '',
    launch_date: null,
    dev_cost: 0,
    cost_breakdown: [],
    status: 'active',
    notes: null,
    catalog_book_id: null,
  };
}

export default function BookForm({ initial, saving, onCancel, onSubmit, onDelete }: Props) {
  const [draft, setDraft] = useState<TrackedBookInsert>(() => (initial ? fromBook(initial) : emptyDraft()));

  useEffect(() => {
    setDraft(initial ? fromBook(initial) : emptyDraft());
  }, [initial]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.catalog_book_id) return;
    onSubmit({
      ...draft,
      title: draft.title.trim(),
      // dev_cost auto-derives from cost_breakdown if user left it at 0
      dev_cost:
        (draft.cost_breakdown ?? []).reduce((s, c) => s + (Number(c.amount) || 0), 0) || draft.dev_cost || 0,
    });
  }

  function setCost(items: CostLineItem[]) {
    setDraft(d => ({ ...d, cost_breakdown: items }));
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface rounded-card border border-edge p-6 space-y-5">
      <div>
        <label className="block text-sm font-medium text-content mb-1">Book</label>
        <CatalogBookPicker
          value={draft.catalog_book_id ?? null}
          onChange={(id, book) => setDraft(d => ({ ...d, catalog_book_id: id, title: book.title }))}
          placeholder="Pick from Catalog or add a new book…"
        />
        <p className="text-xs text-content-muted mt-1">
          Books in the Tracker reference your Catalog so title and pen name stay in sync. Add a new one inline above if it isn't there yet.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-content mb-1">Launch date</label>
          <input
            type="date"
            value={draft.launch_date ?? ''}
            onChange={e => setDraft(d => ({ ...d, launch_date: e.target.value || null }))}
            className="w-full px-3 py-2 border border-edge-strong rounded-control"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-content mb-1">Status</label>
          <select
            value={draft.status ?? 'active'}
            onChange={e => setDraft(d => ({ ...d, status: e.target.value as 'active' | 'paid_off' }))}
            className="w-full px-3 py-2 border border-edge-strong rounded-control bg-surface"
          >
            <option value="active">Active (not paid off)</option>
            <option value="paid_off">Paid off</option>
          </select>
          <p className="text-xs text-content-muted mt-1">
            Status auto-flips to "paid off" when cumulative profit clears dev cost.
          </p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-content mb-2">Cost breakdown</label>
        <CostBreakdownEditor items={draft.cost_breakdown ?? []} onChange={setCost} />
      </div>

      <div>
        <label className="block text-sm font-medium text-content mb-1">Notes</label>
        <textarea
          value={draft.notes ?? ''}
          onChange={e => setDraft(d => ({ ...d, notes: e.target.value || null }))}
          rows={3}
          className="w-full px-3 py-2 border border-edge-strong rounded-control text-sm"
          placeholder="Anything you want to remember about this title's dev costs…"
        />
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-edge">
        <div>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-rose-600 border border-rose-200 rounded-control hover:bg-rose-50"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-content border border-edge-strong rounded-control hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !draft.catalog_book_id}
            className="px-4 py-2 text-sm bg-purple-600 text-white font-medium rounded-control hover:bg-purple-700 disabled:opacity-50 shadow-sm"
          >
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Add book'}
          </button>
        </div>
      </div>
    </form>
  );
}
