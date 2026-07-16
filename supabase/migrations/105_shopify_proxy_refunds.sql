-- Adds refunds and cancelled_at to the fields the shopify_proxy Postgres
-- function requests from Shopify's /orders.json endpoint. Without this,
-- refund_line_items never reach our local shopify_orders table, and the
-- inventory-restock-on-refund path in applyOrdersToInventory can't fire.
--
-- Targeted string replacement rather than a full function rewrite so we
-- don't accidentally regress unrelated actions in shopify_proxy.

DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE proname = 'shopify_proxy' AND pronamespace = 'public'::regnamespace;

  IF v_src IS NULL THEN
    RAISE NOTICE 'shopify_proxy function not found — skipping.';
    RETURN;
  END IF;

  IF position('cancelled_at' IN v_src) > 0 AND position(',refunds,' IN v_src) > 0 THEN
    -- Already patched (either manually or by a prior run) — nothing to do.
    RETURN;
  END IF;

  v_src := replace(
    v_src,
    'fields=id,name,order_number,created_at,customer,fulfillment_status,financial_status,total_price,line_items,fulfillments,location_id',
    'fields=id,name,order_number,created_at,cancelled_at,customer,fulfillment_status,financial_status,total_price,line_items,fulfillments,refunds,location_id'
  );

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.shopify_proxy(action TEXT, params JSONB DEFAULT ''{}''::jsonb) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$%s$body$;',
    v_src
  );
END $$;
