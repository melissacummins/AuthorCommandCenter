# Audit: Replacing LinkedOption with a Command Center "Linked Editions" Module

> **Status: Discussion draft — nothing has been built.** This is the audit and
> plan Melissa asked for. Once we agree on scope and answer the open questions
> in §8, the companion build directive (same format as
> `WRITING_MODULE_DIRECTIVE.md`) gets written and handed to the implementing
> model.

**The idea being audited:** retire the LinkedOption Combined Listings app
(~$9.99+/mo) and manage "these separate products are really one book in
different formats" from the Command Center, with the storefront widget owned by
us instead of by an app.

**Verdict up front: this is very buildable, and the Command Center is unusually
well prepared for it.** The Upsells module already proves the entire pipeline
this needs — configure in the app → store in Supabase → push to Shopify product
metafields → a Liquid snippet in the theme renders it on the storefront. A
Linked Editions module is architecturally a sibling of Upsells, not a new
frontier. The honest caveats are in §4.

---

## 1. What was actually found (store + app + codebase)

These findings come from the live store via the Shopify Admin API, the theme's
config, and a full read of the repo — not from assumptions.

**The store (shopmelissacummins.com, Basic plan):**

- **81 products**: 11 ebooks, 26 paperbacks, 6 audiobooks, plus bundles,
  hardcovers, and merch. 59 active, 21 draft, 1 archived.
- Each format is a **separate single-variant product** — e.g. *Night Shade
  Ebook* (active, $7.99), *Night Shade Paperback* (draft, $22.99,
  handle `…-paperback-int`), *Night Shade Audiobook* (archived). This is the
  whole reason LinkedOption exists on the store: Shopify variants can't carry
  separate tax categories, descriptions, or URLs, so formats must stay separate
  products, and something has to visually stitch them together.
- 26 paperbacks against ~11 titles means most books have **more than one
  paperback product** (US vs. international `-int` handles, and drafts that were
  deliberately turned off). Groups are not a clean one-product-per-format
  picture — the data model must allow arbitrary labeled members, not a fixed
  Ebook/Paperback/Audiobook trio.
- **A real, live problem LinkedOption is silently hiding today:** several group
  members are DRAFT or ARCHIVED (Night Shade's paperback and audiobook among
  them). Those format buttons have simply vanished from the storefront with no
  warning to you. A replacement can *tell* you when a group is broken — the app
  never will.

**How LinkedOption is wired in:**

- It runs as a **theme app embed** (`king-linked-options` in
  `config/settings_data.json` of your customized Dawn theme). That means the
  format picker is injected client-side by their JavaScript after the page
  loads.
- **Your group definitions are not in your store data.** A scan of product
  metafields found namespaces from a dozen apps (judge.me, loox, vitals,
  selleasy…) but **nothing from LinkedOption** — the groups live in their
  backend and/or app-owned metafields that only their app can read. If the app
  is uninstalled without exporting first, the groupings are gone (Shopify also
  purges app-owned data ~48h after uninstall).
- Per its App Store listing, the app links separate products as swatch/button
  "variants" on product pages (and optionally collection cards), supports
  bulk-grouping by title/SKU/tag, CSV import/export, and starts at $9.99/mo
  ([App Store listing](https://apps.shopify.com/linked-options),
  [feature/pricing summary](https://www.storecensus.com/shopify-apps/linked-options)).

**What the Command Center already has (this is why the build is cheap):**

- A server-side Shopify proxy (`shopify_proxy` Postgres RPC) with OAuth already
  granting `write_products` and `write_themes` scopes — no new connection or
  re-auth needed for the core work.
- A **ready-made metafield write path**: Upsells pushes its config to a
  `author_cc.upsells` product metafield via `metafieldsSet`
  (`src/modules/upsells/api.ts`).
- A **ready-made theme publish path**: Upsells publishes
  `snippets/acc-addons.liquid` into the live theme with one button
  (`set_theme_asset` action, migration `090`).
- A **product picker UI** to copy (`src/modules/upsells/components/OfferEditor.tsx`).
- Established module conventions: register in `App.tsx` + `src/lib/access.ts`,
  tile in a sidebar group, one idempotent numbered migration, RLS per-user.

## 2. Proposed shape of the replacement

One new module — working name **Linked Editions** — in the **Operations**
sidebar group next to Upsells (it's the same kind of storefront merchandising
tool). Three moving parts:

1. **Supabase as source of truth.** One migration adds `linked_edition_groups`
   (group name, settings) and `linked_edition_members` (Shopify product ID,
   label like "Ebook" / "Signed Paperback", display order). Registered in the
   existing backup system.

2. **Shopify metafields as the delivery mechanism.** On sync, each product in a
   group gets two metafields in the existing `author_cc` namespace:
   - `linked_editions` — a `list.product_reference` of every member (ordered)
   - `edition_label` — its own label ("Ebook", "Audiobook", …)

   `list.product_reference` is the key design choice: Liquid can walk those
   references natively and get each sibling's **live** title, URL, price, and
   availability at render time. Draft/archived products come back empty in
   Liquid and simply don't render — so unlike LinkedOption, unpublishing a
   paperback can never leave a dead button, and there's nothing to re-sync when
   prices change.

3. **A server-rendered Liquid snippet** (`snippets/acc-editions.liquid`)
   published from the module with one click, exactly like the Upsells snippet.
   It renders the edition pills styled with Dawn's own variant-pill settings
   (your theme already defines those), with the current product highlighted.
   One-time manual step, same as Upsells: add a `{% render %}` Custom Liquid
   block to the product template in the theme editor — the module will show
   copy-paste instructions.

**Why this is an upgrade, not just parity:**

- **Server-rendered, not injected.** LinkedOption's embed paints the picker
  with JavaScript after page load (flicker/layout shift, invisible if JS
  stalls, one of *fifteen* app embeds currently competing on your pages).
  A Liquid snippet is in the HTML Shopify sends — instant, and the
  edition links are crawlable by Google as real `<a>` links.
- **Group health dashboard.** The module flags groups pointing at
  draft/archived/deleted products — the exact silent failure happening right
  now — and shows each book's formats and prices side by side.
- **Auto-grouping.** Your titles are extremely regular (`<Book> <Format> —
  <subtitle>`), so a proposal pass can pre-build ~90% of the groups for
  one-click confirmation instead of hand-assembling 81 products.
- **You own the data.** Groups live in your Supabase (backed up with
  everything else) and in open metafields on your own products — portable to
  any future theme or even another app.
- **$0/month**, forever, versus $120+/year.

**Tax, checkout, and channels — the part that "just works":** because every
format stays its own product (same as today), per-product tax categories,
Google/Bing feeds, discounts, and checkout behavior are completely untouched.
This replacement changes *presentation only*. That's the main reason the risk
is low.

## 3. Deliberately out of scope (v1)

- **Collection-page swatches / hiding sibling products in collections.**
  LinkedOption can decorate product cards in collections and de-duplicate
  siblings there. Replicating that means editing Dawn's `card-product` snippet
  — doable, but it's the fiddliest, most theme-update-fragile part, and it's
  unclear you use it (§8, Q1). Phase 2 if wanted.
- **CSV import/export.** Pointless once Supabase is the source of truth with
  auto-grouping.
- **A public Shopify app / app embed.** Building an actual app (OAuth app
  store distribution, app blocks) is 10× the effort for zero benefit on a
  single store.

## 4. Where this could go wrong (the honest list)

1. **Migration data is hostage to the app.** Groups must be exported from
   LinkedOption's admin UI (it has CSV export) *before* uninstalling. If
   export fails or the format is useless, fallback is auto-grouping + a manual
   review pass — annoying but bounded at ~20 groups.
2. **Theme coupling.** An app embed survives theme switches; a snippet doesn't.
   If you replace or majorly update the Dawn copy, the snippet and the one
   `{% render %}` block must be re-added (one click + one paste — and the
   snippet source lives in this repo, so it can't be lost). This is the real
   ongoing cost of ownership: near zero, but not zero, and it's on us rather
   than a vendor.
3. **No vendor support.** If Shopify changes Liquid/metafield behavior (rare,
   and they version the Admin API), we fix it ourselves. Mitigated by keeping
   the storefront layer dead simple — no JavaScript required at all in v1.
4. **Cutover sequencing matters.** Uninstalling LinkedOption kills its widget
   instantly. The safe order is: build → sync metafields → verify snippet on a
   **duplicate theme** via preview link → add the render block to the live
   product template → confirm → export CSV from LinkedOption → uninstall →
   delete its leftover app-embed entry from theme settings. Done in that
   order, shoppers never see a gap.
5. **Two-axis groups.** If you want Format and Region/Edition as *separate*
   pickers (like real variant options), the widget gets meaningfully more
   complex. Recommendation: one flat labeled row ("Ebook · Paperback · Signed
   Paperback · Audiobook") — simpler, and honestly clearer for book shoppers.
   Decide in §8, Q3.
6. **Not the "native" solution.** Shopify's own Combined Listings app would be
   the canonical answer, but it's **Shopify Plus–only**, and you're on Basic —
   so the realistic choices are "an app like LinkedOption" or "this build."
   Worth knowing in case you ever move to Plus.

## 5. Tooling & cost plan (right tool per job, cheapest that works)

| Job | Tool | Why / cost |
|---|---|---|
| Pull all 81 products, parse titles, propose groups | **Python script** (one-off, run locally or in-session) | Pure deterministic string work — an LLM would be slower and cost money to do worse. Free. |
| Migration SQL, `shopify_proxy` extension, React module, Liquid snippet | **One Claude Code session on Sonnet** (`claude -p` or interactive; `--model sonnet`) | Well-scoped CRUD following an existing in-repo template (Upsells). Doesn't need Opus/Fable-class reasoning. Roughly $2–5 of API tokens, or $0 extra on a subscription. |
| The build directive itself | Already in progress (this session) | Fable/Opus-class model is the right place to spend thinking budget — on the spec, not the typing. |
| Verifying metafields match Supabase after sync | **Python check script** committed with the module | Free, rerunnable, no model involved. |
| Storefront verification | Duplicate-theme preview link + eyeballs | Free. |

**Explicitly not recommended:** multi-agent workflows or Opus for the
implementation — this is a ~6-file module with a proven template; a single
Sonnet session with a tight directive is the efficient tool. Total one-time
build cost is a few dollars at most; ongoing cost is $0/mo against the
$9.99+/mo saved, so it pays for itself in the first month.

## 6. Build phases (what the directive will specify)

1. **Phase 1 — Data + module.** Migration `09x_linked_editions.sql`;
   `src/modules/linked-editions/` (group list, group editor with product
   picker, health indicators); registration in `App.tsx`, `access.ts`,
   `Layout.tsx`, `Home.tsx` (Operations group); backup-table registration.
2. **Phase 2 — Sync.** Extend `shopify_proxy` with a
   `set_linked_edition_metafields` action (the existing metafield action is
   hard-coded to the upsells key); "Sync to Shopify" with per-product results
   and a drift check.
3. **Phase 3 — Storefront.** `snippets/acc-editions.liquid` (pure Liquid, no
   JS), publish button, theme-setup tab with the paste-in instructions,
   duplicate-theme test checklist.
4. **Phase 4 — Migration & cutover.** Auto-group proposal from product titles
   (+ optional LinkedOption CSV import if the export is usable), then the
   §4.4 cutover checklist.
5. **Phase 5 (optional, only if used today) — collection card pills.**

## 7. What was checked, for the record

Live Admin API queries (shop plan, product counts/status, per-product
metafield namespaces, theme config confirming the `king-linked-options` embed);
full repo exploration (Upsells module as template, `shopify_proxy` action
inventory, migration/RLS conventions, module registration path); LinkedOption
public listing for features/pricing. Direct storefront fetch was blocked by
the session's proxy, so the widget's exact rendered markup wasn't inspected —
irrelevant to the plan, since we're replacing rather than imitating its DOM.

Sources: [LinkedOption on the Shopify App Store](https://apps.shopify.com/linked-options) ·
[StoreCensus feature/pricing summary](https://www.storecensus.com/shopify-apps/linked-options) ·
[Shopify community: using products as variants of each other](https://community.shopify.com/t/how-do-i-use-existing-products-as-variants-of-each-other/376479)

## 8. Open questions for Melissa (answer these, then the directive gets written)

1. **Which LinkedOption features do you actually use?** Just the format picker
   on product pages, or also swatches on collection cards / hiding sibling
   products in collections? (Decides whether Phase 5 exists.)
2. **What are you paying** for LinkedOption today? (Sets the savings math;
   listing says plans start at $9.99/mo.)
3. **One picker or two?** A single row of labeled editions (recommended), or
   separate Format + Region/Edition pickers?
4. **Draft editions:** hidden entirely (current behavior), or shown greyed-out
   as "coming back soon" when a paperback is temporarily off?
5. **Sidebar placement:** Operations (next to Upsells) — agreed, or prefer
   Catalog?
