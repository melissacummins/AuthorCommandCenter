import { useEffect, useRef, useState } from 'react';
import { MapPin, Check, ChevronDown } from 'lucide-react';
import { fetchShopifyLocations, updateDefaultLocation } from '../../orders/api';
import type { ShopifyLocation, ShopifySettings } from '../../../lib/types';

// Compact fulfillment-location badge for the Inventory header. Shows the
// currently-selected default location. Clicking opens a dropdown of every
// Shopify location the user has connected. Picking one persists it via
// shopify_settings.default_location_id — the same field the Shopify sync tab
// reads — so the two views stay in lockstep.
//
// Renders nothing if Shopify isn't connected (no access token yet).
export default function LocationPicker({ settings, onChanged }: {
  settings: ShopifySettings | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<ShopifyLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || locations.length > 0 || !settings?.access_token) return;
    let cancelled = false;
    setLoading(true);
    fetchShopifyLocations()
      .then(list => { if (!cancelled) setLocations(list); })
      .catch(err => console.error('Failed to load Shopify locations', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, locations.length, settings?.access_token]);

  if (!settings?.access_token) return null;

  const currentName = settings.default_location_name || 'No location selected';
  const currentId = settings.default_location_id || '';

  async function pick(loc: ShopifyLocation) {
    setSaving(String(loc.id));
    try {
      await updateDefaultLocation(String(loc.id), loc.name);
      onChanged();
      setOpen(false);
    } catch (err) {
      console.error('Failed to update default location', err);
    }
    setSaving(null);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 border border-edge text-content text-sm font-medium rounded-control hover:bg-surface-hover"
        title="Fulfillment location — controls which Shopify orders count toward this inventory"
      >
        <MapPin className="w-4 h-4 text-content-muted" />
        <span className="max-w-[180px] truncate">{currentName}</span>
        <ChevronDown className="w-3.5 h-3.5 text-content-muted" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-20 bg-surface border border-edge rounded-control shadow-lg min-w-[240px] max-h-72 overflow-y-auto">
          {loading ? (
            <p className="px-3 py-2 text-sm text-content-muted italic">Loading locations…</p>
          ) : locations.length === 0 ? (
            <p className="px-3 py-2 text-sm text-content-muted italic">No locations found.</p>
          ) : locations.map(loc => {
            const id = String(loc.id);
            const isCurrent = id === currentId;
            return (
              <button
                key={id}
                onClick={() => pick(loc)}
                disabled={saving !== null}
                className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-surface-hover disabled:opacity-50"
              >
                {isCurrent ? <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <span className="w-3.5 shrink-0" />}
                <span className="truncate">{loc.name}</span>
                {saving === id && <span className="ml-auto text-[11px] text-content-muted">saving…</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
