import { useEffect, useState } from 'react';
import { Globe, Plus, Loader2, Trash2, CheckCircle, Clock, Copy, Check } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { addCustomDomain, deleteCustomDomain, listCustomDomains } from '../api';
import type { CustomDomain } from '../types';

// The CNAME target every Vercel custom domain points at. Shown as DNS guidance.
const CNAME_TARGET = 'cname.vercel-dns.com';

export default function DomainSettings({ onPrimaryChange }: { onPrimaryChange?: () => void }) {
  const { user } = useAuth();
  const [domains, setDomains] = useState<CustomDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDomain, setNewDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    listCustomDomains(user.id)
      .then(setDomains)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load domains'))
      .finally(() => setLoading(false));
  }, [user]);

  async function handleAdd() {
    if (!user || !newDomain.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await addCustomDomain(user.id, newDomain);
      setDomains((prev) => [...prev, created]);
      setNewDomain('');
    } catch (e: any) {
      setError(
        /duplicate|unique/i.test(e?.message ?? '')
          ? 'That domain is already connected (to your account or another).'
          : e?.message ?? 'Failed to add domain',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(d: CustomDomain) {
    if (!confirm(`Remove ${d.domain}? Links served from it will stop working.`)) return;
    try {
      await deleteCustomDomain(d.id);
      setDomains((prev) => prev.filter((x) => x.id !== d.id));
      onPrimaryChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove domain');
    }
  }

  async function copyTarget() {
    try {
      await navigator.clipboard.writeText(CNAME_TARGET);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-2">
        <Globe className="w-5 h-5 text-brand-600" />
        <h2 className="text-lg font-semibold text-content">Your domain</h2>
      </div>
      <p className="text-sm text-content-secondary mb-6">
        Connect a domain you own (e.g. <span className="font-mono">links.yourbooks.com</span>) to
        serve your short links and bio page from your own brand. Until a domain is connected and
        verified, your links can't be shared publicly.
      </p>

      {/* Add */}
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          placeholder="links.yourbooks.com"
          className="flex-1 px-3 py-2 border border-edge-strong rounded-control text-sm"
          autoComplete="off"
        />
        <button
          onClick={handleAdd}
          disabled={busy || !newDomain.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-brand-600 text-brand-fg font-medium rounded-control hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add
        </button>
      </div>
      {error && <p className="text-rose-600 text-sm mb-3">{error}</p>}

      {/* DNS guidance */}
      <div className="text-xs text-content-secondary bg-surface-hover border border-edge rounded-control p-3 mb-6">
        <p className="font-medium text-content mb-1">How to connect a domain</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Add the domain above.</li>
          <li>
            At your domain registrar, point it with a <span className="font-mono">CNAME</span> record to{' '}
            <button onClick={copyTarget} className="inline-flex items-center gap-1 font-mono text-brand-700 hover:underline">
              {CNAME_TARGET}
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </button>
          </li>
          <li>We'll finish setup and mark it verified — usually within a day.</li>
        </ol>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-content-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : domains.length === 0 ? (
        <p className="text-sm text-content-muted">No domains connected yet.</p>
      ) : (
        <div className="space-y-2">
          {domains.map((d) => (
            <div key={d.id} className="flex items-center gap-3 border border-edge rounded-card px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-content truncate font-mono">{d.domain}</p>
                {d.verified ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                    <CheckCircle className="w-3.5 h-3.5" /> Verified{d.is_primary ? ' · primary' : ''}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                    <Clock className="w-3.5 h-3.5" /> Pending verification
                  </span>
                )}
              </div>
              <button
                onClick={() => handleDelete(d)}
                className="p-1.5 text-rose-500 border border-rose-200 rounded-control hover:bg-rose-50"
                title="Remove domain"
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
