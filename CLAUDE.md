# Author Command Center — Claude notes

## When adding a Supabase migration
- Apply it to the production database directly (via the Supabase MCP
  `apply_migration`) as part of merging the PR — do NOT ask Melissa to
  paste-and-run SQL by hand. Confirm afterward that the change is live.
- IMPORTANT: `apply_migration` records the migration under an auto-generated
  TIMESTAMP version, which does NOT match this repo's `NNN_name.sql`
  numbering and makes the Supabase CLI/branching report "Remote migration
  versions not found in local migrations directory". Right after applying,
  realign the history so remote matches the file:
  `UPDATE supabase_migrations.schema_migrations SET version='<NNN>', name='<name>' WHERE version='<timestamp>';`
  (verify with `select version, name from supabase_migrations.schema_migrations order by version desc limit 5;`).
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
