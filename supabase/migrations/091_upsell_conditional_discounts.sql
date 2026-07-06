-- ============================================
-- UPSELLS: CONDITIONAL DISCOUNTS
-- The discount should only apply while the main product is in the cart.
--   - Add-on offers: "Buy X, Get Y" — buy the main product, get the add-ons
--     at a discount. The discount drops the instant the main product leaves
--     the cart. New shopify_proxy action: create_bxgy_discount.
--   - Bundle offers (main product is discounted too, so it can't be a BxGy
--     "buy" item): the basic code now takes an optional min_quantity so it
--     only stands when the shopper keeps 2+ of the bundle's items.
-- Run this in Supabase SQL Editor (new query).
-- ============================================

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
  v_shop_id TEXT;
  v_discount JSONB;
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

  ELSIF action = 'get_themes' THEN
    v_api_url := format('https://%s/admin/api/%s/themes.json', v_store_url, v_api_version);

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

  -- ---- POST/PUT requests ----

  ELSIF action = 'set_theme_asset' THEN
    -- Publish the widget snippet. The asset key is fixed server-side so
    -- this action can never modify any other theme file.
    IF params->>'theme_id' IS NULL OR NOT (params->>'theme_id' ~ '^[0-9]+$') THEN
      RETURN jsonb_build_object('error', 'set_theme_asset requires a numeric theme_id');
    END IF;
    IF params->>'value' IS NULL THEN
      RETURN jsonb_build_object('error', 'set_theme_asset requires a value');
    END IF;

    v_api_url := format('https://%s/admin/api/%s/themes/%s/assets.json',
      v_store_url, v_api_version, params->>'theme_id');
    v_body := jsonb_build_object(
      'asset', jsonb_build_object(
        'key', 'snippets/acc-addons.liquid',
        'value', params->>'value'
      )
    )::TEXT;

    SELECT * INTO v_response FROM extensions.http(
      ('PUT', v_api_url,
       ARRAY[
         ROW('X-Shopify-Access-Token', v_access_token)::extensions.http_header,
         ROW('Content-Type', 'application/json')::extensions.http_header
       ],
       'application/json', v_body
      )::extensions.http_request
    );

    IF v_response.status NOT IN (200, 201) THEN
      RETURN jsonb_build_object('error', format('Shopify API error: %s', v_response.status), 'details', left(v_response.content, 500));
    END IF;
    RETURN v_response.content::JSONB;

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

  ELSIF action = 'set_shop_metafield' THEN
    IF params->>'value' IS NULL THEN
      RETURN jsonb_build_object('error', 'set_shop_metafield requires a value');
    END IF;

    SELECT * INTO v_response FROM extensions.http(
      ('GET', format('https://%s/admin/api/%s/shop.json?fields=id', v_store_url, v_api_version),
       ARRAY[ROW('X-Shopify-Access-Token', v_access_token)::extensions.http_header],
       NULL, NULL
      )::extensions.http_request
    );
    IF v_response.status != 200 THEN
      RETURN jsonb_build_object('error', format('Shopify API error: %s', v_response.status), 'details', left(v_response.content, 500));
    END IF;
    v_shop_id := (v_response.content::JSONB)->'shop'->>'id';
    IF v_shop_id IS NULL THEN
      RETURN jsonb_build_object('error', 'Could not resolve the shop id');
    END IF;

    v_api_url := format('https://%s/admin/api/%s/graphql.json', v_store_url, v_api_version);
    v_body := jsonb_build_object(
      'query', 'mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id namespace key } userErrors { field message } } }',
      'variables', jsonb_build_object(
        'metafields', jsonb_build_array(
          jsonb_build_object(
            'ownerId', format('gid://shopify/Shop/%s', v_shop_id),
            'namespace', COALESCE(params->>'namespace', 'author_cc'),
            'key', COALESCE(params->>'key', 'widget'),
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
    -- Basic code scoped to specific products. Optional min_quantity makes the
    -- discount only stand when that many of the entitled items are in the cart
    -- (used for bundle offers so the discount depends on the bundle staying
    -- together, not on a single leftover item).
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

    v_discount := jsonb_build_object(
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
    );

    IF params->>'min_quantity' IS NOT NULL AND params->>'min_quantity' ~ '^[0-9]+$' THEN
      v_discount := v_discount || jsonb_build_object(
        'minimumRequirement', jsonb_build_object(
          'quantity', jsonb_build_object('greaterThanOrEqualToQuantity', params->>'min_quantity')
        )
      );
    END IF;

    v_api_url := format('https://%s/admin/api/%s/graphql.json', v_store_url, v_api_version);
    v_body := jsonb_build_object(
      'query', 'mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) { codeDiscountNode { id } userErrors { field message } } }',
      'variables', jsonb_build_object('basicCodeDiscount', v_discount)
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

  ELSIF action = 'create_bxgy_discount' THEN
    -- "Buy X, Get Y": the customer must have the main product (buy_product_id)
    -- in the cart to receive the discount on the add-ons (get_product_ids).
    -- Removing the main product removes the discount automatically.
    IF params->>'code' IS NULL OR length(params->>'code') > 64 THEN
      RETURN jsonb_build_object('error', 'create_bxgy_discount requires a code (max 64 chars)');
    END IF;
    IF params->>'buy_product_id' IS NULL OR NOT (params->>'buy_product_id' ~ '^[0-9]+$') THEN
      RETURN jsonb_build_object('error', 'create_bxgy_discount requires a numeric buy_product_id');
    END IF;
    IF params->>'value' IS NULL OR NOT (params->>'value' ~ '^[0-9]+(\.[0-9]+)?$') THEN
      RETURN jsonb_build_object('error', 'create_bxgy_discount requires a numeric value');
    END IF;

    SELECT jsonb_agg(format('gid://shopify/Product/%s', pid))
    INTO v_product_gids
    FROM jsonb_array_elements_text(COALESCE(params->'get_product_ids', '[]'::jsonb)) AS pid
    WHERE pid ~ '^[0-9]+$';

    IF v_product_gids IS NULL OR jsonb_array_length(v_product_gids) = 0 THEN
      RETURN jsonb_build_object('error', 'create_bxgy_discount requires get_product_ids');
    END IF;

    -- The "get" discount effect (BxGy supports percentage or a fixed amount).
    IF COALESCE(params->>'value_type', 'percentage') = 'percentage' THEN
      v_value := jsonb_build_object('percentage', (params->>'value')::NUMERIC / 100);
    ELSE
      v_value := jsonb_build_object('amount', params->>'value');
    END IF;

    v_api_url := format('https://%s/admin/api/%s/graphql.json', v_store_url, v_api_version);
    v_body := jsonb_build_object(
      'query', 'mutation discountCodeBxgyCreate($bxgyCodeDiscount: DiscountCodeBxgyInput!) { discountCodeBxgyCreate(bxgyCodeDiscount: $bxgyCodeDiscount) { codeDiscountNode { id } userErrors { field message } } }',
      'variables', jsonb_build_object(
        'bxgyCodeDiscount', jsonb_build_object(
          'title', COALESCE(params->>'title', 'Upsell add-on discount'),
          'code', params->>'code',
          'startsAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'customerSelection', jsonb_build_object('all', TRUE),
          'customerBuys', jsonb_build_object(
            'value', jsonb_build_object('quantity', '1'),
            'items', jsonb_build_object('products', jsonb_build_object(
              'productsToAdd', jsonb_build_array(format('gid://shopify/Product/%s', params->>'buy_product_id'))
            ))
          ),
          'customerGets', jsonb_build_object(
            'value', jsonb_build_object('discountOnQuantity', jsonb_build_object(
              'quantity', jsonb_array_length(v_product_gids)::TEXT,
              'effect', v_value
            )),
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
