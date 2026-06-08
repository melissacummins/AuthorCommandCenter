# Author Command Center — Claude notes

## When adding a Supabase migration
- Migrations apply automatically through the Supabase ↔ GitHub
  integration — no copy-paste needed. On a PR, the `supabase[bot]`
  comment runs new migration files against an ephemeral preview
  database; **merging the PR into `main` applies them to production**
  (project `vinnvzmuuwmssijwdomt`). Don't tell Melissa to paste SQL by
  hand as a routine step.
  - Optional fallback only: if a migration must go live *before* merge,
    the SQL editor is `https://supabase.com/dashboard/project/vinnvzmuuwmssijwdomt/sql/new`.
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
4. **Marketing** — Ad Alchemy, Marketing, Media, Social Media, KDP Optimizer, Links, ARCs

Settings sits below the groups. Keep new modules placed inside one of
these four groups; ask before introducing a fifth.
