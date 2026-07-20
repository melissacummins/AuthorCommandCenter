import { Check, Palette } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

// Theme picker (redesign directive §5.3): swatch cards that apply instantly.
// The choice persists per browser (localStorage) and only affects this
// device — Classic light stays the default everywhere until you change it.

export default function ThemeSection() {
  const { theme, themes, setTheme } = useTheme();

  return (
    <section className="bg-surface rounded-card border border-edge p-6 mb-6">
      <div className="flex items-center gap-3 mb-2">
        <Palette className="w-5 h-5 text-brand-600" />
        <h2 className="text-lg font-semibold text-content">Theme</h2>
      </div>
      <p className="text-sm text-content-secondary mb-5">
        Restyle the whole Command Center. Applies instantly and is remembered on this device.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {themes.map(t => {
          const selected = t.id === theme;
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`group relative text-left rounded-card border p-3 transition-all
                ${selected ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-edge hover:border-edge-strong'}`}
              style={{ backgroundColor: t.swatch.surface }}
              title={t.label}
            >
              {/* Mini preview: sidebar strip + accent dot on the theme's surface. */}
              <div className="flex items-center gap-2 mb-2">
                <span className="w-3 h-8 rounded-sm shrink-0" style={{ backgroundColor: t.swatch.sidebar }} />
                <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: t.swatch.accent }} />
                <span className="flex-1 h-1.5 rounded-full opacity-30" style={{ backgroundColor: t.swatch.accent }} />
              </div>
              <span className={`text-xs font-medium ${t.dark ? 'text-white/90' : 'text-black/80'}`}>
                {t.label}
              </span>
              {selected && (
                <span className="absolute top-2 right-2 inline-flex items-center justify-center w-4.5 h-4.5 rounded-full bg-brand-500 text-white">
                  <Check className="w-3 h-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
