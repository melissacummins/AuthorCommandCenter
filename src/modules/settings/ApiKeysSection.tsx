import { useEffect, useState, type ComponentType } from 'react';
import { KeyRound, ImagePlus, Sparkles, Info, Loader2, Trash2, Check, AudioLines, Zap } from 'lucide-react';
import {
  getFalKeyStatus, setFalKey, removeFalKey,
  getOpenaiKeyStatus, setOpenaiKey, removeOpenaiKey,
  getIdeogramKeyStatus, setIdeogramKey, removeIdeogramKey,
} from '../media/lib/client';
import { getAnthropicKeyStatus, setAnthropicKey, removeAnthropicKey, plannerComplete } from '../planner/ai';
import { getElevenlabsKeyStatus, setElevenlabsKey, removeElevenlabsKey } from '../audiobook/lib/client';
import { getOpenrouterKeyStatus, setOpenrouterKey, removeOpenrouterKey } from '../writing/lib/ai';

// Shared status shape across every BYOK provider.
interface KeyStatus { has_key: boolean; hint: string | null; updated_at: string | null }

interface Provider {
  id: string;
  name: string;
  Icon: ComponentType<{ className?: string }>;
  iconColor: string;
  placeholder: string;
  minLength: number;
  validate?: (k: string) => string | null;
  helpUrl: string;
  helpLabel: string;
  description: string;
  getStatus: () => Promise<KeyStatus>;
  saveKey: (k: string) => Promise<KeyStatus>;
  removeKey: () => Promise<void>;
  onTest?: () => Promise<void>; // optional connectivity check (Claude)
}

const PROVIDERS: Provider[] = [
  {
    id: 'fal', name: 'Fal.AI', Icon: ImagePlus, iconColor: 'text-brand-600',
    placeholder: 'key_xxxx…', minLength: 16,
    helpUrl: 'https://fal.ai/dashboard/keys', helpLabel: 'Get a Fal key',
    description: 'Powers most media-generation models. Each generation is billed directly to your Fal account.',
    getStatus: getFalKeyStatus, saveKey: setFalKey, removeKey: removeFalKey,
  },
  {
    id: 'openai', name: 'OpenAI', Icon: ImagePlus, iconColor: 'text-emerald-600',
    placeholder: 'sk-proj-…  or  sk-…', minLength: 20,
    validate: k => k.startsWith('sk-') ? null : 'OpenAI keys start with "sk-".',
    helpUrl: 'https://platform.openai.com/api-keys', helpLabel: 'Get an OpenAI key',
    description: 'Optional. Routes GPT Image 2 directly to OpenAI instead of through Fal — about 3× cheaper.',
    getStatus: getOpenaiKeyStatus, saveKey: setOpenaiKey, removeKey: removeOpenaiKey,
  },
  {
    id: 'ideogram', name: 'Ideogram', Icon: ImagePlus, iconColor: 'text-brand-600',
    placeholder: 'Ideogram API key (40+ chars)', minLength: 20,
    helpUrl: 'https://ideogram.ai/manage-api', helpLabel: 'Get an Ideogram key',
    description: 'Optional. Routes Ideogram v3/v4 directly to Ideogram — unlocks the Turbo speed (~half Fal’s price) and the Quality tier Fal doesn’t expose.',
    getStatus: getIdeogramKeyStatus, saveKey: setIdeogramKey, removeKey: removeIdeogramKey,
  },
  {
    id: 'anthropic', name: 'Claude (AI)', Icon: Sparkles, iconColor: 'text-brand-600',
    placeholder: 'sk-ant-…', minLength: 20,
    validate: k => k.startsWith('sk-ant-') ? null : 'Anthropic keys start with "sk-ant-".',
    helpUrl: 'https://console.anthropic.com/settings/keys', helpLabel: 'Get an Anthropic key',
    description: 'Powers the planner’s AI assists (Suggest my day, Triage, Orbit picks). Billed to your own Anthropic account.',
    getStatus: getAnthropicKeyStatus, saveKey: setAnthropicKey, removeKey: removeAnthropicKey,
    onTest: async () => { await plannerComplete({ prompt: 'Reply with the single word: ok', maxTokens: 16 }); },
  },
  {
    id: 'elevenlabs', name: 'ElevenLabs', Icon: AudioLines, iconColor: 'text-brand-600',
    placeholder: 'ElevenLabs API key', minLength: 20,
    helpUrl: 'https://elevenlabs.io/app/settings/api-keys', helpLabel: 'Get an ElevenLabs key',
    description: 'Powers the Audiobook module — voice creation, cloning, and multi-voice narration. Billed to your own ElevenLabs account.',
    getStatus: getElevenlabsKeyStatus, saveKey: setElevenlabsKey, removeKey: removeElevenlabsKey,
  },
  {
    id: 'openrouter', name: 'OpenRouter', Icon: Zap, iconColor: 'text-brand-600',
    placeholder: 'sk-or-…', minLength: 20,
    validate: k => k.startsWith('sk-or-') ? null : 'OpenRouter keys start with "sk-or-".',
    helpUrl: 'https://openrouter.ai/keys', helpLabel: 'Get an OpenRouter key',
    description: 'Optional second AI provider for the Writing module — one key unlocks any model OpenRouter hosts, not just Claude. Billed to your own OpenRouter account.',
    getStatus: getOpenrouterKeyStatus, saveKey: setOpenrouterKey, removeKey: removeOpenrouterKey,
  },
];

function InfoTip({ text, href, label }: { text: string; href: string; label: string }) {
  return (
    <span className="relative group shrink-0">
      <Info className="w-4 h-4 text-content-faint hover:text-content-secondary cursor-help" />
      <span className="pointer-events-none group-hover:pointer-events-auto opacity-0 group-hover:opacity-100 transition-opacity absolute right-0 top-6 z-20 w-72 rounded-control border border-edge bg-surface p-3 text-xs leading-relaxed text-content-secondary shadow-lg">
        {text}{' '}
        <a href={href} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline whitespace-nowrap">{label} →</a>
        <span className="block mt-1.5 text-content-muted">Encrypted server-side; never shown again after you save it.</span>
      </span>
    </span>
  );
}

function KeyRow({ p }: { p: Provider }) {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<'idle' | 'run' | 'ok' | 'err'>('idle');

  useEffect(() => {
    let cancelled = false;
    p.getStatus()
      .then(s => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setStatus({ has_key: false, hint: null, updated_at: null }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [p]);

  async function save() {
    const trimmed = raw.trim();
    const msg = p.validate?.(trimmed);
    if (msg) { setError(msg); return; }
    setBusy(true); setError(null); setTest('idle');
    try { setStatus(await p.saveKey(trimmed)); setRaw(''); }
    catch (e) { setError((e as Error)?.message ?? 'Failed to save key.'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(`Remove your stored ${p.name} key? You'll need to paste it again to use it.`)) return;
    setBusy(true); setError(null); setTest('idle');
    try { await p.removeKey(); setStatus({ has_key: false, hint: null, updated_at: null }); }
    catch (e) { setError((e as Error)?.message ?? 'Failed to remove key.'); }
    finally { setBusy(false); }
  }

  async function runTest() {
    if (!p.onTest) return;
    setTest('run'); setError(null);
    try { await p.onTest(); setTest('ok'); }
    catch (e) { setTest('err'); setError((e as Error)?.message ?? 'Test failed.'); }
  }

  const connected = !!status?.has_key;

  return (
    <div className="border-t border-edge-soft py-3 first:border-t-0">
      <div className="flex items-center gap-3 flex-wrap">
        <p.Icon className={`w-4 h-4 shrink-0 ${p.iconColor}`} />
        <span className="text-sm font-medium text-content w-28 shrink-0">{p.name}</span>

        {loading ? (
          <span className="text-sm text-content-muted">Checking…</span>
        ) : connected ? (
          <span className="flex items-center gap-1.5 text-sm text-content-secondary">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            ••• <span className="font-mono text-content-secondary">{status?.hint}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-content-muted">
            <span className="w-2 h-2 rounded-full bg-edge-strong shrink-0" /> Not connected
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {!loading && connected && (
            <>
              {p.onTest && (
                <button onClick={runTest} disabled={test === 'run'}
                  className="text-xs font-medium text-content-secondary hover:text-brand-600 disabled:opacity-50 inline-flex items-center gap-1">
                  {test === 'run' ? <Loader2 className="w-3 h-3 animate-spin" /> : test === 'ok' ? <Check className="w-3 h-3 text-emerald-600" /> : null}
                  {test === 'ok' ? 'Working' : test === 'run' ? 'Testing…' : 'Test'}
                </button>
              )}
              <button onClick={remove} disabled={busy}
                className="inline-flex items-center gap-1 text-xs font-medium text-content-muted hover:text-rose-600 disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            </>
          )}
          {!loading && !connected && (
            <>
              <input
                type="password" value={raw} onChange={e => setRaw(e.target.value)}
                placeholder={p.placeholder} autoComplete="off"
                onKeyDown={e => { if (e.key === 'Enter' && raw.trim().length >= p.minLength) save(); }}
                className="w-44 sm:w-56 px-2.5 py-1.5 border border-edge-strong rounded-control text-sm font-mono"
              />
              <button onClick={save} disabled={busy || raw.trim().length < p.minLength}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-brand-fg font-medium rounded-control bg-brand-600 hover:bg-brand-700 disabled:opacity-50">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
              </button>
            </>
          )}
          <InfoTip text={p.description} href={p.helpUrl} label={p.helpLabel} />
        </div>
      </div>
      {error && <p className="text-xs text-rose-600 mt-1.5 ml-7">{error}</p>}
    </div>
  );
}

// One home for every per-user (BYOK) API key. Compact rows so the list stays
// short as providers are added. Shopify/Pinterest still live in their own
// modules because they're OAuth flows with extra setup UI.
export default function ApiKeysSection() {
  return (
    <section className="bg-surface rounded-card border border-edge p-6 mb-6">
      <div className="flex items-center gap-3 mb-1.5">
        <KeyRound className="w-5 h-5 text-brand-600" />
        <h2 className="text-lg font-semibold text-content">API Keys</h2>
      </div>
      <p className="text-sm text-content-secondary mb-3">
        Your own keys for the integrations that need them. Each is stored encrypted server-side and billed to your own account. Hover the ⓘ for what each one unlocks.
      </p>
      <div>
        {PROVIDERS.map(p => <KeyRow key={p.id} p={p} />)}
      </div>
    </section>
  );
}
