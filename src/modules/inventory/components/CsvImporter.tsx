import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import type { Product } from '../../../lib/types';

export interface CsvColumnMap {
  // CSV header (case-insensitive) → target field
  [csvHeader: string]: string;
}

export interface ParsedRow {
  rowIndex: number;
  productKey: string;        // raw value from the "title" column
  productId: string | null;  // matched product
  productName: string | null;
  fields: Record<string, string>; // additional fields, by target name
  // for printer quotes only
  printer?: string;
}

interface BaseProps {
  open: boolean;
  onClose: () => void;
  products: Product[];
  onComplete: () => void;
}

// Normalize for fuzzy matching: lowercase, strip non-alphanum, collapse spaces.
function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Match a CSV "title" value to a product by name. Prefers exact matches, then
// products whose normalized name is a prefix or equals the title — and avoids
// scratch-and-dent variants (so "Crowned In Blood" matches the main product,
// not "Crowned In Blood - S&D").
function matchProduct(title: string, products: Product[]): Product | null {
  if (!title) return null;
  const normTitle = normalize(title);
  if (!normTitle) return null;
  const candidates = products.filter(p => !/\bs ?d\b/.test(normalize(p.name)));
  const exact = candidates.find(p => normalize(p.name) === normTitle);
  if (exact) return exact;
  // Otherwise: product name equals title ignoring suffixes
  const startsWith = candidates.find(p => normalize(p.name).startsWith(normTitle) || normTitle.startsWith(normalize(p.name)));
  if (startsWith) return startsWith;
  return null;
}

interface ImporterProps extends BaseProps {
  kind: 'book-specs' | 'printer-quotes';
  onImportRows: (rows: ParsedRow[]) => Promise<{ imported: number; failed: number }>;
}

export default function CsvImporter({ open, onClose, products, onImportRows, onComplete, kind }: ImporterProps) {
  const [csv, setCsv] = useState('');
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCsv('');
    setParsed(null);
    setImporting(false);
    setResult(null);
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  function handleParse() {
    setError(null);
    setResult(null);
    if (!csv.trim()) { setError('Paste your CSV first.'); return; }

    const res = Papa.parse<Record<string, string>>(csv.trim(), {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: h => h.trim(),
    });
    if (res.errors.length > 0 && res.data.length === 0) {
      setError(`Couldn't parse the CSV: ${res.errors[0].message}`);
      return;
    }

    const headers = res.meta.fields || [];
    const lower = headers.map(h => h.toLowerCase());

    function pick(possibleNames: string[]): string | null {
      for (const name of possibleNames) {
        const idx = lower.indexOf(name.toLowerCase());
        if (idx >= 0) return headers[idx];
      }
      return null;
    }

    // Required columns vary by kind
    const titleHeader = kind === 'book-specs'
      ? pick(['title', 'name', 'book', 'product'])
      : pick(['for copy', 'product', 'title', 'name', 'book']);
    if (!titleHeader) {
      setError(`Couldn't find the book/title column. Looked for: ${kind === 'book-specs' ? 'Title' : 'For copy / Product'}.`);
      return;
    }

    const printerHeader = kind === 'printer-quotes' ? pick(['printer name', 'printer']) : null;
    if (kind === 'printer-quotes' && !printerHeader) {
      setError(`Couldn't find the Printer Name column.`);
      return;
    }

    // Field maps per kind
    const specFields: Array<[string, string[]]> = [
      ['format', ['format']],
      ['trim_size', ['size', 'trim size']],
      ['lamination', ['lamination']],
      ['paper_gsm', ['paper gsm', 'paper']],
      ['special_addons', ['special add-ons', 'special addons', 'add-ons', 'addons']],
      ['bw_pages', ['b/w pages', 'bw pages', 'b w pages']],
      ['color_pages', ['color pages']],
      ['isbn', ['isbn']],
      ['notes', ['notes']],
    ];
    const quoteFields: Array<[string, string[]]> = [
      ['unit_cost', ['quote for one copy', 'quote', 'unit cost', 'unit_cost']],
      ['shipping_estimate', ['shipping']],
      ['past_order_count', ['past order count', 'past orders']],
      ['notes', ['notes']],
    ];
    const fieldMap: Array<[string, string]> = (kind === 'book-specs' ? specFields : quoteFields)
      .map(([k, names]) => [k, pick(names) ?? '']) as Array<[string, string]>;

    const rows: ParsedRow[] = res.data.map((r, i) => {
      const titleValue = (r[titleHeader] || '').trim();
      const product = matchProduct(titleValue, products);
      const fields: Record<string, string> = {};
      for (const [target, src] of fieldMap) {
        if (!src) continue;
        const v = (r[src] || '').trim();
        if (v) fields[target] = v;
      }
      const printer = printerHeader ? (r[printerHeader] || '').trim() : undefined;
      return {
        rowIndex: i + 2, // header is row 1
        productKey: titleValue,
        productId: product?.id ?? null,
        productName: product?.name ?? null,
        fields,
        printer,
      };
    }).filter(row => row.productKey); // ignore empty title rows

    setParsed(rows);
  }

  async function handleImport() {
    if (!parsed) return;
    const toImport = parsed.filter(r => {
      if (!r.productId) return false;
      if (kind === 'book-specs') return true;
      if (!r.printer) return false;
      const cost = Number((r.fields.unit_cost || '').replace(/[$,\s]/g, ''));
      return cost > 0;
    });
    if (toImport.length === 0) { setError('Nothing to import — no rows matched a product (or no unit cost on quote rows).'); return; }
    setImporting(true);
    setError(null);
    try {
      const res = await onImportRows(toImport);
      setResult(res);
      onComplete();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Import failed.');
    }
    setImporting(false);
  }

  const matchSummary = useMemo(() => {
    if (!parsed) return null;
    const matched = parsed.filter(r => r.productId).length;
    const unmatched = parsed.length - matched;
    return { matched, unmatched };
  }, [parsed]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={close}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-800">
            Import {kind === 'book-specs' ? 'Book Specs' : 'Printer Quotes'} from CSV
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {kind === 'book-specs'
              ? 'Expected columns: Title, Format, Size, Lamination, Paper GSM, Special Add-ons, B/W Pages, Color Pages.'
              : 'Expected columns: Printer Name, For copy (book title), Quote for One Copy, Shipping, Past Order Count, Notes.'}
          </p>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {!parsed && (
            <>
              <textarea
                value={csv}
                onChange={e => setCsv(e.target.value)}
                placeholder="Paste CSV contents here…"
                className="w-full h-64 px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:border-blue-400"
              />
              {error && (
                <div className="flex items-start gap-2 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4 mt-0.5" /> {error}
                </div>
              )}
            </>
          )}

          {parsed && !result && matchSummary && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5 text-emerald-600 font-medium">
                  <CheckCircle2 className="w-4 h-4" /> {matchSummary.matched} matched
                </span>
                {matchSummary.unmatched > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-amber-600 font-medium">
                    <AlertCircle className="w-4 h-4" /> {matchSummary.unmatched} unmatched (will be skipped)
                  </span>
                )}
              </div>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-y-auto max-h-72">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr className="text-left text-slate-500 uppercase tracking-wider">
                        {kind === 'printer-quotes' && <th className="py-2 px-2 font-medium">Printer</th>}
                        <th className="py-2 px-2 font-medium">CSV Title</th>
                        <th className="py-2 px-2 font-medium">→ Product</th>
                        {kind === 'book-specs' && <>
                          <th className="py-2 px-2 font-medium">Format</th>
                          <th className="py-2 px-2 font-medium">Size</th>
                          <th className="py-2 px-2 font-medium">Lam</th>
                          <th className="py-2 px-2 font-medium">B/W</th>
                          <th className="py-2 px-2 font-medium">Color</th>
                        </>}
                        {kind === 'printer-quotes' && <>
                          <th className="py-2 px-2 font-medium">Quote</th>
                          <th className="py-2 px-2 font-medium">Ship</th>
                          <th className="py-2 px-2 font-medium">Past</th>
                        </>}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.map(r => (
                        <tr key={r.rowIndex} className={`border-t border-slate-100 ${r.productId ? '' : 'bg-amber-50/40 text-slate-400'}`}>
                          {kind === 'printer-quotes' && <td className="py-1.5 px-2">{r.printer || '—'}</td>}
                          <td className="py-1.5 px-2">{r.productKey}</td>
                          <td className="py-1.5 px-2">{r.productName || <span className="text-amber-700">no match</span>}</td>
                          {kind === 'book-specs' && <>
                            <td className="py-1.5 px-2">{r.fields.format || '—'}</td>
                            <td className="py-1.5 px-2">{r.fields.trim_size || '—'}</td>
                            <td className="py-1.5 px-2">{r.fields.lamination || '—'}</td>
                            <td className="py-1.5 px-2">{r.fields.bw_pages || '—'}</td>
                            <td className="py-1.5 px-2">{r.fields.color_pages || '—'}</td>
                          </>}
                          {kind === 'printer-quotes' && <>
                            <td className="py-1.5 px-2">{r.fields.unit_cost || '—'}</td>
                            <td className="py-1.5 px-2">{r.fields.shipping_estimate || '—'}</td>
                            <td className="py-1.5 px-2">{r.fields.past_order_count || '—'}</td>
                          </>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {error && (
                <div className="flex items-start gap-2 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4 mt-0.5" /> {error}
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="text-center py-8">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
              <p className="text-slate-800 font-medium">Imported {result.imported} row{result.imported === 1 ? '' : 's'}.</p>
              {result.failed > 0 && <p className="text-amber-600 text-sm mt-1">{result.failed} failed — check the console.</p>}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-200 flex justify-end gap-3">
          {!parsed && (
            <>
              <button onClick={close} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleParse} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Parse</button>
            </>
          )}
          {parsed && !result && (
            <>
              <button onClick={() => { setParsed(null); setError(null); }} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Back</button>
              <button onClick={handleImport} disabled={importing || !matchSummary?.matched} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {importing ? 'Importing…' : `Import ${matchSummary?.matched ?? 0} matched row${matchSummary?.matched === 1 ? '' : 's'}`}
              </button>
            </>
          )}
          {result && (
            <button onClick={close} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
