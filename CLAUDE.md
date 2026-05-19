# Author Command Center — Claude notes

## When adding a Supabase migration
- Always include a clickable link to the Supabase SQL editor in the PR
  description so Melissa can paste-and-run without hunting for it:
  `https://supabase.com/dashboard/project/vinnvzmuuwmssijwdomt/sql/new`
- All new migrations must be idempotent (`IF NOT EXISTS`,
  `DROP POLICY/TRIGGER IF EXISTS` before `CREATE`). Supabase Preview
  Branching re-applies migrations against a preview database, and
  non-idempotent statements fail the preview check.

## Sidebar grouping
Modules are grouped into four sections in `src/components/Layout.tsx`
and the same order on `src/pages/Home.tsx`:

1. **Catalog** — Catalog
2. **Finances** — Book Tracker, Profit, Financials
3. **Operations** — Inventory, Cross-Sell Analyzer
4. **Marketing** — Ad Alchemy, Marketing, Media, Social Media, KDP Optimizer, Link Shortener, ARCs

Settings sits below the groups. Keep new modules placed inside one of
these four groups; ask before introducing a fifth.
