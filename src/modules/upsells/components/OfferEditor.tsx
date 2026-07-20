import { useMemo, useState } from 'react';
import { Search, Trash2, ChevronUp, ChevronDown, Loader2, AlertCircle, Plus, BadgePercent } from 'lucide-react';
import Modal from '../../../components/Modal';
import { saveOffer } from '../api';
import type { CatalogProduct, CatalogVariant, DiscountType, UpsellAddon, UpsellOffer } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  catalog: CatalogProduct[];
  existing: UpsellOffer | null;
  // Product ids that already have an offer (so a second offer can't be
  // created for the same product — the metafield is one-per-product).
  takenProductIds: Set<string>;
  onSaved: () => void;
}

function formatPrice(price: string): string {
  const n = parseFloat(price);
  return isNaN(n) ? price : `$${n.toFixed(2)}`;
}

export default function OfferEditor({ open, onClose, catalog, existing, takenProductIds, onSaved }: Props) {
  const [trigger, setTrigger] = useState<CatalogProduct | null>(null);
  const [heading, setHeading] = useState(existing?.heading ?? 'Add to your order');
  const [addons, setAddons] = useState<UpsellAddon[]>(existing?.addons ?? []);
  const [discountEnabled, setDiscountEnabled] = useState(existing?.discount_enabled ?? false);
  const [discountType, setDiscountType] = useState<DiscountType>(existing?.discount_type ?? 'percentage');
  const [discountValue, setDiscountValue] = useState(existing?.discount_value ? String(existing.discount_value) : '');
  const [discountText, setDiscountText] = useState(existing?.discount_text ?? '');
  const [includesTrigger, setIncludesTrigger] = useState(existing?.discount_includes_trigger ?? false);
  const [combinesProduct, setCombinesProduct] = useState(existing?.discount_combines_product ?? false);
  const [combinesOrder, setCombinesOrder] = useState(existing?.discount_combines_order ?? false);
  const [combinesShipping, setCombinesShipping] = useState(existing?.discount_combines_shipping ?? false);
  const [triggerQuery, setTriggerQuery] = useState('');
  const [addonQuery, setAddonQuery] = useState('');
  const [expandedProduct, setExpandedProduct] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const triggerProductId = existing?.shopify_product_id ?? (trigger ? String(trigger.id) : null);
  const triggerTitle = existing?.product_title ?? trigger?.title ?? null;
  const triggerImage = existing?.product_image ?? trigger?.image?.src ?? null;

  const triggerMatches = useMemo(() => {
    if (!triggerQuery.trim()) return [];
    const q = triggerQuery.trim().toLowerCase();
    return catalog
      .filter(p => p.title.toLowerCase().includes(q) && !takenProductIds.has(String(p.id)))
      .slice(0, 8);
  }, [catalog, triggerQuery, takenProductIds]);

  const addonMatches = useMemo(() => {
    if (!addonQuery.trim()) return [];
    const q = addonQuery.trim().toLowerCase();
    const usedVariants = new Set(addons.map(a => a.variant_id));
    return catalog
      .filter(p =>
        p.title.toLowerCase().includes(q) &&
        String(p.id) !== triggerProductId &&
        p.variants.some(v => !usedVariants.has(v.id)))
      .slice(0, 8);
  }, [catalog, addonQuery, addons, triggerProductId]);

  function addAddon(product: CatalogProduct, variant: CatalogVariant) {
    setAddons(prev => [...prev, {
      variant_id: variant.id,
      product_id: product.id,
      handle: product.handle,
      label: '',
      title: product.title,
      variant_title: variant.title === 'Default Title' ? '' : variant.title,
      price: variant.price,
      image: product.image?.src ?? null,
    }]);
    setAddonQuery('');
    setExpandedProduct(null);
  }

  function pickAddonProduct(product: CatalogProduct) {
    const usedVariants = new Set(addons.map(a => a.variant_id));
    const free = product.variants.filter(v => !usedVariants.has(v.id));
    if (free.length === 1) {
      addAddon(product, free[0]);
    } else {
      setExpandedProduct(expandedProduct === product.id ? null : product.id);
    }
  }

  function move(index: number, dir: -1 | 1) {
    setAddons(prev => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSave() {
    if (!triggerProductId) { setError('Pick the product this offer appears on.'); return; }
    if (addons.length === 0) { setError('Add at least one add-on.'); return; }
    const parsedDiscount = parseFloat(discountValue) || 0;
    if (discountEnabled && parsedDiscount <= 0) { setError('Enter a discount value greater than zero.'); return; }
    if (discountEnabled && discountType === 'percentage' && parsedDiscount > 100) { setError('Percentage discount can\'t exceed 100.'); return; }
    setError('');
    setSaving(true);
    try {
      const triggerHandle = existing?.product_handle
        ?? trigger?.handle
        ?? catalog.find(p => String(p.id) === triggerProductId)?.handle
        ?? '';
      await saveOffer({
        shopify_product_id: triggerProductId,
        product_title: triggerTitle ?? '',
        product_handle: triggerHandle,
        product_image: triggerImage,
        heading: heading.trim() || 'Add to your order',
        enabled: existing?.enabled ?? true,
        addons,
        discount_enabled: discountEnabled,
        discount_type: discountType,
        discount_value: parsedDiscount,
        discount_text: discountText.trim(),
        discount_includes_trigger: includesTrigger,
        discount_combines_product: combinesProduct,
        discount_combines_order: combinesOrder,
        discount_combines_shipping: combinesShipping,
        discount_gid: existing?.discount_gid ?? null,
      });
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save offer');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit offer' : 'New offer'} maxWidth="max-w-2xl">
      <div className="space-y-5">
        {/* Trigger product */}
        <div>
          <label className="block text-sm font-medium text-content mb-1.5">Shows on product page</label>
          {triggerProductId ? (
            <div className="flex items-center gap-3 p-3 bg-surface-hover border border-edge rounded-card">
              {triggerImage
                ? <img src={triggerImage} alt="" className="w-10 h-10 rounded-control object-cover" />
                : <div className="w-10 h-10 rounded-control bg-edge" />}
              <span className="text-sm font-medium text-content flex-1">{triggerTitle}</span>
              {!existing && (
                <button onClick={() => { setTrigger(null); setTriggerQuery(''); }} className="text-xs text-content-secondary hover:text-red-600">
                  Change
                </button>
              )}
            </div>
          ) : (
            <div className="relative">
              <Search className="w-4 h-4 text-content-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={triggerQuery}
                onChange={e => setTriggerQuery(e.target.value)}
                placeholder="Search your products…"
                className="w-full pl-9 pr-3 py-2 border border-edge rounded-control text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                autoFocus
              />
              {triggerMatches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-surface border border-edge rounded-card shadow-lg overflow-hidden">
                  {triggerMatches.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setTrigger(p); setTriggerQuery(''); }}
                      className="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-surface-hover"
                    >
                      {p.image?.src
                        ? <img src={p.image.src} alt="" className="w-8 h-8 rounded object-cover" />
                        : <div className="w-8 h-8 rounded bg-edge" />}
                      <span className="text-sm text-content">{p.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Heading */}
        <div>
          <label className="block text-sm font-medium text-content mb-1.5">Widget heading</label>
          <input
            type="text"
            value={heading}
            onChange={e => setHeading(e.target.value)}
            placeholder="Add to your order"
            className="w-full px-3 py-2 border border-edge rounded-control text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
          />
        </div>

        {/* Add-ons */}
        <div>
          <label className="block text-sm font-medium text-content mb-1.5">Add-ons</label>

          {addons.length > 0 && (
            <div className="space-y-2 mb-3">
              {addons.map((a, i) => (
                <div key={a.variant_id} className="flex items-center gap-3 p-3 border border-edge rounded-card">
                  {a.image
                    ? <img src={a.image} alt="" className="w-10 h-10 rounded-control object-cover" />
                    : <div className="w-10 h-10 rounded-control bg-edge" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-content truncate">
                      {a.title}{a.variant_title ? ` — ${a.variant_title}` : ''}
                      <span className="text-content-muted font-normal ml-2">{formatPrice(a.price)}</span>
                    </p>
                    <input
                      type="text"
                      value={a.label}
                      onChange={e => setAddons(prev => prev.map((x, xi) => xi === i ? { ...x, label: e.target.value } : x))}
                      placeholder={`Shown as: ${a.title}`}
                      className="mt-1 w-full px-2 py-1 border border-edge rounded text-xs text-content-secondary focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="p-0.5 text-content-muted hover:text-content disabled:opacity-30">
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button onClick={() => move(i, 1)} disabled={i === addons.length - 1} className="p-0.5 text-content-muted hover:text-content disabled:opacity-30">
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                  <button onClick={() => setAddons(prev => prev.filter((_, xi) => xi !== i))} className="p-1.5 text-content-muted hover:text-red-600 rounded-control hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="relative">
            <Plus className="w-4 h-4 text-content-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={addonQuery}
              onChange={e => { setAddonQuery(e.target.value); setExpandedProduct(null); }}
              placeholder="Search a product to add as an add-on…"
              className="w-full pl-9 pr-3 py-2 border border-dashed border-edge-strong rounded-control text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />
            {addonMatches.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-surface border border-edge rounded-card shadow-lg overflow-hidden max-h-72 overflow-y-auto">
                {addonMatches.map(p => {
                  const usedVariants = new Set(addons.map(a => a.variant_id));
                  const free = p.variants.filter(v => !usedVariants.has(v.id));
                  return (
                    <div key={p.id}>
                      <button
                        onClick={() => pickAddonProduct(p)}
                        className="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-surface-hover"
                      >
                        {p.image?.src
                          ? <img src={p.image.src} alt="" className="w-8 h-8 rounded object-cover" />
                          : <div className="w-8 h-8 rounded bg-edge" />}
                        <span className="text-sm text-content flex-1">{p.title}</span>
                        {free.length > 1 && <span className="text-xs text-content-muted">{free.length} variants</span>}
                      </button>
                      {expandedProduct === p.id && free.map(v => (
                        <button
                          key={v.id}
                          onClick={() => addAddon(p, v)}
                          className="flex items-center gap-2 w-full pl-14 pr-3 py-1.5 text-left hover:bg-sky-50"
                        >
                          <span className="text-xs text-content-secondary flex-1">{v.title}</span>
                          <span className="text-xs text-content-muted">{formatPrice(v.price)}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Discount */}
        <div className="border border-edge rounded-card p-4">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={discountEnabled}
              onChange={e => setDiscountEnabled(e.target.checked)}
              className="w-4 h-4 accent-sky-600"
            />
            <BadgePercent className="w-4 h-4 text-sky-600" />
            <span className="text-sm font-medium text-content">Discount on add-ons</span>
          </label>
          <p className="text-xs text-content-muted mt-1 ml-6">
            A discount code scoped to just these add-ons is created in Shopify and applied
            automatically when a reader checks one — they never have to type it.
          </p>

          {discountEnabled && (
            <div className="mt-4 space-y-4 ml-6">
              <div className="flex flex-wrap gap-3">
                <div>
                  <label className="block text-xs font-medium text-content-secondary mb-1">Type</label>
                  <select
                    value={discountType}
                    onChange={e => setDiscountType(e.target.value as DiscountType)}
                    className="px-3 py-2 border border-edge rounded-control text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed value ($)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-content-secondary mb-1">Value</label>
                  <input
                    type="number"
                    min="0"
                    step={discountType === 'percentage' ? '1' : '0.01'}
                    value={discountValue}
                    onChange={e => setDiscountValue(e.target.value)}
                    placeholder={discountType === 'percentage' ? '15' : '5.00'}
                    className="w-28 px-3 py-2 border border-edge rounded-control text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1">Discount text (shown in the widget)</label>
                <input
                  type="text"
                  value={discountText}
                  onChange={e => setDiscountText(e.target.value)}
                  placeholder="Save when you bundle"
                  className="w-full px-3 py-2 border border-edge rounded-control text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <label className="flex items-start gap-2 text-sm text-content-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={includesTrigger}
                  onChange={e => setIncludesTrigger(e.target.checked)}
                  className="w-4 h-4 accent-sky-600 mt-0.5"
                />
                <span>
                  Bundle-style: discount also applies to the main product
                  <span className="block text-xs text-content-muted">
                    Like a "frequently bought together" deal — everything in the cart from this offer
                    gets the discount, add-ons are pre-checked, and the widget's total reflects it.
                  </span>
                </span>
              </label>

              <div>
                <label className="block text-xs font-medium text-content-secondary mb-1.5">Can combine with</label>
                <div className="flex flex-wrap gap-4">
                  {([
                    ['Other product discounts', combinesProduct, setCombinesProduct],
                    ['Order discounts', combinesOrder, setCombinesOrder],
                    ['Shipping discounts', combinesShipping, setCombinesShipping],
                  ] as const).map(([label, value, setter]) => (
                    <label key={label} className="flex items-center gap-2 text-sm text-content-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={value}
                        onChange={e => setter(e.target.checked)}
                        className="w-4 h-4 accent-sky-600"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {existing?.discount_code && (
                <p className="text-xs text-content-muted">
                  Current code: <code className="bg-surface-sunken px-1.5 py-0.5 rounded">{existing.discount_code}</code> — recreated automatically on every save.
                </p>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-control">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-edge rounded-control hover:bg-surface-hover text-content">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white text-sm font-medium rounded-control hover:bg-sky-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Saving to Shopify…' : 'Save offer'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
