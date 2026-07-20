import React, { useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import type { Product } from '../../../lib/types';
import { adjustStock } from '../api';

interface StockModalProps {
  product: Product;
  onClose: () => void;
  onRefetch: () => void;
}

export default function StockModal({ product, onClose, onRefetch }: StockModalProps) {
  const [type, setType] = useState<'add' | 'subtract'>('add');
  const [inventoryType, setInventoryType] = useState<'book' | 'bundle'>('book');
  const [quantity, setQuantity] = useState(1);
  const [source, setSource] = useState('Manual');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentValue = inventoryType === 'book' ? product.book_inventory : product.bundles_inventory;
  const newValue = type === 'add' ? currentValue + quantity : Math.max(0, currentValue - quantity);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (quantity <= 0) { setError('Quantity must be greater than 0.'); return; }
    setSaving(true);
    setError(null);
    try {
      await adjustStock(product.id, type, inventoryType, quantity, source, notes, currentValue);
      onRefetch();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to adjust stock.');
    }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-content-secondary">
        Adjusting stock for <span className="font-semibold">{product.name}</span>
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setType('add')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-control text-sm font-medium border-2 transition-colors ${
            type === 'add' ? 'border-green-500 bg-green-50 text-green-700' : 'border-edge text-content-secondary'
          }`}
        >
          <Plus className="w-4 h-4" /> Add
        </button>
        <button
          type="button"
          onClick={() => setType('subtract')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-control text-sm font-medium border-2 transition-colors ${
            type === 'subtract' ? 'border-red-500 bg-red-50 text-red-700' : 'border-edge text-content-secondary'
          }`}
        >
          <Minus className="w-4 h-4" /> Subtract
        </button>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setInventoryType('book')}
          className={`flex-1 px-3 py-2 rounded-control text-sm font-medium border-2 transition-colors ${
            inventoryType === 'book' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-edge text-content-secondary'
          }`}
        >
          Book
        </button>
        <button
          type="button"
          onClick={() => setInventoryType('bundle')}
          className={`flex-1 px-3 py-2 rounded-control text-sm font-medium border-2 transition-colors ${
            inventoryType === 'bundle' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-edge text-content-secondary'
          }`}
        >
          Bundle
        </button>
      </div>

      <div>
        <label className="block text-xs text-content-secondary mb-1">Quantity</label>
        <input
          type="number"
          min="1"
          value={quantity}
          onChange={e => setQuantity(Number(e.target.value))}
          className="w-full px-3 py-2 border border-edge rounded-control text-sm focus:outline-none focus:border-brand-400"
        />
      </div>

      <div className="bg-surface-hover rounded-control p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-content-secondary">Current</span>
          <span className="font-medium">{currentValue}</span>
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-content-secondary">After</span>
          <span className={`font-semibold ${type === 'add' ? 'text-green-600' : 'text-red-600'}`}>{newValue}</span>
        </div>
      </div>

      <div>
        <label className="block text-xs text-content-secondary mb-1">Source</label>
        <input
          type="text"
          value={source}
          onChange={e => setSource(e.target.value)}
          className="w-full px-3 py-2 border border-edge rounded-control text-sm focus:outline-none focus:border-brand-400"
        />
      </div>

      <div>
        <label className="block text-xs text-content-secondary mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 border border-edge rounded-control text-sm focus:outline-none focus:border-brand-400 resize-none"
        />
      </div>

      {error && <p className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded-control">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-content-secondary hover:bg-surface-sunken rounded-control">Cancel</button>
        <button
          type="submit"
          disabled={saving}
          className={`px-4 py-2 text-sm text-white rounded-control disabled:opacity-50 ${
            type === 'add' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
          }`}
        >
          {saving ? 'Saving...' : type === 'add' ? 'Add Stock' : 'Subtract Stock'}
        </button>
      </div>
    </form>
  );
}
