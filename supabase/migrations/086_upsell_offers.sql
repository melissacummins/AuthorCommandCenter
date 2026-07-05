-- ============================================
-- UPSELLS & ADD-ONS (SellEasy replacement)
-- 1. upsell_offers: which add-ons show on which product page.
-- 2. shopify_proxy gains two actions:
--    - get_products_catalog: products with handle/images/prices for the picker
--    - set_product_metafield: GraphQL metafieldsSet upsert (the storefront
--      widget reads this metafield, keyed by product/variant IDs only)
-- Run this in Supabase SQL Editor (new query).
-- ============================================

CREATE TABLE IF NOT EXISTS upsell_offers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  shopify_product_id TEXT NOT NULL,
  product_title TEXT NOT NULL DEFAULT '',
  product_handle TEXT NOT NULL DEFAULT '',
  product_image TEXT,
  heading TEXT NOT NULL DEFAULT 'Add to your order',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- [{variant_id, product_id, handle, label, title, variant_title, price, image}]
  addons JSONB NOT NULL DEFAULT '[]',
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, shopify_product_id)
);

CREATE INDEX IF NOT EXISTS idx_upsell_offers_user ON upsell_offers(user_id);

ALTER TABLE upsell_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS upsell_offers_own ON upsell_offers;
CREATE POLICY upsell_offers_own ON upsell_offers
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Replace the proxy function with an expanded version
CREATE OR REPLACE FUNCTION public.shopify_proxy(action TEXT, params JSONB DEFAULT '{}')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_url TEXT;
  v_access_token TEXT;
  v_api_url TEXT;
  v_response extensions.http_response;
  v_api_version TEXT := '2024-01';
  v_body TEXT;
  v_link TEXT;
  v_next TEXT;
BEGIN
  -- Get the calling user's Shopify settings
  SELECT store_url, access_token
  INTO v_store_url, v_access_token
  FROM public.shopify_settings
  WHERE user_id = auth.uid();

  IF v_store_url IS NULL THEN
    RETURN jsonb_build_object('error', 'Shopify not configured. Please add your store credentials.');
  END IF;

  -- ---- GET requests ----

  IF action = 'test_connection' THEN
    v_api_url := format('https://%s/admin/api/%s/shop.json', v_store_url, v_api_version);

  ELSIF action = 'get_locations' THEN
    v_api_url := format('https://%s/admin/api/%s/locations.json', v_store_url, v_api_version);

  ELSIF action = 'get_orders' THEN
    IF params->>'page_info' IS NOT NULL THEN
      v_api_url := format('https://%s/admin/api/%s/orders.json?page_info=%s&limit=%s',
        v_store_url, v_api_version, params->>'page_info', COALESCE(params->>'limit', '250'));
    ELSE
      v_api_url := format('https://%s/admin/api/%s/orders.json?status=%s&limit=%s&fields=id,name,order_number,created_at,customer,fulfillment_status,financial_status,total_price,line_items,fulfillments,location_id',
        v_store_url, v_api_version, COALESCE(params->>'status', 'any'), COALESCE(params->>'limit', '250'));
      IF params->>'created_at_min' IS NOT NULL THEN
        v_api_url := v_api_url || '&created_at_min=' || (params->>'created_at_min');
      END IF;
      IF params->>'created_at_max' IS NOT NULL THEN
        v_api_url := v_api_url || '&created_at_max=' || (params->>'created_at_max');
      END IF;
    END IF;

  ELSIF action = 'get_products' THEN
    v_api_url := format('https://%s/admin/api/%s/products.json?limit=250&fields=id,title,variants',
      v_store_url, v_api_version);
    IF params->>'since_id' IS NOT NULL THEN
      v_api_url := v_api_url || '&since_id=' || (params->>'since_id');
    END IF;
    IF params->>'page_info' IS NOT NULL THEN
      v_api_url := format('https://%s/admin/api/%s/products.json?page_info=%s&limit=250',
        v_store_url, v_api_version, params->>'page_info');
    END IF;

  ELSIF action = 'get_products_catalog' THEN
    -- Richer product list for the Upsells picker: handles for the Liquid
    -- lookup, images and prices for the editor UI.
    IF params->>'page_info' IS NOT NULL THEN
      v_api_url := format('https://%s/admin/api/%s/products.json?page_info=%s&limit=250',
        v_store_url, v_api_version, params->>'page_info');
    ELSE
      v_api_url := format('https://%s/admin/api/%s/products.json?limit=250&status=active&fields=id,title,handle,status,image,variants',
        v_store_url, v_api_version);
    END IF;

  ELSIF action = 'get_inventory_levels' THEN
    v_api_url := format('https://%s/admin/api/%s/inventory_levels.json?location_id=%s&inventory_item_ids=%s',
      v_store_url, v_api_version,
      params->>'location_id',
      params->>'inventory_item_ids');

  -- ---- POST requests ----

  ELSIF action = 'set_inventory' THEN
    v_api_url := format('https://%s/admin/api/%s/inventory_levels/set.json', v_store_url, v_api_version);
    v_body := json_build_object(
      'location_id', (params->>'location_id')::BIGINT,
      'inventory_item_id', (params->>'inventory_item_id')::BIGINT,
      'available', (params->>'available')::INT
    )::TEXT;

    SELECT * INTO v_response FROM extensions.http(
      ('POST', v_api_url,
       ARRAY[
         ROW('X-Shopify-Access-Token', v_access_token)::extensions.http_header,
         ROW('Content-Type', 'application/json')::extensions.http_header
       ],
       'application/json', v_body
      )::extensions.http_request
    );

    IF v_response.status != 200 THEN
      RETURN jsonb_build_object('error', format('Shopify API error: %s', v_response.status), 'details', left(v_response.content, 500));
    END IF;
    RETURN v_response.content::JSONB;

  ELSIF action = 'set_product_metafield' THEN
    -- Upsert a JSON metafield on a product via GraphQL metafieldsSet.
    -- REST metafield POST fails on duplicate namespace/key; metafieldsSet
    -- is a true upsert, so saving an offer twice just works.
    IF params->>'product_id' IS NULL OR NOT (params->>'product_id' ~ '^[0-9]+$') THEN
      RETURN jsonb_build_object('error', 'set_product_metafield requires a numeric product_id');
    END IF;
    IF params->>'value' IS NULL THEN
      RETURN jsonb_build_object('error', 'set_product_metafield requires a value');
    END IF;

    v_api_url := format('https://%s/admin/api/%s/graphql.json', v_store_url, v_api_version);
    v_body := jsonb_build_object(
      'query', 'mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id namespace key } userErrors { field message } } }',
      'variables', jsonb_build_object(
        'metafields', jsonb_build_array(
          jsonb_build_object(
            'ownerId', format('gid://shopify/Product/%s', params->>'product_id'),
            'namespace', COALESCE(params->>'namespace', 'author_cc'),
            'key', COALESCE(params->>'key', 'upsells'),
            'type', 'json',
            'value', params->>'value'
          )
        )
      )
    )::TEXT;

    SELECT * INTO v_response FROM extensions.http(
      ('POST', v_api_url,
       ARRAY[
         ROW('X-Shopify-Access-Token', v_access_token)::extensions.http_header,
         ROW('Content-Type', 'application/json')::extensions.http_header
       ],
       'application/json', v_body
      )::extensions.http_request
    );

    IF v_response.status != 200 THEN
      RETURN jsonb_build_object('error', format('Shopify API error: %s', v_response.status), 'details', left(v_response.content, 500));
    END IF;
    RETURN v_response.content::JSONB;

  ELSE
    RETURN jsonb_build_object('error', format('Unknown action: %s', action));
  END IF;

  -- Execute GET request
  SELECT * INTO v_response FROM extensions.http(
    ('GET', v_api_url,
     ARRAY[ROW('X-Shopify-Access-Token', v_access_token)::extensions.http_header],
     NULL, NULL
    )::extensions.http_request
  );

  IF v_response.status != 200 THEN
    RETURN jsonb_build_object('error', format('Shopify API error: %s', v_response.status), 'details', left(v_response.content, 500));
  END IF;

  -- Surface cursor pagination (Link header) so multi-page catalogs load fully
  SELECT h.value INTO v_link
  FROM unnest(v_response.headers) AS h
  WHERE lower(h.field) = 'link'
  LIMIT 1;

  IF v_link IS NOT NULL THEN
    v_next := substring(v_link from '<[^>]*[?&]page_info=([^>&]+)[^>]*>;\s*rel="next"');
  END IF;

  RETURN v_response.content::JSONB || jsonb_build_object('nextPageInfo', v_next);
END;
$$;

GRANT EXECUTE ON FUNCTION public.shopify_proxy(TEXT, JSONB) TO authenticated;
