-- Adds a per-product defect rate so true cost per good book can be computed.
-- Stored as a percentage 0-100. When non-zero, the cost model assumes the
-- printer reprints damaged books for free but the PA still QAs every reprint,
-- so QA cost effectively scales by (1 + defect_rate / 100).

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS defect_rate NUMERIC DEFAULT 0;
