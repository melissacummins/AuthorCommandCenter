import { useState } from 'react';
import { Store, Key, CheckCircle, AlertCircle, Loader2, Trash2, ExternalLink } from 'lucide-react';
import { saveShopifySettings, deleteShopifySettings, testShopifyConnection, getShopifyOAuthUrl } from '../api';
import type { ShopifySettings } from '../../../lib/types';

interface Props {
  settings: ShopifySettings | null;
  onSaved: () => void;
}

export default function ShopifySetup({ settings, onSaved }: Props) {
  const [storeUrl, setStoreUrl] = useState(settings?.store_url || '');
  const [clientId, setClientId] = useState(settings?.client_id || '');
  const [clientSecret, setClientSecret] = useState(settings?.client_secret || '');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showDisconnect, setShowDisconnect] = useState(false);

  const isConnected = !!settings?.access_token;
  const hasCredentials = !!settings?.client_id;

  function normalizeStoreUrl(url: string): string {
    let cleaned = url.trim().toLowerCase();
    cleaned = cleaned.replace(/^https?:\/\//, '');
    cleaned = cleaned.replace(/\/+$/, '');
    if (!cleaned.endsWith('.myshopify.com') && !cleaned.includes('.')) {
      cleaned = `${cleaned}.myshopify.com`;
    }
    return cleaned;
  }

  async function handleSaveAndAuthorize() {
    setError('');
    setSuccess('');

    const normalizedUrl = normalizeStoreUrl(storeUrl);
    if (!normalizedUrl || !clientId.trim() || !clientSecret.trim()) {
      setError('Please fill in all three fields.');
      return;
    }

    setSaving(true);
    try {
      await saveShopifySettings({
        store_url: normalizedUrl,
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
      });
      setStoreUrl(normalizedUrl);
      onSaved();

      // Redirect to Shopify OAuth
      const redirectUri = `${window.location.origin}/shopify/callback`;
      const oauthUrl = getShopifyOAuthUrl(normalizedUrl, clientId.trim(), redirectUri);
      window.location.href = oauthUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
      setSaving(false);
    }
  }

  async function handleReauthorize() {
    if (!settings) return;
    const redirectUri = `${window.location.origin}/shopify/callback`;
    const oauthUrl = getShopifyOAuthUrl(settings.store_url, settings.client_id || '', redirectUri);
    window.location.href = oauthUrl;
  }

  async function handleTest() {
    setError('');
    setSuccess('');
    setTesting(true);
    try {
      const result = await testShopifyConnection();
      setSuccess(`Connected to "${result.shop.name}" (${result.shop.domain})`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection test failed.');
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    try {
      await deleteShopifySettings();
      setStoreUrl('');
      setClientId('');
      setClientSecret('');
      setShowDisconnect(false);
      setSuccess('');
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  }

  return (
    <div className="space-y-6">
      {/* Connected Banner */}
      {isConnected && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-card">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-emerald-800">Connected to Shopify</p>
            <p className="text-xs text-emerald-600">{settings!.store_url}</p>
          </div>
          <button
            onClick={() => setShowDisconnect(!showDisconnect)}
            className="text-xs text-content-secondary hover:text-red-600 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Credentials saved but not yet authorized */}
      {hasCredentials && !isConnected && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-card">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">Credentials saved — authorization needed</p>
            <p className="text-xs text-amber-600">Click "Authorize with Shopify" below to complete the connection.</p>
          </div>
        </div>
      )}

      {showDisconnect && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-card">
          <p className="text-sm text-red-700 mb-3">Are you sure? This will remove your Shopify credentials and disconnect the integration.</p>
          <div className="flex gap-2">
            <button onClick={handleDisconnect} className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-control hover:bg-red-700">
              Disconnect
            </button>
            <button onClick={() => setShowDisconnect(false)} className="px-3 py-1.5 text-sm border border-edge rounded-control hover:bg-surface-hover">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Form */}
      <div className="space-y-4">
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-content mb-1.5">
            <Store className="w-4 h-4" /> Store URL
          </label>
          <input
            type="text"
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
            placeholder="your-store.myshopify.com"
            className="w-full px-3 py-2 border border-edge rounded-control text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-content mb-1.5">
            <Key className="w-4 h-4" /> Client ID
          </label>
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Paste your Client ID from the Dev Dashboard"
            className="w-full px-3 py-2 border border-edge rounded-control text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-content mb-1.5">
            <Key className="w-4 h-4" /> Client Secret
          </label>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Paste your Client Secret from the Dev Dashboard"
            className="w-full px-3 py-2 border border-edge rounded-control text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
          <p className="text-xs text-content-muted mt-1">
            Both are found in your Shopify Dev Dashboard &rarr; Settings &rarr; Credentials
          </p>
        </div>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-control">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-control">
          <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-700">{success}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        {!isConnected && (
          <button
            onClick={handleSaveAndAuthorize}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-brand-fg text-sm font-medium rounded-control hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            Save & Authorize with Shopify
          </button>
        )}
        {isConnected && (
          <>
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-brand-fg text-sm font-medium rounded-control hover:bg-brand-700 disabled:opacity-50"
            >
              {testing && <Loader2 className="w-4 h-4 animate-spin" />}
              Test Connection
            </button>
            <button
              onClick={handleReauthorize}
              className="flex items-center gap-2 px-4 py-2 border border-edge text-content text-sm font-medium rounded-control hover:bg-surface-hover"
            >
              <ExternalLink className="w-4 h-4" /> Re-authorize
            </button>
          </>
        )}
      </div>
    </div>
  );
}
