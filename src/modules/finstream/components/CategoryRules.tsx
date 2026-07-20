import { useState, useMemo } from 'react';
import { Plus, Trash2, RefreshCw, Loader2, AlertCircle, Check, X, Edit2, Search } from 'lucide-react';
import { useCategoryRules, useTransactions } from '../hooks/useFinancials';
import { addCategoryRule, updateCategoryRule, deleteCategoryRule, recategorizeAll } from '../api';
import CategoryInput from './CategoryInput';

export default function CategoryRules() {
  const { rules, loading, refetch } = useCategoryRules();
  const { transactions } = useTransactions();
  const [matchString, setMatchString] = useState('');
  const [targetCategory, setTargetCategory] = useState('');
  const [ruleType, setRuleType] = useState<'income' | 'expense' | ''>('expense');
  const [saving, setSaving] = useState(false);
  const [recategorizing, setRecategorizing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMatch, setEditMatch] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editType, setEditType] = useState<'income' | 'expense' | ''>('');

  // Build unique categories from existing rules + transactions
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const r of rules) cats.add(r.target_category);
    for (const t of transactions) if (t.category) cats.add(t.category);
    return Array.from(cats).sort();
  }, [rules, transactions]);

  // Filter rules by search
  const filteredRules = useMemo(() => {
    if (!search) return rules;
    const s = search.toLowerCase();
    return rules.filter(r =>
      r.match_string.toLowerCase().includes(s) ||
      r.target_category.toLowerCase().includes(s)
    );
  }, [rules, search]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!matchString.trim() || !targetCategory.trim()) return;
    setSaving(true);
    setError('');
    try {
      await addCategoryRule({
        match_string: matchString.trim(),
        target_category: targetCategory.trim(),
        type: ruleType || null,
      });
      setMatchString('');
      setTargetCategory('');
      refetch();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add rule');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(rule: typeof rules[0]) {
    setEditingId(rule.id);
    setEditMatch(rule.match_string);
    setEditCategory(rule.target_category);
    setEditType(rule.type || '');
  }

  async function saveEdit() {
    if (!editingId || !editMatch.trim() || !editCategory.trim()) return;
    try {
      await updateCategoryRule(editingId, {
        match_string: editMatch.trim(),
        target_category: editCategory.trim(),
        type: editType || null,
      });
      setEditingId(null);
      refetch();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update rule');
    }
  }

  async function handleDelete(id: string) {
    await deleteCategoryRule(id);
    refetch();
  }

  async function handleRecategorize() {
    setRecategorizing(true);
    setMessage('');
    try {
      const count = await recategorizeAll();
      setMessage(`Re-categorized ${count} transactions`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to re-categorize');
    } finally {
      setRecategorizing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-surface rounded-card border border-edge p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-content">Auto-Categorization Rules</h3>
            <p className="text-sm text-content-secondary mt-0.5">
              When a transaction description contains the match text, it gets automatically categorized.
            </p>
          </div>
          <button
            onClick={handleRecategorize}
            disabled={recategorizing || rules.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-edge text-content rounded-control hover:bg-surface-hover disabled:opacity-50"
          >
            {recategorizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Re-categorize Uncategorized
          </button>
        </div>

        {/* Add Rule Form */}
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 mb-4 pb-4 border-b border-edge">
          <div className="flex-1 min-w-[150px]">
            <label className="block text-xs text-content-secondary mb-1">If description contains</label>
            <input type="text" value={matchString} onChange={e => setMatchString(e.target.value)}
              placeholder="e.g., AMAZON, NETFLIX"
              className="w-full px-3 py-2 border border-edge rounded-control text-sm focus:outline-none focus:border-cyan-400" />
          </div>
          <div className="flex-1 min-w-[150px]">
            <label className="block text-xs text-content-secondary mb-1">Set category to</label>
            <CategoryInput
              value={targetCategory}
              onChange={setTargetCategory}
              categories={allCategories}
              placeholder="Type or pick a category..."
            />
          </div>
          <div className="w-32">
            <label className="block text-xs text-content-secondary mb-1">Type</label>
            <select value={ruleType} onChange={e => setRuleType(e.target.value as '' | 'income' | 'expense')}
              className="w-full px-3 py-2 border border-edge rounded-control text-sm">
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="">Auto</option>
            </select>
          </div>
          <button type="submit" disabled={saving || !matchString.trim() || !targetCategory.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white text-sm font-medium rounded-control hover:bg-cyan-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add Rule
          </button>
        </form>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-muted" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search rules..."
            className="w-full pl-10 pr-4 py-2 border border-edge rounded-control text-sm focus:outline-none focus:border-cyan-400" />
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-control mb-4">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {message && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-control mb-4">
            <p className="text-sm text-emerald-700">{message}</p>
          </div>
        )}

        {/* Rules count */}
        <p className="text-xs text-content-muted mb-2">
          {filteredRules.length}{search ? ` of ${rules.length}` : ''} rule{filteredRules.length !== 1 ? 's' : ''}
        </p>

        {/* Rules List */}
        <div className="divide-y divide-edge-soft">
          {filteredRules.map(rule => (
            <div key={rule.id} className="flex items-center justify-between py-3 gap-3">
              {editingId === rule.id ? (
                <>
                  <div className="flex items-center gap-3 flex-1 flex-wrap">
                    <input type="text" value={editMatch} onChange={e => setEditMatch(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                      className="px-2 py-1 border border-cyan-400 rounded text-sm font-mono w-48 focus:outline-none" autoFocus />
                    <span className="text-content-muted">&rarr;</span>
                    <CategoryInput
                      value={editCategory}
                      onChange={setEditCategory}
                      categories={allCategories}
                      className="w-40"
                      onEnter={saveEdit}
                      onEscape={() => setEditingId(null)}
                    />
                    <select value={editType} onChange={e => setEditType(e.target.value as '' | 'income' | 'expense')}
                      className="px-2 py-1 border border-cyan-400 rounded text-sm focus:outline-none">
                      <option value="expense">expense</option>
                      <option value="income">income</option>
                      <option value="">auto</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={saveEdit} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
                    <button onClick={() => setEditingId(null)} className="p-1 text-content-muted hover:bg-surface-hover rounded"><X className="w-4 h-4" /></button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-4 text-sm flex-1 flex-wrap">
                    <span className="font-mono bg-surface-sunken px-2 py-1 rounded text-content">{rule.match_string}</span>
                    <span className="text-content-muted">&rarr;</span>
                    <span className="font-medium text-content">{rule.target_category}</span>
                    {rule.type && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        rule.type === 'income' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}>{rule.type}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEdit(rule)} className="p-1 text-content-faint hover:text-cyan-500 rounded">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(rule.id)} className="p-1 text-content-faint hover:text-red-500 rounded">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {filteredRules.length === 0 && (
            <p className="py-6 text-center text-sm text-content-muted">
              {search ? 'No rules match your search.' : 'No rules yet. Add one above to auto-categorize transactions on import.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
