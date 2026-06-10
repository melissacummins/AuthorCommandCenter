import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Package, Truck, CheckCircle, Clock, Trash2, Loader2, AlertCircle, X, FileText
} from 'lucide-react';
import { getPurchaseOrders, createPurchaseOrder, confirmArrival, deletePurchaseOrder, getVendors, addVendor } from '../api/purchaseOrders';
import type { CreatePOInput, POLineItem, ConfirmArrivalInput } from '../api/purchaseOrders';
import type { PurchaseOrder, Product, Vendor } from '../../../lib/types';
import Modal from '../../../components/Modal';

interface Props {
  products: Product[];
  onInventoryChanged: () => void;
}

export default function PurchaseOrders({ products, onInventoryChanged }: Props) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmingPO, setConfirmingPO] = useState<PurchaseOrder | null>(null);

  const fetchOrders = useCallback(async () => {
    const data = await getPurchaseOrders();
    setOrders(data);
    setLoading(false);
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Group orders by invoice (po_number)
  const grouped = groupOrders(orders);
  const pendingGroups = grouped.filter(g => g.items.some(i => i.status === 'pending'));
  const arrivedGroups = grouped.filter(g => g.items.every(i => i.status === 'arrived'));

  async function handleDelete(id: string) {
    if (!confirm('Delete this purchase order line?')) return;
    await deletePurchaseOrder(id);
    fetchOrders();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">
            {pendingGroups.length} pending order{pendingGroups.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" /> New Purchase Order
        </button>
      </div>

      {/* Pending Orders */}
      {pendingGroups.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">Pending</h3>
          {pendingGroups.map(group => (
            <POCard
              key={group.key}
              group={group}
              products={products}
              onConfirm={setConfirmingPO}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Arrived Orders */}
      {arrivedGroups.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">Arrived</h3>
          {arrivedGroups.map(group => (
            <POCard
              key={group.key}
              group={group}
              products={products}
              onConfirm={setConfirmingPO}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {orders.length === 0 && (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
          <Truck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-slate-700 mb-1">No purchase orders</h3>
          <p className="text-sm text-slate-400 mb-4">Create a purchase order to track incoming stock.</p>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> New Purchase Order
          </button>
        </div>
      )}

      {/* Add PO Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="New Purchase Order" maxWidth="max-w-2xl">
        <AddPOForm
          products={products}
          onClose={() => setShowAdd(false)}
          onCreated={() => { fetchOrders(); setShowAdd(false); }}
        />
      </Modal>

      {/* Confirm Arrival Modal */}
      <Modal
        open={!!confirmingPO}
        onClose={() => setConfirmingPO(null)}
        title="Confirm Arrival"
        maxWidth="max-w-xl"
      >
        {confirmingPO && (
          <ConfirmArrivalForm
            po={confirmingPO}
            products={products}
            onClose={() => setConfirmingPO(null)}
            onConfirmed={() => {
              fetchOrders();
              onInventoryChanged();
              setConfirmingPO(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

// ---- PO Card ----

interface POGroup {
  key: string;
  invoiceNumber: string;
  vendor: string;
  orderDate: string;
  expectedDispatch: string;
  expectedArrival: string;
  items: PurchaseOrder[];
}

function groupOrders(orders: PurchaseOrder[]): POGroup[] {
  const map = new Map<string, PurchaseOrder[]>();
  for (const o of orders) {
    const key = `${o.vendor || 'no-vendor'}|${o.po_number || o.id}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(o);
  }

  return Array.from(map.entries()).map(([key, items]) => ({
    key,
    invoiceNumber: items[0].po_number || '(no invoice #)',
    vendor: items[0].vendor || '',
    orderDate: items[0].order_date,
    expectedDispatch: items[0].expected_dispatch,
    expectedArrival: items[0].expected_arrival,
    items,
  }));
}

function POCard({ group, products, onConfirm, onDelete }: {
  group: POGroup;
  products: Product[];
  onConfirm: (po: PurchaseOrder) => void;
  onDelete: (id: string) => void;
}) {
  const allArrived = group.items.every(i => i.status === 'arrived');
  const totalOrdered = group.items.reduce((s, i) => s + i.quantity, 0);
  const totalReceived = group.items.reduce((s, i) => s + (i.actual_quantity || 0), 0);

  return (
    <div className={`bg-white rounded-xl border ${allArrived ? 'border-emerald-200' : 'border-slate-200'} overflow-hidden`}>
      {/* Header */}
      <div className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3 ${allArrived ? 'bg-emerald-50' : 'bg-slate-50'} border-b border-slate-100`}>
        <div className="flex items-center gap-3">
          {allArrived ? (
            <CheckCircle className="w-5 h-5 text-emerald-500" />
          ) : (
            <Clock className="w-5 h-5 text-amber-500" />
          )}
          <div>
            <div className="flex items-center gap-2">
              {group.vendor && (
                <span className="font-semibold text-slate-800 text-sm">{group.vendor}</span>
              )}
              <span className="text-xs text-slate-500">Invoice #{group.invoiceNumber}</span>
            </div>
            <span className="text-xs text-slate-400">
              {totalOrdered} ordered{allArrived && `, ${totalReceived} received`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>Ordered: {group.orderDate}</span>
          {group.expectedDispatch && <span>Dispatch: {group.expectedDispatch}</span>}
          {group.expectedArrival && <span>Arrival: {group.expectedArrival}</span>}
        </div>
      </div>

      {/* Line items */}
      <div className="divide-y divide-slate-100">
        {group.items.map(item => {
          const sdProduct = item.scratch_dent_product_id ? products.find(p => p.id === item.scratch_dent_product_id) : null;
          return (
            <div key={item.id} className="px-5 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Package className="w-4 h-4 text-slate-400" />
                  <p className="text-sm font-medium text-slate-800">{item.product_name}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-800">
                      {item.status === 'arrived' ? (
                        <>{item.actual_quantity} <span className="text-xs font-normal text-slate-400">of {item.quantity} ordered</span></>
                      ) : (
                        <>{item.quantity} <span className="text-xs font-normal text-slate-400">ordered</span></>
                      )}
                    </p>
                  </div>
                  {item.status === 'pending' ? (
                    <button
                      onClick={() => onConfirm(item)}
                      className="px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                    >
                      Confirm Arrival
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-lg">
                      Received
                    </span>
                  )}
                  <button onClick={() => onDelete(item.id)} className="p-1 text-slate-300 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {/* Additional info: scratch & dent split + notes */}
              {item.status === 'arrived' && (item.scratch_dent_quantity > 0 || item.notes) && (
                <div className="mt-2 ml-7 text-xs text-slate-500 space-y-0.5">
                  {item.scratch_dent_quantity > 0 && sdProduct && (
                    <p>
                      <span className="font-medium text-amber-700">{item.scratch_dent_quantity} scratch & dent</span>
                      <span className="text-slate-400"> &rarr; added to </span>
                      <span className="text-slate-600">{sdProduct.name}</span>
                    </p>
                  )}
                  {item.notes && (
                    <p className="flex items-start gap-1.5">
                      <FileText className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                      <span>{item.notes}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Add PO Form ----

function AddPOForm({ products, onClose, onCreated }: {
  products: Product[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [vendor, setVendor] = useState('');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [showNewVendor, setShowNewVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [expectedDispatch, setExpectedDispatch] = useState('');
  const [expectedArrival, setExpectedArrival] = useState('');
  const [items, setItems] = useState<POLineItem[]>([{ product_id: '', product_name: '', quantity: 1 }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getVendors().then(setVendors);
  }, []);

  async function handleAddVendor() {
    if (!newVendorName.trim()) return;
    const v = await addVendor(newVendorName);
    setVendors([...vendors, v].sort((a, b) => a.name.localeCompare(b.name)));
    setVendor(v.name);
    setNewVendorName('');
    setShowNewVendor(false);
  }

  function addLine() {
    setItems([...items, { product_id: '', product_name: '', quantity: 1 }]);
  }

  function removeLine(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, field: keyof POLineItem, value: string | number) {
    setItems(items.map((item, i) => {
      if (i !== idx) return item;
      if (field === 'product_id') {
        const product = products.find(p => p.id === value);
        return { ...item, product_id: value as string, product_name: product?.name || '' };
      }
      return { ...item, [field]: value };
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter(i => i.product_id && i.quantity > 0);
    if (validItems.length === 0) { setError('Add at least one product.'); return; }
    if (!orderDate) { setError('Order date is required.'); return; }

    setSaving(true);
    setError('');
    try {
      const input: CreatePOInput = {
        invoice_number: invoiceNumber.trim(),
        vendor: vendor.trim(),
        order_date: orderDate,
        expected_dispatch: expectedDispatch,
        expected_arrival: expectedArrival,
        items: validItems,
      };
      await createPurchaseOrder(input);
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create purchase order');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Vendor & Invoice */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Vendor *</label>
          {showNewVendor ? (
            <div className="flex gap-2">
              <input type="text" value={newVendorName} onChange={e => setNewVendorName(e.target.value)}
                placeholder="Vendor name"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddVendor(); } }}
                autoFocus
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400" />
              <button type="button" onClick={handleAddVendor} className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Add</button>
              <button type="button" onClick={() => setShowNewVendor(false)} className="px-2 py-2 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <select value={vendor} onChange={e => setVendor(e.target.value)}
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400">
                <option value="">Select vendor...</option>
                {vendors.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
              </select>
              <button type="button" onClick={() => setShowNewVendor(true)}
                className="px-2 py-2 text-blue-600 hover:bg-blue-50 rounded-lg" title="Add new vendor">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Invoice #</label>
          <input type="text" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
            placeholder="From vendor"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400" />
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Order Date *</label>
          <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Expected Dispatch</label>
          <input type="date" value={expectedDispatch} onChange={e => setExpectedDispatch(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Expected Arrival</label>
          <input type="date" value={expectedArrival} onChange={e => setExpectedArrival(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400" />
        </div>
      </div>

      {/* Line Items */}
      <div className="border-t border-slate-200 pt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-slate-700">Products</p>
          <button type="button" onClick={addLine} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
            <Plus className="w-3 h-3" /> Add Product
          </button>
        </div>
        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-end gap-3">
              <div className="flex-1">
                {idx === 0 && <label className="block text-xs text-slate-400 mb-1">Product</label>}
                <select
                  value={item.product_id}
                  onChange={e => updateLine(idx, 'product_id', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
                >
                  <option value="">Select product...</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                </select>
              </div>
              <div className="w-24">
                {idx === 0 && <label className="block text-xs text-slate-400 mb-1">Qty</label>}
                <input type="number" min={1} value={item.quantity}
                  onChange={e => updateLine(idx, 'quantity', Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400" />
              </div>
              {items.length > 1 && (
                <button type="button" onClick={() => removeLine(idx)} className="p-2 text-slate-300 hover:text-red-500 mb-0.5">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2 border-t border-slate-200">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Creating...' : 'Create Purchase Order'}
        </button>
      </div>
    </form>
  );
}

// ---- Confirm Arrival Form ----

function ConfirmArrivalForm({ po, products, onClose, onConfirmed }: {
  po: PurchaseOrder;
  products: Product[];
  onClose: () => void;
  onConfirmed: () => void;
}) {
  // Find the main product to get its default scratch & dent product
  const mainProduct = products.find(p => p.id === po.product_id);
  const defaultSdProductId = mainProduct?.default_scratch_dent_product_id || '';

  const [goodQty, setGoodQty] = useState(po.quantity);
  const [addToInv, setAddToInv] = useState(po.quantity);
  const [sdQty, setSdQty] = useState(0);
  // Once she manually edits scratch & dent, stop auto-filling it from goodQty
  // (covers the case where she received fewer than ordered).
  const [sdTouched, setSdTouched] = useState(false);
  const [sdProductId, setSdProductId] = useState<string>(defaultSdProductId);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handleGoodQtyChange(next: number) {
    if (addToInv === goodQty) setAddToInv(next);
    setGoodQty(next);
    if (!sdTouched) setSdQty(Math.max(0, po.quantity - next));
  }

  function handleSdChange(next: number) {
    setSdQty(next);
    setSdTouched(true);
  }

  async function handleConfirm() {
    if (sdQty > 0 && !sdProductId) {
      setError('Please select a product for the scratch & dent items.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const input: ConfirmArrivalInput = {
        good_quantity: goodQty,
        add_to_inventory: addToInv,
        scratch_dent_quantity: sdQty,
        scratch_dent_product_id: sdQty > 0 ? sdProductId : null,
        save_scratch_dent_as_default: saveAsDefault,
        notes,
      };
      await confirmArrival(po.id, input);
      onConfirmed();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to confirm arrival');
      setSaving(false);
    }
  }

  const total = goodQty + sdQty;
  const diff = total - po.quantity;
  const sdProduct = sdProductId ? products.find(p => p.id === sdProductId) : null;

  // Filter products for scratch & dent picker (exclude the main product)
  const sdOptions = products.filter(p => p.id !== po.product_id);
  const hasDefault = !!defaultSdProductId;

  return (
    <div className="space-y-4">
      <div className="p-4 bg-slate-50 rounded-lg">
        <p className="text-sm font-medium text-slate-800">{po.product_name}</p>
        <p className="text-xs text-slate-500 mt-1">Ordered: {po.quantity} units</p>
      </div>

      {/* Quantity Split */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Good Qty Received</label>
          <input type="number" min={0} value={goodQty}
            onChange={e => handleGoodQtyChange(Number(e.target.value))}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Scratch & Dent</label>
          <input type="number" min={0} value={sdQty}
            onChange={e => handleSdChange(Number(e.target.value))}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Add to Inventory</label>
          <input type="number" min={0} value={addToInv}
            onChange={e => setAddToInv(Number(e.target.value))}
            className="w-full px-3 py-2 border border-indigo-300 bg-indigo-50/50 rounded-lg text-sm focus:outline-none focus:border-indigo-500" />
          <p className="text-xs text-slate-400 mt-1">
            Set to 0 for component-only orders (e.g., stickers arriving before buttons)
          </p>
        </div>
      </div>

      {/* Total summary */}
      <div className="text-xs text-slate-500">
        Total received: <strong className="text-slate-700">{total}</strong>
        {diff !== 0 && (
          <span className={diff < 0 ? 'text-amber-600 ml-2' : 'text-emerald-600 ml-2'}>
            ({diff < 0 ? `${Math.abs(diff)} fewer than ordered` : `${diff} more than ordered`})
          </span>
        )}
        {addToInv < goodQty && addToInv >= 0 && (
          <span className="text-indigo-600 ml-2">
            ({goodQty - addToInv} received but not added to inventory)
          </span>
        )}
      </div>

      {/* Scratch & Dent product picker */}
      {sdQty > 0 && (
        <div className="border-t border-slate-200 pt-4 space-y-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Scratch & Dent Product {hasDefault && <span className="text-slate-400">(default saved)</span>}
            </label>
            <select
              value={sdProductId}
              onChange={e => setSdProductId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400"
            >
              <option value="">Select the S&D product...</option>
              {sdOptions.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              {sdProduct ? `${sdQty} units will be added to "${sdProduct.name}"` : 'Pick the product that represents the damaged/scratch & dent version'}
            </p>
          </div>

          {sdProductId && sdProductId !== defaultSdProductId && (
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" checked={saveAsDefault}
                onChange={e => setSaveAsDefault(e.target.checked)}
                className="rounded" />
              Save as default scratch & dent product for <strong>{po.product_name}</strong>
            </label>
          )}
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="block text-xs text-slate-500 mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g., Vendor shipped 54 of item 1 but only 49 of item 3"
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 resize-none"
        />
        <p className="text-xs text-slate-400 mt-1">
          Notes will appear on the product's detail view so you can reference them later.
        </p>
      </div>

      {/* Summary */}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 space-y-1">
        {addToInv > 0 ? (
          <p>&bull; <strong>{addToInv}</strong> units will be added to <strong>{po.product_name}</strong> inventory</p>
        ) : (
          <p>&bull; <strong>{po.product_name}</strong> inventory will <strong>not change</strong> (component-only tracking)</p>
        )}
        {goodQty > addToInv && addToInv >= 0 && (
          <p className="text-indigo-600">&bull; {goodQty - addToInv} units received but held (waiting for other components)</p>
        )}
        {sdQty > 0 && sdProduct && (
          <p>&bull; <strong>{sdQty}</strong> scratch & dent units will be added to <strong>{sdProduct.name}</strong></p>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
        <button onClick={handleConfirm} disabled={saving || total === 0}
          className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
          {saving ? 'Confirming...' : 'Confirm & Add to Inventory'}
        </button>
      </div>
    </div>
  );
}
