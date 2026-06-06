import { useEffect, useState } from 'react';
import { ImagePlus, AlertCircle, CheckCircle, Loader2, Trash2, Key } from 'lucide-react';
import {
  getFalKeyStatus, setFalKey, removeFalKey,
  getOpenaiKeyStatus, setOpenaiKey, removeOpenaiKey,
  getIdeogramKeyStatus, setIdeogramKey, removeIdeogramKey,
} from '../media/lib/client';
import type { FalKeyStatus } from '../media/lib/client';

interface KeyCardProps {
  title: string;
  iconColor: string;
  description: string;
  placeholder: string;
  helpUrl: string;
  helpUrlLabel: string;
  buttonColor: string;
  minLength: number;
  validate?: (raw: string) => string | null;
  getStatus: () => Promise<FalKeyStatus>;
  saveKey: (k: string) => Promise<FalKeyStatus>;
  removeKey: () => Promise<void>;
}

function KeyCard(props: KeyCardProps) {
  const [status, setStatus] = useState<FalKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [rawKey, setRawKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    props.getStatus()
      .then(s => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setStatus({ has_key: false, hint: null, updated_at: null }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [props]);

  async function handleSave() {
    setError(null); setSaved(false);
    const trimmed = rawKey.trim();
    if (props.validate) {
      const msg = props.validate(trimmed);
      if (msg) { setError(msg); return; }
    }
    setSaving(true);
    try {
      const next = await props.saveKey(trimmed);
      setStatus(next);
      setRawKey('');
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm(`Remove your stored ${props.title} key? You will need to paste it again to use it.`)) return;
    setRemoving(true); setError(null);
    try {
      await props.removeKey();
      setStatus({ has_key: false, hint: null, updated_at: null });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="border-t border-slate-100 pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2 mb-2">
        <ImagePlus className={`w-4 h-4 ${props.iconColor}`} />
        <h3 className="font-semibold text-slate-800">{props.title}</h3>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        {props.description}{' '}
        <a href={props.helpUrl} target="_blank" rel="noreferrer" className="text-fuchsia-600 hover:text-fuchsia-700 underline">
          {props.helpUrlLabel}
        </a>
        . Encrypted server-side and never sent to the browser after you save it.
      </p>

      {loading ? (
        <div className="text-sm text-slate-500">Checking key status…</div>
      ) : status?.has_key ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>
              Key saved. Ends in <span className="font-mono">{status.hint}</span>
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
            <span>Paste the full key — it gets encrypted with AES-256-GCM before storage.</span>
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={rawKey}
              onChange={e => setRawKey(e.target.value)}
              placeholder={props.placeholder}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
              autoComplete="off"
            />
            <button
              onClick={handleSave}
              disabled={saving || rawKey.trim().length < props.minLength}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm text-white font-medium rounded-lg disabled:opacity-50 ${props.buttonColor}`}
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Saving…' : 'Save key'}
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
    </div>
  );
}

// Both image-generation provider keys live here so they're in one
// predictable place. Klaviyo is a separate card on this same page.
// Shopify and Pinterest still configure in their own modules because
// they're OAuth flows with extra setup UI.
export default function MediaApiKeysSection() {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
      <div className="flex items-center gap-3 mb-2">
        <ImagePlus className="w-5 h-5 text-fuchsia-600" />
        <h2 className="text-lg font-semibold text-slate-800">Media generator keys</h2>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        Used by the Media module to generate Pinterest pins, new release art, and short video clips. Add at least a Fal.AI key to use the full catalogue; an OpenAI key makes GPT Image 1 ~3× cheaper by routing it directly instead of through Fal.
      </p>

      <div className="space-y-5">
        <KeyCard
          title="Fal.AI API key"
          iconColor="text-fuchsia-600"
          description="Required for all media generation models except GPT Image 1 if you have an OpenAI key. Each generation is billed directly to your Fal account."
          placeholder="key_xxxx…  or  xxxxxxxx:xxxxxxxx…"
          helpUrl="https://fal.ai/dashboard/keys"
          helpUrlLabel="Get a key from Fal"
          buttonColor="bg-fuchsia-600 hover:bg-fuchsia-700"
          minLength={16}
          getStatus={getFalKeyStatus}
          saveKey={setFalKey}
          removeKey={removeFalKey}
        />

        <KeyCard
          title="OpenAI API key — for GPT Image 2"
          iconColor="text-emerald-600"
          description="Optional but recommended. When set, GPT Image 2 calls go directly to OpenAI instead of through Fal — roughly 3× cheaper. Other models keep using Fal."
          placeholder="sk-proj-…  or  sk-…"
          helpUrl="https://platform.openai.com/api-keys"
          helpUrlLabel="Get a key from OpenAI"
          buttonColor="bg-emerald-600 hover:bg-emerald-700"
          minLength={20}
          validate={(k) => k.startsWith('sk-') ? null : 'OpenAI keys start with "sk-".'}
          getStatus={getOpenaiKeyStatus}
          saveKey={setOpenaiKey}
          removeKey={removeOpenaiKey}
        />

        <KeyCard
          title="Ideogram API key — for Ideogram v3"
          iconColor="text-indigo-600"
          description="Optional. When set, Ideogram v3 generate and edit go directly to Ideogram instead of through Fal. Unlocks the Turbo rendering speed (~$0.03/image, about half what Fal charges) and the Quality tier Fal doesn't expose."
          placeholder="Ideogram API key (40+ chars)"
          helpUrl="https://ideogram.ai/manage-api"
          helpUrlLabel="Get a key from Ideogram"
          buttonColor="bg-indigo-600 hover:bg-indigo-700"
          minLength={20}
          getStatus={getIdeogramKeyStatus}
          saveKey={setIdeogramKey}
          removeKey={removeIdeogramKey}
        />
      </div>
    </section>
  );
}
