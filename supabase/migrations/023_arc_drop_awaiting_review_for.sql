-- Drop the unused awaiting_review_for array column from arc_readers.
-- "Reviewed" alone tells us whether a reader followed through; an explicit
-- "awaiting review for" history is redundant — a book is either in the
-- Reviewed list or it isn't.

ALTER TABLE arc_readers DROP COLUMN IF EXISTS awaiting_review_for;
