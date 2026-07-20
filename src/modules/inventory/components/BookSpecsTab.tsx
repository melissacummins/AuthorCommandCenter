import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import type { Product, BookSpec } from '../../../lib/types';
import { supabase } from '../../../lib/supabase';
import { useProducts } from '../hooks/useProducts';
import { getAllBookSpecs, upsertBookSpec, deleteBookSpecForProduct, type BookSpecPatch } from '../api/bookSpecs';
import { getAddonTags, upsertAddonTagColor } from '../api/addonTags';
import CsvImporter, { type ParsedRow } from './CsvImporter';
import TagMultiSelect, { type TagColor } from './TagMultiSelect';

type Field = keyof Pick<BookSpec, 'format' | 'trim_size' | 'lamination' | 'paper_gsm' | 'special_addons' | 'bw_pages' | 'color_pages' | 'notes'>;

interface RowState {
  format: string;
  trim_size: string;
  lamination: string;
  paper_gsm: string;
  special_addons: string;
  bw_pages: number;
  color_pages: number;
  notes: string;
}

const EMPTY_ROW: RowState = {
  format: '', trim_size: '', lamination: '', paper_gsm: '', special_addons: '',
  bw_pages: 0, color_pages: 0, notes: '',
};

const FORMAT_OPTIONS = ['Paperback', 'Hardcover'];
const SIZE_OPTIONS = ['5 x 8', '5.25 x 8', '5.5 x 8.5', '6 x 9', '7 x 10', '8 x 10', '8.5 x 11'];
const LAMINATION_OPTIONS = ['Matte', 'Gloss'];

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
    notes: s.notes || '',
  };
}

export default function BookSpecsTab() {
  const { products } = useProducts();
  const [specs, setSpecs] = useState<BookSpec[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const addPickerRef = useRef<HTMLDivElement | null>(null);
  const [tagColorMap, setTagColorMap] = useState<Map<string, string>>(new Map());
  // hasLoaded distinguishes "first fetch hasn't completed yet" from "fetch
  // completed and returned zero". Without it, a transient fetch failure
  // (e.g. auth token refresh window) makes the page look like data was wiped.
  const [hasLoaded, setHasLoaded] = useState(false);

  async function reloadTagColors() {
    try {
      const data = await getAddonTags();
      const m = new Map<string, string>();
      for (const t of data) m.set(t.label.toLowerCase(), t.color);
      setTagColorMap(m);
    } catch (err) {
      console.error('Failed to load addon tag colors', err);
    }
  }

  useEffect(() => { reloadTagColors(); }, []);

  async function handleSetTagColor(label: string, color: TagColor) {
    setTagColorMap(prev => {
      const next = new Map(prev);
      next.set(label.toLowerCase(), color);
      return next;
    });
    try {
      await upsertAddonTagColor(label, color);
    } catch (err) {
      console.error('Failed to save tag color', err);
    }
  }

  async function reloadSpecs() {
    try {
      const data = await getAllBookSpecs();
      setSpecs(data);
      setHasLoaded(true);
    } catch (err) {
      console.error('Failed to load specs', err);
    }
  }

  useEffect(() => { reloadSpecs(); }, []);

  // Refetch when the Supabase auth token rotates and when the tab regains
  // focus after sitting idle — both moments where a stale fetch could have
  // returned empty and left the UI in a misleading "no rows" state.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        reloadSpecs();
        reloadTagColors();
      }
    });
    function onFocus() { reloadSpecs(); reloadTagColors(); }
    window.addEventListener('focus', onFocus);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Rebuild row state when products or specs change
  useEffect(() => {
    const byProduct = new Map(specs.map(s => [s.product_id, s]));
    const next: Record<string, RowState> = {};
    for (const p of products) next[p.id] = specToRow(byProduct.get(p.id));
    setRows(next);
  }, [products, specs]);

  // Click-away closes the add picker
  useEffect(() => {
    if (!showAddPicker) return;
    function onDocClick(e: MouseEvent) {
      if (addPickerRef.current && !addPickerRef.current.contains(e.target as Node)) {
        setShowAddPicker(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showAddPicker]);

  const trackedProductIds = useMemo(() => new Set(specs.map(s => s.product_id)), [specs]);

  // Books currently shown in the table: those with a spec row
  const trackedBooks = useMemo(() => {
    return products
      .filter(p => trackedProductIds.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, trackedProductIds]);

  // Every tag the user has used anywhere — feeds the multi-select autocomplete.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of specs) {
      for (const raw of (s.special_addons || '').split(',')) {
        const t = raw.trim();
        if (t) set.add(t);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [specs]);

  // Candidates for the Add dropdown: products not yet tracked
  const candidateProducts = useMemo(() => {
    return products
      .filter(p => !trackedProductIds.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, trackedProductIds]);

  async function addBook(productId: string) {
    setShowAddPicker(false);
    try {
      // Empty insert creates the spec row; refresh
      await upsertBookSpec(productId, {});
      await reloadSpecs();
    } catch (err) {
      console.error('Failed to add book to specs', err);
    }
  }

  async function removeBook(product: Product) {
    if (!confirm(`Remove "${product.name}" from Book Specs? (This deletes the saved specs.)`)) return;
    try {
      await deleteBookSpecForProduct(product.id);
      await reloadSpecs();
    } catch (err) {
      console.error('Failed to remove book', err);
    }
  }

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
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-content">Book Specifications</h2>
          <p className="text-sm text-content-secondary mt-1">
            Physical specs per book — pull these up when you're getting a fresh quote. Add the books you want to track below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-edge text-content rounded-control hover:bg-surface-hover"
          >
            <Upload className="w-4 h-4" /> Import CSV
          </button>
        <div className="relative" ref={addPickerRef}>
          <button
            onClick={() => setShowAddPicker(s => !s)}
            disabled={candidateProducts.length === 0}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-brand-600 text-brand-fg rounded-control hover:bg-brand-700 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Add Book
          </button>
          {showAddPicker && candidateProducts.length > 0 && (
            <div className="absolute right-0 mt-1 z-10 bg-surface border border-edge rounded-control shadow-lg max-h-72 overflow-y-auto min-w-[280px]">
              {candidateProducts.map(p => (
                <button
                  key={p.id}
                  onClick={() => addBook(p.id)}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-brand-50 border-b border-edge-soft last:border-b-0"
                >
                  <div className="text-content">{p.name}</div>
                  <div className="text-[11px] text-content-muted">{p.category}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>

      <CsvImporter
        open={showImport}
        onClose={() => setShowImport(false)}
        products={products}
        kind="book-specs"
        onComplete={reloadSpecs}
        onImportRows={async (rows: ParsedRow[]) => {
          let imported = 0;
          let failed = 0;
          for (const r of rows) {
            if (!r.productId) continue;
            try {
              const patch: BookSpecPatch = {};
              if (r.fields.format) patch.format = r.fields.format;
              if (r.fields.trim_size) patch.trim_size = r.fields.trim_size;
              if (r.fields.lamination) patch.lamination = r.fields.lamination;
              if (r.fields.paper_gsm) patch.paper_gsm = r.fields.paper_gsm;
              if (r.fields.special_addons) patch.special_addons = r.fields.special_addons;
              if (r.fields.notes) patch.notes = r.fields.notes;
              if (r.fields.bw_pages) patch.bw_pages = Number(r.fields.bw_pages) || 0;
              if (r.fields.color_pages) patch.color_pages = Number(r.fields.color_pages) || 0;
              await upsertBookSpec(r.productId, patch);
              imported++;
            } catch (err) {
              console.error('Row failed', r, err);
              failed++;
            }
          }
          return { imported, failed };
        }}
      />

      {!hasLoaded ? (
        <div className="bg-surface rounded-card border border-edge p-12 text-center">
          <div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : trackedBooks.length === 0 ? (
        <div className="bg-surface rounded-card border border-edge p-12 text-center text-content-muted italic">
          No books tracked yet. Click "Add Book" to pick one from your products.
        </div>
      ) : (
        <div className="bg-surface rounded-card border border-edge overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-hover border-b border-edge text-[11px] uppercase text-content-secondary tracking-wider">
                  <th className="text-left py-2.5 px-3 font-medium sticky left-0 bg-surface-hover min-w-[260px]">Book</th>
                  <th className="text-left py-2.5 px-3 font-medium">Format</th>
                  <th className="text-left py-2.5 px-3 font-medium">Size</th>
                  <th className="text-left py-2.5 px-3 font-medium">Lamination</th>
                  <th className="text-left py-2.5 px-3 font-medium">Paper GSM</th>
                  <th className="text-right py-2.5 px-3 font-medium">B/W</th>
                  <th className="text-right py-2.5 px-3 font-medium">Color</th>
                  <th className="text-left py-2.5 px-3 font-medium min-w-[260px]">Special Add-ons</th>
                  <th className="text-left py-2.5 px-3 font-medium">Notes</th>
                  <th className="py-2.5 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {trackedBooks.map(p => {
                  const row = rows[p.id] ?? EMPTY_ROW;
                  return (
                    <tr key={p.id} className="border-b border-edge-soft hover:bg-surface-hover/40 group">
                      <td className="py-2 px-3 font-medium text-content sticky left-0 bg-surface group-hover:bg-surface-hover/40 min-w-[260px]">
                        <div>{p.name}</div>
                        <div className="text-[11px] text-content-muted font-normal">{p.category}{p.sku ? ` · ${p.sku}` : ''}</div>
                      </td>
                      <SelectCell value={row.format} options={FORMAT_OPTIONS} onChange={v => updateLocal(p.id, 'format', v)} onSave={v => saveField(p, 'format', v)} saving={savingCell === `${p.id}:format`} />
                      <SelectCell value={row.trim_size} options={SIZE_OPTIONS} onChange={v => updateLocal(p.id, 'trim_size', v)} onSave={v => saveField(p, 'trim_size', v)} saving={savingCell === `${p.id}:trim_size`} />
                      <SelectCell value={row.lamination} options={LAMINATION_OPTIONS} onChange={v => updateLocal(p.id, 'lamination', v)} onSave={v => saveField(p, 'lamination', v)} saving={savingCell === `${p.id}:lamination`} />
                      <TextCell value={row.paper_gsm} placeholder="80 Uncoated" onChange={v => updateLocal(p.id, 'paper_gsm', v)} onSave={v => saveField(p, 'paper_gsm', v)} saving={savingCell === `${p.id}:paper_gsm`} />
                      <NumCell value={row.bw_pages} onChange={v => updateLocal(p.id, 'bw_pages', v)} onSave={v => saveField(p, 'bw_pages', v)} saving={savingCell === `${p.id}:bw_pages`} />
                      <NumCell value={row.color_pages} onChange={v => updateLocal(p.id, 'color_pages', v)} onSave={v => saveField(p, 'color_pages', v)} saving={savingCell === `${p.id}:color_pages`} />
                      <td className="py-1 px-2 align-top">
                        <TagMultiSelect
                          value={row.special_addons}
                          allTags={allTags}
                          colorMap={tagColorMap}
                          onSetTagColor={handleSetTagColor}
                          onChange={v => { updateLocal(p.id, 'special_addons', v); saveField(p, 'special_addons', v); }}
                        />
                      </td>
                      <TextCell value={row.notes} placeholder="" wide onChange={v => updateLocal(p.id, 'notes', v)} onSave={v => saveField(p, 'notes', v)} saving={savingCell === `${p.id}:notes`} />
                      <td className="py-1 px-2 align-top">
                        <button onClick={() => removeBook(p)} className="p-1 text-red-400 hover:bg-red-50 rounded" title="Remove from Book Specs">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SelectCell({ value, options, onChange, onSave, saving }: { value: string; options: string[]; onChange: (v: string) => void; onSave: (v: string) => void; saving: boolean }) {
  const isCustom = value !== '' && !options.includes(value);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === '__custom__') {
      const custom = prompt('Enter a custom value:')?.trim();
      if (!custom) return;
      onChange(custom);
      onSave(custom);
      return;
    }
    onChange(v);
    onSave(v);
  }

  return (
    <td className="py-1 px-2 align-top">
      <select
        value={value}
        onChange={handleChange}
        className={`min-w-[120px] w-full px-2 py-1.5 border border-transparent hover:border-edge focus:border-brand-400 focus:bg-brand-50/20 rounded text-sm bg-surface focus:outline-none ${saving ? 'bg-brand-50/40' : ''}`}
      >
        <option value="">—</option>
        {isCustom && <option value={value}>{value}</option>}
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        <option value="__custom__">Custom…</option>
      </select>
    </td>
  );
}

function TextCell({ value, placeholder, onChange, onSave, saving, wide }: { value: string; placeholder?: string; onChange: (v: string) => void; onSave: (v: string) => void; saving: boolean; wide?: boolean }) {
  return (
    <td className="py-1 px-2 align-top">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onBlur={() => onSave(value)}
        className={`${wide ? 'min-w-[180px]' : 'min-w-[110px]'} w-full px-2 py-1.5 border border-transparent hover:border-edge focus:border-brand-400 focus:bg-brand-50/20 rounded text-sm focus:outline-none ${saving ? 'bg-brand-50/40' : ''}`}
      />
    </td>
  );
}

function NumCell({ value, onChange, onSave, saving }: { value: number; onChange: (v: number) => void; onSave: (v: number) => void; saving: boolean }) {
  return (
    <td className="py-1 px-2 align-top">
      <input
        type="number"
        min={0}
        value={value || ''}
        placeholder="0"
        onChange={e => onChange(Number(e.target.value))}
        onBlur={() => onSave(value)}
        className={`w-20 px-2 py-1.5 border border-transparent hover:border-edge focus:border-brand-400 focus:bg-brand-50/20 rounded text-sm text-right focus:outline-none ${saving ? 'bg-brand-50/40' : ''}`}
      />
    </td>
  );
}
