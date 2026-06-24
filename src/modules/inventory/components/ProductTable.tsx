import { useState, useEffect, createContext, useContext } from 'react';
import { Search, ChevronDown, ChevronUp, ChevronRight, Edit2, Check, X, Plus, Trash2, FileText, Copy } from 'lucide-react';
import type { Product, PurchaseOrder } from '../../../lib/types';
import { calculateProductMetrics, formatCurrency, formatPercent, marginColor, CATEGORIES, STATUSES } from '../utils';
import { updateProduct, deleteProduct } from '../api';
import { getNotesForProduct, getDefectStatsForProduct } from '../api/purchaseOrders';
import type { DefectStats } from '../api/purchaseOrders';
import BookSpecsPanel from './BookSpecsPanel';
import PrinterQuotesPanel from './PrinterQuotesPanel';

interface ProductTableProps {
  products: Product[];
  onRefetch: () => void;
  onAdjustStock: (product: Product) => void;
  onDuplicate?: (product: Product) => void;
  pendingStock?: Map<string, number>;
}

const BULK_FIELDS: Array<{ value: string; label: string }> = [
  { value: 'qa_cost', label: 'QA Cost' },
  { value: 'defect_rate', label: 'Defect Rate (%)' },
  { value: 'pa_costs', label: 'PA Costs' },
  { value: 'production_cost', label: 'Production Cost' },
  { value: 'shipping_cost', label: 'Shipping Cost' },
  { value: 'shipping_supplies_cost', label: 'Shipping Supplies' },
  { value: 'handling_fee_add_on', label: 'Handling Fee' },
  { value: 'base_price', label: 'Base Price' },
  { value: 'tt_shop_price', label: 'TikTok Price' },
  { value: 'free_shipping', label: 'TikTok Free Shipping' },
  { value: 'lead_time', label: 'Lead Time (days)' },
];

type SortKey = 'name' | 'category' | 'base_price' | 'netMarginPercent' | 'book_inventory' | 'status';

// EditableCell lives at module scope (not nested inside ProductTable) so that
// React doesn't see it as a new component type on every keystroke. Without
// this, the input was unmounted/remounted each render, autoFocus fired again,
// and the cursor snapped back to the end of the field.
type EditCtx = {
  editingField: { id: string; field: string } | null;
  editValue: string;
  setEditValue: (v: string) => void;
  startEdit: (id: string, field: string, currentValue: string | number) => void;
  saveEdit: (id: string, field: string) => void;
  cancelEdit: () => void;
};
const EditContext = createContext<EditCtx | null>(null);

function EditableCell({ id, field, value, format, suffix }: { id: string; field: string; value: string | number; format?: (v: number) => string; suffix?: string }) {
  const ctx = useContext(EditContext);
  if (!ctx) return null;
  const isEditing = ctx.editingField?.id === id && ctx.editingField?.field === field;
  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <input type="text" value={ctx.editValue} onChange={e => ctx.setEditValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') ctx.saveEdit(id, field); if (e.key === 'Escape') ctx.cancelEdit(); }}
          className="w-20 px-1 py-0.5 border border-blue-400 rounded text-sm focus:outline-none" autoFocus />
        <button onClick={() => ctx.saveEdit(id, field)} className="text-green-600"><Check className="w-3 h-3" /></button>
        <button onClick={ctx.cancelEdit} className="text-slate-400"><X className="w-3 h-3" /></button>
      </div>
    );
  }
  const display = format ? format(Number(value)) : `${value}${suffix || ''}`;
  return (
    <span className="cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded group inline-flex items-center gap-1" onClick={() => ctx.startEdit(id, field, value)} title="Click to edit">
      {display}<Edit2 className="w-3 h-3 text-slate-300 group-hover:text-blue-400 opacity-0 group-hover:opacity-100" />
    </span>
  );
}

export default function ProductTable({ products, onRefetch, onAdjustStock, onDuplicate, pendingStock }: ProductTableProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<string>(BULK_FIELDS[0].value);
  const [bulkValue, setBulkValue] = useState<string>('');
  const [bulkSaving, setBulkSaving] = useState(false);

  const enriched = products.map(p => ({ ...p, metrics: calculateProductMetrics(p, products) }));

  let filtered = enriched.filter(p => {
    const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || p.category === categoryFilter;
    const matchesStatus = !statusFilter || p.metrics.status === statusFilter;
    return matchesSearch && matchesCategory && matchesStatus;
  });

  filtered.sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'name': cmp = a.name.localeCompare(b.name); break;
      case 'category': cmp = a.category.localeCompare(b.category); break;
      case 'base_price': cmp = a.base_price - b.base_price; break;
      case 'netMarginPercent': cmp = a.metrics.netMarginPercent - b.metrics.netMarginPercent; break;
      case 'book_inventory': {
        const aInv = (a.category === 'Bundle' || a.category === 'Book Box') ? a.metrics.bundlesInventory : a.metrics.bookInventory;
        const bInv = (b.category === 'Bundle' || b.category === 'Book Box') ? b.metrics.bundlesInventory : b.metrics.bookInventory;
        cmp = aInv - bInv;
        break;
      }
      case 'status': cmp = a.metrics.status.localeCompare(b.metrics.status); break;
    }
    return sortAsc ? cmp : -cmp;
  });

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  }

  function startEdit(id: string, field: string, currentValue: string | number) {
    setEditingField({ id, field });
    setEditValue(String(currentValue));
  }

  async function saveEdit(id: string, field: string) {
    try {
      const numericFields = ['base_price', 'production_cost', 'shipping_cost', 'shipping_supplies_cost',
        'pa_costs', 'qa_cost', 'defect_rate', 'handling_fee_add_on', 'tt_shop_price', 'free_shipping', 'lead_time',
        'book_stock', 'books_purchased', 'bundles_purchased', 'purchased_via_bundles',
        'six_month_book_sales', 'six_month_bundle_sales', 'csv_avg_daily', 'csv_reorder_threshold'];
      const value = numericFields.includes(field) ? Number(editValue) : editValue;
      await updateProduct(id, { [field]: value });

      // When editing 6mo bundle sales on a bundle, propagate to all component books
      if (field === 'six_month_bundle_sales') {
        const bundle = products.find(p => p.id === id);
        if (bundle && (bundle.category === 'Bundle' || bundle.category === 'Book Box')) {
          const bundleName = bundle.name;

          // Find all books that list this bundle in their `bundles` field
          const componentBooks = products.filter(p => {
            if (p.category === 'Bundle' || p.category === 'Book Box') return false;
            if (!p.bundles) return false;
            return p.bundles.split(',').some(b => b.trim() === bundleName);
          });

          // Also check books_in_bundle as a fallback
          if (componentBooks.length === 0 && bundle.books_in_bundle) {
            const names = bundle.books_in_bundle.split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
            for (const name of names) {
              const book = products.find(p =>
                p.category !== 'Bundle' && p.category !== 'Book Box' &&
                (p.name.toLowerCase() === name || p.name.toLowerCase().startsWith(name) || name.startsWith(p.name.toLowerCase()))
              );
              if (book) componentBooks.push(book);
            }
          }

          // Calculate total bundle sales for each book across ALL bundles it belongs to
          for (const book of componentBooks) {
            const bookBundleNames = book.bundles ? book.bundles.split(',').map(b => b.trim()).filter(Boolean) : [];
            let totalBundleSales = 0;
            for (const bn of bookBundleNames) {
              const b = products.find(p => p.name === bn);
              if (b) {
                // Use the new value for the bundle being edited, existing value for others
                totalBundleSales += (b.id === id) ? Number(value) : b.six_month_bundle_sales;
              }
            }
            await updateProduct(book.id, { six_month_bundle_sales: totalBundleSales });
          }
        }
      }

      setEditingField(null);
      onRefetch();
    } catch (err) {
      console.error('Failed to save:', err);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try { await deleteProduct(id); onRefetch(); } catch (err) { console.error(err); }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllFiltered(filteredIds: string[]) {
    const allSelected = filteredIds.length > 0 && filteredIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) filteredIds.forEach(id => next.delete(id));
      else filteredIds.forEach(id => next.add(id));
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setBulkValue('');
  }

  async function applyBulkEdit() {
    if (selectedIds.size === 0) return;
    if (bulkValue.trim() === '') return;
    const numValue = Number(bulkValue);
    if (Number.isNaN(numValue)) {
      alert(`"${bulkValue}" is not a number.`);
      return;
    }
    const fieldLabel = BULK_FIELDS.find(f => f.value === bulkField)?.label ?? bulkField;
    if (!confirm(`Set ${fieldLabel} to ${numValue} on ${selectedIds.size} product${selectedIds.size === 1 ? '' : 's'}?`)) return;
    setBulkSaving(true);
    try {
      const ids: string[] = Array.from(selectedIds);
      await Promise.all(ids.map(id => updateProduct(id, { [bulkField]: numValue })));
      clearSelection();
      onRefetch();
    } catch (err) {
      console.error('Bulk edit failed:', err);
      alert('Bulk edit failed. See console for details.');
    }
    setBulkSaving(false);
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return null;
    return sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  }

  const editCtx: EditCtx = {
    editingField,
    editValue,
    setEditValue,
    startEdit,
    saveEdit,
    cancelEdit: () => setEditingField(null),
  };

  function ReadOnlyCell({ value, format, className }: { value: number | string; format?: (v: number) => string; className?: string }) {
    const display = format ? format(Number(value)) : value;
    return <span className={className}>{display}</span>;
  }

  // Toggle a book's membership in a bundle (from the bundle's perspective)
  async function toggleBookInBundle(bundle: typeof enriched[0], bookName: string, isCurrentlyIn: boolean) {
    try {
      // Update the bundle's books_in_bundle field
      const currentBooks = bundle.books_in_bundle
        ? bundle.books_in_bundle.split(',').map(b => b.trim()).filter(Boolean)
        : [];
      const newBooks = isCurrentlyIn
        ? currentBooks.filter(b => b !== bookName)
        : [...currentBooks, bookName];
      await updateProduct(bundle.id, { books_in_bundle: newBooks.join(', ') });

      // Update the book's bundles field
      const book = allBooks.find(b => b.name === bookName);
      if (book) {
        const currentBundles = book.bundles
          ? book.bundles.split(',').map(b => b.trim()).filter(Boolean)
          : [];
        const newBundles = isCurrentlyIn
          ? currentBundles.filter(b => b !== bundle.name)
          : [...currentBundles, bundle.name];
        await updateProduct(book.id, { bundles: newBundles.join(', ') });
      }

      onRefetch();
    } catch (err) {
      console.error('Failed to toggle book in bundle:', err);
    }
  }

  function StatusBadge({ status }: { status: string }) {
    const colors: Record<string, string> = {
      'Good': 'bg-green-50 text-green-700 border border-green-200',
      'REORDER NOW': 'bg-red-50 text-red-700 border border-red-200',
      'OUT OF STOCK': 'bg-red-100 text-red-800 border border-red-300',
      'BUNDLE': 'bg-blue-50 text-blue-700 border border-blue-200',
      'TRACKING ONLY': 'bg-slate-50 text-slate-600 border border-slate-200',
    };
    return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[status] || 'bg-slate-100'}`}>{status}</span>;
  }

  // All bundle/book box products for the "Part of Bundles" checkboxes
  const allBundles = products.filter(p => p.category === 'Bundle' || p.category === 'Book Box');
  // All non-bundle products for the "Books in Bundle" checkboxes
  const allBooks = products.filter(p => p.category !== 'Bundle' && p.category !== 'Book Box');

  // Get which bundles a product belongs to from its `bundles` field
  function getProductBundles(product: typeof enriched[0]): string[] {
    if (!product.bundles) return [];
    return product.bundles.split(',').map(b => b.trim()).filter(Boolean);
  }

  // Toggle a bundle membership for a product
  async function toggleBundle(product: typeof enriched[0], bundleName: string, isCurrentlyIn: boolean) {
    try {
      // Update the product's `bundles` field
      const currentBundles = getProductBundles(product);
      let newBundles: string[];
      if (isCurrentlyIn) {
        newBundles = currentBundles.filter(b => b !== bundleName);
      } else {
        newBundles = [...currentBundles, bundleName];
      }
      await updateProduct(product.id, { bundles: newBundles.join(', ') });

      // Update the bundle's `books_in_bundle` field
      const bundle = allBundles.find(b => b.name === bundleName);
      if (bundle) {
        const currentBooks = bundle.books_in_bundle
          ? bundle.books_in_bundle.split(',').map(b => b.trim()).filter(Boolean)
          : [];
        let newBooks: string[];
        if (isCurrentlyIn) {
          newBooks = currentBooks.filter(b => b !== product.name);
        } else {
          newBooks = [...currentBooks, product.name];
        }
        await updateProduct(bundle.id, { books_in_bundle: newBooks.join(', ') });
      }

      onRefetch();
    } catch (err) {
      console.error('Failed to toggle bundle:', err);
    }
  }

  return (
    <EditContext.Provider value={editCtx}>
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" placeholder="Search by name or SKU..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400" />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400">
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400">
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-slate-500">{filtered.length} product{filtered.length !== 1 ? 's' : ''}</p>
        {selectedIds.size === 0 && filtered.length > 0 && (
          <button
            onClick={() => toggleSelectAllFiltered(filtered.map(p => p.id))}
            className="text-xs text-slate-500 hover:text-slate-700 underline"
          >
            Select all {filtered.length} in current filter
          </button>
        )}
      </div>

      {/* Bulk Edit Panel — appears when rows are selected */}
      {selectedIds.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-blue-800">
            {selectedIds.size} selected
          </span>
          <span className="text-blue-300">|</span>
          <span className="text-sm text-blue-700">Set</span>
          <select
            value={bulkField}
            onChange={e => setBulkField(e.target.value)}
            className="px-2 py-1.5 border border-blue-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-400"
          >
            {BULK_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <span className="text-sm text-blue-700">to</span>
          <input
            type="number"
            step="0.01"
            value={bulkValue}
            onChange={e => setBulkValue(e.target.value)}
            placeholder="0.00"
            className="w-28 px-2 py-1.5 border border-blue-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-400"
          />
          <button
            onClick={applyBulkEdit}
            disabled={bulkSaving || bulkValue.trim() === ''}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {bulkSaving ? 'Applying…' : `Apply to ${selectedIds.size}`}
          </button>
          <button
            onClick={clearSelection}
            disabled={bulkSaving}
            className="px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-100 rounded-lg disabled:opacity-50"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="w-8 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every(p => selectedIds.has(p.id))}
                    onChange={() => toggleSelectAllFiltered(filtered.map(p => p.id))}
                    className="rounded cursor-pointer"
                    title="Select all in current filter"
                  />
                </th>
                <th className="w-8 px-3 py-3"></th>
                {([
                  ['name', 'Product', 'text-left'],
                  ['category', 'Category', 'text-left'],
                  ['base_price', 'Price', 'text-center'],
                  ['netMarginPercent', 'Margin', 'text-center'],
                  ['book_inventory', 'Inventory', 'text-center'],
                  ['status', 'Status', 'text-left'],
                ] as [SortKey, string, string][]).map(([key, label, align]) => (
                  <th key={key} className={`px-3 py-3 ${align} font-medium text-slate-600 cursor-pointer hover:text-slate-800 select-none`}
                    onClick={() => handleSort(key)}>
                    <span className="inline-flex items-center gap-1">{label}<SortIcon column={key} /></span>
                  </th>
                ))}
                <th className="px-3 py-3 text-left font-medium text-slate-600">Action</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(product => {
                const memberBundles = getProductBundles(product);
                return (
                <>
                  <tr key={product.id} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${selectedIds.has(product.id) ? 'bg-blue-50/40' : ''}`}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(product.id)}
                        onChange={() => toggleSelect(product.id)}
                        className="rounded cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <button onClick={() => setExpandedId(expandedId === product.id ? null : product.id)} className="text-slate-400 hover:text-slate-600">
                        <ChevronRight className={`w-4 h-4 transition-transform ${expandedId === product.id ? 'rotate-90' : ''}`} />
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-slate-800">{product.name}</p>
                      <p className="text-xs text-slate-400">{product.sku}</p>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{product.category}</td>
                    <td className="px-3 py-3 text-center">{formatCurrency(product.base_price)}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={marginColor(product.metrics.netMarginPercent)}>{formatPercent(product.metrics.netMarginPercent)}</span>
                    </td>
                    <td className="px-3 py-3 text-center font-medium">
                      {(product.category === 'Bundle' || product.category === 'Book Box')
                        ? product.metrics.bundlesInventory
                        : product.metrics.bookInventory}
                      {pendingStock?.get(product.id) ? (
                        <span className="text-xs font-normal text-amber-600 ml-1">(+{pendingStock.get(product.id)} incoming)</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3"><StatusBadge status={product.metrics.status} /></td>
                    <td className="px-3 py-3 text-xs text-slate-500">{product.metrics.action}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => onAdjustStock(product)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg" title="Adjust Stock">
                          <Plus className="w-4 h-4" />
                        </button>
                        {onDuplicate && (
                          <button onClick={() => onDuplicate(product)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg" title="Duplicate (copy pricing & costs)">
                            <Copy className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => handleDelete(product.id, product.name)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === product.id && (
                    <tr key={`${product.id}-detail`} className="bg-slate-50/50">
                      <td colSpan={10} className="px-6 py-5">
                        {/* Product Info — editable name, SKU, category */}
                        <div className="flex flex-wrap items-center gap-4 mb-4 pb-4 border-b border-slate-200">
                          <div className="flex-1 min-w-[200px]">
                            <p className="text-[11px] text-slate-400 uppercase mb-0.5">Product Name</p>
                            <EditableCell id={product.id} field="name" value={product.name} />
                          </div>
                          <div>
                            <p className="text-[11px] text-slate-400 uppercase mb-0.5">SKU</p>
                            <EditableCell id={product.id} field="sku" value={product.sku} />
                          </div>
                          <div>
                            <p className="text-[11px] text-slate-400 uppercase mb-0.5">Category</p>
                            {editingField?.id === product.id && editingField?.field === 'category' ? (
                              <div className="flex items-center gap-1">
                                <select value={editValue} onChange={e => setEditValue(e.target.value)}
                                  className="px-1 py-0.5 border border-blue-400 rounded text-sm focus:outline-none">
                                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <button onClick={() => saveEdit(product.id, 'category')} className="text-green-600"><Check className="w-3 h-3" /></button>
                                <button onClick={() => setEditingField(null)} className="text-slate-400"><X className="w-3 h-3" /></button>
                              </div>
                            ) : (
                              <span className="cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded group inline-flex items-center gap-1"
                                onClick={() => startEdit(product.id, 'category', product.category)} title="Click to edit">
                                {product.category}
                                <Edit2 className="w-3 h-3 text-slate-300 group-hover:text-blue-400 opacity-0 group-hover:opacity-100" />
                              </span>
                            )}
                          </div>
                          <div>
                            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                              <input type="checkbox" checked={product.do_not_reorder}
                                onChange={async (e) => { await updateProduct(product.id, { do_not_reorder: e.target.checked }); onRefetch(); }}
                                className="rounded" />
                              Tracking Only
                            </label>
                          </div>
                        </div>

                        {/* Bento Box Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* INVENTORY & SALES */}
                          <div className="bg-white rounded-xl border border-slate-200 p-4">
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                              {(product.category === 'Bundle' || product.category === 'Book Box') ? 'Bundle Inventory & Sales' : 'Inventory & Sales'}
                            </h4>
                            <div className="grid grid-cols-3 gap-4 text-sm">
                              {(product.category === 'Bundle' || product.category === 'Book Box') ? (
                                <>
                                  <div>
                                    <p className="text-[11px] text-slate-400 uppercase mb-0.5">Bundles Inventory</p>
                                    <span className="font-semibold">{product.metrics.bundlesInventory}</span>
                                  </div>
                                  <div>
                                    <p className="text-[11px] text-slate-400 uppercase mb-0.5">Bundles Purchased</p>
                                    <ReadOnlyCell value={product.bundles_purchased} />
                                  </div>
                                  <div>
                                    <p className="text-[11px] text-slate-400 uppercase mb-0.5">6Mo Bundle Sales</p>
                                    <EditableCell id={product.id} field="six_month_bundle_sales" value={product.six_month_bundle_sales} />
                                  </div>
                                  <div>
                                    <p className="text-[11px] text-slate-400 uppercase mb-0.5">Avg Daily Sales</p>
                                    <span>{product.metrics.avgDailySales.toFixed(4)}</span>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div>
                                    <p className="text-[11px] text-slate-400 uppercase mb-0.5">Book Stock</p>
                                    <EditableCell id={product.id} field="book_stock" value={product.book_stock} />
                                  </div>
                                  <div>
                                    <p className="text-[11px] text-slate-400 uppercase mb-0.5">Books Purchased</p>
                                    <ReadOnlyCell value={product.books_purchased} />
                                  </div>
                                  <div>
                                    <p className="text-[11px] text-slate-400 uppercase mb-0.5">Purchased via Bundles</p>
                                    <ReadOnlyCell value={product.purchased_via_bundles} />
                                  </div>
                                  <div>
                                    <p className="text-[11px] text-slate-400 uppercase mb-0.5">Book Inventory</p>
                                    <span className="font-semibold">{product.metrics.bookInventory}</span>
                                  </div>
                                  <div>
                                    <p className="text-[11px] text-slate-400 uppercase mb-0.5">6Mo Book Sales</p>
                                    <EditableCell id={product.id} field="six_month_book_sales" value={product.six_month_book_sales} />
                                  </div>
                                  <div>
                                    <p className="text-[11px] text-slate-400 uppercase mb-0.5">6Mo Bundle Sales</p>
                                    <ReadOnlyCell value={product.six_month_bundle_sales} />
                                  </div>
                                  <div>
                                    <p className="text-[11px] text-slate-400 uppercase mb-0.5">Avg Daily Sales</p>
                                    <span>{product.metrics.avgDailySales.toFixed(4)}</span>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          {/* PRICING & MARGINS */}
                          <div className="bg-white rounded-xl border border-slate-200 p-4">
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Pricing & Margins</h4>
                            <div className="grid grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="text-[11px] text-slate-400 uppercase mb-0.5">Base Price</p>
                                <EditableCell id={product.id} field="base_price" value={product.base_price} format={formatCurrency} />
                              </div>
                              <div>
                                <p className="text-[11px] text-slate-400 uppercase mb-0.5">Production Cost</p>
                                <EditableCell id={product.id} field="production_cost" value={product.production_cost} format={formatCurrency} />
                              </div>
                              <div>
                                <p className="text-[11px] text-slate-400 uppercase mb-0.5">Shipping Cost</p>
                                <EditableCell id={product.id} field="shipping_cost" value={product.shipping_cost} format={formatCurrency} />
                              </div>
                              <div>
                                <p className="text-[11px] text-slate-400 uppercase mb-0.5">Shipping Supplies</p>
                                <EditableCell id={product.id} field="shipping_supplies_cost" value={product.shipping_supplies_cost} format={formatCurrency} />
                              </div>
                              <div>
                                <p className="text-[11px] text-slate-400 uppercase mb-0.5">PA Costs</p>
                                <EditableCell id={product.id} field="pa_costs" value={product.pa_costs} format={formatCurrency} />
                              </div>
                              <div>
                                <p className="text-[11px] text-slate-400 uppercase mb-0.5" title="QA cost per unit — e.g., $15 PA session ÷ books in batch">QA Cost</p>
                                <EditableCell id={product.id} field="qa_cost" value={product.qa_cost} format={formatCurrency} />
                              </div>
                              <div>
                                <p className="text-[11px] text-slate-400 uppercase mb-0.5">Handling Fee</p>
                                <EditableCell id={product.id} field="handling_fee_add_on" value={product.handling_fee_add_on} format={formatCurrency} />
                              </div>
                              <div>
                                <p className="text-[11px] text-slate-400 uppercase mb-0.5">Transaction Fees</p>
                                <span>{formatCurrency(product.metrics.transactionFees)}</span>
                              </div>
                            </div>

                            {/* Cost Breakdown — grouped subtotals for printer comparison */}
                            <div className="mt-4 pt-4 border-t border-slate-200">
                              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Cost Breakdown</p>
                              <div className="space-y-1.5 text-sm">
                                <div className="flex justify-between items-baseline">
                                  <span className="text-slate-600" title="Production + Shipping + Shipping Supplies. Use this to compare printers.">
                                    Printer / Fulfillment
                                  </span>
                                  <span className="font-medium text-slate-800">{formatCurrency(product.metrics.printerCost)}</span>
                                </div>
                                <div className="flex justify-between items-baseline">
                                  <span className="text-slate-600" title="PA Costs + QA Cost — your assistant's total time per unit">
                                    PA Total (incl. QA)
                                  </span>
                                  <span className="font-medium text-slate-800">{formatCurrency(product.metrics.paTotal)}</span>
                                </div>
                                <div className="flex justify-between items-baseline">
                                  <span className="text-slate-600">Transaction Fees</span>
                                  <span className="font-medium text-slate-800">{formatCurrency(product.metrics.transactionFees)}</span>
                                </div>
                                <div className="flex justify-between items-baseline pt-1.5 border-t border-slate-100">
                                  <span className="text-slate-700 font-medium">Total Cost / Unit</span>
                                  <span className="font-semibold text-slate-900">{formatCurrency(product.metrics.totalCostPerUnit)}</span>
                                </div>
                                <div className="flex justify-between items-baseline">
                                  <span className="text-slate-600" title="Base Price + Handling Fee">Revenue / Unit</span>
                                  <span className="font-medium text-slate-800">{formatCurrency(product.metrics.revenuePerUnit)}</span>
                                </div>
                                <div className="flex justify-between items-baseline pt-1.5 border-t border-slate-100">
                                  <span className="text-slate-700 font-medium">Net Margin</span>
                                  <span className={`font-semibold ${marginColor(product.metrics.netMarginPercent)}`}>
                                    {formatCurrency(product.metrics.netMargin)} ({product.metrics.netMarginPercent.toFixed(1)}%)
                                  </span>
                                </div>

                                {/* Reprint adjustment — true cost when printer reprints damaged books for free
                                    but PA still QAs every reprint */}
                                <div className="flex justify-between items-baseline pt-3 mt-1 border-t border-slate-200">
                                  <span
                                    className="text-slate-600"
                                    title="% of books per order that arrive damaged and trigger a free reprint. PA still has to QA every reprint book."
                                  >
                                    Defect / Reprint Rate
                                  </span>
                                  <span className="inline-flex items-center">
                                    <EditableCell id={product.id} field="defect_rate" value={product.defect_rate || 0} suffix="%" />
                                  </span>
                                </div>
                                {(product.defect_rate || 0) > 0 && (
                                  <>
                                    <div className="flex justify-between items-baseline">
                                      <span className="text-slate-600" title="QA cost × defect rate — the QA you pay on free reprints">
                                        Extra QA on reprints
                                      </span>
                                      <span className="font-medium text-slate-800">{formatCurrency(product.metrics.reprintQaCost)}</span>
                                    </div>
                                    <div className="flex justify-between items-baseline pt-1.5 border-t border-slate-100">
                                      <span
                                        className="text-slate-700 font-medium"
                                        title="Total cost per unit + extra QA on reprints. This is the true cost to compare against quoted printer prices."
                                      >
                                        True Cost / Good Book
                                      </span>
                                      <span className="font-semibold text-slate-900">{formatCurrency(product.metrics.trueCostPerGoodBook)}</span>
                                    </div>
                                    <div className="flex justify-between items-baseline">
                                      <span className="text-slate-700 font-medium">True Net Margin</span>
                                      <span className={`font-semibold ${marginColor(product.metrics.trueNetMarginPercent)}`}>
                                        {formatCurrency(product.metrics.trueNetMargin)} ({product.metrics.trueNetMarginPercent.toFixed(1)}%)
                                      </span>
                                    </div>
                                  </>
                                )}
                                <DefectStatsHint productId={product.id} />
                              </div>
                            </div>
                          </div>

                          {/* REORDER METRICS */}
                          <div className="bg-white rounded-xl border border-slate-200 p-4">
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Reorder Metrics</h4>
                            {product.do_not_reorder ? (
                              <p className="text-sm text-slate-400 italic">N/A — Tracking Only</p>
                            ) : (
                              <div className="grid grid-cols-3 gap-4 text-sm">
                                <div>
                                  <p className="text-[11px] text-slate-400 uppercase mb-0.5">Lead Time (days)</p>
                                  <EditableCell id={product.id} field="lead_time" value={product.lead_time} />
                                </div>
                                <div>
                                  <p className="text-[11px] text-slate-400 uppercase mb-0.5">Reorder Threshold</p>
                                  <span>{product.metrics.reorderThreshold}</span>
                                </div>
                                <div>
                                  <p className="text-[11px] text-slate-400 uppercase mb-0.5">Days Remaining</p>
                                  <span className={product.metrics.daysRemaining !== Infinity && product.metrics.daysRemaining <= product.lead_time ? 'text-red-600 font-medium' : ''}>
                                    {product.metrics.daysRemaining === Infinity ? 'N/A' : product.metrics.daysRemaining}
                                  </span>
                                </div>
                                <div>
                                  <p className="text-[11px] text-slate-400 uppercase mb-0.5">Reorder Qty</p>
                                  <span>{product.metrics.reorderQty}</span>
                                </div>
                                <div>
                                  <p className="text-[11px] text-slate-400 uppercase mb-0.5">Reorder Cost</p>
                                  <span>{formatCurrency(product.metrics.reorderCost)}</span>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* TIKTOK SHOP */}
                          <div className="bg-white rounded-xl border border-slate-200 p-4">
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">TikTok Shop</h4>
                            <div className="grid grid-cols-3 gap-4 text-sm">
                              <div>
                                <p className="text-[11px] text-slate-400 uppercase mb-0.5">TikTok Price</p>
                                <EditableCell id={product.id} field="tt_shop_price" value={product.tt_shop_price} format={formatCurrency} />
                              </div>
                              <div>
                                <p className="text-[11px] text-slate-400 uppercase mb-0.5">TikTok Fees</p>
                                <span>{formatCurrency(product.metrics.ttFees)}</span>
                              </div>
                              <div>
                                <p className="text-[11px] text-slate-400 uppercase mb-0.5">Free Shipping</p>
                                <EditableCell id={product.id} field="free_shipping" value={product.free_shipping} format={formatCurrency} />
                              </div>
                              <div>
                                <p className="text-[11px] text-slate-400 uppercase mb-0.5">TikTok Margin ($)</p>
                                <span className={`font-medium ${marginColor(product.metrics.ttNetMarginPercent)}`}>{formatCurrency(product.metrics.ttNetMargin)}</span>
                              </div>
                              <div className="col-span-2">
                                <p className="text-[11px] text-slate-400 uppercase mb-0.5">TikTok Margin (%)</p>
                                <span className={`text-lg font-semibold ${marginColor(product.metrics.ttNetMarginPercent)}`}>{product.metrics.ttNetMarginPercent.toFixed(1)}%</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Books in Bundle — only for bundle/book box products */}
                        {(product.category === 'Bundle' || product.category === 'Book Box') && (
                          <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4">
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Books in Bundle</h4>
                            <div className="flex flex-wrap gap-2">
                              {allBooks.map(book => {
                                const booksInBundle = product.books_in_bundle
                                  ? product.books_in_bundle.split(',').map(b => b.trim()).filter(Boolean)
                                  : [];
                                const isIn = booksInBundle.includes(book.name);
                                return (
                                  <label
                                    key={book.id}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                                      isIn
                                        ? 'bg-blue-50 border border-blue-200 text-blue-700'
                                        : 'bg-slate-50 border border-slate-200 text-slate-500 hover:bg-slate-100'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isIn}
                                      onChange={() => toggleBookInBundle(product, book.name, isIn)}
                                      className="rounded text-blue-600 w-3 h-3"
                                    />
                                    {book.name}
                                  </label>
                                );
                              })}
                            </div>
                            <p className="text-xs text-slate-500 mt-3">
                              Bundle availability is auto-calculated from the minimum inventory of component books: <strong>{product.metrics.bundlesInventory} available</strong>
                            </p>
                          </div>
                        )}

                        {/* Part of Bundles — only show for non-bundle products */}
                        {product.category !== 'Bundle' && product.category !== 'Book Box' && allBundles.length > 0 && (
                          <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4">
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Part of Bundles</h4>
                            <div className="flex flex-wrap gap-2">
                              {allBundles.map(bundle => {
                                const isIn = memberBundles.includes(bundle.name);
                                return (
                                  <label
                                    key={bundle.id}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                                      isIn
                                        ? 'bg-green-50 border border-green-200 text-green-700'
                                        : 'bg-slate-50 border border-slate-200 text-slate-500 hover:bg-slate-100'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isIn}
                                      onChange={() => toggleBundle(product, bundle.name, isIn)}
                                      className="rounded text-green-600 w-3 h-3"
                                    />
                                    {bundle.name}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Book Specifications */}
                        <BookSpecsPanel productId={product.id} />

                        {/* Printer Quotes */}
                        <PrinterQuotesPanel product={product} />

                        {/* Recent PO Notes */}
                        <POProductNotes productId={product.id} />

                        {/* Delete Product */}
                        <div className="mt-4 flex justify-end">
                          <button
                            onClick={() => handleDelete(product.id, product.name)}
                            className="flex items-center gap-2 px-4 py-2 text-red-500 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors"
                          >
                            <Trash2 className="w-4 h-4" /> Delete Product
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )})}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-slate-400">
                    {products.length === 0 ? 'No products yet. Add your first product to get started.' : 'No products match your filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </EditContext.Provider>
  );
}

function POProductNotes({ productId }: { productId: string }) {
  const [notes, setNotes] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getNotesForProduct(productId).then(data => {
      if (active) {
        setNotes(data);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [productId]);

  if (loading || notes.length === 0) return null;

  return (
    <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4">
      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
        <FileText className="w-3 h-3" /> Purchase Order Notes
      </h4>
      <div className="space-y-2">
        {notes.map(po => (
          <div key={po.id} className="flex gap-3 text-sm">
            <div className="text-xs text-slate-400 shrink-0 w-24">
              {po.actual_arrival || po.order_date}
              {po.vendor && <p>{po.vendor}</p>}
            </div>
            <div className="flex-1">
              <p className="text-slate-700">{po.notes}</p>
              {po.po_number && (
                <p className="text-xs text-slate-400 mt-0.5">Invoice #{po.po_number}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DefectStatsHint({ productId }: { productId: string }) {
  const [stats, setStats] = useState<DefectStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDefectStatsForProduct(productId)
      .then(s => { if (!cancelled) setStats(s); })
      .catch(() => { /* silent — hint only */ });
    return () => { cancelled = true; };
  }, [productId]);

  if (!stats || stats.orderCount === 0 || stats.totalReceived === 0) return null;
  return (
    <p className="text-[11px] text-slate-400 pt-1.5 italic">
      Your POs: {stats.totalDamaged} of {stats.totalReceived} books damaged across {stats.orderCount} order{stats.orderCount === 1 ? '' : 's'} ({stats.defectRate.toFixed(1)}%)
    </p>
  );
}
