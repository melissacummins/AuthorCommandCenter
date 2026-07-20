import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import type { Product, PrinterQuote } from '../../../lib/types';
import { supabase } from '../../../lib/supabase';
import { useProducts } from '../hooks/useProducts';
import { getAllQuotes, upsertQuoteForPrinterAndProduct, deleteQuote, type QuotePatch } from '../api/printerQuotes';
import { getPrinterProfiles, upsertPrinterProfile, type PrinterProfile, type PrinterStatus } from '../api/printerProfiles';
import { calculateTrueCostForQuote, formatCurrency } from '../utils';
import CsvImporter, { type ParsedRow } from './CsvImporter';

const STATUS_OPTIONS: Array<{ value: PrinterStatus; label: string; chip: string }> = [
  { value: 'active',   label: 'Active',   chip: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'current',  label: 'Current',  chip: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { value: 'rejected', label: 'Rejected', chip: 'bg-red-100 text-red-700 border-red-200' },
];

function statusChipClass(status: PrinterStatus): string {
  return STATUS_OPTIONS.find(o => o.value === status)?.chip ?? STATUS_OPTIONS[0].chip;
}

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
  // hasLoaded distinguishes "first fetch hasn't completed yet" from "fetch
  // completed with zero rows" so a transient empty response (auth-token
  // refresh, network blip) doesn't make the table look empty.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [profiles, setProfiles] = useState<PrinterProfile[]>([]);
  const [targetMargin, setTargetMargin] = useState<number>(60);
  const [showRejected, setShowRejected] = useState(false);

  async function reloadProfiles() {
    try {
      const data = await getPrinterProfiles();
      setProfiles(data);
    } catch (err) {
      console.error('Failed to load printer profiles', err);
    }
  }

  useEffect(() => { reloadProfiles(); }, []);

  function statusFor(printer: string): PrinterStatus {
    return profiles.find(p => p.printer === printer)?.status ?? 'active';
  }

  async function setStatus(printer: string, status: PrinterStatus) {
    // Optimistic update so the chip switches instantly
    setProfiles(prev => {
      const i = prev.findIndex(p => p.printer === printer);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], status };
        return next;
      }
      return [...prev, { id: '', user_id: '', printer, status, notes: '', created_at: '', updated_at: '' }];
    });
    try {
      await upsertPrinterProfile(printer, { status });
      await reloadProfiles();
    } catch (err) {
      console.error('Failed to save printer status', err);
    }
  }

  async function reloadQuotes() {
    try {
      const all = await getAllQuotes();
      setQuotes(all);
      setHasLoaded(true);
    } catch (err) {
      console.error('Failed to load quotes', err);
    }
  }

  useEffect(() => { reloadQuotes(); }, []);

  // Refetch when the Supabase auth token rotates and when the tab regains
  // focus — covers transient empty results during token refresh or after
  // the tab has sat idle.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') reloadQuotes();
    });
    function onFocus() { reloadQuotes(); }
    window.addEventListener('focus', onFocus);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const printers = useMemo(() => {
    const set = new Set<string>();
    for (const q of quotes) if (q.printer) set.add(q.printer);
    return Array.from(set).sort();
  }, [quotes]);

  // Per-printer aggregate stats: average True Cost / Good Book across all
  // books with a non-zero quote, plus how many of those books beat the
  // target margin. Drives the rankings table.
  const rankings = useMemo(() => {
    const byProduct = new Map(products.map(p => [p.id, p]));
    return printers.map(printer => {
      const status = statusFor(printer);
      const printerQuotes = quotes.filter(q => q.printer === printer && q.unit_cost > 0);
      let totalCost = 0;
      let totalMargin = 0;
      let booksHittingTarget = 0;
      let counted = 0;
      let booksCheaperThanCurrent = 0;
      for (const q of printerQuotes) {
        const p = byProduct.get(q.product_id);
        if (!p || p.category === 'Bundle' || p.category === 'Book Box') continue;
        const r = calculateTrueCostForQuote(p, q.unit_cost, q.shipping_estimate);
        const current = calculateTrueCostForQuote(p, p.production_cost, p.shipping_cost);
        totalCost += r.trueCost;
        totalMargin += r.netMarginPercent;
        if (r.netMarginPercent >= targetMargin) booksHittingTarget++;
        if (r.trueCost < current.trueCost) booksCheaperThanCurrent++;
        counted++;
      }
      return {
        printer,
        status,
        bookCount: counted,
        avgTrueCost: counted > 0 ? totalCost / counted : 0,
        avgMarginPercent: counted > 0 ? totalMargin / counted : 0,
        booksHittingTarget,
        booksCheaperThanCurrent,
      };
    }).filter(r => r.bookCount > 0)
      .sort((a, b) => a.avgTrueCost - b.avgTrueCost);
  }, [printers, quotes, products, profiles, targetMargin]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleRankings = useMemo(
    () => showRejected ? rankings : rankings.filter(r => r.status !== 'rejected'),
    [rankings, showRejected]
  );
  const rejectedCount = useMemo(() => rankings.filter(r => r.status === 'rejected').length, [rankings]);

  // Auto-select first non-rejected printer when none selected
  useEffect(() => {
    if (!selectedPrinter && visibleRankings.length > 0) setSelectedPrinter(visibleRankings[0].printer);
  }, [visibleRankings, selectedPrinter]);

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
          <h2 className="text-xl font-semibold text-content">Printer Quotes</h2>
          <p className="text-sm text-content-secondary mt-1">Pick a printer, then fill in quote prices per book to compare against your current vendor.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-content-secondary">
            <input type="checkbox" checked={includeSD} onChange={e => setIncludeSD(e.target.checked)} className="rounded" />
            Include S&amp;D variants
          </label>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-edge text-content rounded-control hover:bg-surface-hover"
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

      {/* Rankings */}
      {hasLoaded && rankings.length > 0 && (
        <div className="bg-surface rounded-card border border-edge p-4 mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-content">Printer Rankings</h3>
              <p className="text-[11px] text-content-secondary">Ranked by average True Cost / Good Book across the books you've quoted. Click a row to load it below.</p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-content-secondary">
                Target margin
                <input
                  type="number"
                  value={targetMargin}
                  onChange={e => setTargetMargin(Number(e.target.value) || 0)}
                  className="w-14 px-1.5 py-1 border border-edge rounded text-xs text-right focus:outline-none focus:border-blue-400"
                />
                %
              </label>
              {rejectedCount > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-content-secondary">
                  <input type="checkbox" checked={showRejected} onChange={e => setShowRejected(e.target.checked)} className="rounded" />
                  Show rejected ({rejectedCount})
                </label>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase text-content-secondary tracking-wider border-b border-edge-soft">
                  <th className="text-left py-2 px-2 font-medium">#</th>
                  <th className="text-left py-2 px-2 font-medium">Printer</th>
                  <th className="text-left py-2 px-2 font-medium">Status</th>
                  <th className="text-right py-2 px-2 font-medium" title="Books in this printer with a non-zero quote">Books</th>
                  <th className="text-right py-2 px-2 font-medium" title="Average True Cost / Good Book across quoted books">Avg True Cost</th>
                  <th className="text-right py-2 px-2 font-medium" title="Average net margin % across quoted books at this printer">Avg Margin %</th>
                  <th className="text-right py-2 px-2 font-medium" title={`Books whose margin meets or beats ${targetMargin}%`}>≥ Target</th>
                  <th className="text-right py-2 px-2 font-medium" title="Books where this printer's true cost is cheaper than your current production_cost + shipping_cost">Beats Current</th>
                </tr>
              </thead>
              <tbody>
                {visibleRankings.map((r, i) => {
                  const isSelected = r.printer === selectedPrinter;
                  return (
                    <tr
                      key={r.printer}
                      onClick={() => setSelectedPrinter(r.printer)}
                      className={`border-b border-edge-soft cursor-pointer hover:bg-surface-hover/60 ${isSelected ? 'bg-blue-50/40' : ''}`}
                    >
                      <td className="py-1.5 px-2 text-content-muted text-xs">{i + 1}</td>
                      <td className="py-1.5 px-2 font-medium text-content">{r.printer}</td>
                      <td className="py-1.5 px-2" onClick={e => e.stopPropagation()}>
                        <select
                          value={r.status}
                          onChange={e => setStatus(r.printer, e.target.value as PrinterStatus)}
                          className={`px-2 py-0.5 text-[11px] rounded-full border focus:outline-none ${statusChipClass(r.status)}`}
                        >
                          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5 px-2 text-right text-content-secondary">{r.bookCount}</td>
                      <td className="py-1.5 px-2 text-right font-medium text-content">{formatCurrency(r.avgTrueCost)}</td>
                      <td className={`py-1.5 px-2 text-right font-medium ${r.avgMarginPercent >= targetMargin ? 'text-emerald-600' : 'text-content-secondary'}`}>
                        {r.avgMarginPercent.toFixed(1)}%
                      </td>
                      <td className="py-1.5 px-2 text-right text-content-secondary">{r.booksHittingTarget}/{r.bookCount}</td>
                      <td className="py-1.5 px-2 text-right text-content-secondary">{r.booksCheaperThanCurrent}/{r.bookCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Printer Selector */}
      <div className="bg-surface rounded-card border border-edge p-4 mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-content">Printer</label>
        <select
          value={selectedPrinter}
          onChange={e => setSelectedPrinter(e.target.value)}
          className="px-3 py-2 border border-edge rounded-control text-sm focus:outline-none focus:border-blue-400 min-w-[200px]"
        >
          <option value="">Select a printer…</option>
          {printers.filter(p => showRejected || statusFor(p) !== 'rejected').map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {selectedPrinter && (
          <select
            value={statusFor(selectedPrinter)}
            onChange={e => setStatus(selectedPrinter, e.target.value as PrinterStatus)}
            className={`px-2 py-1 text-xs rounded-full border focus:outline-none ${statusChipClass(statusFor(selectedPrinter))}`}
          >
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <button
          onClick={addPrinter}
          className="flex items-center gap-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-control hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" /> Add Printer
        </button>
        {selectedPrinter && (
          <button
            onClick={handleDeletePrinter}
            className="ml-auto flex items-center gap-1 px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-control"
            title={`Delete all quotes for ${selectedPrinter}`}
          >
            <Trash2 className="w-4 h-4" /> Delete printer
          </button>
        )}
      </div>

      {/* Per-book quote table */}
      {!hasLoaded ? (
        <div className="bg-surface rounded-card border border-edge p-12 text-center">
          <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : selectedPrinter ? (
        <div className="bg-surface rounded-card border border-edge overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-hover border-b border-edge text-[11px] uppercase text-content-secondary tracking-wider">
                  <th className="text-left py-2.5 px-3 font-medium sticky left-0 bg-surface-hover">Book</th>
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
                    ? 'text-content-faint'
                    : diff < 0 ? 'text-emerald-600' : diff > 0 ? 'text-amber-600' : 'text-content-secondary';
                  const marginColor = result.netMarginPercent >= 50 ? 'text-emerald-600' : result.netMarginPercent >= 30 ? 'text-amber-600' : 'text-red-500';
                  const hasQuote = !!quotes.find(q => q.printer === selectedPrinter && q.product_id === p.id);
                  return (
                    <tr key={p.id} className="border-b border-edge-soft hover:bg-surface-hover/40 group">
                      <td className="py-2 px-3 font-medium text-content sticky left-0 bg-surface group-hover:bg-surface-hover/40">{p.name}</td>
                      <td className="py-2 px-3 text-right text-content-secondary">{formatCurrency(p.production_cost + p.shipping_cost)}</td>
                      <QuoteNumCell value={row.unit_cost} onChange={v => updateLocal(p.id, 'unit_cost', v)} onSave={v => saveField(p.id, 'unit_cost', v)} saving={savingCell === `${p.id}:unit_cost`} highlight />
                      <QuoteNumCell value={row.shipping_estimate} onChange={v => updateLocal(p.id, 'shipping_estimate', v)} onSave={v => saveField(p.id, 'shipping_estimate', v)} saving={savingCell === `${p.id}:shipping_estimate`} />
                      <td className="py-2 px-3 text-right font-medium text-content">{row.unit_cost > 0 ? formatCurrency(result.trueCost) : '—'}</td>
                      <td className={`py-2 px-3 text-right font-medium ${row.unit_cost > 0 ? marginColor : 'text-content-faint'}`}>
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
                  <tr><td colSpan={9} className="py-12 text-center text-content-muted italic">No books to show.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-surface rounded-card border border-edge p-12 text-center text-content-muted italic">
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
        className={`w-24 px-2 py-1.5 border border-transparent hover:border-edge focus:border-blue-400 focus:bg-blue-50/20 rounded text-sm text-right focus:outline-none ${highlight ? 'font-medium' : ''} ${saving ? 'bg-blue-50/40' : ''}`}
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
        className={`min-w-[180px] w-full px-2 py-1.5 border border-transparent hover:border-edge focus:border-blue-400 focus:bg-blue-50/20 rounded text-sm focus:outline-none ${saving ? 'bg-blue-50/40' : ''}`}
      />
    </td>
  );
}
