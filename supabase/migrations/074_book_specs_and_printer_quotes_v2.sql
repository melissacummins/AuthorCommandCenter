-- Brings the existing book_specs and printer_quotes tables in line with
-- the user's spec sheet from Air Table. The base tables already exist
-- from migration 001 but with a different column layout; this migration
-- adds the fields she actually tracks (Format, Size/Lamination/Paper GSM,
-- Special Add-ons, B/W and Color pages) and Past Order Count on quotes.

ALTER TABLE book_specs
  ADD COLUMN IF NOT EXISTS format TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS lamination TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS paper_gsm TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS special_addons TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS bw_pages INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS color_pages INTEGER DEFAULT 0;

ALTER TABLE printer_quotes
  ADD COLUMN IF NOT EXISTS past_order_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_book_specs_product ON book_specs(product_id);
CREATE INDEX IF NOT EXISTS idx_printer_quotes_product ON printer_quotes(product_id);
