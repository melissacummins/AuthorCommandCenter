import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Trash2, Edit2, AlertCircle, X, Tag, Calendar } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { usePenNames } from '../../../contexts/PenNameContext';
import PenNameChip from '../../../components/PenNameChip';
import CatalogBookPicker from '../../../components/CatalogBookPicker';
import {
  createPromotion,
  deletePromotion,
  listPromotions,
  updatePromotion,
  promotionROI,
} from '../../promotions/api';
import type { Promotion, PromotionInsert, PromoKind } from '../../promotions/types';
import { PROMO_KINDS, PROMO_LABELS, PROMO_COLORS } from '../../promotions/types';

type View =
  | { mode: 'list' }
  | { mode: 'edit'; promo: Promotion | null };

// Manual promotion log. Each row is one book × one promo run with cost
// + outcome attribution so the Timeline can render an event with the
// right color, name, and ROI tooltip.
export default function PromotionsTab() {
  const { user } = useAuth();
  const { selectedPenNameId, penNames } = usePenNames();
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ mode: 'list' });
  const [saving, setSaving] = useState(false);

  const penNameById = useMemo(() => new Map(penNames.map(p => [p.id, p])), [penNames]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    listPromotions(user.id)
      .then(rows => { if (!cancelled) setPromos(rows); })
      .catch(err => { if (!cancelled) setError(err?.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  // Filter by active pen name via the joined Catalog book.
  const visible = selectedPenNameId
    ? promos.filter(p => p.book_pen_name_id === selectedPenNameId)
    : promos;

  async function handleSave(input: PromotionInsert, editingId: string | null) {
    if (!user) return;
    setSaving(true);
    try {
      if (editingId) {
        const updated = await updatePromotion(editingId, input);
        setPromos(prev => prev.map(p => (p.id === editingId ? updated : p))
          .sort((a, b) => b.starts_on.localeCompare(a.starts_on)));
      } else {
        const created = await createPromotion(user.id, input);
        setPromos(prev => [created, ...prev]);
      }
      setView({ mode: 'list' });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this promotion? Its timeline events will disappear with it.')) return;
    try {
      await deletePromotion(id);
      setPromos(prev => prev.filter(p => p.id !== id));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }

  if (view.mode === 'edit') {
    return (
      <PromotionForm
        initial={view.promo}
        saving={saving}
        onCancel={() => setView({ mode: 'list' })}
        onSubmit={input => handleSave(input, view.promo?.id ?? null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Tag className="w-5 h-5 text-pink-500" /> Promotions
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            BookBub deals, free runs, newsletter swaps, paid ads — every promo logged here becomes a Timeline event for the linked book.
          </p>
        </div>
        <button
          onClick={() => setView({ mode: 'edit', promo: null })}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-pink-600 text-white font-medium rounded-lg hover:bg-pink-700 shadow-sm"
        >
          <Plus className="w-4 h-4" /> Log a promo
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500">
          {promos.length === 0
            ? 'No promotions logged yet. Hit "Log a promo" to add your first.'
            : 'No promotions for the active pen name.'}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Promo</th>
                <th className="px-4 py-3">Book</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3 text-right">Cost</th>
                <th className="px-4 py-3 text-right">Revenue</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(p => {
                const colors = PROMO_COLORS[p.kind];
                const pn = p.book_pen_name_id ? penNameById.get(p.book_pen_name_id) : null;
                const { net } = promotionROI(p);
                return (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                        <div>
                          <div className="font-medium text-slate-800">{p.name}</div>
                          <div className={`inline-block text-[10px] mt-0.5 px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>
                            {PROMO_LABELS[p.kind]}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-slate-700">{p.book_title ?? '(deleted)'}</div>
                      {pn && <div className="mt-1"><PenNameChip name={pn.name} color={pn.color} /></div>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">
                      {p.starts_on}
                      {p.ends_on !== p.starts_on && <> → {p.ends_on}</>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                      {p.cost !== null ? `$${p.cost.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                      {p.revenue !== null ? `$${p.revenue.toFixed(2)}` : '—'}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                      net === null ? 'text-slate-400' : net >= 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {net === null ? '—' : `${net >= 0 ? '+' : '-'}$${Math.abs(net).toFixed(2)}`}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => setView({ mode: 'edit', promo: p })}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                        aria-label="Edit"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                        aria-label="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PromotionForm({
  initial, saving, onSubmit, onCancel,
}: {
  initial: Promotion | null;
  saving: boolean;
  onSubmit: (input: PromotionInsert) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [bookId, setBookId] = useState<string | null>(initial?.book_id ?? null);
  const [kind, setKind] = useState<PromoKind>(initial?.kind ?? 'bookbub_featured');
  const [name, setName] = useState(initial?.name ?? '');
  const [startsOn, setStartsOn] = useState(initial?.starts_on ?? new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState(initial?.ends_on ?? new Date().toISOString().slice(0, 10));
  const [cost, setCost] = useState(initial?.cost?.toString() ?? '');
  const [revenue, setRevenue] = useState(initial?.revenue?.toString() ?? '');
  const [freeDownloads, setFreeDownloads] = useState(initial?.free_downloads?.toString() ?? '');
  const [unitsSold, setUnitsSold] = useState(initial?.units_sold?.toString() ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!bookId || !name.trim()) return;
    onSubmit({
      book_id: bookId,
      kind,
      name: name.trim(),
      starts_on: startsOn,
      ends_on: endsOn < startsOn ? startsOn : endsOn,
      cost: cost.trim() ? Number(cost) : null,
      revenue: revenue.trim() ? Number(revenue) : null,
      free_downloads: freeDownloads.trim() ? Math.round(Number(freeDownloads)) : null,
      units_sold: unitsSold.trim() ? Math.round(Number(unitsSold)) : null,
      notes: notes.trim() || null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-slate-800">
          {initial ? 'Edit promotion' : 'Log a promotion'}
        </h2>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Book *</label>
          <CatalogBookPicker
            value={bookId}
            onChange={id => setBookId(id)}
            placeholder="Pick the book this promo was for…"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Type *</label>
            <select
              value={kind}
              onChange={e => setKind(e.target.value as PromoKind)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              {PROMO_KINDS.map(k => <option key={k} value={k}>{PROMO_LABELS[k]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. BookBub Featured Deal — March"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Starts
            </label>
            <input
              type="date"
              value={startsOn}
              onChange={e => setStartsOn(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Ends
            </label>
            <input
              type="date"
              value={endsOn}
              onChange={e => setEndsOn(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumberField label="Cost ($)" value={cost} onChange={setCost} step="0.01" />
          <NumberField label="Revenue ($)" value={revenue} onChange={setRevenue} step="0.01" />
          <NumberField label="Free downloads" value={freeDownloads} onChange={setFreeDownloads} />
          <NumberField label="Units sold" value={unitsSold} onChange={setUnitsSold} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
          <textarea
            rows={3}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="What worked, what didn't, follow-up actions…"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!bookId || !name.trim() || saving}
          className="px-4 py-2 text-sm bg-pink-600 text-white font-medium rounded-lg hover:bg-pink-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Log promotion'}
        </button>
      </div>
    </form>
  );
}

function NumberField({ label, value, onChange, step }: { label: string; value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      <input
        type="number"
        step={step ?? '1'}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
        placeholder="—"
      />
    </div>
  );
}
