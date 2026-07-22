# MCP Connector Tool Catalog — Author Command Center

Design spec for expanding `api/mcp.ts` from one tool (`get_business_snapshot`)
to full parity with the app. **This is a design doc — no tools are built here.**

## Architecture constraints (read before building)

- **One Vercel function** (`api/mcp.ts`) hosts the whole MCP surface — we are
  near Vercel's function cap. Every new tool is a `server.tool(...)` registration
  inside `buildServer()`, not a new file/route.
- **Identity comes from the OAuth token, never a param.** `authenticate()` builds
  a per-request Supabase client carrying the caller's JWT; every query runs under
  that user's RLS. **No tool may accept a `user_id` argument.** When a core
  function needs the id (e.g. `getUpcomingDatesCore`), pass `user.id` from the
  authenticated `User`.
- **Runtime code must not reach into `../src`.** The function imports only from
  `api/_generated/dashboardCore.js`, produced by `scripts/bundle-mcp-core.mjs`
  (esbuild bundles `src/lib/dashboardCore.ts` + its transitive relative imports
  into one self-contained ESM file; npm packages stay external).
  - **Consequence:** the existing module data layers (`src/modules/*/api.ts`) are
    **NOT reusable as-is** — they import the browser singleton `src/lib/supabase.ts`
    (`import.meta.env`, undefined server-side) and hardcode it instead of taking a
    `client` param. Their *logic* is the reference, but each connector-backed
    function must be **re-authored in the client-injected style** (`(client, userId, …)`)
    and placed where the bundler will pick it up.
  - **Two bundling options for new core code:**
    1. Add functions to `src/lib/dashboardCore.ts` (already the entrypoint), or
    2. Create sibling modules (e.g. `src/lib/connectorCore/writing.ts`) **imported
       by `dashboardCore.ts`** so esbuild follows them in — OR extend
       `scripts/bundle-mcp-core.mjs` with additional `entryPoints`. Recommend a
       `src/lib/connectorCore/` folder of client-injected functions, re-exported
       from `dashboardCore.ts`, to keep `dashboardCore.ts` from ballooning.
- **Pure helpers stay reusable.** Type-only / pure modules already pulled into the
  bundle (`opportunities.ts`, `inventory/utils`, `profit-track/utils/*`,
  `catalog/types`, `writing/types` `countWords`/`htmlToPlainText`) are safe to call
  from new core functions.

Legend: **[reuse]** logic already exists in a browser api and needs porting to
client-injected core · **[core-exists]** already in bundled `dashboardCore.ts` ·
**[new]** logic must be written · **[bundle]** must be added to the bundled core.

---

## Domain → table map (RLS: every table below is scoped by `user_id` unless noted)

| Domain (sidebar) | Primary tables | Browser data layer (reference) |
|---|---|---|
| Catalog | `books`, `book_word_logs`, `pen_names`, `book_reviews` | `catalog/api.ts` |
| Writing | `manuscripts`, `manuscript_chapters`, `manuscript_revisions`, `manuscript_word_logs`, `manuscript_chats` | `writing/api.ts` |
| Book Tracker | `tracked_books`, `quarterly_updates` | `book-tracker/api.ts` |
| Profit | `daily_records`, `book_daily_metrics`, `profit_categories`, `weekly_notes`, `monthly_orders`, `monthly_page_reads`, `order_sources`, `user_ui_preferences` | `profit-track/hooks/useProfitData.ts`, `profit-track/utils/*` |
| Transactions | `transactions`, `category_rules`, `manual_subscriptions`, `cash_flow_notes`, `manual_history_entries` | `finstream/api.ts` |
| Inventory | `products`, `inventory_orders`, `purchase_orders`, `book_specs`, `printer_quotes`, `printer_profiles`, `vendors` | `inventory/api.ts` |
| Cross-Sell Analyzer | `cross_sell_reports` (JSONB blob per year) | `cross-sell/CrossSellModule.tsx` |
| Upsells | `upsell_offers`, `upsell_widget_settings`, `upsell_events` | `upsells/api.ts` |
| Content Creator | `content_hooks`, `content_scans`, `content_creatives`, `hook_playbook_entries`, `playbook_rules` | `content-creator/api.ts` |
| Media | `media_generations`, `media_collections`, `media_custom_models`, `media_style_presets` | `media/lib/client.ts` |
| Social Media | `social_accounts`, `social_posts` | `social-media/lib/*` |
| Audiobook | `audiobook_projects`, `audiobook_chapters`, `audiobook_segments` | `audiobook/api.ts` |
| KDP Optimizer | `kdp_books`, `tropes`, `keywords` | `kdp-optimizer/api.ts` |
| Links | `short_links`, `link_clicks`, `link_conversions`, `link_folders`, `bio_settings`, `bio_blocks`, `landing_pages`, `series_pages`, `custom_domains` | `link-shortener/api.ts` |
| ARCs | `arc_readers`, `arc_reader_books` | `arcs/api.ts` |
| Orders (Shopify) | `shopify_orders`, `shopify_settings`, `shopify_sync_log` | `orders/api.ts` |
| Planner (Upcoming) | `planner_tasks`, `planner_notes`, `planner_time_sessions`, `planner_settings` | `planner/api.ts` |

---

# READ TOOLS

Reads are low-risk (RLS-scoped, no mutation) and should ship first. All return
JSON-serialized text content, matching `get_business_snapshot`.

## Existing
- **`get_business_snapshot`** — the day's whole picture. **[core-exists]**
  `getBusinessSnapshot(client, user.id)`.

## Catalog
- **`list_books`** — All catalog books with status, series, prices, ISBNs, dates,
  tropes, keywords. Params: optional `status`, `series`, `search`.
  Table `books`. **[reuse]** port `catalog/api.listBooks`. **[bundle]**
- **`get_book`** — One book's full record + linked manuscript summary + pipeline
  percent. Params: `book_id`. Uses `books` + `manuscripts` + `pipelinePercent()`
  (pure). **[reuse]/[bundle]**
- **`get_book_checklist`** — Opportunities + pipeline % + translations-done for one
  book. Params: `book_id`. **[reuse]** `dashboard.getBookChecklist` logic ported to
  client-injected (engine `deriveOpportunities` is already pure). **[bundle]**
- **`list_opportunities`** — Ranked catalog-wide opportunities (audiobook,
  translation, format, KDP, ARC gaps). Params: optional `limit`. **[reuse]**
  port `dashboard.getOpportunities`; `opportunities.ts` is already pure. **[bundle]**
- **`list_pen_names`** — Pen names for attribution. Table `pen_names`. **[new]/[bundle]**

## Writing (see §"Manuscript storage facts" below)
- **`list_manuscripts`** — Title, status, word_count, linked book, updated_at.
  Table `manuscripts`. **[reuse]** `writing/api.listManuscripts`. **[bundle]**
- **`get_manuscript`** — One manuscript + its chapter list (idx, title, word_count,
  and optionally `content_html`). Params: `manuscript_id`, optional
  `include_content` (default false — chapter bodies are large). Tables
  `manuscripts` + `manuscript_chapters`. **[reuse]** `getManuscript` +
  `listChapters`. **[bundle]**
- **`get_manuscript_text`** — Plain-text of a manuscript (or subset of chapters),
  chapters joined with titled separators. Params: `manuscript_id`, optional
  `chapter_ids`. **[reuse]** `getManuscriptPlainText` (uses pure `htmlToPlainText`).
  **[bundle]**
- **`list_chapters`** — Chapter index for a manuscript (id, idx, title, word_count),
  no bodies. Params: `manuscript_id`. **[reuse]** `listChapters`. **[bundle]**

## Book Tracker
- **`list_tracked_books`** — Payoff tracker rows: dev cost, cost breakdown,
  cumulative profit, status, payoff date/quarter, months-to-payoff. Table
  `tracked_books`. **[reuse]** `book-tracker/api.listTrackedBooks`. **[bundle]**
- **`list_quarterly_updates`** — Profit history entries per tracked book. Params:
  optional `tracked_book_id`. Table `quarterly_updates`. **[reuse]**

## Profit
- **`get_month_pnl`** — Current + previous month revenue / ad spend / net + "as-of"
  date. **[core-exists]** `getMonthPnlCore`.
- **`get_profit_records`** — Daily records over a date range with computed metrics
  (revenue, ad spend, net per day). Params: `start`, `end`. Tables `daily_records` +
  `profit_categories`; reuse pure `calculateMetrics`, `dailyRecordFromDb`,
  `profitCategoryFromDb` (already bundled). **[new core]/[bundle]**
- **`list_profit_categories`** — User's ad/revenue category config. Table
  `profit_categories`. **[new]/[bundle]**

## Transactions
- **`list_transactions`** — Bank/finance transactions with filters. Params: optional
  `month` (YYYY-MM), `type` (income|expense), `category`, `search`. Table
  `transactions`. **[reuse]** `finstream/api.getTransactions`. **[bundle]**
- **`get_monthly_financials`** — Per-month income/expense/net + category breakdown.
  Params: optional `months`. **[reuse]** `getMonthlySummaries`. **[bundle]**
- **`list_subscriptions`** — Recurring vendor subscriptions. Table
  `manual_subscriptions`. **[reuse]** `getSubscriptions`.
- **`list_cash_flow_notes`** — Existing free-text per-month cash-flow notes (NOT
  structured projections — see §Cash flow). Table `cash_flow_notes`. **[reuse]**

## Inventory
- **`get_inventory_alerts`** — Reorder-now / out-of-stock products with suggested
  qty and cost. **[core-exists]** `getInventoryAlertsCore`.
- **`list_products`** — All inventory products with stock, costs, SKUs. Table
  `products`. **[reuse]** `inventory/api.getProducts`. **[bundle]**
- **`list_purchase_orders`** — POs with status (pending/arrived), qty, dates.
  Params: optional `status`. Table `purchase_orders`. **[new]/[bundle]**

## Cross-Sell Analyzer
- **`get_cross_sell_report`** — Stored cross-sell analysis for a year (JSONB blob).
  Params: optional `year`. Table `cross_sell_reports`. **[new]/[bundle]**

## Upsells
- **`list_upsell_offers`** — Configured upsell/cross-sell offers + enabled state.
  Table `upsell_offers`. **[reuse]** `upsells/api.getOffers`.
- **`get_upsell_stats`** — Impression/conversion stats per offer. Table
  `upsell_events`. **[reuse]** `getOfferStats`.

## Content Creator
- **`list_content_hooks`** — Extracted marketing hooks for a book, with status.
  Params: `book_id`. Table `content_hooks`. **[reuse]** `listHooks`.
- **`list_creatives`** — Generated creatives (captions/graphics/video) for a book.
  Params: `book_id`, `type`. Table `content_creatives`. **[reuse]** `listCreatives`.

## Media
- **`list_media_generations`** — Generated images/videos with prompt, model, status,
  output URL. Params: optional `kind` (image|video), `collection_id`. Table
  `media_generations`. **[new]/[bundle]**
- **`list_media_collections`** — Media collections/folders. Table
  `media_collections`. **[new]/[bundle]**

## Social Media
- **`list_social_posts`** — Synced posts with metrics (impressions, reach, likes,
  comments, saves), permalink, caption. Params: optional `platform`, `limit`. Table
  `social_posts`. **[new]/[bundle]**
- **`list_social_accounts`** — Connected accounts (platform, username, display name).
  **Return non-secret columns only** — never the `encrypted_access_token*` columns.
  Table `social_accounts`. **[new]/[bundle]**

## Audiobook
- **`list_audiobook_projects`** — Projects with status, linked book. Table
  `audiobook_projects`. **[reuse]** `audiobook/api.listProjects`.
- **`get_audiobook_project`** — One project + chapters + segment counts. Params:
  `project_id`. Tables `audiobook_projects` + `audiobook_chapters` +
  `audiobook_segments`. **[reuse]** `getProject`/`listChapters`/`listSegments`.

## KDP Optimizer
- **`list_kdp_books`** — KDP book entries. Table `kdp_books`. **[reuse]** `listKdpBooks`.
- **`list_tropes`** — Tropes with descriptions. Table `tropes`. **[reuse]** `listTropes`.
- **`list_keywords`** — Keywords, optionally grouped by trope. Params: optional
  `trope_id`. Table `keywords`. **[reuse]** `listKeywords`.

## Links
- **`list_short_links`** — Short links with destination, slug, folder. Table
  `short_links`. **[reuse]** `link-shortener/api.listLinks`.
- **`get_link_stats`** — Click counts / conversions for a link. Params: `link_id`.
  Tables `link_clicks` + `link_conversions`. **[reuse]** `listClicks`/`listConversions`.
- **`list_landing_pages`** / **`list_series_pages`** — Public book/series pages.
  Tables `landing_pages` / `series_pages`. **[reuse]**

## ARCs
- **`list_arc_readers`** — ARC readers with status, socials, assigned books.
  Params: optional `status`. Tables `arc_readers` + `arc_reader_books`. **[reuse]**
  `arcs/api.listArcReaders`.

## Orders (Shopify)
- **`list_shopify_orders`** — Synced Shopify orders with line items, dates, refunds.
  Params: optional `location_id`. Table `shopify_orders`. **[reuse]** `getSyncedOrders`.
- **`get_shopify_sync_status`** — Last sync time + recent sync log. Table
  `shopify_sync_log`. **[reuse]** `getSyncLogs`.

## Planner
- **`get_today_tasks`** — Open/overdue tasks for today. **[core-exists]**
  `getTodayTasksCore`.
- **`get_upcoming`** — Everything dated in the next N days (releases, pre-orders,
  manuscript deadlines, tasks). Params: optional `days`. **[core-exists]**
  `getUpcomingDatesCore`.
- **`list_tasks`** — Planner tasks with filters. Params: optional `done`,
  `someday`, date range. Table `planner_tasks`. **[reuse]** `planner/api.listTasks`.

---

# WRITE TOOLS

**Global write guardrails**
- Every write runs under the caller's RLS — a tool physically cannot mutate another
  user's rows, but that is not a substitute for validation.
- **No connector tool should perform hard `DELETE`s of user content.** Where the app
  offers deletes, the connector should prefer status changes / archival, or omit the
  delete entirely. Deletes below are explicitly flagged.
- Prefer **append / insert** and **narrow single-field updates** over
  replace-everything operations.
- Validate foreign keys (e.g. `book_id`, `manuscript_id`) belong to the caller
  before writing children.

## Writing — manuscripts & chapters (HIGHEST-CARE; see storage facts below)

- **`append_manuscript_chapter`** — Add a **new** chapter to the END of a manuscript
  without touching any existing chapter. Params: `manuscript_id`, `title`, `content`
  (plain text or HTML; wrap plain text in `<p>`). Target `manuscript_chapters`.
  **[new core]/[bundle]** — DO NOT reuse `saveChapters` (destructive). New function
  mirrors `addChapter` but writes content in one insert:
  1. `SELECT idx FROM manuscript_chapters WHERE manuscript_id = $1` → `nextIdx = max(idx)+1` (0 if none).
  2. `INSERT` one row `{manuscript_id, user_id, idx: nextIdx, title, content_html, word_count: countWords()}`.
  3. Roll up word count (port `syncWordCount`) onto `manuscripts.word_count` +
     `manuscript_word_logs`, and onto the linked book if any.
  - **GUARDRAILS: append-only. Never deletes or renumbers existing chapters. Never
    calls the app's `saveChapters` (which does `delete().eq('manuscript_id', …)`
    first — that would erase the whole manuscript).**
- **`create_manuscript`** — Start a new manuscript shell (optionally linked to a
  book). Params: `title`, optional `book_id`, `status`. Target `manuscripts`.
  **[reuse]** `createManuscript`. GUARDRAIL: creation only; no chapter side effects.
- **`update_chapter_content`** — Replace ONE chapter's body. Params: `chapter_id`,
  `content`. Target `manuscript_chapters`. **[reuse]** `updateChapter` logic.
  **GUARDRAILS / PRODUCT DECISION:** this **overwrites** that chapter's
  `content_html`. Before overwriting, the tool **MUST snapshot the prior content
  into `manuscript_revisions`** (port `createRevision`, as `restoreRevision` does)
  so the change is reversible. **Flag for product sign-off** — recommend shipping
  `append_manuscript_chapter` first and treating in-place overwrite as a later,
  revision-protected addition. Never expose a raw "delete chapter" tool.
- **`append_manuscript_chat_message`** — Append a message to a manuscript's chat
  thread. Params: `manuscript_id`, `role`, `content`. Target `manuscript_chats`.
  **[reuse]** `addManuscriptChatMessage`. Append-only.

## Catalog
- **`update_book_fields`** — Narrow updates to a book: status, dates, prices, blurb,
  keywords, tropes, ISBNs. Params: `book_id` + a whitelist of updatable fields.
  Target `books`. **[reuse]** `updateBook`. GUARDRAILS: field whitelist (no
  `user_id`/`id`/timestamps); no delete. Consider read-back confirmation for
  `status` transitions.
- **`create_book`** — New catalog book. Params: catalog fields. **[reuse]**
  `createBook`. GUARDRAIL: create only.
- **`set_opportunity_decision`** — Mark an opportunity planned/dismissed. Params:
  `book_id`, `opportunity_key`, `decision`. Target `book_opportunity_decisions`
  (upsert). **[reuse]** `dashboard.setOpportunityDecision`. Safe (idempotent upsert).

## Planner
- **`create_task`** — Add a planner task. Params: `title`, optional `due_date`,
  `kind`, `someday`, `notes`. Target `planner_tasks`. **[reuse]** `createTask`. Append-only.
- **`complete_task`** — Mark a task done (sets `done`/`done_at`). Params: `task_id`.
  Target `planner_tasks`. **[reuse]** `updateTask`. GUARDRAIL: status update only, no delete.

## Inventory
- **`adjust_stock`** — Add/subtract product stock, writing an `inventory_orders`
  audit row (the app never mutates `products.book_inventory` without a log). Params:
  `product_id`, `inventory_type` (book|bundle), `delta`, `source`, `notes`. Targets
  `products` + `inventory_orders`. **[reuse]** `inventory/api.adjustStock`.
  GUARDRAILS: always writes the audit `inventory_orders` row; never a bare product
  update. **PRODUCT DECISION:** confirm whether the connector should be allowed to
  move real stock at all, or be read-only for inventory.
- **`create_purchase_order`** — Log a PO (feeds reorder-alert suppression). Params:
  `product_id`, `product_name`, `quantity`, dates. Target `purchase_orders`.
  **[new]/[bundle]**. Append-only.

## Book Tracker
- **`add_quarterly_update`** — Record a quarter's profit for a tracked book;
  recomputes payoff. Params: `tracked_book_id`, `quarter_label`, `profit`. Targets
  `quarterly_updates` (+ recompute onto `tracked_books`). **[reuse]**
  `addQuarterlyUpdate` / `recomputeBookPayoff`. Append-oriented.

## Transactions
- **`add_transaction`** — Insert one finance transaction. Params: `date`,
  `description`, `amount`, `type`, `category`. Target `transactions`. **[reuse]**
  `addTransaction`. Append-only. (Skip `bulkDelete*` — never expose.)
- **`save_cash_flow_note`** — Upsert the existing free-text monthly note. Params:
  `month`, `note`. Target `cash_flow_notes`. **[reuse]** `saveCashFlowNote`.

## KDP Optimizer
- **`create_trope`** / **`update_book_keywords`** — Add a trope; set a book's Amazon
  keywords. **[reuse]** `createTrope`, `updateBook`(amazon_keywords). Non-destructive.

## Content Creator
- **`set_hook_status`** — Approve/reject a marketing hook. Params: `hook_id`,
  `status`. Target `content_hooks`. **[reuse]** `setHookStatus`. Status update only.

## Cash Flow — NEW FEATURE (needs schema change, see below)
- **`upsert_cash_flow_projection`** — Create/update one expected-cash-flow line item
  for a week/month. Params: `period_type`, `period_start`, `label`, `expected_amount`,
  `direction`, optional `category`, `status`, `notes`. Target new
  `cash_flow_projections`. **[new core + migration]**. Upsert on
  `(user_id, period_type, period_start, label)`; no destructive delete (offer a
  `status='cancelled'` instead).
- **`list_cash_flow_projections`** (read) — Params: optional `period_type`, date
  range. Returns projected line items grouped by period with inflow/outflow/net.

---

# Cash flow — storage verdict & proposed table

**Verdict: NO structured projected/expected cash-flow storage exists.** What exists:
- `cash_flow_notes` — `(user_id, month, note TEXT)`. **Free-text note only**, one per
  month. Not structured, no amounts. (`finstream/api.getCashFlowNotes`/`saveCashFlowNote`.)
- `manual_history_entries` — `(user_id, month, amount, description)`. **Historical
  actuals**, not forward projections.
- `daily_records` / `transactions` — recorded actuals, past-facing.
- `purchase_orders.expected_arrival` — expected inventory arrival dates, not money.

Nothing stores "expected profit coming in during week/month X." Melissa's
"cash flow with expected profit" task is confirmed **not backed by the app.**

## Proposed migration (idempotent, RLS, one row per projection line item)

`supabase/migrations/108_cash_flow_projections.sql`:

```sql
CREATE TABLE IF NOT EXISTS cash_flow_projections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_type    TEXT NOT NULL DEFAULT 'month'
                   CHECK (period_type IN ('week', 'month')),
  period_start   DATE NOT NULL,          -- Monday of the week, or 1st of the month
  label          TEXT NOT NULL DEFAULT '',      -- e.g. "Amazon royalty", "Shopify payout"
  category       TEXT,                          -- optional grouping
  direction      TEXT NOT NULL DEFAULT 'inflow'
                   CHECK (direction IN ('inflow', 'outflow')),
  expected_amount NUMERIC NOT NULL DEFAULT 0,   -- always positive; direction gives sign
  status         TEXT NOT NULL DEFAULT 'expected'
                   CHECK (status IN ('expected', 'confirmed', 'received', 'cancelled')),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, period_type, period_start, label)
);

CREATE INDEX IF NOT EXISTS cash_flow_projections_user_period_idx
  ON cash_flow_projections(user_id, period_type, period_start);

ALTER TABLE cash_flow_projections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cash flow projections: owner read"   ON cash_flow_projections;
DROP POLICY IF EXISTS "Cash flow projections: owner insert" ON cash_flow_projections;
DROP POLICY IF EXISTS "Cash flow projections: owner update" ON cash_flow_projections;
DROP POLICY IF EXISTS "Cash flow projections: owner delete" ON cash_flow_projections;

CREATE POLICY "Cash flow projections: owner read"   ON cash_flow_projections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Cash flow projections: owner insert" ON cash_flow_projections FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Cash flow projections: owner update" ON cash_flow_projections FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Cash flow projections: owner delete" ON cash_flow_projections FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION cash_flow_projections_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cash_flow_projections_updated_at ON cash_flow_projections;
CREATE TRIGGER cash_flow_projections_updated_at
  BEFORE UPDATE ON cash_flow_projections
  FOR EACH ROW EXECUTE FUNCTION cash_flow_projections_set_updated_at();
```

PR must include the SQL-editor link per `CLAUDE.md`:
`https://supabase.com/dashboard/project/vinnvzmuuwmssijwdomt/sql/new`

---

# Recommended build order (phases)

**Phase 1 — Reads, batch 1 (reuse existing bundled core): ~5 tools.**
`get_month_pnl`, `get_inventory_alerts`, `get_today_tasks`, `get_upcoming`,
plus keep `get_business_snapshot`. Zero new core code — thin wrappers over
`dashboardCore.ts`. Fastest parity win.

**Phase 2 — Reads, batch 2 (port module apis to client-injected core): ~28 tools.**
All remaining `list_*`/`get_*` across Catalog, Writing, Book Tracker, Profit,
Transactions, Inventory, Cross-Sell, Upsells, Content Creator, Media, Social,
Audiobook, KDP, Links, ARCs, Orders, Planner. Work: build
`src/lib/connectorCore/*` client-injected functions (or extend `dashboardCore.ts`)
and extend `scripts/bundle-mcp-core.mjs` if adding entrypoints. Highest volume,
all low-risk.

**Phase 3 — Writes, grouped by domain (safe, append/upsert first): ~12 tools.**
- 3a Writing: `append_manuscript_chapter` (the flagship write, append-only),
  `create_manuscript`, `append_manuscript_chat_message`.
- 3b Catalog/Planner: `update_book_fields`, `create_book`,
  `set_opportunity_decision`, `create_task`, `complete_task`.
- 3c Finance/Tracker: `add_transaction`, `save_cash_flow_note`,
  `add_quarterly_update`.
- 3d KDP/Content: `create_trope`, `update_book_keywords`, `set_hook_status`.
Defer/flag for product sign-off: `update_chapter_content` (revision-guarded),
`adjust_stock` + `create_purchase_order` (real stock movement).

**Phase 4 — Cash-flow feature (schema change): ~2 tools + 1 migration.**
Ship migration `108_cash_flow_projections.sql`, then
`upsert_cash_flow_projection` (write) and `list_cash_flow_projections` (read).
Last because it is the only item requiring a new table.

**Rough totals:** ~33 read tools, ~14 write tools (+2 cash-flow) across 4 phases.
