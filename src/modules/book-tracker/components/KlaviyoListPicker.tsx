import { useEffect, useState } from 'react';
import { Mail, RefreshCw, Users, AlertCircle, ExternalLink } from 'lucide-react';
import {
  getKlaviyoKeyStatus,
  listKlaviyoLists,
  getKlaviyoListCount,
  type KlaviyoList,
} from '../../../lib/klaviyo';

interface Props {
  value: string | null;
  onChange: (listId: string | null) => void;
}

// Optional Klaviyo list attachment for a tracked book. Shows the
// current attached list's profile count, or lets the user pick one from
// their Klaviyo account if a key is configured.
export default function KlaviyoListPicker({ value, onChange }: Props) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [lists, setLists] = useState<KlaviyoList[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getKlaviyoKeyStatus()
      .then(s => { if (!cancelled) setHasKey(s.has_key); })
      .catch(() => { if (!cancelled) setHasKey(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!value || !hasKey) { setCount(null); return; }
    let cancelled = false;
    getKlaviyoListCount(value)
      .then(c => { if (!cancelled) setCount(c); })
      .catch(() => { if (!cancelled) setCount(null); });
    return () => { cancelled = true; };
  }, [value, hasKey]);

  async function loadLists() {
    setLoading(true);
    setError(null);
    try {
      const rows = await listKlaviyoLists();
      setLists(rows);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  if (hasKey === false) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-600">
        <div className="flex items-center gap-2 mb-1">
          <Mail className="w-4 h-4 text-slate-400" />
          <span className="font-medium text-slate-700">Klaviyo</span>
        </div>
        <p>
          Add a Klaviyo API key in{' '}
          <a href="/settings" className="text-purple-600 hover:underline">Settings</a>{' '}
          to attach this book to a mailing list.
        </p>
      </div>
    );
  }

  const selectedList = lists?.find(l => l.id === value);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-purple-500" />
          <span className="font-medium text-slate-700">Klaviyo list</span>
        </div>
        {!lists && (
          <button
            onClick={loadLists}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading…' : 'Load my lists'}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-lg p-2 text-xs text-rose-700">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {lists ? (
        <select
          value={value ?? ''}
          onChange={e => onChange(e.target.value || null)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
        >
          <option value="">— No list attached —</option>
          {lists.map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      ) : (
        value ? (
          <div className="text-sm">
            <div className="text-slate-600">Attached list ID: <span className="font-mono">{value}</span></div>
            <button
              onClick={() => onChange(null)}
              className="text-xs text-rose-600 hover:underline mt-1"
            >
              Detach
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-400 italic">No list attached. Load your lists to pick one.</p>
        )
      )}

      {value && (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <Users className="w-3.5 h-3.5 text-slate-400" />
          {count !== null ? (
            <span>{count.toLocaleString()} subscribers{selectedList ? ` in ${selectedList.name}` : ''}</span>
          ) : (
            <span className="text-slate-400">Loading subscriber count…</span>
          )}
          <a
            href={`https://www.klaviyo.com/list/${value}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs text-purple-600 hover:underline"
          >
            Open in Klaviyo <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}
