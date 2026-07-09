-- Per-book toggle for the ARC applicant book picker.
-- Default TRUE so existing catalog books stay visible. Translations
-- (rows where parent_book_id is set) don't accept ARC applications,
-- so we flip those to FALSE on migration; the checkbox on the book
-- form still lets Melissa override case-by-case.

ALTER TABLE books
  ADD COLUMN IF NOT EXISTS include_in_arcs BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE books
SET include_in_arcs = FALSE
WHERE parent_book_id IS NOT NULL
  AND include_in_arcs IS DISTINCT FROM FALSE;
