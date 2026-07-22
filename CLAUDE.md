# Author Command Center — Claude notes

## When adding a Supabase migration
- Apply it to the production database directly (via the Supabase MCP
  `apply_migration`) as part of merging the PR — do NOT ask Melissa to
  paste-and-run SQL by hand. Confirm afterward that the change is live.
- All new migrations must be idempotent (`IF NOT EXISTS`,
  `DROP POLICY/TRIGGER IF EXISTS` before `CREATE`). Supabase Preview
  Branching re-applies migrations against a preview database, and
  non-idempotent statements fail the preview check.

## Sidebar grouping
Modules are grouped into four sections in `src/components/Layout.tsx`
and the same order on `src/pages/Home.tsx`:

1. **Catalog** — Catalog, Writing
2. **Finances** — Book Tracker, Profit, Transactions
3. **Operations** — Inventory, Cross-Sell Analyzer, Upsells
4. **Marketing** — Content Creator, Media, Social Media, Audiobook, KDP Optimizer, Links, ARCs

Settings sits below the groups. Keep new modules placed inside one of
these four groups; ask before introducing a fifth.
