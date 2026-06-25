-- Adds the products table to the supabase_realtime publication so the
-- Inventory module can react to changes (e.g. inventory deltas from a
-- Shopify sync running in the Orders module) without a hard refresh.
--
-- Idempotent — pg_publication_tables guard avoids the "is already member"
-- error if the table is already published.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'products'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE products;
  END IF;
END $$;
