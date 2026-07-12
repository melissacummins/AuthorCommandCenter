# Marketing Studio — Feasibility Audit & Build Plan

**Status:** Proposal for review — no code has been built yet.
**Question being answered:** Can we turn the Marketing module into an Author-Scale-style
tool (manuscript scanning → hooks → slideshows → e-reader scene graphics), fed by one
shared manuscript source and the catalog, instead of re-typing book info everywhere?

**Short answer: yes, and you're much closer than you think.** Roughly 70% of the
infrastructure already exists in the app — it's just not wired together. The two genuinely
new things are (1) the manuscript scanner pipeline and (2) the e-reader scene / slideshow
renderer. Everything else is plumbing between systems you already built.

---

## 1. What you actually have today (the audit)

I had three research passes go through the whole codebase. Here's the honest state of it:

| Piece | Reality |
|---|---|
| **Marketing → Ads wizard** (Book Analysis, Creative Studio, Hook Workshop, Copy Generator, Script Builder) | **A UI prototype.** The "AI analysis" is a hard-coded 2.5-second timer that always returns the same fake themes and comp authors (`BookAnalysisStep.tsx:32` literally says `// Simulate AI analysis (replace with real API call)`). Nothing is saved — close the tab and it's gone. The Book Basics form re-asks for title/series/pen name/subgenre/heat/tropes and never touches the catalog. The steps don't even share data with each other (hooks you favorite never reach the Copy Generator despite the UI claiming they will). |
| **Marketing → Promotions & Newsletters** | Real and working. Both use the catalog book picker and persist to Supabase. These are fine — leave them alone. |
| **Ad Alchemy** | A 29-line "Coming Up" splash screen. Nothing behind it. |
| **Catalog** | Solid. `books` has title, subtitle, series + position, pen name, blurb, `tropes[]`, kinks, content warnings, ASIN/ISBNs, keywords, cover, reviews. **But: no `heat_level` and no `subgenre` column** — that's why other tools can't pull them. Nine modules already consume the catalog, so the "single source for book facts" pattern is proven. |
| **Writing module** | This is your manuscript home and it's better positioned than you may realize. Manuscripts import from .docx/.txt/.md (italics preserved), chapters stored as HTML in Supabase, word counts sync — and **each manuscript already has an optional `book_id` link to the catalog** plus a `status` field with a `final` value. The "one place to put the manuscript that everything else picks up" **already exists**; nothing else reads it yet, but the schema is ready. |
| **AI backend** | Already built and multi-provider: `api/writing/ai.ts` supports Anthropic, OpenRouter, and OpenAI with your own keys stored encrypted per-user. This is directly reusable for manuscript scanning. |
| **Image & video generation** | Already built and extensive: `api/media/generate.ts` has ~35 image models (Flux, gpt-image, Ideogram, Imagen…) plus video models (Kling, Veo3, LTX…), with outputs saved to the `media-outputs` storage bucket. **The "generate a background from the scene" feature is 90% done** — it just needs a scene-to-prompt step in front of it. |
| **Social Media module** | Read-only Pinterest analytics. The Marketing tab of the same name is an empty placeholder. |
| **What does NOT exist anywhere** | Any canvas/compositing/rendering capability — no slideshow renderer, no text-on-image, no video assembly (no ffmpeg/Remotion/canvas drawing). This is the one genuinely new subsystem. |

So your instinct is exactly right: you built good individual organs and never connected the
circulatory system.

---

## 2. The unifying concept

One rule fixes the "why am I typing this again" problem everywhere:

> **The catalog is the source of truth for book *facts*. The Writing module is the source
> of truth for book *text*. Marketing reads both and never asks for either.**

Concretely:

1. **Add `heat_level` and `subgenre` to the `books` table** (one small migration). Now the
   catalog carries everything Book Analysis was re-asking for: title, series, pen name,
   subgenre, heat level, tropes, blurb.
2. **Treat a manuscript with `status = 'final'` + a `book_id` link as "the marketing
   manuscript"** for that book. You already import finals into Writing; a small "Use for
   marketing / final" toggle makes it explicit. Any module that needs the text calls the
   existing `getManuscriptsForBook(bookId)` helper.
3. **The Marketing module opens with the catalog book picker** (like Promotions already
   does). Picking a book pulls facts from the catalog and text from Writing. Zero re-entry.

This also future-proofs Ad Alchemy, ARCs, KDP Optimizer, etc. — they inherit the same rule.

---

## 3. The proposed build — "Marketing Studio" in five phases

Each phase is a self-contained PR that leaves the app working. Order matters: each one
feeds the next.

### Phase 0 — Foundation glue (small, unblocks everything)
- Migration: `heat_level` (e.g. 1–5 or text) and `subgenre` on `books`; backfill UI in
  Catalog edit form.
- Migration: new marketing tables — `marketing_hooks`, `marketing_scenes`,
  `marketing_creatives` (slideshows + scene cards), reusing the type shapes that already
  exist unused in `src/lib/types.ts:430-500`.
- Replace `BookBasicsForm` with `CatalogBookPicker` + read-only book facts panel +
  manuscript selector (finals for that book, from Writing).
- **No AI in this phase. Pure plumbing.**

### Phase 1 — Manuscript Hook Scanner (the Author Scale core)
- New `api/marketing/ai.ts` endpoint modeled directly on `api/writing/ai.ts` (same BYOK
  key handling, same providers).
- **Two-pass scan, orchestrated from the browser one chapter at a time** (this matters —
  see risk #1):
  1. *Extraction pass* — cheap model reads each chapter and returns candidate hooks as
     JSON: the hook line(s), why it works, trope/heat tags, and the surrounding scene
     excerpt for later use.
  2. *Ranking & wording pass* — a stronger model takes all candidates plus the book's
     catalog facts (tropes, heat, subgenre) and returns the top N, each with suggested
     slideshow wording (slide-by-slide text) and suggested ad-copy angle.
- Results save to `marketing_hooks` with the scene context attached. You approve, edit,
  or discard each one — edits persist.
- Progress bar per chapter; a scan is resumable (chapters already scanned are skipped).

### Phase 2 — Slideshow Studio
- Pick an approved hook → it becomes an editable slide deck (usually 3–7 short text
  slides, 1080×1920).
- Per-slide background, three options:
  a. **Generate from scene** — a cheap model turns the stored scene excerpt into an image
     prompt, then calls your existing `api/media/generate.ts` (Flux etc.). Costs pennies.
  b. **Pick from Media library** (anything already in `media-outputs`).
  c. **Upload your own.**
- Text overlay editor: font, size, position, color, safe-area guides for TikTok/Reels UI.
- Export: PNG per slide (drop straight into TikTok's photo-mode/CapCut), saved to
  `media-outputs` so the Media module sees them too.
- Rendering approach: plain HTML/CSS slide → PNG via canvas snapshot. Deterministic,
  free, no AI.

### Phase 3 — E-reader Scene Cards (the "Kindle screenshot" feature)
- Pick a scene: either jump from a hook's stored excerpt or browse chapters directly
  (chapter text is already HTML in Supabase — italics intact, which matters for romance).
- The scene renders as a **generic e-reader page** (paper background, book title header,
  page footer — deliberately *not* Amazon's Kindle UI; see risk #4).
- **Dialogue auto-detection is plain code, not AI** — quoted text is found with
  deterministic parsing, for free. Each dialogue span gets a toggleable highlight.
- Annotation layer: highlight color, strike-through for the naughty words, underline,
  circle, heart, exclamation — hand-drawn-style SVG stamps you can place, move, resize.
- Export options:
  a. PNG of the annotated page (transparent or paper background) — use over any video in
     CapCut/TikTok. **This is the MVP.**
  b. Generated video background from the Media module (Kling/Veo/LTX already work) with
     the page composited on top, exported in-browser as WebM. **Stretch goal** — see
     risk #3 before counting on it.

### Phase 4 — Rewire the rest of the wizard to real data
- Copy Generator and Script Builder call the real AI endpoint, pre-seeded with catalog
  facts + your approved hooks (favorited hooks actually get prioritized now).
- Outputs persist (`marketing_copy` table) instead of dying on tab-switch.
- Book Analysis step's fake timer is deleted; the real reader-avatar/comp-author analysis
  runs off the manuscript + catalog and is saved.
- The Marketing "Social Media" placeholder tab becomes a gallery of generated assets
  (slideshows, scene cards) with per-book/per-pen-name filtering — a natural bridge to the
  Social module later.
- Ad Alchemy, whenever you build it, consumes these same tables instead of inventing
  its own.

---

## 4. Where this could break — the honest risks

1. **Serverless timeouts kill whole-book scans.** Vercel functions have short execution
   limits; sending a 90k-word novel in one request will time out. **Solution baked into
   the design:** the browser loops over chapters and makes one small API call per chapter
   (exactly how your audiobook module already handles long work). Also why scans are
   resumable.
2. **AI cost per scan.** A full novel is ~120–130k tokens of input. Scanning every chapter
   with a top-tier model on every scan would get expensive fast. The two-pass design fixes
   this: the per-chapter extraction runs on Haiku (cheap), and only the distilled
   candidates go to a stronger model. Realistic cost: **roughly $0.20–0.40 per full-book
   scan, and ~$0.01–0.05 per generated background image** on your own keys. See §6.
3. **In-browser video export is the shakiest piece.** Browsers can compose video + overlay
   to WebM natively, but true MP4 export needs ffmpeg-in-the-browser (heavy, slow) or a
   server (Vercel functions aren't suited to it). TikTok/CapCut accept PNG overlays and
   WebM in most flows, so the plan ships PNG + WebM and treats MP4 as explicitly out of
   scope for v1. If MP4 becomes a must-have later, the right answer is a small external
   render service — a separate decision.
4. **"Kindle" is Amazon's trademark.** A pixel-perfect fake Kindle screenshot in paid ads
   invites takedowns. The scene card uses a clean generic e-reader look (which is also
   what most of these tools actually render). You lose nothing functionally.
5. **Catalog gaps.** No heat/subgenre columns today (Phase 0 fixes), and some catalog
   entries may have empty tropes/blurbs — the scanner should degrade gracefully and can
   even *suggest* tropes back to the catalog from the manuscript scan (nice enhancement).
6. **BYOK dependency.** Scanning needs your Anthropic (or OpenRouter) key set in Settings;
   background generation needs your Fal key. Both flows already exist — the UI just needs
   clear "add your key" prompts when missing.
7. **The existing Ads wizard isn't worth preserving as-is.** Since it has no persistence
   and no AI, rebuilding its steps on real data is not "throwing work away" — the UI
   shells and step layout get reused; only the fake internals are replaced.

Nothing here is a blocker. Risk #3 is the only one that constrains scope (video export),
and it's phased so it can't sink the rest.

---

## 5. Enhancements you'd get over Author Scale

Because this lives inside your command center instead of a standalone tool:

- **Catalog-aware voice.** Every prompt automatically knows the book's tropes, heat
  level, subgenre, pen name, and blurb — hooks come out already on-brand, per pen name.
- **Assets land in your Media library** and are reusable across Marketing, future Ads,
  and Socials — not trapped in an external app.
- **Hooks are a shared asset.** The same approved hook feeds slideshows, scene cards, ad
  copy, and reel scripts, so your messaging stays consistent across formats.
- **Manuscript-to-catalog backflow.** The scanner can propose tropes/content warnings it
  detects that aren't in the catalog yet — one click to accept.
- **Scene cards can quote-attribute automatically** (book title, series, pen name) for
  legally-clean teaser graphics.
- Later: pipe finished assets into the Social module for scheduling/tracking, and into
  Ad Alchemy for performance analysis — same tables, no re-import.

---

## 6. The right tool for each job (efficiency plan)

Guiding rule you stated, applied: **never pay a model to do what deterministic code does
for free.**

### Free / deterministic (plain TypeScript, no AI, no cost)
- Dialogue detection & quote spans (regex/parser over chapter HTML)
- E-reader page layout & pagination
- Slide rendering, text overlay, PNG/WebM export
- Highlight/strike/annotation editing
- All persistence, progress tracking, resume logic

### Runtime AI (your keys, chosen per job)

| Job | Model | Why | Est. cost |
|---|---|---|---|
| Per-chapter hook extraction | **Claude Haiku 4.5** (`claude-haiku-4-5`) | $1/$5 per M tokens; extraction is pattern-spotting, not deep reasoning | ~$0.15–0.25 per full novel |
| Hook ranking + slideshow wording | **Claude Sonnet** (`claude-sonnet-4-6`, already the app's default; `claude-sonnet-5` when you want the newer model — intro-priced $2/$10 through Aug 2026) | Needs taste + genre awareness; runs once per scan over distilled candidates | ~$0.05–0.15 per scan |
| Scene → image prompt | Haiku 4.5 | One short call per background | <$0.01 |
| Copy Generator / Script Builder | Sonnet | Quality matters, volume is low | ~$0.02–0.05 per generation |
| Background images | Existing Media models (Flux Schnell ≈ $0.003/img up to Imagen/gpt-image ≈ $0.04–0.08) | Already wired | pennies |

All calls go through the existing encrypted-BYOK endpoints, so provider choice stays
yours (OpenRouter works too). Everything supports per-user model override like the
Writing chat already does.

### Build execution (who writes the code)
- **This is a TypeScript/React/Supabase repo — no Python or shell scripting is the right
  tool here.** The runtime never shells out to `claude -p`; the app calls the API
  directly through the endpoint pattern you already have (cheaper, no CLI dependency,
  works on Vercel).
- **Builder:** Claude Code sessions in this repo, one PR per phase, following the
  existing directive pattern (like `WRITING_MODULE_DIRECTIVE.md`). Phases 0–1 are the
  highest-value, lowest-risk start. Sonnet-tier is fully sufficient for the
  implementation work — no need to pay Opus rates for plumbing.
- Each phase's directive will include the Supabase SQL editor link for its migration,
  per house rules, and all migrations will be idempotent for preview branching.

---

## 7. Decisions I need from you before writing the build directive

1. **Heat level format** — a 1–5 flame scale, or free text (e.g. "sweet / steamy /
   scorching")? (Affects the catalog migration and every prompt.)
2. **Video in v1?** — Ship Phase 3 with PNG scene cards + WebM slideshow export and defer
   MP4, or keep v1 strictly image-based and add motion later? (My recommendation: PNG +
   WebM, defer MP4.)
3. **Scan trigger** — manual "Scan manuscript" button only (my recommendation — you
   control cost), or auto-scan when a manuscript is marked final?
4. **Keep or fold Ad Alchemy?** — This plan makes Marketing the creative studio. Should
   Ad Alchemy stay reserved for ad *performance* (CSV import, Golden Ratio math) so the
   two don't overlap? (My recommendation: yes — Marketing = make, Ad Alchemy = measure.)
5. **Scope check** — anything in Author Scale I didn't cover that you use? (e.g. do they
   do anything with sound/music you'd want noted as future scope?)

Answer these (or just say "your recommendations are fine") and the next step is the full
build directive: `docs/MARKETING_STUDIO_DIRECTIVE.md` with per-phase specs, schemas,
prompts, and acceptance checks that another model can execute phase by phase.
