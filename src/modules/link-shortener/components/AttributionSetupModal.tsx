import { useEffect, useState } from 'react';
import { Copy, Check, Loader2, ShoppingBag, ExternalLink } from 'lucide-react';
import Modal from '../../../components/Modal';
import { useAuth } from '../../../contexts/AuthContext';
import { getAttributionSettings, upsertAttributionSettings } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AttributionSetupModal({ open, onClose }: Props) {
  const { user } = useAuth();
  const [secret, setSecret] = useState('');
  const [param, setParam] = useState('click_id');
  const [windowMin, setWindowMin] = useState(4320);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    setError(null);
    getAttributionSettings(user.id)
      .then((s) => {
        setSecret(s?.shopify_webhook_secret ?? '');
        setParam(s?.click_id_param ?? 'click_id');
        setWindowMin(s?.attribution_window_minutes ?? 4320);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [open, user]);

  const webhookUrl =
    typeof window !== 'undefined' && user
      ? `${window.location.origin}/api/conversions/shopify-webhook?u=${user.id}`
      : '';

  const themeSnippet = `<!-- Save click_id from URL into Shopify cart attributes -->
<script>
(function () {
  try {
    var p = '${param}';
    var url = new URL(window.location.href);
    var cid = url.searchParams.get(p);
    if (cid) localStorage.setItem('_clickid', cid);
    cid = cid || localStorage.getItem('_clickid');
    if (!cid) return;
    fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attributes: { click_id: cid } })
    }).catch(function () {});
  } catch (e) {}
})();
</script>`;

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      await upsertAttributionSettings(user.id, {
        shopify_webhook_secret: secret.trim() || null,
        click_id_param: param.trim() || 'click_id',
        attribution_window_minutes: windowMin,
      });
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function copy(value: string, key: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1400);
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Conversion tracking setup" maxWidth="max-w-2xl">
      {loading ? (
        <div className="py-8 flex items-center justify-center text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <ShoppingBag className="w-4 h-4" /> Shopify webhook
            </div>
            <p className="text-sm text-slate-600">
              In your Shopify admin: <strong>Settings → Notifications → Webhooks</strong>. Create a webhook for <em>Order paid</em>, format JSON, paste this URL:
            </p>
            <FieldCopy value={webhookUrl} keyName="url" copied={copied} onCopy={copy} />
            <p className="text-sm text-slate-600">
              Shopify will display a <strong>Webhook signing secret</strong>. Paste it here so we can verify each incoming event:
            </p>
            <input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="shpss_..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </section>

          <section className="space-y-3">
            <div className="text-sm font-semibold text-slate-700">Theme snippet (most accurate attribution)</div>
            <p className="text-sm text-slate-600">
              For best attribution, add this to your Shopify theme so the click_id rides through to the order. In Shopify admin:{' '}
              <strong>Online Store → Themes → ⋯ → Edit code</strong>, open <code className="bg-slate-100 px-1 rounded">theme.liquid</code>, and paste this just before <code className="bg-slate-100 px-1 rounded">&lt;/head&gt;</code>:
            </p>
            <FieldCopy value={themeSnippet} keyName="snippet" copied={copied} onCopy={copy} multiline />
          </section>

          <section className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">URL parameter name</label>
              <input
                value={param}
                onChange={(e) => setParam(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <p className="mt-1 text-xs text-slate-500">Default: <code>click_id</code>. Appears as <code>?click_id=…</code> on destination URLs.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Fallback window (minutes)</label>
              <input
                type="number"
                value={windowMin}
                onChange={(e) => setWindowMin(Number(e.target.value) || 4320)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <p className="mt-1 text-xs text-slate-500">If no click_id, match orders to clicks within this window. Default 4320 (3 days).</p>
            </div>
          </section>

          {error && <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>}

          <div className="flex items-center justify-between">
            <a
              href="https://help.shopify.com/en/manual/orders/notifications/webhooks"
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1"
            >
              Shopify webhook docs <ExternalLink className="w-3 h-3" />
            </a>
            <div className="flex items-center gap-3">
              {savedAt && <span className="text-xs text-emerald-600">Saved!</span>}
              <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Close</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Save settings
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function FieldCopy({
  value, keyName, copied, onCopy, multiline,
}: {
  value: string; keyName: string; copied: string | null;
  onCopy: (value: string, key: string) => void; multiline?: boolean;
}) {
  return (
    <div className="relative">
      {multiline ? (
        <textarea
          readOnly
          value={value}
          rows={8}
          className="w-full px-3 py-2 pr-10 rounded-lg border border-slate-200 bg-slate-50 text-xs font-mono text-slate-700"
        />
      ) : (
        <input
          readOnly
          value={value}
          className="w-full px-3 py-2 pr-10 rounded-lg border border-slate-200 bg-slate-50 text-sm font-mono text-slate-700"
        />
      )}
      <button
        onClick={() => onCopy(value, keyName)}
        className="absolute top-2 right-2 p-1.5 text-slate-400 hover:text-indigo-600 bg-white rounded-md border border-slate-200"
        title="Copy"
      >
        {copied === keyName ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}
