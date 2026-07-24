# Author Command Center — Claude notes

## When adding a Supabase migration
- Migrations apply AUTOMATICALLY when the PR merges, via the Supabase ↔
  GitHub branching integration. **NEVER ask Melissa to paste-and-run SQL by
  hand** — that is the whole point of the integration. Just ship the
  `NNN_name.sql` file in the PR.
- ALWAYS VERIFY it actually landed. Auto-apply has silently no-op'd before,
  and the missing column/table then breaks the app. After the PR merges,
  confirm against production (project `vinnvzmuuwmssijwdomt`) with the
  Supabase MCP — do NOT assume:
  - `list_migrations` includes the new `NNN` version, AND
  - the change is really there, e.g.
    `select column_name from information_schema.columns where table_name='<table>' and column_name='<col>';`
    (or an equivalent check for the table/policy the migration adds).
- If verification shows it did NOT apply, fall back to applying it yourself
  via the Supabase MCP `apply_migration`, then realign the version number:
  `apply_migration` records it under an auto-generated TIMESTAMP that does
  NOT match this repo's `NNN_name.sql` numbering (which makes branching
  report "Remote migration versions not found in local migrations
  directory"). Fix it right after:
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
