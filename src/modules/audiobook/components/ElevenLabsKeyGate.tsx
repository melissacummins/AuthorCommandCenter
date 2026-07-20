import { useEffect, useState } from 'react';
import { KeyRound, Loader2, ExternalLink } from 'lucide-react';
import { getElevenlabsKeyStatus, setElevenlabsKey } from '../lib/client';

// Wraps the module: until the user has an ElevenLabs key on file, the audiobook
// tools are hidden behind a compact connect card (they can paste the key right
// here or manage it in Settings → API Keys).
export default function ElevenLabsKeyGate({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getElevenlabsKeyStatus()
      .then(s => { if (!cancelled) setConnected(s.has_key); })
      .catch(() => { if (!cancelled) setConnected(false); });
    return () => { cancelled = true; };
  }, []);

  async function save() {
    const key = raw.trim();
    if (key.length < 20) { setError('Paste the full ElevenLabs API key.'); return; }
    setBusy(true); setError(null);
    try { await setElevenlabsKey(key); setConnected(true); setRaw(''); }
    catch (e) { setError((e as Error)?.message ?? 'Failed to save key.'); }
    finally { setBusy(false); }
  }

  if (connected === null) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
      </div>
    );
  }

  if (connected) return <>{children}</>;

  return (
    <div className="max-w-xl mx-auto mt-10 bg-surface rounded-card border border-edge p-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-card bg-gradient-to-br from-brand-500 to-brand-600 shadow shadow-brand-500/25">
          <KeyRound className="w-5 h-5 text-white" />
        </div>
        <h2 className="text-lg font-semibold text-content">Connect ElevenLabs</h2>
      </div>
      <p className="text-sm text-content-secondary mb-4">
        Paste your ElevenLabs API key to start building audiobooks. It's encrypted server-side and every
        generation is billed to your own ElevenLabs account. AI speaker-tagging also needs your Claude key
        (add it in <span className="font-medium text-content-secondary">Settings → API Keys</span>).
      </p>
      <div className="flex items-center gap-2">
        <input
          type="password" value={raw} onChange={e => setRaw(e.target.value)}
          placeholder="ElevenLabs API key" autoComplete="off"
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          className="flex-1 px-3 py-2 border border-edge-strong rounded-control text-sm font-mono"
        />
        <button onClick={save} disabled={busy || raw.trim().length < 20}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-brand-fg font-medium rounded-control bg-brand-600 hover:bg-brand-700 disabled:opacity-50">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
      </div>
      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
      <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline mt-3">
        Get an ElevenLabs API key <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}
