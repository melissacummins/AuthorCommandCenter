-- ============================================
-- Per-link Meta (Facebook) Pixel event choice
--   Adds short_links.meta_event so a click on a bio-page card fires the
--   configured Meta Standard Event (ViewContent, Lead, Purchase, …) instead
--   of only PageView. NULL means the link inherits the page-load PageView
--   and does not fire an extra event on click.
-- ============================================

ALTER TABLE short_links
  ADD COLUMN IF NOT EXISTS meta_event TEXT;

-- Meta Standard Events list (as of Q3 2026). We do NOT include a `custom`
-- placeholder here — future custom events can be added via a follow-up
-- migration when we support them in the UI.
ALTER TABLE short_links DROP CONSTRAINT IF EXISTS short_links_meta_event_check;
ALTER TABLE short_links
  ADD CONSTRAINT short_links_meta_event_check CHECK (
    meta_event IS NULL OR meta_event IN (
      'ViewContent',
      'Lead',
      'Purchase',
      'Subscribe',
      'CompleteRegistration',
      'AddToCart',
      'InitiateCheckout',
      'AddPaymentInfo',
      'Contact',
      'Search',
      'Schedule',
      'StartTrial',
      'SubmitApplication',
      'CustomizeProduct',
      'FindLocation',
      'Donate'
    )
  );
