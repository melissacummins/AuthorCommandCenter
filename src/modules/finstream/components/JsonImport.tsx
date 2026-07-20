import { useState } from 'react';
import { Upload, CheckCircle, AlertCircle, Loader2, FileJson } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface Props {
  onComplete: () => void;
}

export default function JsonImport({ onComplete }: Props) {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setProgress([]);
    setError('');
    setDone(false);

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const userId = user.id;

      // Try to detect the data format
      // Format 1: Direct arrays at top level
      // Format 2: Keyed object with table names
      // Format 3: Firebase-style with camelCase keys

      const transactions = extractArray(data, ['transactions', 'Transactions']);
      const categoryRules = extractArray(data, ['categoryRules', 'category_rules', 'CategoryRules', 'rules']);
      const subscriptions = extractArray(data, ['subscriptions', 'manual_subscriptions', 'ManualSubscriptions']);
      const cashFlowNotes = extractArray(data, ['cashFlowNotes', 'cash_flow_notes', 'CashFlowNotes']);
      const historyEntries = extractArray(data, ['manualHistoryEntries', 'manual_history_entries', 'ManualHistoryEntries', 'history']);

      // Import transactions
      if (transactions.length > 0) {
        addProgress(`Importing ${transactions.length} transactions...`);
        const rows = transactions.map((t: Record<string, unknown>) => ({
          user_id: userId,
          date: String(t.date || ''),
          description: String(t.description || t.desc || ''),
          original_description: String(t.original_description || t.originalDescription || t.description || t.desc || ''),
          amount: Number(t.amount || 0),
          category: String(t.category || 'Uncategorized'),
          source: String(t.source || 'JSON Import'),
          type: (t.type === 'income' ? 'income' : 'expense') as 'income' | 'expense',
        })).filter((t: { date: string }) => t.date);

        const batchSize = 500;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          const { error } = await supabase.from('transactions').insert(batch);
          if (error) throw new Error(`Transaction import failed: ${error.message}`);
        }
        addProgress(`  Imported ${rows.length} transactions`);
      }

      // Import category rules
      if (categoryRules.length > 0) {
        addProgress(`Importing ${categoryRules.length} category rules...`);
        const rows = categoryRules.map((r: Record<string, unknown>) => ({
          user_id: userId,
          match_string: String(r.match_string || r.matchString || r.match || ''),
          target_category: String(r.target_category || r.targetCategory || r.category || ''),
          type: r.type === 'income' ? 'income' : r.type === 'expense' ? 'expense' : null,
        })).filter((r: { match_string: string }) => r.match_string);

        const { error } = await supabase.from('category_rules').insert(rows);
        if (error) throw new Error(`Rules import failed: ${error.message}`);
        addProgress(`  Imported ${rows.length} rules`);
      }

      // Import subscriptions
      if (subscriptions.length > 0) {
        addProgress(`Importing ${subscriptions.length} subscriptions...`);
        const rows = subscriptions.map((s: Record<string, unknown>) => ({
          user_id: userId,
          vendor_name: String(s.vendor_name || s.vendorName || s.vendor || s.name || ''),
          match_string: s.match_string || s.matchString || null,
          frequency: ['Monthly', 'Yearly', 'Weekly'].includes(String(s.frequency)) ? s.frequency : 'Monthly',
          amount: s.amount ? Number(s.amount) : null,
        })).filter((s: { vendor_name: string }) => s.vendor_name);

        const { error } = await supabase.from('manual_subscriptions').insert(rows);
        if (error) throw new Error(`Subscriptions import failed: ${error.message}`);
        addProgress(`  Imported ${rows.length} subscriptions`);
      }

      // Import cash flow notes
      if (cashFlowNotes.length > 0) {
        addProgress(`Importing ${cashFlowNotes.length} cash flow notes...`);
        const rows = cashFlowNotes.map((n: Record<string, unknown>) => ({
          user_id: userId,
          month: String(n.month || ''),
          note: String(n.note || n.content || ''),
        })).filter((n: { month: string }) => n.month);

        const { error } = await supabase.from('cash_flow_notes').upsert(rows, { onConflict: 'user_id,month' });
        if (error) throw new Error(`Notes import failed: ${error.message}`);
        addProgress(`  Imported ${rows.length} notes`);
      }

      // Import manual history entries
      if (historyEntries.length > 0) {
        addProgress(`Importing ${historyEntries.length} history entries...`);
        const rows = historyEntries.map((h: Record<string, unknown>) => ({
          user_id: userId,
          month: String(h.month || ''),
          amount: Number(h.amount || 0),
          description: String(h.description || h.desc || ''),
        })).filter((h: { month: string }) => h.month);

        const { error } = await supabase.from('manual_history_entries').insert(rows);
        if (error) throw new Error(`History import failed: ${error.message}`);
        addProgress(`  Imported ${rows.length} entries`);
      }

      const total = transactions.length + categoryRules.length + subscriptions.length + cashFlowNotes.length + historyEntries.length;
      if (total === 0) {
        setError('No recognizable data found in the JSON file. Expected keys like "transactions", "categoryRules", "subscriptions", etc.');
      } else {
        addProgress('Import complete!');
        setDone(true);
        onComplete();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  function addProgress(msg: string) {
    setProgress(prev => [...prev, msg]);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-content-secondary">
        Upload a JSON file from your old app. Supported data: transactions, category rules, subscriptions, cash flow notes, and history entries.
      </p>

      <div className="bg-surface-hover rounded-control p-4 text-xs text-content-secondary">
        <p className="font-medium text-content-secondary mb-1">Expected JSON format:</p>
        <pre className="overflow-x-auto">{`{
  "transactions": [{ "date": "2024-01-15", "description": "...", "amount": 9.99, "category": "Software", "type": "expense" }],
  "categoryRules": [{ "matchString": "AMAZON", "targetCategory": "Supplies", "type": "expense" }],
  "subscriptions": [{ "vendorName": "Adobe", "amount": 54.99, "frequency": "Monthly" }]
}`}</pre>
        <p className="mt-2">Both camelCase and snake_case field names are accepted.</p>
      </div>

      <label className={`flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed rounded-card cursor-pointer transition-colors ${
        importing ? 'border-edge bg-surface-hover opacity-50' : 'border-brand-300 hover:bg-brand-50 hover:border-brand-400'
      }`}>
        {importing ? <Loader2 className="w-5 h-5 text-brand-500 animate-spin" /> : <FileJson className="w-5 h-5 text-brand-500" />}
        <span className="text-sm font-medium text-content">
          {importing ? 'Importing...' : 'Choose JSON file'}
        </span>
        <input type="file" accept=".json" onChange={handleFile} className="hidden" disabled={importing} />
      </label>

      {progress.length > 0 && (
        <div className="bg-surface-hover rounded-control p-3 space-y-1">
          {progress.map((msg, i) => (
            <p key={i} className="text-xs text-content-secondary flex items-center gap-1.5">
              {i === progress.length - 1 && done ? (
                <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
              ) : (
                <span className="w-3 h-3 shrink-0" />
              )}
              {msg}
            </p>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-control">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}

function extractArray(data: unknown, keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data === 'object' && data !== null) {
    for (const key of keys) {
      const val = (data as Record<string, unknown>)[key];
      if (Array.isArray(val)) return val;
    }
    // Try nested under a "data" key
    const nested = (data as Record<string, unknown>).data;
    if (typeof nested === 'object' && nested !== null) {
      for (const key of keys) {
        const val = (nested as Record<string, unknown>)[key];
        if (Array.isArray(val)) return val;
      }
    }
  }
  return [];
}
