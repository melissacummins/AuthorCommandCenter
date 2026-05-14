-- ============================================
-- KDP Optimizer ↔ Catalog linking + JSON import support
--   * Adds book_id FK on kdp_books pointing at the catalog books table
--     so a KDP book record can be linked to a catalog book and have
--     its selected keywords surface in the Catalog overview.
--   * Adds external_id on tropes / keywords / kdp_books so a JSON
--     import from the user's old app can dedupe rows on re-import
--     without violating uniqueness.
-- ============================================

ALTER TABLE kdp_books
  ADD COLUMN IF NOT EXISTS book_id UUID REFERENCES books(id) ON DELETE SET NULL;

ALTER TABLE kdp_books     ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE tropes        ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE keywords      ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS kdp_books_user_external_id_idx
  ON kdp_books(user_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tropes_user_external_id_idx
  ON tropes(user_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS keywords_user_external_id_idx
  ON keywords(user_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS kdp_books_book_idx ON kdp_books(book_id);
CREATE INDEX IF NOT EXISTS keywords_trope_idx ON keywords(trope_id);
