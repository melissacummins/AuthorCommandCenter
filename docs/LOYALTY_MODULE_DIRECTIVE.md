# Smile.io Replacement — Audit & Build Directive: Loyalty Module

> **Status: PROPOSAL — nothing has been built.** Part 1 is the audit for
> Melissa to read and react to. Part 2 is the tooling plan (what builds this
> and what it costs). Part 3 is the build directive for the implementing
> model, in the same format as `docs/WRITING_MODULE_DIRECTIVE.md` — it is
> **not actionable until the ⚠ DECISION items in §3.2 are answered.**

---

# Part 1 — The Audit

## 1.1 The verdict up front

**Yes, this is worth doing, and the Command Center is unusually well
positioned to do it.** About 70% of what Smile's paid tiers charge for is
already built in this app in some form — it just hasn't been pointed at
loyalty yet. The two genuinely new pieces of work are (a) a way for
*customers* to see and redeem their points (the Command Center is your
admin cockpit; customers can never log into it), and (b) transactional
email you control. Both are solvable; both are named honestly in §1.4.

What you'd be giving up is Smile as a *vendor*: their uptime, their fraud
handling, their email deliverability, their silent handling of refunds and
edge cases. Those responsibilities move to this codebase. The directive in
Part 3 budgets for that explicitly (reconciliation job, refund webhooks,
anti-fraud rules) rather than pretending it's free.

## 1.2 Facts this audit is based on (verified live, 2026-07-11)

- **Store:** shopmelissacummins.com, Shopify **Basic** plan, USD.
- **Volume:** 56 orders (Apr), 68 (May), 87 (Jun) — ~$1.1k–$2.6k/month and
  growing. Under Smile's free-plan 200-order/month cap today, but at the
  current growth curve that cap is a real ceiling within a year or so.
- **Smile leaves nothing behind:** customer records were checked live for
  metafields — they are **empty**. Points balances exist only inside
  Smile's own database. Migration options are covered in §1.4 risk #2.
- **The app already talks to Shopify deeply:** OAuth flow with a stored
  token, a `shopify_proxy` Postgres function that calls the Admin
  REST/GraphQL APIs, order sync into a local `shopify_orders` table, and —
  critically — **the Upsells module already creates and deletes Shopify
  discount codes**, which is exactly what a points redemption is.
- **A Shopify order webhook already exists** (`api/conversions/shopify-webhook.ts`,
  HMAC-verified, used by the Link Shortener for conversion attribution).
  Points accrual is the same shape of endpoint with different bookkeeping.
- **The Link Shortener already does purchase attribution** (click →
  order matching). That is the hard 80% of a referral program — the thing
  Smile paywalls — already running in production in this app.
- **Klaviyo is already integrated** (per-user API key, stored encrypted).
  Today it's used read-mostly, but pushing loyalty *events* to Klaviyo is a
  small addition, and Klaviyo flows send from **your authenticated domain**
  — which directly fixes "I don't know what domain the points email comes
  from and I can't edit it."
- **Gap #1 — no customers table.** Orders sync only saves a customer
  *name* string; no emails, no Shopify customer IDs. Loyalty needs customer
  identity, so a members table and customer sync is Phase 1 work.
- **Gap #2 — OAuth scopes.** The stored Shopify token has
  `read_orders, read/write_products, write_discounts, read_locations,
  read/write_themes` — but **no `read_customers`/`write_customers`**.
  Reading customer emails, writing points to customer metafields, and
  tagging VIPs all need those. Fix is a one-time re-connect through the
  existing OAuth screen with two scopes added — small, but it must happen
  first or Phase 1 fails confusingly.
- **Gap #3 — nothing runs on a schedule.** No cron anywhere in the app.
  Loyalty wants a nightly job (reconciliation, VIP recalc, expiry
  warnings). Vercel Cron (already the host) covers this.

## 1.3 Your Smile complaints, mapped

| What you can't do on Smile free | How the Command Center version does it |
|---|---|
| Referrals (paid feature) | Each member gets a personal short link via the existing Link Shortener; its conversion webhook already attributes orders to links. Referrer gets points, friend gets a welcome code via Shopify's `/discount/CODE` auto-apply URL. |
| VIP tiers (paid feature) | Tiers computed from the points ledger on your rules; tier written to the customer as a Shopify tag → usable for segment-scoped discounts, early ARC access, etc. |
| Analytics (growth, benchmarks, points activity) | The ledger lives in your Supabase; an Overview tab with recharts (already a dependency) shows points issued vs. redeemed, redemption rate, top members, program liability. You own every row — no paywall between you and your own data. |
| Loyalty hub — customers can't see their points | Two surfaces, both in Part 3 Phase 5: points balance written to a customer metafield and displayed on the store account page via a theme section (the app already has `write_themes`), plus a public "My Rewards" page where a customer enters their email, gets a one-time code, and sees/redeems their balance — no account needed. |
| Redemption emails: unknown sender domain, can't edit | Loyalty events pushed to Klaviyo; you build the flow emails in Klaviyo's editor, from your domain, in your voice. (Resend is the fallback if you'd rather not run these through Klaviyo — see ⚠ DECISION D6.) |
| No one has ever redeemed points | Root cause is almost certainly invisibility (no hub, unbranded email from an unknown sender). Fix is structural: visible balance on the account page + your-domain emails + a "you have N points, that's $X off" reminder flow. |

## 1.4 Where this can go wrong (the honest list)

1. **Customers can't use the Command Center.** It's your internal tool with
   team auth. Every customer-facing surface must be built separately: the
   theme section and the public OTP-verified rewards page. This is the
   single biggest chunk of new work and the part with real security
   surface (a balance-lookup endpoint must not let anyone enumerate other
   people's balances — hence email verification, rate limiting, and
   server-side tokens). Budgeted as its own phase.
2. **Smile's balances may not come with you.** Verified: nothing is stored
   on Shopify customer records. Before uninstalling Smile, export whatever
   its admin allows (check Customers → export in the Smile dashboard, and
   ask their support for a points-balance export — merchants are generally
   given their data on request). **Plan B is actually good:** your full
   order history is already synced, so points can be recomputed
   retroactively from real orders. Announced as "we've upgraded our
   rewards program and recalculated your points — most balances went up,"
   a backfill turns a migration risk into a launch campaign. ⚠ DECISION D2.
3. **Refunds, cancellations, edited orders.** Smile silently claws back
   points. We must subscribe to `refunds/create` and `orders/cancelled`
   and write negative ledger entries, or balances inflate. In-directive.
4. **Missed webhooks = silently wrong balances.** Webhook delivery is
   at-least-once, not guaranteed-exactly-when. Mitigation is cheap and
   specified: idempotency keys on every ledger entry plus a nightly
   reconciliation job that re-derives balances from the synced orders
   table and flags drift.
5. **Email deliverability is now your problem.** If Klaviyo domain
   authentication (DKIM/SPF) isn't set up, loyalty emails land in spam and
   you've rebuilt Smile's exact failure. This is a checklist item in
   Phase 6, not code.
6. **No points widget at checkout.** Smile's paid tiers show "redeem your
   points" inside checkout. On Basic plan without building a full embedded
   Shopify app, we can't inject UI into checkout. Customers redeem *before*
   checkout (hub → get code → code auto-applies via link). Acceptable for
   a bookstore, but it is a real UX difference — naming it so it isn't a
   surprise.
7. **You become the vendor.** Bugs, edge cases, and "why is my balance
   wrong" emails route to you. The mitigations above shrink this, and the
   admin module includes a manual adjust-points tool for graceful
   recovery, but it never reaches zero.
8. **Program rules are a liability decision, not a code decision.**
   Expiration, earn rate, exclusions (shipping? taxes? gift cards?),
   rounding. Changing rules after launch angers exactly the customers the
   program exists to please — so they're forced decisions (§3.2) before
   Phase 1, not defaults buried in code.

## 1.5 Enhancements Smile could never do for you

Because the ledger lives next to your other modules, points stop being
purchase-only:

- **Points for author-world actions:** ARC review submitted (ARCs module),
  newsletter signup (bio pages already capture these), preorder of the
  next release. Awarded automatically where the app can see the event, or
  via a one-click admin grant / CSV import where it can't.
- **Series completion bonuses:** your customers already carry tags like
  "Read Night Fury" — finish-the-series rewards are a query, not a dream.
- **Redemptions that steer the backlist:** reward codes scoped to a
  specific collection (signed paperbacks, a slow-moving series) — the
  existing discount API supports collection scoping today.
- **Cross-module analytics:** points activity next to Profit and
  Cross-Sell data. "Do loyalty members have higher AOV?" becomes a chart.

## 1.6 Cost comparison

- **Smile:** the features you listed are spread across paid tiers running
  **$49–$999/month** ($588–$11,988/yr), plus the free plan's 200
  orders/month ceiling sits in your growth path.
- **This build:** runs on Supabase + Vercel you already pay for; marginal
  hosting cost ≈ $0/month. Klaviyo you already have. One-time build cost
  is model usage only — estimated in Part 2 at roughly **$20–60 of API
  spend total, or ~$0 extra if built inside a Claude subscription** —
  plus your time reviewing each phase.

---

# Part 2 — The right tool for each job

You asked for the cheapest tool that does each job well, with models only
where models earn their keep. Recommendation:

| Job | Tool | Why / cost |
|---|---|---|
| All repo code: migrations, webhook endpoints, module UI, theme section (Phases 1–7) | **Claude Code session running Sonnet 5** (`claude --model sonnet`), fed the Part 3 directive one phase at a time | This is pattern-following work — every table, RLS policy, module registration, and discount call copies an existing in-repo pattern the directive points at. Sonnet is roughly a fifth the cost of Opus-class models and is fully capable of it; the expensive model was needed for the *auditing and planning* (this document), not the bricklaying. One phase per session/PR keeps reviews small. Included in a Claude Pro/Max subscription; if API-billed, est. $3–8 per phase → **$20–60 total**. |
| Points backfill from order history | **Plain SQL** (one idempotent script run in the Supabase SQL editor) | Deterministic math over `shopify_orders`. Free, auditable, re-runnable. No model at runtime. |
| Smile export parsing (if their export comes through) | **Python script** (~50 lines, pandas-free, stdlib csv) | One-off CSV munging → SQL upserts. Free. Written once by the build session, run locally. |
| Webhook testing | **Shell script** (curl + openssl for the HMAC signature) | Replays sample order payloads against the endpoint. Free, kept in `scripts/` for regression use. |
| Email copy (5–6 loyalty flow emails) | **You, in Klaviyo's editor** — optionally one `claude -p --model haiku` call to draft variants | A model is optional here; if used, Haiku drafts all six emails for about a cent. Don't spend Sonnet tokens on prose you'll rewrite in your own voice anyway. |
| VIP/tier math, reconciliation | **SQL inside the app** (nightly Vercel Cron hitting a serverless route) | Pure arithmetic. No model, no cost. |

**Deliberately NOT recommended:** multi-agent orchestration or parallel
workflows for the build (phases are sequential — each depends on your
decisions and on the previous phase's schema; parallel agents would burn
tokens re-discovering each other's work), and any per-event model calls in
production (points math must be deterministic and free — a model in the
accrual path would be both expensive and wrong).

---

# Part 3 — Build Directive: Loyalty Module

**Audience:** the AI model / developer implementing this module. This
document is self-contained — repo discovery has already been done. Follow
it as written. Where this directive conflicts with the codebase's existing
conventions, the codebase wins — flag the conflict in the PR description
instead of improvising.

**Goal:** replace Smile.io with a native Loyalty module whose **primary job
is a correct, auditable points ledger driven by Shopify order events**,
with redemption via single-use Shopify discount codes. Customer-facing
surfaces, email, referrals, and VIP tiers are built on top of that ledger,
in phases. Ledger-first is the explicit priority — a loyalty module with a
beautiful hub and a wrong balance is a failure.

## 3.1 Repo facts you need (pre-researched — trust these)

- Stack: Vite 6, React 19, TS 5.8, `react-router-dom` v7, Tailwind v4 (no
  component library), `lucide-react`, `recharts`, Supabase JS v2.
  Lint/typecheck = `npx tsc --noEmit`. Serverless functions live in `api/`
  (Vercel), not Supabase Edge. Public non-admin pages already exist (bio /
  link pages; `middleware.ts` does host-based routing).
- **Shopify bridge:** Postgres function `shopify_proxy(action, params)`
  (SECURITY DEFINER, `http` extension) — see migrations
  `003_shopify_proxy_function.sql`, `005_shopify_inventory_write.sql`,
  `086`–`092`. Client calls it via `supabase.rpc` — see `callShopifyProxy`
  in `src/modules/orders/api.ts`. Extend it with new actions; do not build
  a second bridge. OAuth: `004_shopify_oauth.sql` +
  `src/modules/orders/components/ShopifyCallback.tsx`; scopes are listed in
  `getShopifyOAuthUrl()` in `src/modules/orders/api.ts`.
- **Discount-code prior art (copy this):** `src/modules/upsells/api.ts` —
  GraphQL `discountCodeBasicCreate` / `discountCodeBxgyCreate` via proxy
  actions `create_discount` / `create_bxgy_discount` / `delete_discount`.
- **Webhook prior art (copy this):** `api/conversions/shopify-webhook.ts`
  — raw-body HMAC verify (`x-shopify-hmac-sha256`), `?u=<user_id>` query
  param, service-role Supabase client.
- **Orders data:** local table `shopify_orders` (upserted on
  `user_id,shopify_order_id`), synced by user-triggered pull. It stores
  only `customer_name` — no email/customer id (you will add capture).
- **Migrations:** `supabase/migrations/NNN_*.sql`, next number ≥ `099`.
  **Must be idempotent** (`IF NOT EXISTS`; `DROP POLICY/TRIGGER IF EXISTS`
  before `CREATE`) — Supabase Preview Branching re-applies them. Table
  pattern: `id UUID PK DEFAULT gen_random_uuid()`, `user_id UUID REFERENCES
  auth.users ON DELETE CASCADE`, timestamps, RLS enabled, four owner-only
  policies (`auth.uid() = user_id`) — copy the looped-policy block in
  `002_shopify_orders.sql`. Every migration PR description must include
  the SQL editor link:
  `https://supabase.com/dashboard/project/vinnvzmuuwmssijwdomt/sql/new`.
- **Module registration (all four, every time):** `src/App.tsx` (lazy
  route + `GATED_ELEMENTS`), `src/lib/access.ts` (`GATED_MODULES`),
  `src/components/Layout.tsx` (modules array + section group),
  `src/pages/Home.tsx` (mirror). Loyalty goes in the **Marketing** group.
- **Email:** Klaviyo only — `src/lib/klaviyo.ts` → `api/klaviyo/[action].ts`,
  per-user encrypted key (`029_user_klaviyo_keys.sql`). No transactional
  sender exists.
- **Theme writes:** `write_themes` scope already granted; migration
  `090_theme_asset_publish.sql` shows the theme-asset action pattern.
  **Never write to the live/published theme without Melissa's explicit
  go-ahead on the specific change.**

## 3.2 Decisions required from Melissa (⚠ blocking — collect before Phase 1)

| # | Decision | Suggested default (adjustable) |
|---|---|---|
| D1 | Earn rate & unit value | 1 point per $1 (pre-tax, pre-shipping, excl. gift cards); 100 points = $5 off |
| D2 | Backfill from full order history, or start balances from Smile's export / zero? | Backfill all history — doubles as the relaunch announcement |
| D3 | Expiration | Points expire after 18 months of account inactivity, with a 30-day warning email; or never |
| D4 | Reward catalog at launch | $5 off / 100 pts, $12 off / 200 pts, free-shipping / 75 pts |
| D5 | Customer hub approach | Both: metafield + theme section on the account page (passive visibility) **and** public OTP rewards page (redemption without login) |
| D6 | Email channel | Klaviyo events + flows (your domain, your editor). Alternative: Resend (~free at this volume) if loyalty email should live outside Klaviyo |
| D7 | Referral rewards | Referrer: 200 pts on friend's first *paid* order ≥ $10, awarded after 14 days (refund window); friend: 10% welcome code. Cap 10 referrals/member/year |
| D8 | VIP tiers | Reader (default) / Superfan (500 pts/yr) / Inner Circle (1500 pts/yr): earn multipliers 1× / 1.25× / 1.5× + early ARC access for Inner Circle |
| D9 | Smile sunset plan | Export what Smile allows → freeze Smile earning → launch → uninstall after 2 weeks of parallel-run |

## 3.3 Phases

Each phase = one branch + one PR, reviewed before the next begins. Run
`npx tsc --noEmit` before every push. Stop and confirm with Melissa at
every point marked **[CHECKPOINT]**.

### Phase 0 — Scope expansion & settings (small)
- Add `read_customers,write_customers` to the OAuth scope list in
  `getShopifyOAuthUrl()`; surface a "re-connect Shopify" prompt in the
  module when the stored token predates the new scopes.
- Migration: `loyalty_settings` (single row per user: earn rate, point
  value, exclusions, expiration policy, program enabled flag) seeded from
  the D-decisions.
- **[CHECKPOINT]** Melissa re-connects Shopify once; verify a
  customer-read proxy call succeeds.

### Phase 1 — Ledger foundation + backfill
- Migrations: `loyalty_members` (user_id, shopify_customer_id, email,
  name, points_balance, lifetime_points, tier, referral_code UNIQUE,
  joined_at), `loyalty_ledger` (member_id, delta, reason enum
  [order, refund, redemption, referral, manual, expiry, bonus],
  source_type + source_id with a UNIQUE(user_id, source_type, source_id)
  idempotency constraint, note, created_at). Balance maintained by DB
  trigger summing ledger (copy trigger style from `088`).
- Extend order sync to persist `customer_email` / `shopify_customer_id`
  on `shopify_orders` (new nullable columns, additive migration) and add
  a `get_customers` proxy action for member import.
- Backfill: one idempotent SQL script computing historical points from
  `shopify_orders` per D1/D2, inserting ledger rows with
  `source_type='order'` so re-runs no-op. Provide (separately, in
  `scripts/`) the Python CSV importer for a Smile export, if one arrives.
- Acceptance: balances visible in Supabase; re-running sync or backfill
  changes nothing; **[CHECKPOINT]** Melissa spot-checks 5 known customers.

### Phase 2 — Accrual webhooks + reconciliation
- `api/loyalty/shopify-webhook.ts` modeled on the conversions webhook:
  topics `orders/paid` (award), `refunds/create` (proportional clawback),
  `orders/cancelled` (reverse). Idempotent via the ledger unique key.
  Auto-create members on first paid order.
- Webhook registration action in `shopify_proxy` (list/create/delete
  webhook subscriptions) + a settings-panel button showing registration
  status.
- Nightly Vercel Cron (`vercel.json` `crons`) → `api/loyalty/reconcile.ts`:
  re-derive balances from `shopify_orders`, flag drift into a
  `loyalty_reconcile_log` table, never auto-"fix" silently.
- Acceptance: shell replay script in `scripts/` proves award + refund +
  duplicate-delivery paths; drift job runs green.

### Phase 3 — Admin module UI
- `src/modules/loyalty/` per the standard module shape
  (`LoyaltyModule.tsx`, `api.ts`, `types.ts`, `components/`, `hooks/`);
  register in all four touchpoints; Marketing group.
- Tabs: **Overview** (recharts: points issued vs redeemed over time,
  redemption rate, outstanding liability in $, top members), **Members**
  (search, balance, tier, ledger drill-down, manual adjust with required
  note), **Activity** (ledger feed), **Rewards** (Phase 4), **Settings**
  (earn rules, webhook status, program on/off).
- Acceptance: **[CHECKPOINT]** Melissa can find any customer's balance and
  history in under 10 seconds.

### Phase 4 — Redemption engine
- Migration: `loyalty_rewards` (name, points_cost, discount kind
  [amount / percent / free-shipping], optional collection scope, active)
  + `loyalty_redemptions` (member, reward, code, discount GID, status).
- Redeem = ledger debit + `discountCodeBasicCreate` via the existing
  proxy path: unique code (`READS-XXXXXX`), `usageLimit: 1`,
  `appliesOncePerCustomer: true`, eligibility restricted to that customer.
  Failure of the Shopify call rolls back the debit.
- Admin-initiated redemption first (redeem on a member's behalf from the
  Members tab) — customer self-serve arrives in Phase 5.
- Acceptance: end-to-end test redemption on the live store with a $1 test
  reward; code applies once and only for that customer.

### Phase 5 — Customer-facing hub (per D5)
- **Metafield sync:** on ledger change, write balance to customer
  metafield `loyalty.points` (via proxy; needs Phase 0 scopes). Theme
  section (new file, Liquid) rendering the balance on the account page +
  a "Rewards" page section; **install on an unpublished theme copy first,
  Melissa approves visually, then publish [CHECKPOINT]**.
- **Public rewards page:** public route on the existing public-page
  infrastructure: enter email → 6-digit OTP emailed (Phase 6 channel) →
  short-lived server-signed token → balance + reward list → self-serve
  redeem → code displayed with a `/discount/CODE` auto-apply link.
  Server-side only via service-role serverless routes
  (`api/loyalty/hub/*`); rate-limited (5 OTP requests/email/hour); no
  balance data ever readable with anon key; OTPs hashed at rest,
  10-minute expiry.
- Acceptance: a real customer email can check balance and redeem with no
  store login; a wrong OTP five times locks the email for an hour.

### Phase 6 — Email (per D6)
- Klaviyo path: push events (`Loyalty Points Earned`,
  `Loyalty Reward Redeemed`, `Loyalty Balance Reminder`,
  `Loyalty Points Expiring`) through a new server-side action in
  `api/klaviyo/[action].ts` using the stored key. Melissa builds the flow
  emails in Klaviyo (her sender domain — **verify DKIM/SPF domain
  authentication in Klaviyo before launch**; this checklist item is part
  of acceptance).
- Monthly balance-reminder trigger from the nightly cron (only members
  with balance ≥ smallest reward, max 1/month) — this is the "nobody
  knows they have points" fix.
- Acceptance: test member receives earn + reminder emails from
  melissacummins.com sender.

### Phase 7 — Referrals + VIP tiers (per D7/D8)
- Referrals: generate each member's short link through the existing Link
  Shortener; attribution comes free from `link_conversions`. New cron step
  awards referrer points for attributed first orders that survive the
  D7 delay window; anti-fraud: referee email ≠ referrer email, order ≥
  minimum, annual cap, no self-click awards.
- VIP: nightly tier recalc from rolling-12-month ledger; tier stored on
  member + pushed as Shopify customer tag (`VIP: Inner Circle`) enabling
  segment-scoped perks; earn multiplier applied at accrual time.
- Acceptance: fabricated referral chain awards exactly once; tier
  boundaries tested at the exact thresholds.

### Out of scope (do not build)
Checkout UI extensions / embedded Shopify app, multi-store support,
points-for-social-follows automation (manual grant covers it), a customer
mobile view beyond responsive web, and any per-event AI calls in the
accrual/redemption path.

## 3.4 Launch runbook (post-Phase 6, before Phase 7 if desired)
1. Smile: export data, freeze earning (D9). 2. Backfill + parallel-run
2 weeks, reconcile daily. 3. Klaviyo announcement campaign ("your points
moved, balances recalculated, here's your balance" — merge-tagged).
4. Uninstall Smile. 5. Watch `loyalty_reconcile_log` for a month.
