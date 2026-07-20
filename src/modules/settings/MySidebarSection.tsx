import { useState } from 'react';
import { LayoutGrid, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { GATED_MODULES } from '../../lib/access';

// Personal nav declutter: hide modules from your OWN sidebar. Distinct
// from the admin "Members & rollout" controls, which govern what other
// members can see. Hiding here only affects this account — the module
// stays live for everyone else and remains reachable by direct URL.
export default function MySidebarSection() {
  const { hiddenModules, setModuleHidden, visibleModules } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Only offer toggles for modules the user can actually see — no point
  // listing areas that aren't entitled to this account anyway.
  const toggleable = GATED_MODULES.filter(m => visibleModules.has(m.key));

  async function toggle(key: string, hidden: boolean) {
    setBusyKey(key);
    setError(null);
    try {
      await setModuleHidden(key, hidden);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="bg-surface rounded-card border border-edge p-6 mb-6">
      <div className="flex items-center gap-3 mb-2">
        <LayoutGrid className="w-5 h-5 text-brand-600" />
        <h2 className="text-lg font-semibold text-content">My sidebar</h2>
      </div>
      <p className="text-sm text-content-secondary mb-5">
        Hide areas you don't use from your own navigation. This only affects your account — hidden
        areas stay available to everyone else and are still reachable by direct link.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-control p-3 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {toggleable.map(m => {
          const hidden = hiddenModules.has(m.key);
          return (
            <div key={m.key} className="flex items-center gap-2 border border-edge rounded-card px-3 py-2.5">
              <span className={`flex-1 text-sm font-medium truncate ${hidden ? 'text-content-muted' : 'text-content'}`}>
                {m.label}
              </span>
              <button
                onClick={() => toggle(m.key, !hidden)}
                disabled={busyKey === m.key}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-control border transition-colors disabled:opacity-50 ${
                  hidden
                    ? 'text-content-secondary bg-surface-hover border-edge hover:bg-surface-sunken'
                    : 'text-brand-700 bg-brand-50 border-brand-200 hover:bg-brand-100'
                }`}
                title={hidden ? 'Hidden from your sidebar' : 'Showing in your sidebar'}
              >
                {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {hidden ? 'Hidden' : 'Showing'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
