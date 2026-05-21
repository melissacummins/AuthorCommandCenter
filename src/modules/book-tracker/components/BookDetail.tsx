import { useEffect, useState } from 'react';
import { ArrowLeft, Edit2 } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  listQuarterlyUpdates,
  addQuarterlyUpdate,
  deleteQuarterlyUpdate,
  updateTrackedBook,
} from '../api';
import type { TrackedBook, QuarterlyUpdate } from '../types';
import { displayTitle } from '../types';
import { usePenNames } from '../../../contexts/PenNameContext';
import PenNameChip from '../../../components/PenNameChip';
import BookTimeline from './BookTimeline';
import QuarterlyUpdatesPanel from './QuarterlyUpdatesPanel';
import KlaviyoListPicker from './KlaviyoListPicker';

interface Props {
  book: TrackedBook;
  onBack: () => void;
  onEdit: () => void;
  onBookUpdated: (book: TrackedBook) => void;
}

export default function BookDetail({ book, onBack, onEdit, onBookUpdated }: Props) {
  const { user } = useAuth();
  const { penNames } = usePenNames();
  const penName = book.catalog_book?.pen_name_id
    ? penNames.find(p => p.id === book.catalog_book?.pen_name_id) ?? null
    : null;
  const [updates, setUpdates] = useState<QuarterlyUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    listQuarterlyUpdates(user.id, book.id)
      .then(rows => { if (!cancelled) setUpdates(rows); })
      .catch(err => { if (!cancelled) setError(err.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, book.id]);

  async function handleAddUpdate(quarter_label: string, profit: number) {
    if (!user) return;
    const { entry, book: nextBook } = await addQuarterlyUpdate(user.id, {
      tracked_book_id: book.id,
      quarter_label,
      profit,
    });
    setUpdates(prev => [...prev, entry]);
    onBookUpdated(nextBook);
  }

  async function handleDeleteUpdate(id: string) {
    if (!user) return;
    const nextBook = await deleteQuarterlyUpdate(user.id, id, book.id);
    setUpdates(prev => prev.filter(u => u.id !== id));
    onBookUpdated(nextBook);
  }

  async function handleKlaviyoChange(listId: string | null) {
    const updated = await updateTrackedBook(book.id, { klaviyo_list_id: listId });
    onBookUpdated(updated);
  }

  const launchLabel = book.launch_date
    ? new Date(book.launch_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : 'Not launched yet';
  const netProfit = book.cumulative_profit - book.dev_cost;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Book Tracker
      </button>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                book.status === 'paid_off'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-purple-100 text-purple-700'
              }`}
            >
              {book.status === 'paid_off' ? 'Paid off' : 'Active'}
            </span>
            {penName && <PenNameChip name={penName.name} color={penName.color} />}
            <span className="text-sm text-slate-500">Launched: {launchLabel}</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">{displayTitle(book)}</h1>
        </div>
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          <Edit2 className="w-4 h-4" /> Edit
        </button>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Dev cost" value={`$${book.dev_cost.toFixed(2)}`} />
        <StatCard label="Cumulative profit" value={`$${book.cumulative_profit.toFixed(2)}`} />
        <StatCard
          label="Net"
          value={`${netProfit >= 0 ? '+' : '-'}$${Math.abs(netProfit).toFixed(2)}`}
          accent={netProfit >= 0 ? 'positive' : 'negative'}
        />
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-500">Loading timeline…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <BookTimeline book={book} updates={updates} />
            {book.cost_breakdown && book.cost_breakdown.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="font-semibold text-slate-800 mb-3">Cost breakdown</h3>
                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                  {book.cost_breakdown.map((c, i) => (
                    <div key={i} className="contents">
                      <div className="text-slate-700">{c.category}</div>
                      <div className="text-slate-900 font-medium tabular-nums">${Number(c.amount).toFixed(2)}</div>
                    </div>
                  ))}
                  <div className="col-span-2 border-t border-slate-200 my-1" />
                  <div className="text-slate-700 font-medium">Total</div>
                  <div className="text-slate-900 font-semibold tabular-nums">${book.dev_cost.toFixed(2)}</div>
                </div>
              </div>
            )}
            {book.notes && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="font-semibold text-slate-800 mb-2">Notes</h3>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{book.notes}</p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <QuarterlyUpdatesPanel
              book={book}
              updates={updates}
              onAdd={handleAddUpdate}
              onDelete={handleDeleteUpdate}
            />
            <KlaviyoListPicker value={book.klaviyo_list_id} onChange={handleKlaviyoChange} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'positive' | 'negative' }) {
  const color =
    accent === 'positive'
      ? 'text-emerald-700'
      : accent === 'negative'
        ? 'text-rose-700'
        : 'text-slate-800';
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
