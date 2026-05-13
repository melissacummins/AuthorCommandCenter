-- Adds per-unit QA cost to the products table.
-- QA cost = the PA's time spent doing quality control, allocated per book unit.
-- Lets the user see the true cost of a book (printer + QA) when comparing printers.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS qa_cost NUMERIC DEFAULT 0;
