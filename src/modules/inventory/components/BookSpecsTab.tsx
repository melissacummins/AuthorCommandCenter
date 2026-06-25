import { useEffect, useMemo, useState } from 'react';
import type { Product, BookSpec } from '../../../lib/types';
import { useProducts } from '../hooks/useProducts';
import { getAllBookSpecs, upsertBookSpec, type BookSpecPatch } from '../api/bookSpecs';

type Field = keyof Pick<BookSpec, 'format' | 'trim_size' | 'lamination' | 'paper_gsm' | 'special_addons' | 'bw_pages' | 'color_pages' | 'isbn' | 'notes'>;

interface RowState {
  format: string;
  trim_size: string;
  lamination: string;
  paper_gsm: string;
  special_addons: string;
  bw_pages: number;
  color_pages: number;
  isbn: string;
  notes: string;
}

const EMPTY_ROW: RowState = {
  format: '', trim_size: '', lamination: '', paper_gsm: '', special_addons: '',
  bw_pages: 0, color_pages: 0, isbn: '', notes: '',
};

function specToRow(s: BookSpec | undefined): RowState {
  if (!s) return EMPTY_ROW;
  return {
    format: s.format || '',
    trim_size: s.trim_size || '',
    lamination: s.lamination || '',
    paper_gsm: s.paper_gsm || '',
    special_addons: s.special_addons || '',
    bw_pages: s.bw_pages || 0,
    color_pages: s.color_pages || 0,
    isbn: s.isbn || '',
    notes: s.notes || '',
  };
}

export default function BookSpecsTab() {
  const { products } = useProducts();
  const [specs, setSpecs] = useState<BookSpec[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [includeSD, setIncludeSD] = useState(false);

  useEffect(() => {
    getAllBookSpecs().then(setSpecs).catch(err => console.error('Failed to load specs', err));
  }, []);

  // Rebuild row state when products or specs change
  useEffect(() => {
    const byProduct = new Map(specs.map(s => [s.product_id, s]));
    const next: Record<string, RowState> = {};
    for (const p of products) next[p.id] = specToRow(byProduct.get(p.id));
    setRows(next);
  }, [products, specs]);

  const books = useMemo(() => {
    return products
      .filter(p => p.category !== 'Bundle' && p.category !== 'Book Box')
      .filter(p => includeSD || (!/\bS&D\b|- S&D/i.test(p.name)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, includeSD]);

  async function saveField(product: Product, field: Field, value: string | number) {
    const cellKey = `${product.id}:${field}`;
    setSavingCell(cellKey);
    try {
      await upsertBookSpec(product.id, { [field]: value } as BookSpecPatch);
    } catch (err) {
      console.error('Failed to save spec', err);
    }
    setSavingCell(null);
  }

  function updateLocal(productId: string, field: Field, value: string | number) {
    setRows(prev => ({ ...prev, [productId]: { ...prev[productId], [field]: value } }));
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Book Specifications</h2>
          <p className="text-sm text-slate-500 mt-1">Physical specs per book — pull these up when you're getting a fresh quote.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={includeSD} onChange={e => setIncludeSD(e.target.checked)} className="rounded" />
          Include S&amp;D variants
        </label>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 tracking-wider">
                <th className="text-left py-2.5 px-3 font-medium sticky left-0 bg-slate-50">Book</th>
                <th className="text-left py-2.5 px-3 font-medium">Format</th>
                <th className="text-left py-2.5 px-3 font-medium">Size</th>
                <th className="text-left py-2.5 px-3 font-medium">Lamination</th>
                <th className="text-left py-2.5 px-3 font-medium">Paper GSM</th>
                <th className="text-right py-2.5 px-3 font-medium">B/W</th>
                <th className="text-right py-2.5 px-3 font-medium">Color</th>
                <th className="text-left py-2.5 px-3 font-medium">Special Add-ons</th>
                <th className="text-left py-2.5 px-3 font-medium">ISBN</th>
                <th className="text-left py-2.5 px-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {books.map(p => {
                const row = rows[p.id] ?? EMPTY_ROW;
                return (
                  <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/40 group">
                    <td className="py-2 px-3 font-medium text-slate-800 sticky left-0 bg-white group-hover:bg-slate-50/40">{p.name}</td>
                    <SpecCell value={row.format} placeholder="Paperback" onSave={v => saveField(p, 'format', v)} onChange={v => updateLocal(p.id, 'format', v)} saving={savingCell === `${p.id}:format`} />
                    <SpecCell value={row.trim_size} placeholder="8x5.25" onSave={v => saveField(p, 'trim_size', v)} onChange={v => updateLocal(p.id, 'trim_size', v)} saving={savingCell === `${p.id}:trim_size`} />
                    <SpecCell value={row.lamination} placeholder="Matte" onSave={v => saveField(p, 'lamination', v)} onChange={v => updateLocal(p.id, 'lamination', v)} saving={savingCell === `${p.id}:lamination`} />
                    <SpecCell value={row.paper_gsm} placeholder="80 Uncoated" onSave={v => saveField(p, 'paper_gsm', v)} onChange={v => updateLocal(p.id, 'paper_gsm', v)} saving={savingCell === `${p.id}:paper_gsm`} />
                    <SpecNumCell value={row.bw_pages} onSave={v => saveField(p, 'bw_pages', v)} onChange={v => updateLocal(p.id, 'bw_pages', v)} saving={savingCell === `${p.id}:bw_pages`} />
                    <SpecNumCell value={row.color_pages} onSave={v => saveField(p, 'color_pages', v)} onChange={v => updateLocal(p.id, 'color_pages', v)} saving={savingCell === `${p.id}:color_pages`} />
                    <SpecCell value={row.special_addons} placeholder="" onSave={v => saveField(p, 'special_addons', v)} onChange={v => updateLocal(p.id, 'special_addons', v)} saving={savingCell === `${p.id}:special_addons`} wide />
                    <SpecCell value={row.isbn} placeholder="" onSave={v => saveField(p, 'isbn', v)} onChange={v => updateLocal(p.id, 'isbn', v)} saving={savingCell === `${p.id}:isbn`} />
                    <SpecCell value={row.notes} placeholder="" onSave={v => saveField(p, 'notes', v)} onChange={v => updateLocal(p.id, 'notes', v)} saving={savingCell === `${p.id}:notes`} wide />
                  </tr>
                );
              })}
              {books.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400 italic">No books to show.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SpecCell({ value, placeholder, onSave, onChange, saving, wide }: { value: string; placeholder?: string; onSave: (v: string) => void; onChange: (v: string) => void; saving: boolean; wide?: boolean }) {
  return (
    <td className="py-1 px-2 align-top">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onBlur={() => onSave(value)}
        className={`${wide ? 'min-w-[180px]' : 'min-w-[110px]'} w-full px-2 py-1.5 border border-transparent hover:border-slate-200 focus:border-blue-400 focus:bg-blue-50/20 rounded text-sm focus:outline-none ${saving ? 'bg-blue-50/40' : ''}`}
      />
    </td>
  );
}

function SpecNumCell({ value, onSave, onChange, saving }: { value: number; onSave: (v: number) => void; onChange: (v: number) => void; saving: boolean }) {
  return (
    <td className="py-1 px-2 align-top">
      <input
        type="number"
        min={0}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        onBlur={() => onSave(value)}
        className={`w-20 px-2 py-1.5 border border-transparent hover:border-slate-200 focus:border-blue-400 focus:bg-blue-50/20 rounded text-sm text-right focus:outline-none ${saving ? 'bg-blue-50/40' : ''}`}
      />
    </td>
  );
}
