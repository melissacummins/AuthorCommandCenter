import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from '../../../components/Modal';
import { useAuth } from '../../../contexts/AuthContext';
import { TRANSLATION_LANGUAGES } from '../types';
import { getPipelinePrefs, savePipelinePrefs } from '../../../lib/dashboard';
import {
  DEFAULT_PIPELINE_PREFS,
  type PipelinePrefs,
  type PipelineTypeToggles,
} from '../../../lib/opportunities';

// Global config for the Catalog pipeline / opportunity engine: which
// translation languages to propose and which whole suggestion types are on.
// Persists to user_ui_preferences.pipeline_prefs and feeds both the per-book
// checklist and the Home opportunities widget. Opened from the pipeline's
// "Options" button.

const TYPE_ROWS: { key: keyof PipelineTypeToggles; label: string; hint: string }[] = [
  { key: 'translation', label: 'Translations', hint: 'Suggest translating into the languages below.' },
  { key: 'audiobook', label: 'Audiobook', hint: 'Suggest making the audiobook when there isn’t one.' },
  { key: 'paperback', label: 'Paperback price', hint: 'Flag published books with no paperback price.' },
  { key: 'hardcover', label: 'Hardcover price', hint: 'Flag published books with no hardcover price.' },
  { key: 'kdp', label: 'Amazon keywords', hint: 'Flag published books with no Amazon keywords.' },
  { key: 'arc', label: 'ARC applications', hint: 'Nudge recent releases not taking ARC applications.' },
];

export default function PipelineOptions({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<PipelinePrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current prefs whenever the modal opens.
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    setPrefs(null);
    setError(null);
    getPipelinePrefs(user.id)
      .then(p => { if (!cancelled) setPrefs(p); })
      .catch(() => { if (!cancelled) setPrefs(DEFAULT_PIPELINE_PREFS); });
    return () => { cancelled = true; };
  }, [open, user]);

  function toggleType(key: keyof PipelineTypeToggles) {
    setPrefs(p => (p ? { ...p, types: { ...p.types, [key]: !p.types[key] } } : p));
  }

  function toggleLanguage(code: string) {
    setPrefs(p => {
      if (!p) return p;
      const has = p.translationLanguages.includes(code);
      const languages = has
        ? p.translationLanguages.filter(c => c !== code)
        : [...p.translationLanguages, code];
      return { ...p, translationLanguages: languages };
    });
  }

  async function handleSave() {
    if (!user || !prefs) return;
    setSaving(true);
    setError(null);
    try {
      await savePipelinePrefs(user.id, prefs);
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const langsDisabled = !prefs?.types.translation;

  return (
    <Modal open={open} onClose={onClose} title="Pipeline options">
      {!prefs ? (
        <p className="text-sm text-content-muted flex items-center gap-2 py-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-content-secondary">
            Choose what the pipeline suggests across every book. These settings apply
            everywhere the pipeline shows — each book’s checklist and the Home dashboard.
          </p>

          {/* Suggestion types */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-content-secondary mb-2">
              Suggestion types
            </h4>
            <ul className="divide-y divide-edge-soft rounded-card border border-edge">
              {TYPE_ROWS.map(row => (
                <li key={row.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-content">{row.label}</div>
                    <div className="text-xs text-content-muted">{row.hint}</div>
                  </div>
                  <Toggle checked={prefs.types[row.key]} onChange={() => toggleType(row.key)} label={row.label} />
                </li>
              ))}
            </ul>
          </div>

          {/* Translation languages */}
          <div className={langsDisabled ? 'opacity-50 pointer-events-none' : ''}>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-content-secondary mb-2">
              Translation languages
            </h4>
            <p className="text-xs text-content-muted mb-2">
              Only checked languages are ever suggested.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {TRANSLATION_LANGUAGES.map(({ code, label }) => {
                const checked = prefs.translationLanguages.includes(code);
                return (
                  <label
                    key={code}
                    className="flex items-center gap-2 text-sm text-content px-2 py-1.5 rounded-control hover:bg-surface-hover cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleLanguage(code)}
                      className="rounded border-edge-strong text-brand-600 focus:ring-brand-500"
                    />
                    {label}
                  </label>
                );
              })}
            </div>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-edge">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-hover rounded-control disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-brand-fg bg-brand-600 hover:bg-brand-500 rounded-control disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-brand-600' : 'bg-surface-sunken border border-edge-strong'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
