import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Product, PrinterQuote } from '../../../lib/types';
import { getQuotesForProduct, createQuote, updateQuote, deleteQuote, type QuotePatch } from '../api/printerQuotes';
import { calculateTrueCostForQuote, formatCurrency } from '../utils';

interface Props {
  product: Product;
}

export default function PrinterQuotesPanel({ product }: Props) {
  const [quotes, setQuotes] = useState<PrinterQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const data = await getQuotesForProduct(product.id);
      setQuotes(data);
    } catch (err) {
      console.error('Failed to load printer quotes', err);
    }
    setLoading(false);
  }

  useEffect(() => { reload(); }, [product.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd() {
    setBusy(true);
    try {
      await createQuote(product.id, { printer: 'New printer', unit_cost: 0, shipping_estimate: 0, past_order_count: 0, notes: '' });
      await reload();
    } catch (err) {
      console.error(err);
      alert('Failed to add quote.');
    }
    setBusy(false);
  }

  async function handleDelete(id: string, printer: string) {
    if (!confirm(`Delete quote from "${printer || 'unnamed printer'}"?`)) return;
    setBusy(true);
    try {
      await deleteQuote(id);
      await reload();
    } catch (err) {
      console.error(err);
    }
    setBusy(false);
  }

  async function handlePatch(id: string, patch: QuotePatch) {
    try {
      await updateQuote(id, patch);
      setQuotes(prev => prev.map(q => q.id === id ? { ...q, ...patch } : q));
    } catch (err) {
      console.error('Failed to save quote', err);
    }
  }

  const currentTrueCost = calculateTrueCostForQuote(product, product.production_cost, product.shipping_cost).trueCost;

  // Score each quote by true cost / good book, ascending — lower is better.
  const scored = quotes.map(q => {
    const result = calculateTrueCostForQuote(product, q.unit_cost, q.shipping_estimate);
    return { quote: q, ...result, diff: result.trueCost - currentTrueCost };
  }).sort((a, b) => a.trueCost - b.trueCost);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Printer Quotes</h4>
        <button
          onClick={handleAdd}
          disabled={busy}
          className="flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> Add Quote
        </button>
      </div>

      <p className="text-xs text-slate-500 mb-3">
        Current true cost / good book at <strong>{formatCurrency(product.production_cost)}</strong> + {formatCurrency(product.shipping_cost)} shipping:{' '}
        <strong className="text-slate-800">{formatCurrency(currentTrueCost)}</strong>
        {(product.defect_rate || 0) > 0 && (
          <span className="text-slate-400"> (defect rate {product.defect_rate}%)</span>
        )}
      </p>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : scored.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No quotes saved yet. Add one to compare against your current printer.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase text-slate-400 border-b border-slate-100">
                <th className="text-left py-2 pr-2 font-medium">Printer</th>
                <th className="text-right py-2 px-2 font-medium">Quote / Copy</th>
                <th className="text-right py-2 px-2 font-medium">Shipping</th>
                <th className="text-right py-2 px-2 font-medium" title="Past Order Count — how many times you've ordered from this printer">Past Orders</th>
                <th className="text-right py-2 px-2 font-medium" title="Reprint-adjusted cost per good book if you used this printer">True Cost / Good</th>
                <th className="text-right py-2 px-2 font-medium" title="Difference vs your current setup. Negative means cheaper.">vs Current</th>
                <th className="text-left py-2 px-2 font-medium">Notes</th>
                <th className="py-2 pl-2"></th>
              </tr>
            </thead>
            <tbody>
              {scored.map(({ quote, trueCost, diff }) => (
                <QuoteRow
                  key={quote.id}
                  quote={quote}
                  trueCost={trueCost}
                  diff={diff}
                  onPatch={patch => handlePatch(quote.id, patch)}
                  onDelete={() => handleDelete(quote.id, quote.printer)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function QuoteRow({ quote, trueCost, diff, onPatch, onDelete }: {
  quote: PrinterQuote;
  trueCost: number;
  diff: number;
  onPatch: (patch: QuotePatch) => void;
  onDelete: () => void;
}) {
  const [printer, setPrinter] = useState(quote.printer);
  const [unitCost, setUnitCost] = useState(String(quote.unit_cost));
  const [shipping, setShipping] = useState(String(quote.shipping_estimate));
  const [pastOrders, setPastOrders] = useState(String(quote.past_order_count || 0));
  const [notes, setNotes] = useState(quote.notes || '');

  useEffect(() => { setPrinter(quote.printer); }, [quote.printer]);
  useEffect(() => { setUnitCost(String(quote.unit_cost)); }, [quote.unit_cost]);
  useEffect(() => { setShipping(String(quote.shipping_estimate)); }, [quote.shipping_estimate]);
  useEffect(() => { setPastOrders(String(quote.past_order_count || 0)); }, [quote.past_order_count]);
  useEffect(() => { setNotes(quote.notes || ''); }, [quote.notes]);

  const diffColor = diff < 0 ? 'text-emerald-600' : diff > 0 ? 'text-amber-600' : 'text-slate-500';
  const diffPrefix = diff > 0 ? '+' : '';

  return (
    <tr className="border-b border-slate-50 hover:bg-slate-50/40">
      <td className="py-2 pr-2">
        <input
          type="text"
          value={printer}
          onChange={e => setPrinter(e.target.value)}
          onBlur={() => { if (printer !== quote.printer) onPatch({ printer }); }}
          className="w-full px-1.5 py-1 border border-transparent hover:border-slate-200 focus:border-blue-400 rounded text-sm focus:outline-none"
        />
      </td>
      <td className="py-2 px-2 text-right">
        <input
          type="number"
          step="0.01"
          value={unitCost}
          onChange={e => setUnitCost(e.target.value)}
          onBlur={() => { const n = Number(unitCost); if (!Number.isNaN(n) && n !== quote.unit_cost) onPatch({ unit_cost: n }); }}
          className="w-20 px-1.5 py-1 border border-transparent hover:border-slate-200 focus:border-blue-400 rounded text-sm text-right focus:outline-none"
        />
      </td>
      <td className="py-2 px-2 text-right">
        <input
          type="number"
          step="0.01"
          value={shipping}
          onChange={e => setShipping(e.target.value)}
          onBlur={() => { const n = Number(shipping); if (!Number.isNaN(n) && n !== quote.shipping_estimate) onPatch({ shipping_estimate: n }); }}
          className="w-20 px-1.5 py-1 border border-transparent hover:border-slate-200 focus:border-blue-400 rounded text-sm text-right focus:outline-none"
        />
      </td>
      <td className="py-2 px-2 text-right">
        <input
          type="number"
          min={0}
          value={pastOrders}
          onChange={e => setPastOrders(e.target.value)}
          onBlur={() => { const n = Number(pastOrders); if (!Number.isNaN(n) && n !== (quote.past_order_count || 0)) onPatch({ past_order_count: n }); }}
          className="w-14 px-1.5 py-1 border border-transparent hover:border-slate-200 focus:border-blue-400 rounded text-sm text-right focus:outline-none"
        />
      </td>
      <td className="py-2 px-2 text-right font-medium text-slate-800">{formatCurrency(trueCost)}</td>
      <td className={`py-2 px-2 text-right font-medium ${diffColor}`}>{diffPrefix}{formatCurrency(diff)}</td>
      <td className="py-2 px-2">
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={() => { if (notes !== (quote.notes || '')) onPatch({ notes }); }}
          placeholder=""
          className="w-full min-w-[160px] px-1.5 py-1 border border-transparent hover:border-slate-200 focus:border-blue-400 rounded text-sm focus:outline-none"
        />
      </td>
      <td className="py-2 pl-2">
        <button onClick={onDelete} className="p-1 text-red-400 hover:bg-red-50 rounded" title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </td>
    </tr>
  );
}
