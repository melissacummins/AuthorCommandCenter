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

export interface UpsellOffer {
  id: string;
  user_id: string;
  shopify_product_id: string;
  product_title: string;
  product_handle: string;
  product_image: string | null;
  heading: string;
  enabled: boolean;
  addons: UpsellAddon[];
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

// Editable subset used by the editor before a row exists.
export interface UpsellOfferDraft {
  shopify_product_id: string;
  product_title: string;
  product_handle: string;
  product_image: string | null;
  heading: string;
  enabled: boolean;
  addons: UpsellAddon[];
}
