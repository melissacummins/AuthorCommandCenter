import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import type { Product, PrinterQuote } from '../../../lib/types';
import { useProducts } from '../hooks/useProducts';
import { getAllQuotes, upsertQuoteForPrinterAndProduct, deleteQuote, type QuotePatch } from '../api/printerQuotes';
import { calculateTrueCostForQuote, formatCurrency } from '../utils';
import CsvImporter, { type ParsedRow } from './CsvImporter';

interface RowState {
  unit_cost: number;
  shipping_estimate: number;
  notes: string;
}

const EMPTY_ROW: RowState = { unit_cost: 0, shipping_estimate: 0, notes: '' };

function quoteToRow(q: PrinterQuote | undefined): RowState {
  if (!q) return EMPTY_ROW;
  return {
    unit_cost: q.unit_cost || 0,
    shipping_estimate: q.shipping_estimate || 0,
    notes: q.notes || '',
  };
}

export default function PrinterQuotesTab() {
  const { products } = useProducts();
  const [quotes, setQuotes] = useState<PrinterQuote[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>('');
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [includeSD, setIncludeSD] = useState(false);
  const [showImport, setShowImport] = useState(false);

  async function reloadQuotes() {
    try {
      const all = await getAllQuotes();
      setQuotes(all);
    } catch (err) {
      console.error('Failed to load quotes', err);
    }
  }

  useEffect(() => { reloadQuotes(); }, []);

  const printers = useMemo(() => {
    const set = new Set<string>();
    for (const q of quotes) if (q.printer) set.add(q.printer);
    return Array.from(set).sort();
  }, [quotes]);

  // Auto-select first printer when none selected
  useEffect(() => {
    if (!selectedPrinter && printers.length > 0) setSelectedPrinter(printers[0]);
  }, [printers, selectedPrinter]);

  const books = useMemo(() => {
    return products
      .filter(p => p.category !== 'Bundle' && p.category !== 'Book Box')
      .filter(p => includeSD || (!/\bS&D\b|- S&D/i.test(p.name)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, includeSD]);

  // Rebuild row state from quotes for the selected printer
  useEffect(() => {
    const next: Record<string, RowState> = {};
    const byProduct = new Map<string, PrinterQuote>();
    for (const q of quotes) {
      if (q.printer === selectedPrinter) byProduct.set(q.product_id, q);
    }
    for (const p of books) next[p.id] = quoteToRow(byProduct.get(p.id));
    setRows(next);
  }, [quotes, selectedPrinter, books]);

  async function addPrinter() {
    const name = prompt('New printer name:')?.trim();
    if (!name) return;
    if (printers.includes(name)) {
      setSelectedPrinter(name);
      return;
    }
    setSelectedPrinter(name);
  }

  function updateLocal(productId: string, field: keyof RowState, value: number | string) {
    setRows(prev => ({ ...prev, [productId]: { ...prev[productId], [field]: value } }));
  }

  async function saveField(productId: string, field: keyof RowState, value: number | string) {
    if (!selectedPrinter) return;
    const cellKey = `${productId}:${field}`;
    setSavingCell(cellKey);
    try {
      await upsertQuoteForPrinterAndProduct(selectedPrinter, productId, { [field]: value } as QuotePatch);
      await reloadQuotes();
    } catch (err) {
      console.error('Failed to save quote', err);
    }
    setSavingCell(null);
  }

  async function handleDeleteRow(productId: string) {
    const q = quotes.find(qq => qq.printer === selectedPrinter && qq.product_id === productId);
    if (!q) return; // nothing to delete
    if (!confirm(`Clear the ${selectedPrinter} quote for this book?`)) return;
    try {
      await deleteQuote(q.id);
      await reloadQuotes();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDeletePrinter() {
    const toDelete = quotes.filter(q => q.printer === selectedPrinter);
    if (toDelete.length === 0) { setSelectedPrinter(''); return; }
    if (!confirm(`Delete ALL ${toDelete.length} ${selectedPrinter} quote${toDelete.length === 1 ? '' : 's'}?`)) return;
    try {
      await Promise.all(toDelete.map(q => deleteQuote(q.id)));
      await reloadQuotes();
      setSelectedPrinter('');
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Printer Quotes</h2>
          <p className="text-sm text-slate-500 mt-1">Pick a printer, then fill in quote prices per book to compare against your current vendor.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={includeSD} onChange={e => setIncludeSD(e.target.checked)} className="rounded" />
            Include S&amp;D variants
          </label>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50"
          >
            <Upload className="w-4 h-4" /> Import CSV
          </button>
        </div>
      </div>

      <CsvImporter
        open={showImport}
        onClose={() => setShowImport(false)}
        products={products}
        kind="printer-quotes"
        onComplete={reloadQuotes}
        onImportRows={async (rows: ParsedRow[]) => {
          let imported = 0;
          let failed = 0;
          for (const r of rows) {
            if (!r.productId || !r.printer) continue;
            try {
              const num = (s: string) => Number(s.replace(/[$,\s]/g, '')) || 0;
              const patch: QuotePatch = { printer: r.printer };
              if (r.fields.unit_cost) patch.unit_cost = num(r.fields.unit_cost);
              if (r.fields.shipping_estimate) patch.shipping_estimate = num(r.fields.shipping_estimate);
              if (r.fields.notes) patch.notes = r.fields.notes;
              await upsertQuoteForPrinterAndProduct(r.printer, r.productId, patch);
              imported++;
            } catch (err) {
              console.error('Row failed', r, err);
              failed++;
            }
          }
          return { imported, failed };
        }}
      />

      {/* Printer Selector */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-slate-700">Printer</label>
        <select
          value={selectedPrinter}
          onChange={e => setSelectedPrinter(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 min-w-[200px]"
        >
          <option value="">Select a printer…</option>
          {printers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button
          onClick={addPrinter}
          className="flex items-center gap-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" /> Add Printer
        </button>
        {selectedPrinter && (
          <button
            onClick={handleDeletePrinter}
            className="ml-auto flex items-center gap-1 px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg"
            title={`Delete all quotes for ${selectedPrinter}`}
          >
            <Trash2 className="w-4 h-4" /> Delete printer
          </button>
        )}
      </div>

      {/* Per-book quote table */}
      {selectedPrinter ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 tracking-wider">
                  <th className="text-left py-2.5 px-3 font-medium sticky left-0 bg-slate-50">Book</th>
                  <th className="text-right py-2.5 px-3 font-medium" title="Your current production_cost + shipping_cost">Current Cost</th>
                  <th className="text-right py-2.5 px-3 font-medium">Quote / Copy</th>
                  <th className="text-right py-2.5 px-3 font-medium">Shipping</th>
                  <th className="text-right py-2.5 px-3 font-medium" title="Reprint-adjusted cost per good book if you used this printer">True Cost / Good</th>
                  <th className="text-right py-2.5 px-3 font-medium" title="Net margin % at this printer vs. your current setup">Net Margin %</th>
                  <th className="text-right py-2.5 px-3 font-medium" title="True cost diff vs. current — negative is cheaper">vs Current</th>
                  <th className="text-left py-2.5 px-3 font-medium">Notes</th>
                  <th className="py-2.5 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {books.map(p => {
                  const row = rows[p.id] ?? EMPTY_ROW;
                  const result = calculateTrueCostForQuote(p, row.unit_cost, row.shipping_estimate);
                  const current = calculateTrueCostForQuote(p, p.production_cost, p.shipping_cost);
                  const diff = result.trueCost - current.trueCost;
                  const diffColor = row.unit_cost === 0
                    ? 'text-slate-300'
                    : diff < 0 ? 'text-emerald-600' : diff > 0 ? 'text-amber-600' : 'text-slate-500';
                  const marginColor = result.netMarginPercent >= 50 ? 'text-emerald-600' : result.netMarginPercent >= 30 ? 'text-amber-600' : 'text-red-500';
                  const hasQuote = !!quotes.find(q => q.printer === selectedPrinter && q.product_id === p.id);
                  return (
                    <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/40 group">
                      <td className="py-2 px-3 font-medium text-slate-800 sticky left-0 bg-white group-hover:bg-slate-50/40">{p.name}</td>
                      <td className="py-2 px-3 text-right text-slate-500">{formatCurrency(p.production_cost + p.shipping_cost)}</td>
                      <QuoteNumCell value={row.unit_cost} onChange={v => updateLocal(p.id, 'unit_cost', v)} onSave={v => saveField(p.id, 'unit_cost', v)} saving={savingCell === `${p.id}:unit_cost`} highlight />
                      <QuoteNumCell value={row.shipping_estimate} onChange={v => updateLocal(p.id, 'shipping_estimate', v)} onSave={v => saveField(p.id, 'shipping_estimate', v)} saving={savingCell === `${p.id}:shipping_estimate`} />
                      <td className="py-2 px-3 text-right font-medium text-slate-800">{row.unit_cost > 0 ? formatCurrency(result.trueCost) : '—'}</td>
                      <td className={`py-2 px-3 text-right font-medium ${row.unit_cost > 0 ? marginColor : 'text-slate-300'}`}>
                        {row.unit_cost > 0 ? `${result.netMarginPercent.toFixed(1)}%` : '—'}
                      </td>
                      <td className={`py-2 px-3 text-right font-medium ${diffColor}`}>{row.unit_cost > 0 ? `${diff > 0 ? '+' : ''}${formatCurrency(diff)}` : '—'}</td>
                      <QuoteTextCell value={row.notes} onChange={v => updateLocal(p.id, 'notes', v)} onSave={v => saveField(p.id, 'notes', v)} saving={savingCell === `${p.id}:notes`} />
                      <td className="py-1 px-2 align-top">
                        {hasQuote && (
                          <button onClick={() => handleDeleteRow(p.id)} className="p-1 text-red-400 hover:bg-red-50 rounded" title="Clear this quote">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {books.length === 0 && (
                  <tr><td colSpan={9} className="py-12 text-center text-slate-400 italic">No books to show.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 italic">
          Pick a printer above (or add a new one) to start comparing quotes.
        </div>
      )}
    </div>
  );
}

function QuoteNumCell({ value, onChange, onSave, saving, highlight }: { value: number; onChange: (v: number) => void; onSave: (v: number) => void; saving: boolean; highlight?: boolean }) {
  return (
    <td className="py-1 px-2 align-top">
      <input
        type="number"
        step="0.01"
        min={0}
        value={value || ''}
        placeholder="0.00"
        onChange={e => onChange(Number(e.target.value))}
        onBlur={() => onSave(value)}
        className={`w-24 px-2 py-1.5 border border-transparent hover:border-slate-200 focus:border-blue-400 focus:bg-blue-50/20 rounded text-sm text-right focus:outline-none ${highlight ? 'font-medium' : ''} ${saving ? 'bg-blue-50/40' : ''}`}
      />
    </td>
  );
}

function QuoteTextCell({ value, onChange, onSave, saving }: { value: string; onChange: (v: string) => void; onSave: (v: string) => void; saving: boolean }) {
  return (
    <td className="py-1 px-2 align-top">
      <input
        type="text"
        value={value}
        placeholder=""
        onChange={e => onChange(e.target.value)}
        onBlur={() => onSave(value)}
        className={`min-w-[180px] w-full px-2 py-1.5 border border-transparent hover:border-slate-200 focus:border-blue-400 focus:bg-blue-50/20 rounded text-sm focus:outline-none ${saving ? 'bg-blue-50/40' : ''}`}
      />
    </td>
  );
}
