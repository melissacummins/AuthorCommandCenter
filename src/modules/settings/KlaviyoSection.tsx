import { useEffect, useState } from 'react';
import { Mail, AlertCircle, CheckCircle, Loader2, Trash2, Key } from 'lucide-react';
import {
  getKlaviyoKeyStatus,
  setKlaviyoKey,
  removeKlaviyoKey,
  type KlaviyoKeyStatus,
} from '../../lib/klaviyo';

// Settings card for the Klaviyo BYOK key. Mirrors the Fal.AI BYOK
// section in MediaModule, but lives on the global Settings page since
// Klaviyo is used by multiple modules (Book Tracker, Marketing, ARCs).
export default function KlaviyoSection() {
  const [status, setStatus] = useState<KlaviyoKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [rawKey, setRawKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getKlaviyoKeyStatus()
      .then(s => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setStatus({ has_key: false, hint: null, updated_at: null }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function handleSave() {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const next = await setKlaviyoKey(rawKey.trim());
      setStatus(next);
      setRawKey('');
      setSaved(true);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm('Remove your stored Klaviyo API key? You will need to paste it again to use Klaviyo features.')) return;
    setRemoving(true);
    setError(null);
    try {
      await removeKlaviyoKey();
      setStatus({ has_key: false, hint: null, updated_at: null });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
      <div className="flex items-center gap-3 mb-2">
        <Mail className="w-5 h-5 text-purple-600" />
        <h2 className="text-lg font-semibold text-slate-800">Klaviyo integration</h2>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        Add a Klaviyo Private API Key so the Command Center can show subscriber counts on book pages and (eventually) sync your audience. The key is encrypted server-side and never sent to the browser after you save it.
      </p>

      {loading ? (
        <div className="text-sm text-slate-500">Checking key status…</div>
      ) : status?.has_key ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>
              Klaviyo connected. Stored key ends in <span className="font-mono">{status.hint}</span>
              {status.updated_at && (
                <span className="text-emerald-600 ml-2">
                  · updated {new Date(status.updated_at).toLocaleDateString()}
                </span>
              )}
            </span>
          </div>
          <button
            onClick={handleRemove}
            disabled={removing}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50 disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" /> {removing ? 'Removing…' : 'Remove key'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
            <Key className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
            <span>
              Get a Private API Key from Klaviyo → Settings → API Keys. Paste it here — we verify it
              against Klaviyo before saving.
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={rawKey}
              onChange={e => setRawKey(e.target.value)}
              placeholder="pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
              autoComplete="off"
            />
            <button
              onClick={handleSave}
              disabled={saving || rawKey.trim().length < 16}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Verifying…' : 'Save key'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-800">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {saved && !error && (
        <div className="mt-3 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
          <CheckCircle className="w-4 h-4 shrink-0" />
          Key saved.
        </div>
      )}
    </section>
  );
}
