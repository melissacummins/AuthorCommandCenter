# Command Center Redesign — Audit & Build Plan (for discussion)

> **Status: DRAFT for Melissa's review.** Nothing in this document has been
> built. This is the audit + proposed plan; once we've discussed and settled
> it, the actual build directive (the instructions another model follows)
> gets written from the decisions here, in the same style as
> `WRITING_MODULE_DIRECTIVE.md`.

**What was asked:** audit the redesign idea (actionable home page, activity
feed, per-book opportunities, revenue/dates on home, resume-writing, production
progress, square-cornered visual language, Ellipsus-style themes), flag where
it works and where it doesn't, and propose the cheapest toolchain that builds
it well.

---

## 1. What the codebase already gives us (audit findings)

Good news first: **almost every widget you want can be derived from data that
already exists.** No big new data model is needed.

| You want | Already in the database | Gap |
|---|---|---|
| "Do I need to order inventory, and how much?" | The Inventory module already computes `reorderThreshold`, `reorderQty`, `reorderCost`, and `do_not_reorder` per product (`src/modules/inventory/utils.ts:105-141`), plus pending-PO quantities (`getPendingByProduct`). | None. A home widget can reuse these functions as-is. |
| "Where are my books? I finished The Ringmaster's Game Prologue and the home page doesn't know." | Catalog `books.status` (idea → drafting → editing → pre_order → published → paused) with dates; Writing `manuscripts.status` (draft/revising/final) linked to books via `book_id`; word counts + targets with daily logs. | No event log — the app records *current state*, not *what changed when* (see §3.3). |
| Opportunities (translate X, make audiobook of Y) | Books carry `language`/`parent_book_id` (translations link to originals), per-format ISBNs & prices (ebook/paperback/hardcover/audiobook), audiobook projects with status, ARC inclusion, keywords, tropes. | Pure derivation — "published original with no `de` child" = translation opportunity. Needs one tiny new table so dismissed suggestions stop nagging (§3.4). |
| Current-month revenue | Profit module stores daily revenue/ad-spend records and has all the calculation utilities. | The existing hook (`useProfitData`) fetches **every row of every table, paginated** — fine inside the module, far too heavy for the home page (§3.2). Needs one month-scoped query. |
| Upcoming dates | `publish_date`, `pre_order_date`, `manuscript_due_date` on books; Planner tasks with `due_date` + recurrence; time blocks. | None — just a merged query. |
| Resume creating | Manuscripts with `updated_at`, chapter structure, word counts. | None — "most recently touched non-final manuscript" is a one-liner. |
| Production progress | Book status + manuscript status + word count vs target + format ISBNs + audiobook project status. | None — a per-book "pipeline completeness" percent is derivable. |
| Themes | A `ThemeContext` already exists with 5 accent themes (red/blue/indigo/emerald/violet) driven by `--color-brand-*` CSS variables in `src/index.css`. | **The big one:** only *one* component actually uses the brand tokens. **123 of ~150 component files hardcode** `bg-white`, `text-slate-*`, `border-slate-200`, `rounded-2xl`, gradient classes. Real themes (midnight, forest, ocean…) recolor *surfaces*, not just accents — so the hardcoded classes must be migrated to semantic tokens first (§3.1). |

Also relevant: Recharts, `motion`, and lucide-react are already installed
(donut/progress visuals and transitions cost nothing new), and the repo already
has a directive-doc convention in `docs/` that the build instructions will follow.

---

## 2. Idea-by-idea verdict

### 2.1 Squares over bubbles — ✅ yes, and make it a token, not a rewrite
Agree with the instinct: screenshot 1's flat, tight rectangles read as "work
tool"; the current gradient-icon cards read as "consumer app." But don't
hand-edit 123 files from `rounded-2xl` to `rounded-md`. Define **radius and
shadow tokens** (`--radius-card`, `--radius-control`, `--shadow-card`) and
mechanically rewrite the hardcoded classes to them. Then "squarish vs soft"
becomes a *theme property* — your default theme sets 4–6px corners and flat
borders, and any future theme can soften it without touching components. Same
codemod pass fixes the gradient-icon-tile look (flat accent-tinted icon
squares like screenshot 1).

### 2.2 Actionable home page — ✅ yes, with one guardrail
The vision is right: the home page should answer "what needs me today?" not
"which apps do I own?" The guardrail: **widgets summarize and deep-link; they
don't re-implement module UIs.** The failure mode of "full capabilities on the
home page" is maintaining two copies of the purchase-order form, two copies of
the task editor, etc. — every module change then breaks the dashboard.

The pattern that gets you 95% of the value at 10% of the cost:

- **Inventory widget:** "3 products below reorder point — Vicious Beast
  (order 40, ~$182)…" with an **Order** button that routes to
  `/inventory?po=<productId>` and the Inventory module opens its *existing* PO
  form pre-filled. One new query param per module, no duplicated forms.
- **Cheap inline actions stay inline** where they're one field: check off a
  task, log today's words, dismiss an opportunity.

So: see everything on Home, do one-click things on Home, and land *inside the
right form, pre-filled* for anything with real workflow.

### 2.3 Recent activity feed — ✅ worth it, two-step honesty about the data
Screenshot 2's "Recently updated / Resume creating" is the best part of that
design. Two ways to build it:

1. **Derived feed (Phase 1):** union of `updated_at` across books,
   manuscripts, POs, tasks, ARC entries → "Ringmaster's Game Prologue —
   manuscript marked Final · 2d ago" style entries. Zero migrations, but it
   only knows *that* something changed recently and its current state, not the
   full change history (it can't show "status went from X→Y three edits ago").
2. **Real `activity_log` table (Phase 5, optional):** one small table, with
   inserts added inside the existing `api.ts` mutation helpers (NOT DB
   triggers — triggers on 20+ tables are a migration-maintenance tax).
   Accurate history, survives multi-edits.

Recommendation: ship the derived feed first; add the log table only if the
derived feed feels too vague in practice. Don't build the accurate one on
day 1 — it touches every module's api.ts and slows the whole redesign.

### 2.4 Opportunities checklist — ✅ the highest-value new idea. Build it as an engine, show it in two places
This deserves to be a first-class concept, not a widget hack:

- **`src/lib/opportunities.ts`** — a pure function: books + audiobook projects
  + products in → scored list out. Rules like: published original with no
  German/French/Spanish child → *translation opportunity*; no audiobook ISBN
  and no audiobook project → *audiobook opportunity*; published with no
  paperback price → *format gap*; published but zero keywords → *KDP gap*;
  series where book 1 is wide but book 3 isn't → *distribution gap*. Pure
  functions = unit-testable for free, no AI involved at runtime.
- **Home widget:** top-N opportunities across the catalog ("Vicious Beast has
  no audiobook", "Crowned In Blood has no DE translation") with
  **Start** → deep-link and **Dismiss / Not planned**.
- **Catalog book view:** a per-book checklist tab showing the full derivation
  (formats ✓/✗, translations ✓/✗/dismissed, audiobook, ARC, keywords) — this is
  your per-book "what could this book still become" view, and it doubles as
  the production-pipeline record.

**Why the dismissal table is non-negotiable:** without it, "translate
Vicious Beast into Polish" nags forever after you've decided never to. One
small idempotent migration: `book_opportunity_decisions (book_id,
opportunity_key, decision, decided_at)`. That's the only schema change in the
whole core plan.

### 2.5 Revenue on home — ✅ cheap, with one honest caveat
A month-to-date card (revenue, ad spend, net, vs last month, "as of <last
entry date>") reusing the Profit module's existing math. The caveat: Profit is
manually entered, so the card is only as fresh as your last entry — which is
why it must show its "as of" date, so a quiet week reads as "not entered yet,"
not "earned nothing." Requires the one month-scoped query noted in §3.2.

### 2.6 Upcoming dates — ✅ trivial merge
Releases (`publish_date`), pre-orders going live, manuscript due dates, and
Planner tasks/meetings in the next 14 days, one chronological list, each
deep-linking to its module. Nothing to debate.

### 2.7 Resume creating — ✅ trivial
Last 3 touched non-final manuscripts with a progress bar (word count vs
target) and a **Continue** button straight into the Writing editor at that
manuscript. Directly answers "what was I working on?"

### 2.8 Production progress bars — ✅ as a derived percent, ❌ not screenshot 4's grid
Agree with your read of image 4: a 7,500-cell editions matrix is their answer
to *their* catalog shape. Your version falls out of §2.4 for free: each open
book gets a pipeline percent (manuscript → editing → formats → published →
audiobook/translations planned-vs-done) shown as a compact bar/ring on the
home "open projects" widget and, in full, on the Catalog checklist tab. Same
data, no new UI paradigm.

### 2.9 Themes — ✅ very doable, and it's the reason to do the token pass first
Once §3.1's tokenization is done, an Ellipsus-style theme is **just a CSS
variable block** (~40 lines): surfaces, text tones, accent scale, sidebar
colors, radius, optional background gradient. Ten themes ≈ one afternoon of
palette authoring, not engineering: Classic (current red), Midnight, Forest,
Ocean, Autumn, Winter, Spring, Sweet Treat, Mono/Paper, Gradient Dusk. The
picker in Settings shows live swatch previews; selection persists in the
existing `ThemeContext` (extended from 5 accent names to full theme objects,
localStorage today, per-user Supabase column later if you want it to follow
you across devices).

Two theming cautions from experience:
- **Dark themes are all-or-nothing.** One un-migrated `bg-white` card in a
  midnight theme is a glaring white island. This is why the codemod must
  sweep *every* file and why the build phases below put tokenization first
  and verify it with screenshots per theme.
- **Charts and status pills need theme-aware colors too** (Recharts hexes and
  the `STATUS_COLORS` maps are hardcoded) — the directive will route them
  through CSS variables as part of the same pass.

---

## 3. Where this can go wrong (the honest-concerns section)

1. **Theming debt is the iceberg.** The visible work is "add themes"; the real
   work is migrating 123 files of hardcoded color/radius classes to tokens.
   Done by hand or by a model editing file-by-file, it's slow, expensive, and
   error-prone. Done by a **Python codemod** (regex/AST rewrite of a fixed
   mapping like `bg-white → bg-surface`, `text-slate-800 → text-content`,
   `rounded-2xl → rounded-card`), it's minutes and free, with a model only
   reviewing the diff and the ~5% of genuinely ambiguous spots (e.g. slate
   used decoratively vs. semantically).
2. **Home-page weight.** Eight widgets naively mounted = eight fat queries on
   every login (the Profit hook alone pages through *all* daily records ever).
   The directive will mandate a single `src/lib/dashboard.ts` data layer:
   scoped queries (current month only, next 14 days only, top-N only), fired
   in parallel, each widget rendering independently as its data lands — so
   one slow source never blanks the page.
3. **Recent activity can overpromise.** Without an event log the feed is
   "current state, recently changed." That's 90% of the value; just don't
   expect "show me everything that happened to this book in March" until/if
   Phase 5 adds the log table.
4. **Opportunity fatigue.** An engine that nags about every theoretical
   translation in 16 languages trains you to ignore the widget. Mitigations:
   dismissals persist (§2.4), languages you've never published in rank below
   ones you have, and the home widget caps at ~5 items — the full firehose
   lives on the per-book tab.
5. **Scope creep risk: Home as super-app.** Restated as a rule the directive
   will enforce: *a widget may read anything, may deep-link anywhere, may
   contain at most one-field inline actions, and may never host a module's
   form.* ("Order" pre-fills Inventory's PO form; it doesn't recreate it.)
6. **Existing CLAUDE.md constraints carry over:** the sidebar's four groups
   stay (this redesign restyles the shell, it doesn't regroup it), and the one
   new migration must be idempotent with the Supabase SQL-editor link in the
   PR description.

---

## 4. Proposed build — phases, tools, and why each tool

Guiding principle you asked for: **scripts where mechanical, cheap model where
judgment is needed, expensive model almost nowhere.**

| Phase | What ships | Tool & why | Est. cost |
|---|---|---|---|
| **0. Design tokens + codemod** | `index.css` token system (surfaces, text, accents, radius, shadows); Python codemod rewrites all hardcoded classes; default "Classic" + one dark theme to prove it | **Python script** does the rewrite (free, deterministic, reviewable as one diff). `claude -p` with **Sonnet** writes the script + adjudicates ambiguous matches. `tsc` + dev-server screenshots verify | ~$3–6 |
| **1. Dashboard data layer** | `src/lib/dashboard.ts` (scoped parallel queries) + `src/lib/opportunities.ts` (pure rules engine) + unit tests; the one dismissals migration | `claude -p` **Sonnet** — well-specified plumbing; tests run free via `tsx` | ~$5–8 |
| **2. Home page rebuild** | Widget grid: Needs Attention (inventory + overdue tasks), Open Projects (progress bars + Resume), Opportunities, Month P&L, Upcoming, Recent Activity (derived), collapsed tool links; deep-link query params in Inventory/Writing/Planner | `claude -p` **Sonnet**, one widget per prompt against the Phase-1 API (keeps each run small and reviewable) | ~$8–12 |
| **3. Theme gallery** | ~10 theme variable blocks + Settings picker with live swatches; extend ThemeContext | **Sonnet**; palettes are authored data, not engineering. Playwright (pre-installed) screenshots every theme for white-island QA — free | ~$3–5 |
| **4. Catalog opportunity tab** | Per-book checklist (formats/translations/audiobook/ARC/keywords) with dismiss + "planned" states, reusing the Phase-1 engine | `claude -p` **Sonnet** | ~$4–6 |
| **5. (Optional, later) activity_log** | Accurate event history via api.ts mutation hooks | Decide after living with the derived feed | — |

**Total core (0–4): roughly $25–40 in API cost.** Where the expensive model
*is* worth it: this audit and the directive itself (already being done here),
plus one final design-review pass over Phase 2's rendered screenshots — a
single Opus/Fable look at "does the home page actually read as
screenshot-1-calm," which is judgment, not typing. Everything verifiable —
type-checks, unit tests, screenshot sweeps — runs as free local tooling, not
model calls.

Phases 0–1 have no visible risk and unblock everything; 2–4 are independent
of each other after that, so we can reorder or drop any of them.

---

## 5. Open questions before the directive gets written

1. **Widget priority.** Proposed top row: Needs Attention → Open Projects →
   Month P&L. Second row: Opportunities → Upcoming → Recent Activity. Match
   how you'd scan it?
2. **Theme list.** Is the 10-theme list in §2.9 the right starter set, and
   which is *your* daily default (that's the one we design first and tune
   hardest)?
3. **Inventory action depth.** Is "Order → lands in Inventory's PO form
   pre-filled with product + suggested qty" enough, or do you truly want PO
   creation without leaving Home? (Recommendation: pre-fill only, per §3.5.)
4. **Activity feed honesty.** OK shipping the derived feed first and deferring
   the real event log to Phase 5?
5. **TodayPanel.** Keep the planner's Today panel as the top-left "Needs
   Attention" ingredient (merged with inventory/overdue items), or leave it
   standalone above the grid as it is now?

Answer these (or just say "recommendations approved") and the build directive
— `COMMAND_CENTER_REDESIGN_DIRECTIVE.md`, phase-by-phase instructions with
the token map, widget specs, query contracts, and acceptance checks — gets
written next. No building happens before you've signed off on that directive.
