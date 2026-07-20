import { useState, useMemo } from 'react';
import { Search, Edit2, Check, X, Trash2, Upload, Loader2, AlertCircle, CheckSquare, Square } from 'lucide-react';
import { useTransactions, useCategoryRules } from '../hooks/useFinancials';
import { updateTransaction, deleteTransaction, importTransactions, bulkUpdateTransactions, bulkDeleteTransactions, getUniqueCategories, getUniqueMonths } from '../api';
import CategoryInput from './CategoryInput';
import type { SharedFilters } from '../FinStreamModule';
import type { Transaction } from '../../../lib/types';
import Papa from 'papaparse';

interface Props {
  filters: SharedFilters;
  onFiltersChange: (f: SharedFilters) => void;
}

export default function TransactionTable({ filters, onFiltersChange }: Props) {
  const { transactions, loading, refetch } = useTransactions();
  const { rules } = useCategoryRules();

  const { search, monthFilter, typeFilter, categoryFilter } = filters;
  const setSearch = (v: string) => onFiltersChange({ ...filters, search: v });
  const setMonthFilter = (v: string) => onFiltersChange({ ...filters, monthFilter: v });
  const setTypeFilter = (v: '' | 'income' | 'expense') => onFiltersChange({ ...filters, typeFilter: v });
  const setCategoryFilter = (v: string) => onFiltersChange({ ...filters, categoryFilter: v });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editField, setEditField] = useState<'category' | 'description'>('category');
  const [editCategory, setEditCategory] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'' | 'category' | 'description' | 'type'>('');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const categories = useMemo(() => getUniqueCategories(transactions), [transactions]);
  const months = useMemo(() => getUniqueMonths(transactions), [transactions]);

  const filtered = useMemo(() => {
    return transactions.filter(t => {
      if (monthFilter && !t.date.startsWith(monthFilter)) return false;
      if (typeFilter && t.type !== typeFilter) return false;
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (search) {
        const s = search.toLowerCase().trim();
        // Check if searching by amount (starts with $ or is a number)
        const amountSearch = s.replace(/^\$/, '');
        if (/^\d+\.?\d*$/.test(amountSearch)) {
          const searchNum = parseFloat(amountSearch);
          if (Math.abs(Number(t.amount)).toFixed(2).includes(amountSearch) || Math.abs(Number(t.amount)) === searchNum) {
            return true;
          }
        }
        return t.description.toLowerCase().includes(s) || t.original_description.toLowerCase().includes(s) || t.category.toLowerCase().includes(s);
      }
      return true;
    });
  }, [transactions, search, monthFilter, typeFilter, categoryFilter]);

  const totalIncome = filtered.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const totalExpenses = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

  const allFilteredSelected = filtered.length > 0 && filtered.every(t => selected.has(t.id));

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(t => t.id)));
    }
  }

  async function handleBulkApply() {
    if (selected.size === 0) return;
    setBulkProcessing(true);
    try {
      const ids = Array.from(selected);
      if (bulkAction === 'category' && bulkValue) {
        await bulkUpdateTransactions(ids, { category: bulkValue });
      } else if (bulkAction === 'description' && bulkValue) {
        await bulkUpdateTransactions(ids, { description: bulkValue });
      } else if (bulkAction === 'type' && (bulkValue === 'income' || bulkValue === 'expense')) {
        await bulkUpdateTransactions(ids, { type: bulkValue });
      }
      setSelected(new Set());
      setBulkAction('');
      setBulkValue('');
      refetch();
    } finally {
      setBulkProcessing(false);
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} transaction${selected.size !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    setBulkProcessing(true);
    try {
      await bulkDeleteTransactions(Array.from(selected));
      setSelected(new Set());
      refetch();
    } finally {
      setBulkProcessing(false);
    }
  }

  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportMsg('');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        try {
          const rows = result.data as Record<string, string>[];
          if (rows.length === 0) {
            setImportMsg('No data found in CSV file');
            setImporting(false);
            return;
          }

          const headers = Object.keys(rows[0]);
          const findCol = (...names: string[]) => headers.find(h => names.some(n => h.toLowerCase().includes(n.toLowerCase())));

          const dateCol = findCol('Date', 'Transaction Date', 'Posted Date', 'Posting Date');
          const descCol = findCol('Description', 'Memo', 'Transaction Description', 'Payee');
          const amountCol = findCol('Amount');
          const debitCol = findCol('Debit');
          const creditCol = findCol('Credit');

          if (!dateCol) {
            setImportMsg(`Could not find a date column. Found columns: ${headers.join(', ')}`);
            setImporting(false);
            return;
          }

          const txs = rows.map(row => {
            let amount: number;
            if (amountCol) {
              amount = parseFloat((row[amountCol] || '0').replace(/[$,]/g, ''));
            } else if (debitCol || creditCol) {
              const debit = parseFloat((row[debitCol || ''] || '0').replace(/[$,]/g, '')) || 0;
              const credit = parseFloat((row[creditCol || ''] || '0').replace(/[$,]/g, '')) || 0;
              amount = credit > 0 ? credit : -Math.abs(debit);
            } else {
              amount = 0;
            }

            const date = normalizeDate(row[dateCol] || '');
            const desc = row[descCol || ''] || '';

            return {
              date,
              description: desc,
              original_description: desc,
              amount,
              category: '',
              source: file.name,
              type: (amount < 0 ? 'expense' : 'income') as 'income' | 'expense',
            };
          }).filter(tx => tx.date && tx.amount !== 0);

          if (txs.length === 0) {
            setImportMsg('No valid transactions found. Check that the CSV has date and amount columns.');
            setImporting(false);
            return;
          }

          const count = await importTransactions(txs, rules);
          setImportMsg(`Imported ${count} transactions from ${file.name}`);
          refetch();
        } catch (err: unknown) {
          setImportMsg(err instanceof Error ? err.message : 'Import failed');
        } finally {
          setImporting(false);
          e.target.value = '';
        }
      },
      error: (err) => {
        setImportMsg(`Failed to parse CSV: ${err.message}`);
        setImporting(false);
      },
    });
  }

  async function handleSaveCategory(id: string) {
    await updateTransaction(id, { category: editCategory });
    setEditingId(null);
    refetch();
  }

  async function handleSaveDescription(id: string) {
    await updateTransaction(id, { description: editDescription });
    setEditingId(null);
    refetch();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this transaction?')) return;
    await deleteTransaction(id);
    refetch();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Import + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <label className={`flex items-center gap-2 px-4 py-2 border border-edge text-content text-sm font-medium rounded-control hover:bg-surface-hover cursor-pointer ${importing ? 'opacity-50' : ''}`}>
          {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Import CSV
          <input type="file" accept=".csv" onChange={handleCsvImport} className="hidden" disabled={importing} />
        </label>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-muted" />
          <input type="text" placeholder="Search description, category, or amount..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-edge rounded-control text-sm focus:outline-none focus:border-brand-400" />
        </div>

        <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
          className="px-3 py-2 border border-edge rounded-control text-sm">
          <option value="">All Months</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as '' | 'income' | 'expense')}
          className="px-3 py-2 border border-edge rounded-control text-sm">
          <option value="">All Types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>

        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          className="px-3 py-2 border border-edge rounded-control text-sm">
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {importMsg && (
        <div className={`flex items-start gap-2 p-3 rounded-control ${importMsg.includes('Import') ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
          <p className={`text-sm ${importMsg.includes('Import') ? 'text-emerald-700' : 'text-red-700'}`}>{importMsg}</p>
        </div>
      )}

      {/* Summary */}
      <div className="flex gap-4 text-sm">
        <span className="text-content-secondary">{filtered.length} transactions</span>
        <span className="text-emerald-600 font-medium">Income: ${totalIncome.toFixed(2)}</span>
        <span className="text-red-600 font-medium">Expenses: ${totalExpenses.toFixed(2)}</span>
        <span className={`font-semibold ${totalIncome - totalExpenses >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
          Net: ${(totalIncome - totalExpenses).toFixed(2)}
        </span>
      </div>

      {/* Bulk Action Bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 p-3 bg-brand-50 border border-brand-200 rounded-card">
          <span className="text-sm font-medium text-brand-800">{selected.size} selected</span>
          <div className="h-5 w-px bg-brand-200" />

          <select value={bulkAction} onChange={e => { setBulkAction(e.target.value as typeof bulkAction); setBulkValue(''); }}
            className="px-2 py-1.5 border border-brand-300 rounded-control text-sm bg-surface">
            <option value="">Choose action...</option>
            <option value="category">Set Category</option>
            <option value="description">Rename</option>
            <option value="type">Set Type</option>
          </select>

          {bulkAction === 'category' && (
            <CategoryInput
              value={bulkValue}
              onChange={setBulkValue}
              categories={categories}
              placeholder="Pick category..."
              className="w-44"
            />
          )}
          {bulkAction === 'description' && (
            <input type="text" value={bulkValue} onChange={e => setBulkValue(e.target.value)}
              placeholder="New description..."
              className="px-3 py-1.5 border border-brand-300 rounded-control text-sm w-52 bg-surface focus:outline-none focus:border-brand-500" />
          )}
          {bulkAction === 'type' && (
            <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
              className="px-2 py-1.5 border border-brand-300 rounded-control text-sm bg-surface">
              <option value="">Pick type...</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          )}

          {bulkAction && bulkValue && (
            <button onClick={handleBulkApply} disabled={bulkProcessing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-brand-fg text-sm font-medium rounded-control hover:bg-brand-700 disabled:opacity-50">
              {bulkProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Apply
            </button>
          )}

          <div className="h-5 w-px bg-brand-200" />
          <button onClick={handleBulkDelete} disabled={bulkProcessing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-red-600 text-sm font-medium rounded-control hover:bg-red-50 disabled:opacity-50">
            <Trash2 className="w-3 h-3" /> Delete
          </button>

          <button onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-brand-600 hover:text-brand-700">Clear selection</button>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface rounded-card border border-edge overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm table-fixed">
            <thead className="sticky top-0 bg-surface-hover">
              <tr className="text-left">
                <th className="px-3 py-3 w-10">
                  <button onClick={toggleSelectAll} className="text-content-muted hover:text-brand-600">
                    {allFilteredSelected ? <CheckSquare className="w-4 h-4 text-brand-600" /> : <Square className="w-4 h-4" />}
                  </button>
                </th>
                <th className="px-3 py-3 font-medium text-content-secondary w-28">Date</th>
                <th className="px-3 py-3 font-medium text-content-secondary">Description</th>
                <th className="px-3 py-3 font-medium text-content-secondary w-36">Category</th>
                <th className="px-3 py-3 font-medium text-content-secondary text-right w-24">Amount</th>
                <th className="px-3 py-3 font-medium text-content-secondary w-20">Type</th>
                <th className="px-3 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-soft">
              {filtered.slice(0, 500).map(tx => (
                <tr key={tx.id} className={`hover:bg-surface-hover ${selected.has(tx.id) ? 'bg-brand-50/50' : ''}`}>
                  <td className="px-3 py-3">
                    <button onClick={() => toggleSelect(tx.id)} className="text-content-muted hover:text-brand-600">
                      {selected.has(tx.id) ? <CheckSquare className="w-4 h-4 text-brand-600" /> : <Square className="w-4 h-4" />}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-content-secondary whitespace-nowrap">{tx.date}</td>
                  <td className="px-3 py-3">
                    {editingId === tx.id && editField === 'description' ? (
                      <div className="flex items-center gap-1">
                        <input type="text" value={editDescription} onChange={e => setEditDescription(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveDescription(tx.id); if (e.key === 'Escape') setEditingId(null); }}
                          className="w-full px-1 py-0.5 border border-brand-400 rounded text-sm" autoFocus />
                        <button onClick={() => handleSaveDescription(tx.id)} className="text-green-600 shrink-0"><Check className="w-3 h-3" /></button>
                        <button onClick={() => setEditingId(null)} className="text-content-muted shrink-0"><X className="w-3 h-3" /></button>
                      </div>
                    ) : (
                      <span
                        className="cursor-pointer hover:bg-brand-50 px-1 py-0.5 rounded flex items-center gap-1 group"
                        onClick={() => { setEditingId(tx.id); setEditField('description'); setEditDescription(tx.description); }}
                        title={tx.description !== tx.original_description ? `Original: ${tx.original_description}` : tx.description}
                      >
                        <span className="text-content truncate block overflow-hidden">{tx.description}</span>
                        <Edit2 className="w-3 h-3 text-content-faint group-hover:text-brand-400 opacity-0 group-hover:opacity-100 shrink-0" />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {editingId === tx.id && editField === 'category' ? (
                      <div className="flex items-center gap-1">
                        <CategoryInput
                          value={editCategory}
                          onChange={setEditCategory}
                          categories={categories}
                          className="w-32"
                          onEnter={() => handleSaveCategory(tx.id)}
                          onEscape={() => setEditingId(null)}
                          autoFocus
                        />
                        <button onClick={() => handleSaveCategory(tx.id)} className="text-green-600 shrink-0"><Check className="w-3 h-3" /></button>
                        <button onClick={() => setEditingId(null)} className="text-content-muted shrink-0"><X className="w-3 h-3" /></button>
                      </div>
                    ) : (
                      <span
                        className="cursor-pointer hover:bg-brand-50 px-1 py-0.5 rounded inline-flex items-center gap-1 group"
                        onClick={() => { setEditingId(tx.id); setEditField('category'); setEditCategory(tx.category); }}
                      >
                        <span className={tx.category === 'Uncategorized' ? 'text-amber-500 italic' : 'text-content-secondary'}>
                          {tx.category || 'Uncategorized'}
                        </span>
                        <Edit2 className="w-3 h-3 text-content-faint group-hover:text-brand-400 opacity-0 group-hover:opacity-100" />
                      </span>
                    )}
                  </td>
                  <td className={`px-3 py-3 text-right font-medium ${tx.type === 'income' ? 'text-emerald-600' : 'text-red-600'}`}>
                    ${Math.abs(Number(tx.amount)).toFixed(2)}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      tx.type === 'income' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {tx.type}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <button onClick={() => handleDelete(tx.id)} className="p-1 text-content-faint hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-content-muted">
                    {transactions.length === 0 ? 'No transactions. Import a CSV to get started.' : 'No transactions match your filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function normalizeDate(raw: string): string {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.substring(0, 10);
  const parts = raw.split('/');
  if (parts.length === 3) {
    const [m, d, y] = parts;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return raw;
}
