// Product shapes returned by the shopify_proxy `get_products_catalog` action
// (REST products.json with handle/image/variants for the picker UI).

export interface CatalogVariant {
  id: number;
  title: string;
  price: string;
  sku?: string | null;
}

export interface CatalogProduct {
  id: number;
  title: string;
  handle: string;
  status: string;
  image: { src: string } | null;
  variants: CatalogVariant[];
}

// One add-on attached to a trigger product. The storefront widget only ever
// reads variant_id + handle + label from the metafield; title/variant_title/
// price/image are a snapshot kept for the editor UI, and going stale is
// harmless — the theme always renders live data.
export interface UpsellAddon {
  variant_id: number;
  product_id: number;
  handle: string;
  label: string; // custom display label; '' = use the product title
  title: string;
  variant_title: string;
  price: string;
  image: string | null;
}

export type DiscountType = 'percentage' | 'fixed';

// Discount settings for an offer. When enabled, a real Shopify discount
// code (scoped to the add-on products) is created on save; the widget
// applies it automatically when a shopper checks an add-on.
export interface UpsellDiscount {
  discount_enabled: boolean;
  discount_type: DiscountType;
  discount_value: number;
  discount_text: string;
  // Bundle-style: the code also covers the trigger product itself
  // (frequently-bought-together semantics), not just the add-ons.
  discount_includes_trigger: boolean;
  discount_combines_product: boolean;
  discount_combines_order: boolean;
  discount_combines_shipping: boolean;
}

export interface UpsellOffer extends UpsellDiscount {
  id: string;
  user_id: string;
  shopify_product_id: string;
  product_title: string;
  product_handle: string;
  product_image: string | null;
  heading: string;
  enabled: boolean;
  addons: UpsellAddon[];
  discount_code: string | null;
  discount_gid: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

// Editable subset used by the editor before a row exists.
export interface UpsellOfferDraft extends UpsellDiscount {
  shopify_product_id: string;
  product_title: string;
  product_handle: string;
  product_image: string | null;
  heading: string;
  enabled: boolean;
  addons: UpsellAddon[];
  discount_code?: string | null;
  discount_gid?: string | null;
}

// Widget design settings, saved from the Design tab. Stored in
// upsell_widget_settings and mirrored to the shop metafield
// author_cc.widget that the theme snippet reads — so saving here restyles
// the live widget instantly, no theme re-paste needed. Empty color strings
// mean "use the theme's own button colors".
export interface WidgetSettings {
  button_bg: string;
  button_text: string;
  button_label: string;
  total_label: string;
  radius: number;
  show_plus: boolean;
  popup: boolean;
}

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  button_bg: '',
  button_text: '',
  button_label: 'Add to cart',
  total_label: 'Total price',
  radius: 12,
  show_plus: true,
  popup: true,
};

// Per-offer performance numbers. Views/clicks come from the widget's
// counter pings; conversions and value are computed from synced Shopify
// orders whose cart lines carry the widget's attribution property.
export interface OfferStats {
  views: number;
  clicks: number;
  conversions: number;
  value: number;
}
