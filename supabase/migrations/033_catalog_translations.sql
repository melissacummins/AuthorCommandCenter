-- ============================================
-- Catalog: translation hierarchy + retire Book Tracker bundles
--
-- Translations get a self-referencing FK on books — each translation
-- row points at the original via parent_book_id and carries a
-- two-letter language code. The Catalog UI collapses translations
-- under the parent in the list view; downstream FKs (Book Tracker,
-- KDP, ARCs, Promotions, Newsletters) keep working because each
-- translation stays its own books row.
--
-- The Book Tracker bundles feature (from Phase 1) is dropped because
-- it didn't match how the user actually thinks about bundles in their
-- workflow — bundles in their world are marketing groupings (series
-- bundles, subgenre bundles on the Shopify site) of already-paid-off
-- books, not the cost-rollup grouping Phase 1 modeled.
-- ============================================

-- New translation fields on books
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS parent_book_id UUID REFERENCES books(id) ON DELETE SET NULL;
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS language TEXT;

-- A parent book can't itself be a translation. We enforce this in the
-- app layer rather than via a CHECK because Postgres can't constrain
-- "lookup the parent's parent_book_id" in a CHECK clause easily.

CREATE INDEX IF NOT EXISTS books_parent_book_idx ON books (parent_book_id);


-- Retire the Phase 1 bundles tables. Drop the junction first (FKs to
-- both sides), then the parent. Use IF EXISTS so re-running the
-- migration in any state is safe.
DROP TABLE IF EXISTS tracked_book_bundle_members;
DROP TABLE IF EXISTS book_bundles;
