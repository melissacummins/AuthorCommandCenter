-- ============================================
-- Bio page "email" block: a newsletter signup form that subscribes
--   visitors to one of the author's Klaviyo lists.
--   klaviyo_list_id : the target list (chosen by the author)
--   button_label    : CTA text (defaults to "Subscribe" when blank)
-- Idempotent.
-- ============================================

ALTER TABLE bio_blocks ADD COLUMN IF NOT EXISTS klaviyo_list_id TEXT;
ALTER TABLE bio_blocks ADD COLUMN IF NOT EXISTS button_label    TEXT;

ALTER TABLE bio_blocks DROP CONSTRAINT IF EXISTS bio_blocks_type_check;
ALTER TABLE bio_blocks
  ADD CONSTRAINT bio_blocks_type_check CHECK (type IN ('section', 'image', 'buttons', 'email'));
