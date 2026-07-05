-- ============================================
-- UPSELLS PHASE 2: DISCOUNTS + STATS
-- 1. Discount settings on upsell_offers (a real Shopify discount code is
--    created per offer, scoped to the add-on products; the widget applies
--    it automatically when an add-on is checked).
-- 2. upsell_events: aggregated view/click counters. The storefront widget
--    reports through track_upsell_event (public RPC, anon key) — counters
--    only, no personal data. Conversions are NOT tracked here; they're
--    computed from synced Shopify orders via line-item attribution.
-- 3. shopify_proxy gains create_discount / delete_discount actions.
-- Run this in Supabase SQL Editor (new query).
-- ============================================

ALTER TABLE upsell_offers
  ADD COLUMN IF NOT EXISTS discount_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS discount_type TEXT NOT NULL DEFAULT 'percentage',
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS discount_combines_product BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS discount_combines_order BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS discount_combines_shipping BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS discount_code TEXT,
  ADD COLUMN IF NOT EXISTS discount_gid TEXT;

-- ---- View/click counters, aggregated per product per day ----

CREATE TABLE IF NOT EXISTS upsell_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  shopify_product_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('view', 'click')),
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  count INTEGER NOT NULL DEFAULT 1,
  UNIQUE(user_id, shopify_product_id, event_type, day)
);

CREATE INDEX IF NOT EXISTS idx_upsell_events_user ON upsell_events(user_id);

ALTER TABLE upsell_events ENABLE ROW LEVEL SECURITY;

-- Owners can read (and manage via backup/restore) their own counters.
-- Storefront visitors never touch this table directly — only through
-- track_upsell_event below.
DROP POLICY IF EXISTS upsell_events_own ON upsell_events;
CREATE POLICY upsell_events_own ON upsell_events
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Public counter endpoint for the storefront widget. Callable with the anon
-- key; resolves the store owner from the shop domain and bumps an aggregate
-- counter. Inputs are strictly validated and the row space is bounded
-- (product x event x day), so abuse can only inflate counters.
CREATE OR REPLACE FUNCTION public.track_upsell_event(p_shop TEXT, p_product_id TEXT, p_event TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF p_event NOT IN ('view', 'click') THEN RETURN; END IF;
  IF p_product_id IS NULL OR NOT (p_product_id ~ '^[0-9]{1,20}$') THEN RETURN; END IF;
  IF p_shop IS NULL OR length(p_shop) > 255 THEN RETURN; END IF;

  SELECT user_id INTO v_user_id
  FROM public.shopify_settings
  WHERE lower(store_url) = lower(p_shop)
  LIMIT 1;
  IF v_user_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.upsell_events (user_id, shopify_product_id, event_type, day, count)
  VALUES (v_user_id, p_product_id, p_event, CURRENT_DATE, 1)
  ON CONFLICT (user_id, shopify_product_id, event_type, day)
  DO UPDATE SET count = upsell_events.count + 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.track_upsell_event(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ---- Extend the Shopify proxy with discount actions ----

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
  v_product_gids JSONB;
  v_value JSONB;
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

  ELSIF action = 'create_discount' THEN
    -- Create a discount code scoped to specific products (the offer's
    -- add-ons). Percentage values arrive as 0-100 and convert to Shopify's
    -- 0-1 fraction; fixed values apply once across the entitled items.
    IF params->>'code' IS NULL OR length(params->>'code') > 64 THEN
      RETURN jsonb_build_object('error', 'create_discount requires a code (max 64 chars)');
    END IF;
    IF params->>'value' IS NULL OR NOT (params->>'value' ~ '^[0-9]+(\.[0-9]+)?$') THEN
      RETURN jsonb_build_object('error', 'create_discount requires a numeric value');
    END IF;

    SELECT jsonb_agg(format('gid://shopify/Product/%s', pid))
    INTO v_product_gids
    FROM jsonb_array_elements_text(COALESCE(params->'product_ids', '[]'::jsonb)) AS pid
    WHERE pid ~ '^[0-9]+$';

    IF v_product_gids IS NULL OR jsonb_array_length(v_product_gids) = 0 THEN
      RETURN jsonb_build_object('error', 'create_discount requires product_ids');
    END IF;

    IF COALESCE(params->>'value_type', 'percentage') = 'percentage' THEN
      v_value := jsonb_build_object('percentage', (params->>'value')::NUMERIC / 100);
    ELSE
      v_value := jsonb_build_object('discountAmount', jsonb_build_object(
        'amount', params->>'value',
        'appliesOnEachItem', FALSE
      ));
    END IF;

    v_api_url := format('https://%s/admin/api/%s/graphql.json', v_store_url, v_api_version);
    v_body := jsonb_build_object(
      'query', 'mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) { codeDiscountNode { id } userErrors { field message } } }',
      'variables', jsonb_build_object(
        'basicCodeDiscount', jsonb_build_object(
          'title', COALESCE(params->>'title', 'Upsell add-on discount'),
          'code', params->>'code',
          'startsAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'customerSelection', jsonb_build_object('all', TRUE),
          'customerGets', jsonb_build_object(
            'value', v_value,
            'items', jsonb_build_object('products', jsonb_build_object('productsToAdd', v_product_gids))
          ),
          'combinesWith', jsonb_build_object(
            'productDiscounts', COALESCE((params->>'combines_product')::BOOLEAN, FALSE),
            'orderDiscounts', COALESCE((params->>'combines_order')::BOOLEAN, FALSE),
            'shippingDiscounts', COALESCE((params->>'combines_shipping')::BOOLEAN, FALSE)
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

  ELSIF action = 'delete_discount' THEN
    IF params->>'gid' IS NULL OR params->>'gid' NOT LIKE 'gid://shopify/DiscountCodeNode/%' THEN
      RETURN jsonb_build_object('error', 'delete_discount requires a DiscountCodeNode gid');
    END IF;

    v_api_url := format('https://%s/admin/api/%s/graphql.json', v_store_url, v_api_version);
    v_body := jsonb_build_object(
      'query', 'mutation discountCodeDelete($id: ID!) { discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { field message } } }',
      'variables', jsonb_build_object('id', params->>'gid')
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
