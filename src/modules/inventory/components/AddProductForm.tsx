import React, { useState } from 'react';
import { CATEGORIES } from '../utils';
import { addProduct } from '../api';
import type { Product, ProductCategory } from '../../../lib/types';

interface AddProductFormProps {
  onClose: () => void;
  onRefetch: () => void;
  duplicateFrom?: Product | null;
}

export default function AddProductForm({ onClose, onRefetch, duplicateFrom }: AddProductFormProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    sku: '',
    category: (duplicateFrom?.category ?? 'Paperback') as string,
    base_price: duplicateFrom?.base_price ?? 0,
    production_cost: duplicateFrom?.production_cost ?? 0,
    shipping_cost: duplicateFrom?.shipping_cost ?? 0,
    shipping_supplies_cost: duplicateFrom?.shipping_supplies_cost ?? 0,
    pa_costs: duplicateFrom?.pa_costs ?? 0,
    qa_cost: duplicateFrom?.qa_cost ?? 0,
    handling_fee_add_on: duplicateFrom?.handling_fee_add_on ?? 0,
    tt_shop_price: duplicateFrom?.tt_shop_price ?? 0,
    free_shipping: duplicateFrom?.free_shipping ?? 0,
    book_stock: 0,
    book_inventory: 0,
    bundles_inventory: 0,
    lead_time: duplicateFrom?.lead_time ?? 0,
    books_in_bundle: '',
    bundles: '',
    do_not_reorder: false,
  });

  function updateField(field: string, value: string | number | boolean) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  const isBundle = form.category === 'Bundle' || form.category === 'Book Box';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Product name is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await addProduct({
        ...form,
        category: form.category as ProductCategory,
        books_purchased: 0,
        bundles_purchased: 0,
        purchased_via_bundles: 0,
        bundles_inventory: isBundle ? form.bundles_inventory : 0,
        book_stock: isBundle ? 0 : form.book_stock,
        book_inventory: isBundle ? 0 : form.book_inventory,
        six_month_book_sales: 0,
        six_month_bundle_sales: 0,
        csv_avg_daily: 0,
        csv_reorder_threshold: 0,
        shopify_inventory_item_id: null,
        shopify_variant_id: null,
        default_scratch_dent_product_id: null,
      });
      onRefetch();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add product.');
    }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {duplicateFrom && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-3 py-2 rounded-lg text-sm">
          Pricing & costs copied from <strong>{duplicateFrom.name}</strong>. Enter a new name and SKU below.
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs text-slate-500 mb-1">Product Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={e => updateField('name', e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">SKU</label>
          <input
            type="text"
            value={form.sku}
            onChange={e => updateField('sku', e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Category</label>
          <select
            value={form.category}
            onChange={e => updateField('category', e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
          >
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4">
        <p className="text-sm font-medium text-slate-700 mb-3">Pricing</p>
        <div className="grid grid-cols-2 gap-4">
          <NumberField label="Base Price" value={form.base_price} onChange={v => updateField('base_price', v)} />
          <NumberField label="TT Shop Price" value={form.tt_shop_price} onChange={v => updateField('tt_shop_price', v)} />
          <NumberField label="Production Cost" value={form.production_cost} onChange={v => updateField('production_cost', v)} />
          <NumberField label="Shipping Cost" value={form.shipping_cost} onChange={v => updateField('shipping_cost', v)} />
          <NumberField label="Shipping Supplies" value={form.shipping_supplies_cost} onChange={v => updateField('shipping_supplies_cost', v)} />
          <NumberField label="PA Costs" value={form.pa_costs} onChange={v => updateField('pa_costs', v)} />
          <NumberField label="QA Cost (per unit)" value={form.qa_cost} onChange={v => updateField('qa_cost', v)} />
          <NumberField label="Handling Fee Add-On" value={form.handling_fee_add_on} onChange={v => updateField('handling_fee_add_on', v)} />
          <NumberField label="Free Shipping" value={form.free_shipping} onChange={v => updateField('free_shipping', v)} />
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4">
        <p className="text-sm font-medium text-slate-700 mb-3">
          {isBundle ? 'Bundle Inventory' : 'Inventory'}
        </p>
        <div className="grid grid-cols-2 gap-4">
          {isBundle ? (
            <NumberField label="Starting Bundle Inventory" value={form.bundles_inventory} onChange={v => updateField('bundles_inventory', v)} />
          ) : (
            <>
              <NumberField label="Starting Stock" value={form.book_stock} onChange={v => updateField('book_stock', v)} />
              <NumberField label="Book Inventory" value={form.book_inventory} onChange={v => updateField('book_inventory', v)} />
            </>
          )}
          <NumberField label="Lead Time (days)" value={form.lead_time} onChange={v => updateField('lead_time', v)} />
        </div>
      </div>

      {isBundle && (
        <div className="border-t border-slate-200 pt-4">
          <p className="text-sm font-medium text-slate-700 mb-3">Bundle Contents</p>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Books in Bundle (comma-separated)</label>
            <input
              type="text"
              value={form.books_in_bundle}
              onChange={e => updateField('books_in_bundle', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-slate-200 pt-4">
        <input
          type="checkbox"
          id="doNotReorder"
          checked={form.do_not_reorder}
          onChange={e => updateField('do_not_reorder', e.target.checked)}
          className="rounded"
        />
        <label htmlFor="doNotReorder" className="text-sm text-slate-600">Do not reorder (tracking only)</label>
      </div>

      {error && <p className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Adding...' : 'Add Product'}
        </button>
      </div>
    </form>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
      />
    </div>
  );
}
