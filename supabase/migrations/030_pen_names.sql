-- ============================================
-- Phase 1: Pen names + Catalog as source of truth
--   A pen name groups books (originals and translations) under a single
--   author persona. Every catalog book belongs to at most one pen name;
--   tracked_books, marketing campaigns, ARCs and KDP reach pen names
--   transitively through their catalog_book_id link.
--
--   pen_name_id is nullable on books because existing rows need a default
--   state — unassigned. A header-level picker can filter all module
--   views by pen name (with "All" as a passthrough).
-- ============================================

CREATE TABLE IF NOT EXISTS pen_names (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- Tailwind color name for chips/badges (e.g. 'pink', 'indigo', 'amber').
  -- Validated client-side; lowercase a-z only.
  color       TEXT NOT NULL DEFAULT 'slate',
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS pen_names_user_name_key
  ON pen_names (user_id, lower(name));

ALTER TABLE pen_names ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pen_names: owner read"   ON pen_names;
DROP POLICY IF EXISTS "pen_names: owner insert" ON pen_names;
DROP POLICY IF EXISTS "pen_names: owner update" ON pen_names;
DROP POLICY IF EXISTS "pen_names: owner delete" ON pen_names;

CREATE POLICY "pen_names: owner read"   ON pen_names FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "pen_names: owner insert" ON pen_names FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pen_names: owner update" ON pen_names FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "pen_names: owner delete" ON pen_names FOR DELETE USING (auth.uid() = user_id);


-- Books opt into a pen name via FK. SET NULL on delete keeps the book
-- and just unassigns it rather than cascading the delete.
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS pen_name_id UUID REFERENCES pen_names(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS books_pen_name_idx ON books (user_id, pen_name_id);
