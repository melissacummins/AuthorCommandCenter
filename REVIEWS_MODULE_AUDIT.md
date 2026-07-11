# Reviews Module — Audit & Proposal

*Prepared for Melissa, July 2026. This is the read-through-and-discuss document. The build
directive (the instructions another model/session would follow to build it) comes after we
agree on this.*

---

## TL;DR

**The idea is good and worth building — but one piece of it, importing Goodreads/retailer
reviews and marking them up with structured data, would actively hurt you.** It violates
Google's review-snippet policy ("ratings must be sourced directly from users"), risks a
"spammy structured markup" manual action that kills your star ratings entirely, breaches
Goodreads/Amazon terms of service (relevant because Goodreads is Amazon-owned and you have a
KDP account), and — the kicker — it wouldn't even deliver the AEO benefit you're after,
because most AI crawlers read visible page text, not schema markup.

**The compliant version keeps ~90% of what you want:**

1. **First-party reviews** collected on your product pages → these ARE eligible for star
   ratings in Google (the "no self-serving reviews" rule only applies to reviewing your own
   *business*, not your *products/books*).
2. **Editorial acclaim** (Goodreads quotes, press, blurbs) displayed as visible on-page
   content **without** review markup — explicitly blessed by Google, and you're already
   doing a manual version of this with your `column_review_1–9` metafields.
3. **Your ARC pipeline is the secret weapon.** You already have an ARCs module in the
   Command Center. Routing ARC readers to leave their review *on your site* (in addition to
   wherever else they post) generates policy-clean first-party reviews from day one — this
   solves the cold-start problem every review system has.

**Honest build-vs-buy note:** Judge.me's free plan does most of the mechanical parts for $0.
The case for building custom is control (moderation, display, data ownership, Command Center
integration, no third-party JS bloating your theme) — not cost savings. Details in §5.

**Recommended tooling for the build: no paid services, no new infrastructure.** Everything
runs on what you already have (Supabase, Vercel, your existing Shopify token). Build labor is
Claude Code working in this repo across 3 phases; Python only for one-off data migration
scripts; optional Haiku API calls (~fractions of a cent per review) for spam triage. Details
in §7.

---

## 1. What you asked for, and what the research says

### 1a. "Import a CSV of reviews from Goodreads or random retailers" — ❌ don't (with markup)

This is the one part of the plan that doesn't survive contact with the rules:

- **Google's review-snippet policy** requires that marked-up ratings be "sourced directly
  from users" of your site. Google's John Mueller has said it flatly: *"You can't mark up
  3rd party reviews with structured data"* — even licensed ones — *"but feel free to show
  them on your site without the markup."* Google's systems actively try to detect
  republished reviews and treat them as ineligible "testimonials."
  ([review snippet docs](https://developers.google.com/search/docs/appearance/structured-data/review-snippet),
  [Mueller on 3rd-party reviews](https://www.seroundtable.com/3rd-party-reviews-with-structured-data-33675.html))
- **The penalty is real:** "Spammy structured markup" is a named
  [manual action](https://support.google.com/webmasters/answer/9044175) — the webspam team
  strips your site's rich-result eligibility until you clean up and file a reconsideration
  request. You'd lose stars on *everything*, including legitimate reviews.
- **Terms of service:** Goodreads' terms prohibit data mining and any "collection and use of
  any book listings, descriptions, reviews"; Amazon's conditions of use have near-identical
  language, and violations are grounds for account termination — worth taking seriously
  given your KDP account lives with the same company. The Goodreads API was shut down in
  2020, so there's no sanctioned export.
- **Copyright:** each review is the reviewer's copyrighted text, licensed to
  Goodreads/Amazon — not to you. Republishing full reviews without each reviewer's
  permission is a separate exposure.
- **FTC angle:** presenting imported reviews as if they were collected on your store
  misrepresents provenance. Labeling matters (see §4).

### 1b. What IS allowed — and it's most of what you want

- **First-party product reviews with full markup.** Reviews submitted on your product pages,
  visible on those pages, marked up as `Review`/`AggregateRating` on the `Product`/`Book`
  entity → fully eligible for stars in Google Search. There is **no minimum review count**
  for organic review snippets (the "50 reviews" rule only applies to Google Shopping product
  ratings). The 2019 "self-serving reviews" restriction only bars `LocalBusiness`/
  `Organization` markup — books/products are fine.
- **Editorial acclaim without markup.** A "Praise for this book" section with attributed
  Goodreads/press quotes (short excerpts, with permission where practical) is standard
  author-site practice and explicitly fine per Google — it just can't feed the star rating.
  This is what your `column_review_1–9` metafields already do by hand.
- **The official Goodreads Reviews Widget** (Author Dashboard → Author Widgets) is the
  sanctioned way to embed live Goodreads reviews. Caveat: it's an iframe, so it contributes
  nothing to your page's crawlable text or schema. Optional garnish, not a foundation.
- **CSV import stays in the plan** — but for reviews you legitimately own: ARC reader
  reviews submitted to you directly, reader emails/newsletter replies (with permission),
  reviews from a previous review app export, in-person/event feedback. The import tool
  should require a provenance field per row and route third-party quotes into the
  unmarked-up "acclaim" section instead of the rated pool.

## 2. AEO reality check — what actually moves the needle

You asked specifically about structured data and LLM visibility. The credible 2025–2026
evidence splits by platform:

| Surface | Does review schema help? | Evidence |
|---|---|---|
| Google Search rich results | **Yes, directly** — this is where the stars come from | Google's own docs |
| Google AI Overviews / AI Mode | **Yes, indirectly** — AIO draws from normal Google indexing; a controlled experiment ([Otterly.AI](https://otterly.ai/blog/schema-markup-real-impact-ai-search/)) found Google's AI surfaces were the *only* platforms with a measurable schema lift | Otterly.AI Dec 2025–Mar 2026 study; Google's Gary Illyes: "normal SEO" is how you get into AIO |
| Bing / Copilot / ChatGPT search | **Yes, via Bing's index** — Microsoft confirmed schema feeds Bing's LLMs; ChatGPT search leans on Bing | [Fabrice Canel, SMX 2025](https://searchengineland.com/microsoft-bing-copilot-use-schema-for-its-llms-453455) |
| Live AI crawlers (GPTBot, ClaudeBot, PerplexityBot) | **No — they read visible HTML text only.** A controlled test planted data only in JSON-LD; none of ChatGPT/Claude/Perplexity/Gemini/Copilot saw it. JS-rendered content was also invisible | [searchVIU test](https://www.searchviu.com/en/schema-markup-and-ai-in-2025-what-chatgpt-claude-perplexity-gemini-really-see/); [Ahrefs 1,885-page study](https://ahrefs.com/blog/schema-ai-citations/): adding schema moved AI citations ~0% |

**What this means for the build (this shapes the architecture more than anything else):**

1. Review text and the aggregate rating must be **server-rendered in Liquid** — real HTML in
   the page source. A JS widget that fetches reviews after page load (how some review apps
   work) is invisible to every AI crawler and to Google's stricter checks. This is a genuine
   advantage of building it ourselves: we control rendering.
2. Schema markup is still worth doing *correctly* — it's what earns stars on Google and
   feeds Bing/Copilot/ChatGPT-search — but it's the visible review text that LLMs actually
   ingest and quote.
3. Ignore the "3.2x more AI citations with schema" numbers floating around marketing blogs —
   nobody has published a methodology behind them, and the two controlled studies that exist
   found roughly zero direct effect outside Google surfaces.

## 3. What's already in place (store + codebase)

The audit found you're starting from further ahead than expected:

**In your Shopify store (shopmelissacummins.com, Dawn-based theme):**
- The standard `reviews.rating` and `reviews.rating_count` product metafields are **already
  defined** — these are the exact fields review apps write and themes/schema read.
- You hand-curate praise quotes in `custom.column_review_1` … `column_review_9` rich-text
  metafields — the manual precursor of the "acclaim" feature.
- Your theme is a copy of Dawn, which outputs its **own Product JSON-LD**. Any review schema
  must *extend that one block*, not add a second Product block — duplicate Product schema is
  the #1 Shopify structured-data failure and can suppress rich results entirely. Since the
  theme is already a customized copy (not auto-updating), editing its snippet is safe.

**In the Command Center codebase:**
- A working Shopify Admin API connection (OAuth token with `write_products` and
  `write_themes` scopes) proxied through a Postgres RPC — the module can write metafields
  and theme assets with zero new credentials.
- A reusable papaparse CSV importer (`src/modules/inventory/components/CsvImporter.tsx`)
  with fuzzy product matching — exactly what the review import tool needs.
- Vercel `api/` serverless routes with HMAC verification patterns (the Shopify webhook
  handler) — the template for the public review-submission endpoint.
- A Klaviyo integration (`api/klaviyo/`) — the hook for post-purchase review-request emails.
- An ARCs module — the hook for the ARC-reader review pipeline.
- A clear module template (`src/modules/<name>/` + `GATED_MODULES` registry + numbered
  idempotent migrations with the 4-policy RLS pattern).

## 4. Recommended architecture

**Source of truth: Supabase. Display copy: Shopify metaobjects + metafields. Rendering:
Liquid (server-side). Submission: Vercel endpoint.**

```
Reader on product page                        Melissa in Command Center
      │ submit form                                  │ moderate / import / configure
      ▼                                              ▼
POST /api/reviews/submit  ──────────────►  Supabase `reviews` table  (source of truth)
  (Turnstile + honeypot,                             │ approve
   verified-buyer lookup)                            ▼
                                     Sync via existing Shopify RPC:
                                     • `review` METAOBJECTS (approved reviews)
                                     • product metafields reviews.rating / rating_count
                                     • product metafield → list of its review metaobjects
                                                     │
                                                     ▼
                                     Theme section renders reviews as real HTML
                                     + extends Dawn's Product JSON-LD with
                                       aggregateRating + review nodes (one block, deduped)
```

Component notes:

- **`reviews` table (Supabase):** rating, title, body, reviewer name/email, product mapping,
  `status` (pending/approved/rejected/featured), `source` (site, arc, import, event…),
  `verified_buyer` boolean, `consent`/provenance fields. Standard owner-RLS migration
  (`094_reviews.sql`) following the existing 4-policy pattern.
- **Moderation-first:** nothing renders until you approve it. The Command Center module gets
  a queue (approve/reject/feature/reply), settings (auto-publish threshold, star filter),
  and stats (rating over time, per-book).
- **Shopify metaobjects** for approved reviews: no scale concern
  ([1,000,000 entries per definition](https://shopify.dev/docs/apps/build/metaobjects/metaobject-limits)).
  A `list.metaobject_reference` metafield on each product holds its most recent/featured
  reviews for Liquid to loop over (that reference list caps at 128 — plenty for on-page
  display; the full history lives in Supabase and the schema's `reviewCount` comes from
  `reviews.rating_count`, not the displayed list).
- **Submission endpoint** (`/api/reviews/submit` on Vercel): Cloudflare **Turnstile**
  (free CAPTCHA) + honeypot field + rate limiting; checks the email against your Shopify
  orders via the existing RPC to set the "Verified buyer" badge honestly. No Shopify "app
  proxy" needed — that would require creating a new Dev Dashboard app (admin-created custom
  apps [can't be created anymore as of Jan 2026](https://help.shopify.com/en/manual/apps/app-types/custom-apps)
  and never supported proxies); a plain CORS endpoint on your existing Vercel project does
  the same job with none of that setup.
- **Two content types, honestly labeled:**
  - *Reader reviews* (first-party) → counted in the rating, marked up in schema, badges like
    "Verified buyer" / "ARC reader" shown truthfully.
  - *Acclaim* (editorial/press/Goodreads quotes) → separate "Praise" section, visible HTML,
    attributed, **no review markup**, never counted in the rating. Your existing
    `column_review_*` content migrates here so it's managed from the Command Center instead
    of nine raw metafields.
- **JSON-LD:** one snippet edit in your Dawn copy — read `reviews.rating`/`rating_count` +
  the review metaobjects, merge `aggregateRating` and `review` nodes into the theme's
  existing Product block. Verify with Google's Rich Results Test as part of the build's
  acceptance criteria.

## 5. Build vs. buy — the honest comparison

[Judge.me's free plan](https://judge.me/pricing) includes unlimited reviews, review-request
emails, photo/video reviews, rich snippets, Google Shopping sync, and review importing, for
$0 forever. If the goal were only "get a review app," installing Judge.me is a one-afternoon
answer, and it's the benchmark the custom build has to justify itself against.

Why custom still makes sense *for you specifically*:

| | Judge.me free | Custom module |
|---|---|---|
| Cost | $0 | $0 infra; build labor |
| Time to live | ~1 day | ~2–3 focused build sessions |
| Command Center control | ❌ separate admin | ✅ native module, your settings |
| Data ownership | export-only | ✅ your Supabase, forever |
| ARC-pipeline integration | ❌ | ✅ ties into your ARCs module |
| Klaviyo review-request flow | partial (their emails) | ✅ your Klaviyo, your templates |
| Rendering | widget JS (+ their branding on free) | ✅ server-rendered Liquid, no third-party JS |
| Schema control (Dawn dedupe) | their toggle, known conflicts | ✅ exactly one Product block |
| Photo reviews, Q&A | ✅ built in | later phases if wanted |
| Maintenance | theirs | yours (small: one endpoint, one sync job, one theme section) |

The main things you'd give up short-term: photo reviews and pre-built email sequences. Both
are addable later. If at any point this feels like too much, Judge.me remains the escape
hatch — and the Supabase-first design means your collected reviews could even be exported to
it.

## 6. Enhancements worth adding (and what to skip)

**Add — high value, cheap:**
1. **ARC → review pipeline** (the standout): when an ARC campaign wraps, readers get a
   personalized link to a short review form for that book. First-party, policy-clean, solves
   cold start. Ties into the existing ARCs module.
2. **Klaviyo post-purchase review request:** N days after fulfillment, a review-request
   email with a prefilled link (order + product), which also lets the form mark
   "Verified buyer" without friction. This is *the* driver of review volume — Judge.me's
   whole model is built on it.
3. **Star ratings on collection/listing cards** (reads the same metafields — one theme
   tweak).
4. **Acclaim manager** replacing the nine `column_review_*` metafields with a proper
   curated-quotes editor in the Command Center.
5. **Optional AI spam/tone triage** on incoming reviews (Haiku call per submission,
   ~$0.001/review) — flags spam/abuse so your moderation queue stays clean. Cheap because
   volume is low; skip if you prefer purely manual moderation.

**Later / skip for now:**
- **Photo/video reviews** — needs storage + moderation UI; Phase 3 if readers actually ask.
- **Google Shopping product-ratings feed** — requires 50+ total reviews and Merchant Center
  setup; revisit once volume exists.
- **Q&A, review replies displayed on-site, IndexNow pings for Bing** — nice-to-haves; none
  block the core value.

## 7. Risks & open questions

**Risks (all manageable):**
- **Low review volume early.** Stars only render when real reviews exist. Mitigation: ARC
  pipeline + Klaviyo requests; no minimum count for organic snippets, so even a handful of
  reviews on a title can produce stars.
- **Theme edits.** The section + JSON-LD merge lives in your Dawn *copy*; a future theme
  replacement means re-adding one section and one snippet (documented in the directive).
- **Moderation is on you.** Expect minutes/week at author-store volume, less with the AI
  triage.
- **Rich results are never guaranteed.** Correct markup makes you *eligible*; Google decides
  per-query. Bing/LLM benefits come from the visible text regardless.
- **Google Preview-branch caveat:** the migration will follow the repo's idempotency rules
  so Supabase preview branching doesn't choke.

**Open questions for you (answer in the PR or in chat, then I write the directive):**
1. **Build vs. Judge.me** — confirmed custom, given the comparison in §5?
2. **Scope of phase 1** — my proposal: reviews table + Command Center module (queue, CSV
   import, acclaim manager) + submission endpoint + metaobject sync + theme section +
   schema. Klaviyo emails and ARC pipeline as phase 2. OK?
3. **Migrate the `column_review_*` quotes** into the new acclaim system, or leave them
   as-is and only manage new content?
4. **Who reviews:** allow anyone to submit (moderated), or verified buyers/ARC readers only?
   I'd suggest anyone-moderated; readers who bought elsewhere (Amazon) are still legitimate
   *readers* of the book, and you approve every one anyway. Their badge would just say
   "Reader" instead of "Verified buyer."

## 8. Tooling for the build (your efficiency question)

You asked me to assign the right tool for the job and not over-subscribe:

- **The build itself: Claude Code in this repo** (sessions like this one). It's TypeScript/
  React/SQL/Liquid authoring in an existing codebase — that's just coding work; no
  orchestration frameworks, no paid services. Phase 1 is roughly: 1 migration, 1 Vercel
  endpoint, 1 module (~6 components following the Inventory template), 1 sync function
  reusing the Shopify RPC, 1 theme section + 1 schema snippet.
- **Python scripts for one-off data tasks** (free, no LLM needed): migrating the
  `column_review_*` metafield contents into the acclaim table, validating/normalizing review
  CSVs before import, bulk-writing metaobjects via the Admin API. Deterministic work —
  a script does it better and cheaper than any model.
- **`claude -p` (headless) is *not* needed** for the build itself — it shines for batch
  text-processing jobs, and the only candidate here is the optional per-review spam triage,
  which is better done as a tiny Haiku API call inside the submission endpoint
  (~$0.001/review at author-store volume, or $0 if we skip it).
- **No new paid infrastructure:** Supabase (existing), Vercel (existing), Shopify token
  (existing), Cloudflare Turnstile (free tier), papaparse (already installed).

**Verification note:** the network sandbox for the research agents blocked direct loading of
some source pages, so a few policy quotes were confirmed via search excerpts rather than the
live page. The load-bearing claims (third-party review markup prohibited; manual-action
risk; metaobject limits; Judge.me free tier) are each backed by multiple independent
sources, but the directive will include a step to re-validate the final markup against
Google's live Rich Results Test rather than trusting documentation quotes.
