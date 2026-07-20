import { useEffect, useMemo, useState } from 'react';
import { Loader2, Paintbrush, Check, RotateCcw } from 'lucide-react';
import { getWidgetSettings, saveWidgetSettings } from '../api';
import { DEFAULT_WIDGET_SETTINGS } from '../types';
import type { UpsellOffer, WidgetSettings } from '../types';

interface PreviewItem {
  title: string;
  image: string | null;
  price: number;
  wasPrice: number | null;
  checked: boolean;
  locked?: boolean;
}

// Fallback preview content for accounts with no offers yet.
const SAMPLE_ITEMS: PreviewItem[] = [
  { title: 'Night Shade Ebook', image: null, price: 4.99, wasPrice: null, checked: true },
  { title: 'Night Fury Audiobook', image: null, price: 14.99, wasPrice: 19.99, checked: true },
];

interface Props {
  offers: UpsellOffer[];
}

export default function WidgetDesignTab({ offers }: Props) {
  const [settings, setSettings] = useState<WidgetSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [previewModal, setPreviewModal] = useState<PreviewItem | null>(null);

  useEffect(() => {
    getWidgetSettings()
      .then(setSettings)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
        setSettings({ ...DEFAULT_WIDGET_SETTINGS });
      });
  }, []);

  // Preview with the user's own products where possible — the first live
  // offer that has add-ons (bundle-style preferred, it shows more).
  const preview = useMemo(() => {
    const offer = offers.find(o => o.enabled && o.addons.length > 0 && o.discount_includes_trigger)
      || offers.find(o => o.enabled && o.addons.length > 0)
      || offers.find(o => o.addons.length > 0);
    if (!offer) {
      return { heading: 'Get the complete collection', dealText: 'Save 15% when you bundle', items: SAMPLE_ITEMS };
    }
    const pct = offer.discount_enabled && offer.discount_type === 'percentage' ? offer.discount_value : 0;
    const items: PreviewItem[] = [];
    if (offer.discount_includes_trigger) {
      const base = 19.99;
      items.push({
        title: offer.product_title,
        image: offer.product_image,
        price: pct ? base * (1 - pct / 100) : base,
        wasPrice: pct ? base : null,
        checked: true,
        locked: true,
      });
    }
    for (const a of offer.addons.slice(0, 3)) {
      const base = parseFloat(a.price) || 9.99;
      items.push({
        title: a.label || a.title,
        image: a.image,
        price: pct ? base * (1 - pct / 100) : base,
        wasPrice: pct ? base : null,
        checked: offer.discount_includes_trigger,
      });
    }
    return { heading: offer.heading || 'Add to your order', dealText: offer.discount_text, items };
  }, [offers]);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await saveWidgetSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
      </div>
    );
  }

  const set = (patch: Partial<WidgetSettings>) => setSettings({ ...settings, ...patch });
  const money = (n: number) => `$${n.toFixed(2)}`;
  const total = preview.items.filter(i => i.checked).reduce((sum, i) => sum + i.price, 0);
  const wasTotal = preview.items.filter(i => i.checked).reduce((sum, i) => sum + (i.wasPrice ?? i.price), 0);
  const btnBg = settings.button_bg || '#414141';
  const btnText = settings.button_text || '#ffffff';

  return (
    <div className="grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-6 items-start">
      {/* Controls */}
      <div className="bg-surface rounded-card border border-edge p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Paintbrush className="w-4 h-4 text-brand-600" />
          <h3 className="font-semibold text-content">Widget design</h3>
        </div>
        <p className="text-xs text-content-secondary -mt-3">
          Saving applies to your live store immediately — no need to touch the theme code.
        </p>

        <div>
          <label className="block text-xs font-medium text-content-secondary mb-1.5">Add to cart button</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={settings.button_bg || '#414141'}
              onChange={e => set({ button_bg: e.target.value })}
              className="w-9 h-9 rounded-control border border-edge cursor-pointer"
              title="Button color"
            />
            <input
              type="color"
              value={settings.button_text || '#ffffff'}
              onChange={e => set({ button_text: e.target.value })}
              className="w-9 h-9 rounded-control border border-edge cursor-pointer"
              title="Button text color"
            />
            <input
              type="text"
              value={settings.button_label}
              onChange={e => set({ button_label: e.target.value })}
              placeholder="Add to cart"
              className="flex-1 px-3 py-2 border border-edge rounded-control text-sm"
            />
          </div>
          {(settings.button_bg || settings.button_text) && (
            <button
              onClick={() => set({ button_bg: '', button_text: '' })}
              className="mt-1.5 flex items-center gap-1 text-xs text-content-secondary hover:text-content"
            >
              <RotateCcw className="w-3 h-3" /> Use my theme&rsquo;s button colors
            </button>
          )}
          {!settings.button_bg && !settings.button_text && (
            <p className="mt-1.5 text-xs text-content-muted">
              Currently using your theme&rsquo;s own button colors (preview shows a placeholder).
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-content-secondary mb-1.5">Total line label</label>
          <input
            type="text"
            value={settings.total_label}
            onChange={e => set({ total_label: e.target.value })}
            placeholder="Total price"
            className="w-full px-3 py-2 border border-edge rounded-control text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-content-secondary mb-1.5">
            Corner roundness <span className="text-content-muted">({settings.radius}px)</span>
          </label>
          <input
            type="range"
            min={0}
            max={24}
            value={settings.radius}
            onChange={e => set({ radius: Number(e.target.value) })}
            className="w-full accent-brand-600"
          />
        </div>

        <label className="flex items-center gap-2.5 text-sm text-content cursor-pointer">
          <input
            type="checkbox"
            checked={settings.show_plus}
            onChange={e => set({ show_plus: e.target.checked })}
            className="w-4 h-4 rounded border-edge-strong text-brand-600"
          />
          Show &ldquo;+&rdquo; between products
        </label>

        <label className="flex items-center gap-2.5 text-sm text-content cursor-pointer">
          <input
            type="checkbox"
            checked={settings.popup}
            onChange={e => set({ popup: e.target.checked })}
            className="w-4 h-4 rounded border-edge-strong text-brand-600"
          />
          Pop-up product preview on click
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 text-brand-fg text-sm font-medium rounded-control hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
          {saving ? 'Saving…' : saved ? 'Live on your store' : 'Save & apply to store'}
        </button>
      </div>

      {/* Live preview */}
      <div className="bg-surface rounded-card border border-edge p-5">
        <p className="text-xs text-content-muted mb-4">
          Preview{offers.length > 0 ? ' (using your own offer)' : ''} — fonts and exact prices come
          from your theme on the real store.
        </p>
        <div className="max-w-md">
          <h3 className="text-lg font-semibold text-content mb-0.5">{preview.heading}</h3>
          {preview.dealText && <p className="text-sm text-content-secondary mb-3.5">{preview.dealText}</p>}

          {preview.items.map((item, i) => (
            <div key={i}>
              {i > 0 && settings.show_plus && (
                <div className="text-center leading-tight text-content-muted">+</div>
              )}
              <div
                className="flex items-center gap-2.5 px-2.5 py-2 border border-edge-strong/70"
                style={{ borderRadius: settings.radius }}
              >
                <input type="checkbox" checked={item.checked} disabled={item.locked} readOnly className="w-[18px] h-[18px] shrink-0" />
                {item.image
                  ? <img src={item.image} alt="" className="w-[56px] h-[56px] object-contain shrink-0" />
                  : <div className="w-[56px] h-[56px] bg-surface-sunken rounded shrink-0" />}
                <div className="flex-1 min-w-0">
                  {settings.popup && !item.locked ? (
                    <button
                      onClick={() => setPreviewModal(item)}
                      className="block text-left font-medium text-content hover:underline leading-snug"
                    >
                      {item.title}
                    </button>
                  ) : (
                    <span className="block font-medium text-content leading-snug">{item.title}</span>
                  )}
                  <span className="text-sm text-content">
                    <strong>{money(item.price)}</strong>
                    {item.wasPrice && <s className="opacity-55 ml-1.5">{money(item.wasPrice)}</s>}
                  </span>
                </div>
              </div>
            </div>
          ))}

          <div className="flex items-baseline gap-2.5 mt-4 mb-2.5 text-content">
            <span>{settings.total_label || 'Total price'}</span>
            <strong>{money(total)}</strong>
            {wasTotal > total && <s className="opacity-55 text-sm">{money(wasTotal)}</s>}
          </div>
          <button
            className="w-full py-3.5 px-5 text-base cursor-pointer"
            style={{ background: btnBg, color: btnText, borderRadius: settings.radius }}
          >
            {settings.button_label || 'Add to cart'}
          </button>
        </div>

        {/* Pop-up preview */}
        {previewModal && settings.popup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/55" onClick={() => setPreviewModal(null)} />
            <div className="relative bg-surface text-content rounded-card max-w-md w-[calc(100%-32px)] max-h-[84vh] overflow-y-auto p-7">
              <button
                onClick={() => setPreviewModal(null)}
                className="absolute top-2 right-3 text-2xl leading-none text-content-secondary hover:text-content"
                aria-label="Close"
              >
                &times;
              </button>
              {previewModal.image
                ? <img src={previewModal.image} alt="" className="block max-w-[280px] w-full mx-auto mb-3.5" />
                : <div className="max-w-[280px] w-full h-48 mx-auto mb-3.5 bg-surface-sunken rounded" />}
              <h4 className="text-lg font-semibold mb-1">{previewModal.title}</h4>
              <p className="mb-3">
                <strong>{money(previewModal.price)}</strong>
                {previewModal.wasPrice && <s className="opacity-55 ml-1.5">{money(previewModal.wasPrice)}</s>}
              </p>
              <p className="text-sm text-content-secondary">
                On your store this shows the product&rsquo;s full description, and shoppers can
                flip through all of its photos.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
