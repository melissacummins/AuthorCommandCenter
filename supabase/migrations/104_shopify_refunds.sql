-- Adds refund + cancellation tracking on synced Shopify orders so the
-- inventory sync can subtract refunded units and skip cancelled orders.
-- Existing rows get 0 refunded / null cancelled_at — safe by default;
-- the next Shopify sync will refresh the values for orders that fall in
-- the sync window and reconcile inventory automatically.

ALTER TABLE shopify_orders
  ADD COLUMN IF NOT EXISTS refunds JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
