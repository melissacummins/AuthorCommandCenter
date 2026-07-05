-- Bundle-style discounts: when enabled, the offer's discount code also
-- covers the trigger product itself (SellEasy's "frequently bought
-- together" semantics — 15% off the whole bundle), not just the add-ons.
-- Run this in Supabase SQL Editor (new query).

ALTER TABLE upsell_offers
  ADD COLUMN IF NOT EXISTS discount_includes_trigger BOOLEAN NOT NULL DEFAULT FALSE;
