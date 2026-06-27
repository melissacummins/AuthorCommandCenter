-- ============================================
-- Remove the BookFunnel new-subscriber receiver (migration 072).
--
-- The feature (a webhook endpoint + capture page) was experimental and is being
-- removed — BookFunnel's own email alerts cover the "new readers to export"
-- need. These tables held no production data. Idempotent.
-- ============================================

DROP TABLE IF EXISTS bookfunnel_events;
DROP TABLE IF EXISTS bookfunnel_settings;
