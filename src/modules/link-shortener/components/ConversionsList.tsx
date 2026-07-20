import { useEffect, useState, type ReactNode } from 'react';
import { DollarSign, Plus, Trash2, ShoppingBag, Sparkles, Loader2, X } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { createConversion, deleteConversion, listConversions } from '../api';
import { formatCurrency, shortDate } from '../utils';
import type { LinkConversion, ShortLink } from '../types';

interface Props {
  link: ShortLink;
  onTotalsChanged: (link: ShortLink) => void;
}

const SOURCE_ICON: Record<string, ReactNode> = {
  manual: <Sparkles className="w-3.5 h-3.5" />,
  shopify_webhook: <ShoppingBag className="w-3.5 h-3.5" />,
  shopify_clickid: <ShoppingBag className="w-3.5 h-3.5" />,
  api: <Sparkles className="w-3.5 h-3.5" />,
};

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  shopify_webhook: 'Shopify (matched)',
  shopify_clickid: 'Shopify (click_id)',
  api: 'API',
};

export default function ConversionsList({ link, onTotalsChanged }: Props) {
  const { user } = useAuth();
  const [conversions, setConversions] = useState<LinkConversion[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [notes, setNotes] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    listConversions(user.id, { linkId: link.id, limit: 200 })
      .then(setConversions)
      .catch(() => setConversions([]))
      .finally(() => setLoading(false));
  }, [link.id, user]);

  async function handleAdd() {
    if (!user) return;
    setError(null);
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
      setError('Value must be a number.');
      return;
    }
    setBusy(true);
    try {
      const created = await createConversion(user.id, {
        link_id: link.id,
        source: 'manual',
        value: numericValue,
        currency: currency.toUpperCase(),
        notes,
        external_ref: externalRef || null,
      });
      setConversions([created, ...conversions]);
      onTotalsChanged({
        ...link,
        conversion_count: link.conversion_count + 1,
        conversion_value: link.conversion_value + numericValue,
      });
      setValue('');
      setNotes('');
      setExternalRef('');
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add conversion');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(c: LinkConversion) {
    if (!confirm(`Remove conversion of ${formatCurrency(c.value, c.currency)}?`)) return;
    try {
      await deleteConversion(c.id);
      setConversions(conversions.filter((x) => x.id !== c.id));
      onTotalsChanged({
        ...link,
        conversion_count: Math.max(0, link.conversion_count - 1),
        conversion_value: Math.max(0, link.conversion_value - c.value),
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-content flex items-center gap-2">
          <DollarSign className="w-4 h-4" /> Conversions
        </h3>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-control text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            <Plus className="w-3.5 h-3.5" /> Log conversion
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-emerald-50 border border-emerald-100 rounded-card px-3 py-2">
          <div className="text-[11px] text-emerald-700 uppercase tracking-wide">Total revenue</div>
          <div className="text-lg font-semibold text-emerald-800 tabular-nums">{formatCurrency(link.conversion_value)}</div>
        </div>
        <div className="bg-indigo-50 border border-indigo-100 rounded-card px-3 py-2">
          <div className="text-[11px] text-indigo-700 uppercase tracking-wide">Count</div>
          <div className="text-lg font-semibold text-indigo-800 tabular-nums">{link.conversion_count}</div>
        </div>
      </div>

      {adding && (
        <div className="mb-3 p-3 rounded-card border border-edge bg-surface-hover space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-content">New manual conversion</span>
            <button onClick={() => setAdding(false)} className="text-content-muted hover:text-content-secondary">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0.00"
              className="flex-1 px-2 py-1.5 text-sm rounded border border-edge focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              maxLength={3}
              placeholder="USD"
              className="w-16 px-2 py-1.5 text-sm rounded border border-edge focus:outline-none focus:ring-2 focus:ring-indigo-300 uppercase"
            />
          </div>
          <input
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder="Reference (e.g. order #1234)"
            className="w-full px-2 py-1.5 text-sm rounded border border-edge focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full px-2 py-1.5 text-sm rounded border border-edge focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          {error && <div className="text-xs text-red-600">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-xs text-content-secondary hover:bg-edge rounded-control">
              Cancel
            </button>
            <button onClick={handleAdd} disabled={busy} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-control disabled:opacity-50">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-content-muted">Loading…</div>
      ) : conversions.length === 0 ? (
        <p className="text-sm text-content-muted">No conversions logged yet. Use the button above for manual entries, or set up the Shopify webhook to auto-track sales.</p>
      ) : (
        <div className="space-y-1">
          {conversions.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-control bg-surface-hover border border-edge-soft text-sm group">
              <span className="text-content-muted shrink-0">{SOURCE_ICON[c.source]}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-content tabular-nums">{formatCurrency(c.value, c.currency)}</span>
                  <span className="text-[10px] uppercase tracking-wide text-content-muted">{SOURCE_LABEL[c.source]}</span>
                </div>
                {(c.external_ref || c.notes) && (
                  <div className="text-xs text-content-secondary truncate">
                    {c.external_ref && <span className="font-mono">{c.external_ref}</span>}
                    {c.external_ref && c.notes && ' — '}
                    {c.notes}
                  </div>
                )}
              </div>
              <span className="text-xs text-content-muted shrink-0">{shortDate(c.occurred_at)}</span>
              <button
                onClick={() => handleDelete(c)}
                className="p-1 text-content-faint hover:text-red-600 opacity-0 group-hover:opacity-100"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
