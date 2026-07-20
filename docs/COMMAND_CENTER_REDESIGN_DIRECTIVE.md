# Build Directive: Command Center Redesign

> **Status: approved for build.** This directive follows the merged
> `COMMAND_CENTER_REDESIGN_AUDIT.md` (#243); Melissa approved all its
> recommendations, including the §5 defaults. Build phases in order; each
> phase is its own PR.

**Audience:** the AI model / developer implementing each phase. This document
is self-contained — repo discovery has already been done and decisions are
final. Where this directive conflicts with something in the codebase, the
codebase's existing conventions win — flag the conflict in the PR description
instead of improvising.

**Goal:** turn the Command Center home page from a launcher into a status
board that answers "what needs me today?", and turn the app's hardcoded
visual style into a tokenized system that supports an Ellipsus-style theme
gallery. The visual language moves from bubbly (rounded-2xl, gradient icon
tiles, soft shadows) to flat, square-ish work-tool cards.

---

## 0. Locked decisions (do not relitigate)

1. **Widget layout** — Row 1: *Needs Attention*, *Open Projects*, *Month
   P&L*. Row 2: *Opportunities*, *Upcoming*, *Recent Activity*. Module link
   cards move into a collapsed "Your tools" section below (collapse state
   already exists in `Home.tsx`).
2. **TodayPanel merges into Needs Attention.** The planner's `TodayPanel` no
   longer renders standalone on Home; its content (today's + overdue tasks,
   quick-add) becomes part of the Needs Attention widget.
3. **Inventory action = pre-filled deep link.** "Order" routes to
   `/inventory?po=<productId>&qty=<suggestedQty>`; the Inventory module opens
   its *existing* PO form pre-filled. No PO creation UI on Home.
4. **Recent activity is derived** from `updated_at` across tables. The
   accurate `activity_log` table is Phase 5 and is **deferred — do not build
   it** unless Melissa asks after living with the derived feed.
5. **Themes**: the ten-theme starter set in §5.2, default **Classic** (the
   current red-accent light look) — design and regression-test Classic first.
6. **Sidebar grouping does not change.** The four groups in `CLAUDE.md`
   (Catalog / Finances / Operations / Marketing) keep their names, members,
   and order. This redesign restyles the shell; it does not regroup it.
7. **The widget rule** (§1) is a hard constraint, not a preference.
8. **One new table only**: `book_opportunity_decisions` (Phase 1). No other
   schema changes in phases 0–4.

---

## 1. Ground rules

- **The widget rule:** a home widget may *read* anything, may *deep-link*
  anywhere, may contain at most **one-field inline actions** (check off a
  task, log a word count, dismiss an opportunity), and may **never host a
  module's form**. Anything needing more than one field routes into the
  module with query params pre-filling its existing UI.
- **Widgets load independently.** Each widget fetches via its own function
  from `src/lib/dashboard.ts` and renders its own skeleton → data → error
  states. One slow or failing source must never blank the page or block
  sibling widgets. No widget may import another module's *hook* that fetches
  unbounded data (specifically: do not use `useProfitData` on Home).
- **Scoped queries only** on Home: current + previous month for P&L, next 14
  days for Upcoming, top-N with `limit()` for activity and opportunities.
- **Migrations** must be idempotent (`IF NOT EXISTS`, `DROP POLICY IF
  EXISTS` before `CREATE`) and the PR description must include the SQL
  editor link: `https://supabase.com/dashboard/project/vinnvzmuuwmssijwdomt/sql/new`.
- **Verification floor for every phase:** `npm run lint` (tsc) clean, any
  new pure logic covered by `*.test.ts` run via `npx tsx --test`, and a dev
  server (`npm run dev`) visual check of the changed screens. Phase-specific
  acceptance checks are listed per phase.
- Match existing code style: modules own their `api.ts`/`types.ts`, shared
  code in `src/lib`, Tailwind utility classes, lucide icons, no new
  dependencies without flagging in the PR.

---

## 2. Phase 0 — Design tokens + codemod (PR 1)

**Outcome:** every hardcoded surface/text/border/radius class in `src/`
routed through semantic tokens; app looks *nearly identical* afterward
(Classic theme reproduces today's palette with squarer corners and flatter
cards); one dark theme (Midnight) proves the system.

### 2.1 Token set

Extend the existing `@theme` block in `src/index.css` (keep the
`--color-brand-*` scale as the accent). Add:

```
Surfaces:  --color-surface (cards; today white)
           --color-surface-sunken (page bg; today slate-100)
           --color-surface-hover (row/tile hover; today slate-50)
Borders:   --color-edge (today slate-200), --color-edge-strong (slate-300)
Text:      --color-content (slate-800/900), --color-content-secondary
           (slate-500/600), --color-content-muted (slate-400)
Sidebar:   --color-sidebar (slate-900), --color-sidebar-raised (slate-800),
           --color-sidebar-content (slate-400→white on hover/active),
           --color-sidebar-muted (slate-500), --color-sidebar-edge (slate-700)
Charts:    --color-chart-1 … --color-chart-6 (Recharts + status visuals)
Status:    --color-status-{idea,drafting,editing,preorder,published,paused}-bg/fg
Radius:    --radius-card (default 6px), --radius-control (4px)
Shadow:    --shadow-card (default: none + 1px edge border look)
Optional:  --app-gradient (page-background gradient; unset in most themes)
```

Register each under `@theme` so Tailwind v4 emits `bg-surface`,
`text-content`, `border-edge`, `rounded-card`, `rounded-control`, etc.
`rounded-full` (avatars, pills, dots) stays literal — do not tokenize it.

### 2.2 The codemod

Write `scripts/tokenize_styles.py` (committed, rerunnable, stdlib-only):

- Rewrites class strings across `src/**/*.tsx` per a fixed mapping table
  (the table lives in the script): `bg-white→bg-surface`,
  `bg-slate-50→bg-surface-hover`, `bg-slate-100→bg-surface-sunken`,
  `border-slate-200→border-edge`, `border-slate-300→border-edge-strong`,
  `text-slate-900|800|700→text-content`, `text-slate-600|500→
  text-content-secondary`, `text-slate-400→text-content-muted`,
  `rounded-2xl|xl→rounded-card`, `rounded-lg|md→rounded-control`, sidebar
  `bg-slate-900|800`→sidebar tokens (Layout.tsx only), plus hover:/focus:/
  dark-prefix variants of each.
- Emits a report of every file touched and every **unmatched** slate/white
  usage (e.g. slate used decoratively inside a chart) for manual review —
  ambiguous cases are resolved by hand, not by loosening the regex.
- Idempotent: running it twice produces no further changes.

Manual follow-ups after the codemod (small, judgment-required):

- `Home.tsx` + `Layout.tsx` gradient icon tiles → flat tiles:
  `bg-brand-100 text-brand-600 rounded-control` (per-module gradient/shadow
  fields in `moduleByPath` are deleted).
- `STATUS_COLORS` in `src/modules/catalog/types.ts` → the
  `--color-status-*` variables (classes like `bg-status-drafting-bg
  text-status-drafting-fg`).
- Recharts components: replace hex color props with
  `var(--color-chart-n)`.
- `ThemeContext.tsx` untouched in this phase beyond continuing to work.

### 2.3 Acceptance

- Codemod report shows **zero remaining** `bg-white`/`bg-slate-`/
  `text-slate-`/`border-slate-`/`rounded-xl`/`rounded-2xl` in `src/`
  (excluding the script and index.css), or each survivor is justified in
  the PR description.
- Classic theme screenshots of Home, Catalog, Inventory, Planner, Profit
  match the pre-change look apart from corners/shadows/icon tiles.
- Midnight theme (add `.theme-midnight` block: near-black surfaces,
  slate-100 content, desaturated accents) applied via devtools class shows
  **no white islands** on those five screens.

---

## 3. Phase 1 — Dashboard data layer + opportunities engine (PR 2)

**Outcome:** all queries and logic Home needs, fully tested, with no UI yet
(Home unchanged in this PR). This is deliberately a logic-only PR so review
is about correctness, not pixels.

### 3.1 `src/lib/dashboard.ts`

Independent async functions (no barrel "fetch everything" call):

- `getInventoryAlerts()` → reuse `getProducts()`, `getSalesRates()`,
  `getPendingByProduct()` and the existing
  `calculateProductMetrics(product, allProducts, avgDailyFromOrders)`
  (`src/modules/inventory/utils.ts:31`). Return products whose status is
  `REORDER NOW` or `OUT OF STOCK`, excluding `do_not_reorder` and those
  fully covered by pending POs, each with `{productId, name, sku,
  bookInventory, daysRemaining, reorderQty, reorderCost}`. Sort by
  `daysRemaining` ascending.
- `getMonthPnl()` → **month-scoped** Supabase queries on the Profit
  module's daily-records table (filter `date >= first of previous month`),
  reusing its existing mappers/category math (`ad` vs `revenue` categories).
  Return `{monthRevenue, monthAdSpend, monthNet, prevMonthNet,
  lastEntryDate}`. Must not fetch all history.
- `getOpenProjects()` → books with status `drafting | editing | pre_order`
  joined with their manuscripts (`manuscripts.book_id`). Return per book:
  status, word_count vs target, manuscript status, `pipelinePercent` (see
  3.3), most recent `updated_at`, plus the top "resume" candidates: 3 most
  recently updated non-`final` manuscripts with ids for deep links.
- `getUpcomingDates(days = 14)` → merged, date-sorted:
  `publish_date`/`pre_order_date`/`manuscript_due_date` from books, planner
  tasks with `due_date` in range (not done, kind `task`). Each item:
  `{date, label, kind, href}`.
- `getRecentActivity(limit = 8)` → union of recent `updated_at` rows from
  books, manuscripts, purchase orders, planner tasks (done today), ARC
  entries; each rendered as current-state phrasing ("*The Ringmaster's Game
  Prologue* — manuscript marked Final · 2d ago"). Order by timestamp,
  `limit` per table before merging.
- `getOpportunities(limit = 5)` → wraps the engine (3.2) + dismissals.

### 3.2 `src/lib/opportunities.ts` (pure, no I/O)

`deriveOpportunities(books, audiobookProjects, decisions): Opportunity[]`

Rules (each yields `{bookId, key, kind, label, score, href}`):

- **Translation:** published original (no `parent_book_id`) with no child
  book in language L. Only propose languages from
  `TRANSLATION_LANGUAGES`; rank languages the catalog already publishes in
  above never-used ones.
- **Audiobook:** published, no `isbn_audiobook`, no audiobook project for
  the book → link to `/audiobook`.
- **Format gap:** published with missing `paperback_price` or
  `hardcover_price`.
- **KDP gap:** published with empty `amazon_keywords` → `/kdp-optimizer`.
- **ARC gap:** published in the last 60 days with `include_in_arcs` false.

Scoring: base per kind (audiobook > translation > format > KDP > ARC),
boosted for series (more books in series = higher), zeroed by a dismissal
row. Unit tests cover every rule plus dismissal and language-ranking
behavior.

### 3.3 `pipelinePercent(book, manuscript, audiobookProject)` — also in
`opportunities.ts`, unit-tested. Weighted stages: manuscript exists (10),
draft complete/word target met (25), status ≥ editing (20), ≥ pre_order
(15), published (15), formats priced (10), audiobook done-or-dismissed (5).
Clamp 0–100.

### 3.4 Migration `106_book_opportunity_decisions.sql`

```
book_opportunity_decisions (
  id uuid pk default gen_random_uuid(),
  user_id uuid not null references auth.users,
  book_id uuid not null references books on delete cascade,
  opportunity_key text not null,   -- e.g. 'translation:de', 'audiobook'
  decision text not null default 'dismissed',  -- 'dismissed' | 'planned'
  created_at timestamptz default now(),
  unique (user_id, book_id, opportunity_key)
)
```

Idempotent; RLS matching the other per-user tables; SQL-editor link in the
PR description. `dashboard.ts` gets `setOpportunityDecision()` /
`clearOpportunityDecision()`.

### 3.5 Acceptance

`npm run lint` clean; `npx tsx --test` green on the new tests; a throwaway
harness (or console call) shows each function returning sane data against
dev data. No visual changes.

---

## 4. Phase 2 — Home page rebuild (PR 3)

**Outcome:** the new Home, built on Phase 1's functions only.

Layout: page header (welcome line, smaller than today) → widget grid
(3-col on `xl`, 2-col `md`, 1-col mobile; order per §0.1) → collapsed
"Your tools" module links (restyled flat per Phase 0) → drop the amber
"Data Migration" banner.

Widgets (all `src/components/dashboard/`, shared `WidgetCard` shell:
`bg-surface border-edge rounded-card`, title row with icon + optional
count badge + "open module" arrow):

1. **Needs Attention** — merges: inventory alerts ("Vicious Beast — 12
   left, ~9 days. Order 40 (~$182)" with **Order** →
   `/inventory?po=<id>&qty=<n>`) and today's/overdue planner tasks with
   inline checkbox + the existing one-line quick-add (port behavior from
   `TodayPanel`, then remove `TodayPanel` from Home). Empty state: "Nothing
   needs you — go write."
2. **Open Projects** — per project: title, status pill, `pipelinePercent`
   bar, words vs target; **Continue** → `/writing?manuscript=<id>`.
3. **Month P&L** — revenue / ad spend / net for the current month, delta
   vs last month, and *always* "as of {lastEntryDate}"; link → `/profit-track`.
4. **Opportunities** — top 5 from `getOpportunities()`; each row: label,
   **Start** (deep link) and **Dismiss** (writes a decision row,
   optimistic removal).
5. **Upcoming** — next 14 days list, date-grouped.
6. **Recent Activity** — 8 derived entries with relative timestamps.

Deep-link handling added in this PR:

- `InventoryModule`: read `?po=<productId>&qty=<n>` → open the existing
  PO form pre-filled (product line + qty), then clear the params.
- `WritingModule`: read `?manuscript=<id>` → open that manuscript in the
  editor.

Acceptance: all widgets load independently (throttle network in devtools —
skeletons, no page block); widget rule audit (no multi-field forms); both
deep links land pre-filled; Classic + Midnight screenshots of Home in the
PR; `npm run lint` clean.

---

## 5. Phase 3 — Theme gallery (PR 4)

### 5.1 ThemeContext extension

Replace the 5-accent `Theme` union with theme ids. Each theme is only a
CSS block (`.theme-<id>` in `index.css`) setting the Phase-0 variables;
`ThemeContext` applies the class to `<html>` and persists to localStorage
under the existing `app-theme` key. Migrate stored legacy values
(`red→classic`, `blue|indigo|emerald|violet→their nearest new theme or
classic`). Mark dark themes so `color-scheme: dark` is set.

### 5.2 The ten themes

| id | feel |
|---|---|
| `classic` (default) | today's look: light, red accent |
| `midnight` | near-black, slate text, cool accent |
| `forest` | deep greens, cream surfaces |
| `ocean` | teal/blue, airy light |
| `autumn` | warm rust/amber |
| `winter` | cool grays, ice blue accent |
| `spring` | soft greens/petal accents |
| `sweet-treat` | pinks throughout |
| `paper` | warm off-white mono, high readability |
| `dusk-gradient` | dark violet with `--app-gradient` page background |

Every theme must define **every** variable from §2.1 (charts and status
colors included) — no fallthrough to Classic values inside a dark theme.

### 5.3 Picker

Settings gets a Theme section: grid of swatch cards (surface + accent +
sidebar chips, name), current selection ringed, applies instantly.

### 5.4 Acceptance

Screenshot sweep — Home, Catalog, Inventory, Planner, Profit under every
theme (a small Playwright script using the pre-installed Chromium at
`/opt/pw-browsers/chromium` is encouraged; manual is acceptable). Zero
white islands in dark themes; status pills and charts legible in all ten;
legacy localStorage values migrate without a crash.

---

## 6. Phase 4 — Catalog opportunity checklist (PR 5)

In `BookView`, add a **Checklist** tab (originals only; translations show
a pointer to their parent): the full ungated output of the Phase-1 engine
for that book — formats (✓ / missing / price set), translations per
relevant language (✓ / opportunity / dismissed / planned), audiobook
status (from projects + ISBN), ARC inclusion, keywords — each row with
Start / Dismiss / **Planned** (decision `planned`, shown as a todo rather
than hidden). Pipeline percent shown as a ring at the top. Reuses
`deriveOpportunities` unfiltered (no top-N, no score cutoff).

Acceptance: dismiss/planned round-trips to `book_opportunity_decisions`
and is reflected on the Home widget; tab renders acceptably for a book
with zero gaps and one with many; `npm run lint` clean.

---

## 7. Phase 5 — activity_log (DEFERRED)

Not approved for build. Revisit only if Melissa finds the derived feed too
vague. (Design sketch lives in the audit §2.3; inserts would go in module
`api.ts` mutation helpers, never DB triggers.)

---

## 8. Execution & tooling

- **One phase = one PR**, in order 0→4; each builds on the previous
  merge. Branch naming and push rules per the session's git instructions.
- **Model assignment:** run each phase as a scoped `claude -p` session on
  **Sonnet** (`claude -p --model claude-sonnet-5`), feeding it this
  directive's phase section plus the ground rules (§0–§1). Phase 2 may be
  split into one run per widget if a single run gets long. The Python
  codemod does Phase 0's mechanical rewrite — the model writes/reviews the
  script and resolves the report's ambiguous cases; it does not hand-edit
  123 files.
- **No expensive-model calls inside the build.** The single optional
  Opus/Fable involvement is a design-review pass over Phase 2/3
  screenshots before merge.
- **Free verification, every phase:** `npm run lint`, `npx tsx --test`,
  dev-server screenshots (Playwright/Chromium pre-installed).
- If a phase uncovers a conflict with this directive, ship the codebase's
  convention and flag the conflict in the PR description — do not stop the
  phase to renegotiate.
