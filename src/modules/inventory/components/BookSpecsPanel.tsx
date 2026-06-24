import { useEffect, useState } from 'react';
import type { BookSpec } from '../../../lib/types';
import { getBookSpecForProduct, upsertBookSpec, type BookSpecPatch } from '../api/bookSpecs';

interface Props {
  productId: string;
}

type FormState = Pick<BookSpec,
  'format' | 'trim_size' | 'lamination' | 'paper_gsm' | 'special_addons' |
  'bw_pages' | 'color_pages' | 'isbn' | 'notes'>;

const EMPTY: FormState = {
  format: '', trim_size: '', lamination: '', paper_gsm: '', special_addons: '',
  bw_pages: 0, color_pages: 0, isbn: '', notes: '',
};

export default function BookSpecsPanel({ productId }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [savingField, setSavingField] = useState<keyof FormState | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getBookSpecForProduct(productId)
      .then(spec => {
        if (cancelled) return;
        setForm(spec ? {
          format: spec.format || '',
          trim_size: spec.trim_size || '',
          lamination: spec.lamination || '',
          paper_gsm: spec.paper_gsm || '',
          special_addons: spec.special_addons || '',
          bw_pages: spec.bw_pages || 0,
          color_pages: spec.color_pages || 0,
          isbn: spec.isbn || '',
          notes: spec.notes || '',
        } : EMPTY);
      })
      .catch(err => console.error('Failed to load book specs', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [productId]);

  async function saveField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [field]: value }));
    setSavingField(field);
    try {
      await upsertBookSpec(productId, { [field]: value } as BookSpecPatch);
    } catch (err) {
      console.error('Failed to save book spec field', field, err);
    }
    setSavingField(null);
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Book Specifications</h4>
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Book Specifications</h4>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <TextField label="Format" value={form.format} placeholder="Paperback" onSave={v => saveField('format', v)} saving={savingField === 'format'} />
        <TextField label="Size" value={form.trim_size} placeholder="8x5.25" onSave={v => saveField('trim_size', v)} saving={savingField === 'trim_size'} />
        <TextField label="Lamination" value={form.lamination} placeholder="Matte" onSave={v => saveField('lamination', v)} saving={savingField === 'lamination'} />
        <TextField label="Paper GSM" value={form.paper_gsm} placeholder="80 Uncoated" onSave={v => saveField('paper_gsm', v)} saving={savingField === 'paper_gsm'} />
        <NumberField label="B/W Pages" value={form.bw_pages} onSave={v => saveField('bw_pages', v)} saving={savingField === 'bw_pages'} />
        <NumberField label="Color Pages" value={form.color_pages} onSave={v => saveField('color_pages', v)} saving={savingField === 'color_pages'} />
        <div className="col-span-2 md:col-span-3">
          <TextField label="Special Add-ons" value={form.special_addons} placeholder="Foiled Dust Jacket, Sprayed Edges, …" onSave={v => saveField('special_addons', v)} saving={savingField === 'special_addons'} />
        </div>
        <TextField label="ISBN" value={form.isbn} placeholder="" onSave={v => saveField('isbn', v)} saving={savingField === 'isbn'} />
        <div className="col-span-2 md:col-span-3">
          <TextField label="Notes" value={form.notes} placeholder="" onSave={v => saveField('notes', v)} saving={savingField === 'notes'} />
        </div>
      </div>
    </div>
  );
}

function TextField({ label, value, placeholder, onSave, saving }: { label: string; value: string; placeholder?: string; onSave: (v: string) => void; saving: boolean }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <div>
      <label className="block text-[11px] text-slate-400 uppercase mb-0.5">{label}{saving && <span className="text-blue-400 ml-1 normal-case">saving…</span>}</label>
      <input
        type="text"
        value={local}
        placeholder={placeholder}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => { if (local !== value) onSave(local); }}
        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
      />
    </div>
  );
}

function NumberField({ label, value, onSave, saving }: { label: string; value: number; onSave: (v: number) => void; saving: boolean }) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => { setLocal(String(value)); }, [value]);
  return (
    <div>
      <label className="block text-[11px] text-slate-400 uppercase mb-0.5">{label}{saving && <span className="text-blue-400 ml-1 normal-case">saving…</span>}</label>
      <input
        type="number"
        min={0}
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => { const n = Number(local); if (!Number.isNaN(n) && n !== value) onSave(n); }}
        className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
      />
    </div>
  );
}
