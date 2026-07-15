-- Adds added_to_inventory to purchase_orders so we can correctly compute the
-- inventory delta when a user edits a previously-arrived PO. Without this
-- column, editing an arrival would have to guess how many good units were
-- added vs kept as component-only.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS added_to_inventory INTEGER DEFAULT 0;

-- Backfill: for existing arrived POs, assume added_to_inventory was
-- actual_quantity - scratch_dent_quantity (the form's default). Component-
-- only orders (add_to_inventory=0 while good>0) will be over-estimated here;
-- if you edit one of those later, use the Stock modal to correct.
UPDATE purchase_orders
SET added_to_inventory = COALESCE(actual_quantity, 0) - COALESCE(scratch_dent_quantity, 0)
WHERE status = 'arrived'
  AND added_to_inventory = 0
  AND actual_quantity IS NOT NULL
  AND actual_quantity > 0;
