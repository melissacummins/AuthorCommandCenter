-- ============================================
-- UPSELLS: BUNDLE DISCOUNT HELPER
-- Bundle offers keep the main product at full price but still discount the
-- whole bundle (SellEasy-style). That's a "Buy X, Get Y" discount where the
-- add-ons absorb the main product's share of the discount, so:
--   - requiring the main product in the cart (Buy X) makes the discount drop
--     the moment it's removed;
--   - the add-ons carry a boosted percentage so the total equals the intended
--     whole-bundle discount while the main product shows full price.
-- The boost depends on live prices, so this function fetches them at save
-- time and computes the effect, keeping the app free of stale price math.
-- Run this in Supabase SQL Editor (new query).
-- ============================================

CREATE OR REPLACE FUNCTION public.upsell_create_bundle_discount(
  p_code TEXT,
  p_title TEXT,
  p_buy_product_id TEXT,
  p_get_product_ids JSONB,
  p_pct NUMERIC DEFAULT NULL,
  p_fixed NUMERIC DEFAULT NULL,
  p_combines_product BOOLEAN DEFAULT FALSE,
  p_combines_order BOOLEAN DEFAULT FALSE,
  p_combines_shipping BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_url TEXT;
  v_access_token TEXT;
  v_api_version TEXT := '2024-01';
  v_response extensions.http_response;
  v_products JSONB;
  v_main NUMERIC;
  v_addons NUMERIC;
  v_d NUMERIC;
  v_eff NUMERIC;
  v_get_gids JSONB;
  v_n INT;
  v_all_ids TEXT;
  v_body TEXT;
BEGIN
  SELECT store_url, access_token INTO v_store_url, v_access_token
  FROM public.shopify_settings WHERE user_id = auth.uid();
  IF v_store_url IS NULL THEN
    RETURN jsonb_build_object('error', 'Shopify not configured. Please add your store credentials.');
  END IF;

  IF p_code IS NULL OR length(p_code) > 64 THEN
    RETURN jsonb_build_object('error', 'requires a code (max 64 chars)');
  END IF;
  IF p_buy_product_id IS NULL OR NOT (p_buy_product_id ~ '^[0-9]+$') THEN
    RETURN jsonb_build_object('error', 'requires a numeric buy_product_id');
  END IF;

  -- Valid numeric add-on ("get") product ids.
  SELECT jsonb_agg(pid) INTO v_get_gids
  FROM jsonb_array_elements_text(COALESCE(p_get_product_ids, '[]'::jsonb)) pid
  WHERE pid ~ '^[0-9]+$';
  IF v_get_gids IS NULL OR jsonb_array_length(v_get_gids) = 0 THEN
    RETURN jsonb_build_object('error', 'requires get_product_ids');
  END IF;
  v_n := jsonb_array_length(v_get_gids);

  -- Fetch current prices for the main + add-on products.
  SELECT string_agg(t.id, ',') INTO v_all_ids
  FROM (SELECT p_buy_product_id AS id
        UNION SELECT jsonb_array_elements_text(v_get_gids)) t;

  SELECT * INTO v_response FROM extensions.http(
    ('GET',
     format('https://%s/admin/api/%s/products.json?ids=%s&fields=id,variants&limit=250',
            v_store_url, v_api_version, v_all_ids),
     ARRAY[ROW('X-Shopify-Access-Token', v_access_token)::extensions.http_header],
     NULL, NULL)::extensions.http_request
  );
  IF v_response.status != 200 THEN
    RETURN jsonb_build_object('error', format('Shopify API error: %s', v_response.status), 'details', left(v_response.content, 500));
  END IF;
  v_products := (v_response.content::JSONB) -> 'products';

  SELECT (p->'variants'->0->>'price')::NUMERIC INTO v_main
  FROM jsonb_array_elements(v_products) p
  WHERE p->>'id' = p_buy_product_id
  LIMIT 1;

  SELECT COALESCE(sum((p->'variants'->0->>'price')::NUMERIC), 0) INTO v_addons
  FROM jsonb_array_elements(v_products) p
  WHERE (p->>'id') IN (SELECT jsonb_array_elements_text(v_get_gids));

  IF v_main IS NULL OR v_addons IS NULL OR v_addons <= 0 THEN
    RETURN jsonb_build_object('error', 'Could not resolve product prices for the bundle');
  END IF;

  -- Whole-bundle discount amount, then the boosted percentage the add-ons
  -- must carry so the total lands on the intended discount.
  IF p_fixed IS NOT NULL AND p_fixed > 0 THEN
    v_d := p_fixed;
  ELSE
    v_d := COALESCE(p_pct, 0) / 100.0 * (v_main + v_addons);
  END IF;
  v_eff := round(v_d / v_addons, 4);
  IF v_eff > 1 THEN v_eff := 1; END IF;      -- add-ons can't go below free
  IF v_eff <= 0 THEN
    RETURN jsonb_build_object('error', 'Computed a non-positive discount');
  END IF;

  -- Create the Buy-X-Get-Y discount.
  v_body := jsonb_build_object(
    'query', 'mutation discountCodeBxgyCreate($bxgyCodeDiscount: DiscountCodeBxgyInput!) { discountCodeBxgyCreate(bxgyCodeDiscount: $bxgyCodeDiscount) { codeDiscountNode { id } userErrors { field message } } }',
    'variables', jsonb_build_object(
      'bxgyCodeDiscount', jsonb_build_object(
        'title', COALESCE(p_title, 'Upsell bundle discount'),
        'code', p_code,
        'startsAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'customerSelection', jsonb_build_object('all', TRUE),
        'customerBuys', jsonb_build_object(
          'value', jsonb_build_object('quantity', '1'),
          'items', jsonb_build_object('products', jsonb_build_object(
            'productsToAdd', jsonb_build_array(format('gid://shopify/Product/%s', p_buy_product_id))
          ))
        ),
        'customerGets', jsonb_build_object(
          'value', jsonb_build_object('discountOnQuantity', jsonb_build_object(
            'quantity', v_n::TEXT,
            'effect', jsonb_build_object('percentage', v_eff)
          )),
          'items', jsonb_build_object('products', jsonb_build_object(
            'productsToAdd', (SELECT jsonb_agg(format('gid://shopify/Product/%s', pid))
                              FROM jsonb_array_elements_text(v_get_gids) pid)
          ))
        ),
        'combinesWith', jsonb_build_object(
          'productDiscounts', COALESCE(p_combines_product, FALSE),
          'orderDiscounts', COALESCE(p_combines_order, FALSE),
          'shippingDiscounts', COALESCE(p_combines_shipping, FALSE)
        )
      )
    )
  )::TEXT;

  SELECT * INTO v_response FROM extensions.http(
    ('POST',
     format('https://%s/admin/api/%s/graphql.json', v_store_url, v_api_version),
     ARRAY[
       ROW('X-Shopify-Access-Token', v_access_token)::extensions.http_header,
       ROW('Content-Type', 'application/json')::extensions.http_header
     ],
     'application/json', v_body)::extensions.http_request
  );
  IF v_response.status != 200 THEN
    RETURN jsonb_build_object('error', format('Shopify API error: %s', v_response.status), 'details', left(v_response.content, 500));
  END IF;
  RETURN v_response.content::JSONB;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsell_create_bundle_discount(TEXT, TEXT, TEXT, JSONB, NUMERIC, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;
