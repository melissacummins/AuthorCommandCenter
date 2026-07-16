-- ============================================
-- SHOPIFY API PROXY - Database Function
-- This replaces the Edge Function approach.
-- Run this in Supabase SQL Editor (new query).
-- ============================================

-- Step 1: Enable the HTTP extension (lets PostgreSQL make web requests)
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- Step 2: Create the proxy function
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
  v_status INT;
BEGIN
  -- Get the calling user's Shopify settings
  SELECT store_url, access_token
  INTO v_store_url, v_access_token
  FROM public.shopify_settings
  WHERE user_id = auth.uid();

  IF v_store_url IS NULL THEN
    RETURN jsonb_build_object('error', 'Shopify not configured. Please add your store credentials.');
  END IF;

  -- Build URL based on action
  IF action = 'test_connection' THEN
    v_api_url := format('https://%s/admin/api/%s/shop.json', v_store_url, v_api_version);

  ELSIF action = 'get_locations' THEN
    v_api_url := format('https://%s/admin/api/%s/locations.json', v_store_url, v_api_version);

  ELSIF action = 'get_orders' THEN
    -- Check if we're using cursor pagination
    IF params->>'page_info' IS NOT NULL THEN
      v_api_url := format('https://%s/admin/api/%s/orders.json?page_info=%s&limit=%s',
        v_store_url, v_api_version,
        params->>'page_info',
        COALESCE(params->>'limit', '250')
      );
    ELSE
      v_api_url := format('https://%s/admin/api/%s/orders.json?status=%s&limit=%s&fields=id,name,order_number,created_at,cancelled_at,customer,fulfillment_status,financial_status,total_price,line_items,fulfillments,refunds,location_id',
        v_store_url, v_api_version,
        COALESCE(params->>'status', 'any'),
        COALESCE(params->>'limit', '250')
      );

      IF params->>'created_at_min' IS NOT NULL THEN
        v_api_url := v_api_url || '&created_at_min=' || (params->>'created_at_min');
      END IF;
      IF params->>'created_at_max' IS NOT NULL THEN
        v_api_url := v_api_url || '&created_at_max=' || (params->>'created_at_max');
      END IF;
    END IF;

  ELSE
    RETURN jsonb_build_object('error', format('Unknown action: %s', action));
  END IF;

  -- Make the HTTP request to Shopify with the access token
  SELECT *
  INTO v_response
  FROM extensions.http(
    (
      'GET',
      v_api_url,
      ARRAY[ROW('X-Shopify-Access-Token', v_access_token)::extensions.http_header],
      NULL,
      NULL
    )::extensions.http_request
  );

  -- Check for errors
  IF v_response.status != 200 THEN
    RETURN jsonb_build_object(
      'error', format('Shopify API error: %s', v_response.status),
      'details', left(v_response.content, 500)
    );
  END IF;

  RETURN v_response.content::JSONB;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.shopify_proxy(TEXT, JSONB) TO authenticated;
