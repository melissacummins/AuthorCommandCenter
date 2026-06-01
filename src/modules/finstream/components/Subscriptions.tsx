import { useState, useMemo } from 'react';
import { Plus, Trash2, Loader2, CreditCard, Edit2, Check, X, Search } from 'lucide-react';
import { useSubscriptions, useTransactions } from '../hooks/useFinancials';
import { addSubscription, deleteSubscription } from '../api';
import type { ManualSubscription, Transaction } from '../../../lib/types';

export default function Subscriptions() {
  const { subscriptions, loading, refetch } = useSubscriptions();
  const { transactions } = useTransactions();
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');

  // Match transactions to subscriptions
  const enriched = useMemo(() => {
    return subscriptions.map(sub => {
      const matchStr = (sub.match_string || sub.vendor_name).toLowerCase();
      const matched = transactions.filter(t =>
        t.description.toLowerCase().includes(matchStr) ||
        t.original_description.toLowerCase().includes(matchStr)
      ).sort((a, b) => b.date.localeCompare(a.date));

      const lastAmount = matched.length > 0 ? Math.abs(Number(matched[0].amount)) : sub.amount;
      const lastDate = matched.length > 0 ? matched[0].date : null;

      return { ...sub, matched, lastAmount, lastDate, matchCount: matched.length };
    });
  }, [subscriptions, transactions]);

  const filtered = search
    ? enriched.filter(s => s.vendor_name.toLowerCase().includes(search.toLowerCase()) || (s.match_string || '').toLowerCase().includes(search.toLowerCase()))
    : enriched;

  const monthlyTotal = enriched.reduce((sum, s) => {
    const amt = s.lastAmount || s.amount || 0;
    if (s.frequency === 'Monthly') return sum + amt;
    if (s.frequency === 'Yearly') return sum + amt / 12;
    if (s.frequency === 'Weekly') return sum + amt * 4.33;
    return sum;
  }, 0);

  const yearlyTotal = monthlyTotal * 12;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-500">Subscriptions</p>
          <p className="text-2xl font-bold text-slate-800">{subscriptions.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-500">Est. Monthly</p>
          <p className="text-2xl font-bold text-red-600">${monthlyTotal.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-500">Est. Yearly</p>
          <p className="text-2xl font-bold text-red-600">${yearlyTotal.toFixed(2)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800">Tracked Subscriptions</h3>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white text-sm font-medium rounded-lg hover:bg-cyan-700"
          >
            <Plus className="w-4 h-4" /> Add Subscription
          </button>
        </div>

        {showAdd && (
          <AddSubscriptionForm
            transactions={transactions}
            onClose={() => setShowAdd(false)}
            onCreated={() => { refetch(); setShowAdd(false); }}
          />
        )}

        {/* Search */}
        {subscriptions.length > 0 && (
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search subscriptions..."
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-cyan-400" />
          </div>
        )}

        {/* Subscription List */}
        <div className="divide-y divide-slate-100">
          {filtered.map(sub => (
            <SubscriptionRow key={sub.id} sub={sub} onDelete={async () => { await deleteSubscription(sub.id); refetch(); }} />
          ))}
          {filtered.length === 0 && subscriptions.length > 0 && (
            <p className="py-6 text-center text-sm text-slate-400">No subscriptions match your search.</p>
          )}
          {subscriptions.length === 0 && (
            <div className="text-center py-8">
              <CreditCard className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No subscriptions tracked yet. Add one or mark a transaction as a subscription.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SubscriptionRow({ sub, onDelete }: {
  sub: ManualSubscription & { matched: Transaction[]; lastAmount: number | null; lastDate: string | null; matchCount: number };
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <CreditCard className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800">{sub.vendor_name}</p>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Matches: <code className="bg-slate-100 px-1 rounded">{sub.match_string || sub.vendor_name}</code></span>
              <span>&middot; {sub.matchCount} transaction{sub.matchCount !== 1 ? 's' : ''}</span>
              {sub.lastDate && <span>&middot; Last: {sub.lastDate}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-sm font-medium text-slate-800">
              ${(sub.lastAmount || sub.amount || 0).toFixed(2)}
            </p>
            <p className="text-xs text-slate-400">{sub.frequency}</p>
          </div>
          {sub.matchCount > 0 && (
            <button onClick={() => setExpanded(!expanded)} className="text-xs text-cyan-600 hover:text-cyan-700">
              {expanded ? 'Hide' : 'History'}
            </button>
          )}
          <button onClick={onDelete} className="p-1 text-slate-300 hover:text-red-500">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {expanded && sub.matched.length > 0 && (
        <div className="mt-2 ml-7 bg-slate-50 rounded-lg p-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="pb-1">Date</th>
                <th className="pb-1">Description</th>
                <th className="pb-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sub.matched.slice(0, 12).map(tx => (
                <tr key={tx.id}>
                  <td className="py-1.5 text-slate-600">{tx.date}</td>
                  <td className="py-1.5 text-slate-600 truncate max-w-xs">{tx.description}</td>
                  <td className="py-1.5 text-right text-slate-700 font-medium">${Math.abs(Number(tx.amount)).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddSubscriptionForm({ transactions, onClose, onCreated }: {
  transactions: Transaction[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [vendor, setVendor] = useState('');
  const [matchString, setMatchString] = useState('');
  const [frequency, setFrequency] = useState<ManualSubscription['frequency']>('Monthly');
  const [saving, setSaving] = useState(false);
  const [fromTx, setFromTx] = useState<Transaction | null>(null);
  const [txSearch, setTxSearch] = useState('');

  // Unique descriptions for picking from transactions
  const uniqueDescs = useMemo(() => {
    const seen = new Map<string, Transaction>();
    for (const tx of transactions) {
      if (tx.type === 'expense' && !seen.has(tx.description)) {
        seen.set(tx.description, tx);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.description.localeCompare(b.description));
  }, [transactions]);

  const filteredTxs = txSearch
    ? uniqueDescs.filter(tx => tx.description.toLowerCase().includes(txSearch.toLowerCase()))
    : [];

  function selectTransaction(tx: Transaction) {
    setFromTx(tx);
    setVendor(tx.description);
    setMatchString(tx.description.split(' ').slice(0, 3).join(' '));
    setTxSearch('');
  }

  // Preview matches
  const previewMatches = matchString
    ? transactions.filter(t =>
        t.description.toLowerCase().includes(matchString.toLowerCase()) ||
        t.original_description.toLowerCase().includes(matchString.toLowerCase())
      ).length
    : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendor.trim()) return;
    setSaving(true);

    const matchedTxs = transactions.filter(t =>
      t.description.toLowerCase().includes((matchString || vendor).toLowerCase()) ||
      t.original_description.toLowerCase().includes((matchString || vendor).toLowerCase())
    ).sort((a, b) => b.date.localeCompare(a.date));

    const detectedAmount = matchedTxs.length > 0 ? Math.abs(Number(matchedTxs[0].amount)) : null;

    await addSubscription({
      vendor_name: vendor.trim(),
      amount: detectedAmount,
      frequency,
      match_string: matchString.trim() || null,
    });
    setSaving(false);
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 pb-4 border-b border-slate-200 space-y-4">
      {/* Pick from transaction */}
      <div>
        <label className="block text-xs text-slate-500 mb-1">Find from a transaction</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" value={txSearch} onChange={e => setTxSearch(e.target.value)}
            placeholder="Search your expense transactions..."
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-cyan-400" />
          {txSearch && filteredTxs.length > 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {filteredTxs.slice(0, 10).map(tx => (
                <button key={tx.id} type="button"
                  onClick={() => selectTransaction(tx)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-cyan-50 flex justify-between gap-4">
                  <span className="truncate text-slate-700">{tx.description}</span>
                  <span className="text-slate-400 shrink-0">${Math.abs(Number(tx.amount)).toFixed(2)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Vendor Name *</label>
          <input type="text" value={vendor} onChange={e => setVendor(e.target.value)}
            placeholder="e.g., Adobe, Canva"
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-cyan-400" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Frequency</label>
          <select value={frequency} onChange={e => setFrequency(e.target.value as ManualSubscription['frequency'])}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
            <option value="Monthly">Monthly</option>
            <option value="Yearly">Yearly</option>
            <option value="Weekly">Weekly</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-500 mb-1">Match String</label>
        <input type="text" value={matchString} onChange={e => setMatchString(e.target.value)}
          placeholder="Text to match in transaction descriptions"
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-cyan-400" />
        <p className="text-xs text-slate-400 mt-1">
          {matchString ? (
            <span>Matches <strong className="text-cyan-600">{previewMatches}</strong> existing transaction{previewMatches !== 1 ? 's' : ''}</span>
          ) : (
            'Handles asterisks, different numbers, etc. Use the part that stays consistent.'
          )}
        </p>
      </div>

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
        <button type="submit" disabled={saving || !vendor.trim()}
          className="px-4 py-2 text-sm bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Subscription'}
        </button>
      </div>
    </form>
  );
}
