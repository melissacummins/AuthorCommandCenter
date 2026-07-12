# Content Creator — Feasibility Audit & Build Plan (v3 — decisions locked)

**Status:** Approved direction; build directive lives in `docs/CONTENT_CREATOR_DIRECTIVE.md`.
**v3 changes:** Decisions from Melissa locked in (delete Promotions/Newsletters/Klaviyo
outright; heat level 1–5; module named Content Creator; AACP is a plugin — export needed).
New features added: built-in default banned-word list with auto-substitution, model
favorites, and Google Drive / Dropbox export (with the OAuth-verification answer).
**v2 changes:** Incorporates Melissa's review of v1 — the AuthorScale-style flow
(scan → saved hook list → pick one → direct it → carousel), the script-over-video
answer, keeping the "Kindle Screenshots" name, retiring Ads/Promotions/Newsletters/Ad
Alchemy, the Author Ad Copy Pro hook playbook, no hard-coded AI models,
manuscript-to-catalog autofill, catalog view-mode fixes, and background music.

**The module gets rebuilt from the top as "Content Creator"** (name open to change),
replacing the current Marketing module. Ad Alchemy is deleted.

---

## 1. What exists today (unchanged audit findings)

| Piece | Reality |
|---|---|
| **Marketing → Ads wizard** | UI prototype. The "AI analysis" is a hard-coded 2.5-second timer with fake results; nothing persists; steps don't share data. **Being retired.** |
| **Marketing → Promotions & Newsletters tabs** | Real, catalog-backed, Supabase-persisted (Klaviyo integration). **Decision: delete outright** — Klaviyo is no longer in use. UI and modules removed; underlying tables left in place (harmless, preserves old data) with an optional cleanup migration later. |
| **Ad Alchemy** | 29-line placeholder splash. **Delete.** |
| **Catalog** | Solid schema (title, series, pen name, blurb, tropes[], kinks, content warnings, identifiers, keywords, cover, reviews) but **no heat_level or subgenre columns**, and the UX has real problems: permanently in edit mode, no reading view, manual save, and a task system that nags about 30 "missing" items on published books. |
| **Writing module** | Manuscript home. Imports .docx/.txt/.md with italics preserved, chapters stored as HTML, optional `book_id` link to catalog, `final` status. **This is the manuscript source of truth** — nothing else consumes it yet, but the schema is ready. |
| **AI backend** | `api/writing/ai.ts`: Anthropic + OpenRouter + OpenAI, per-user encrypted keys, **and it already has a "list available models" action** — the foundation for user-selectable models per task. |
| **Media module** | ~35 image models + video generation (Kling, Veo3, LTX…) via Fal/OpenAI/Ideogram, outputs stored in the `media-outputs` bucket. Scene-background generation is ~90% built. |
| **ElevenLabs** | Keys already stored per-user for the audiobook module — reusable for background music (ElevenLabs has a music API; Suno does not offer an official public API). |
| **Social module** | Pinterest analytics (approved app incoming). Untouched by this plan; finished assets will be handed to it later. |
| **Missing everywhere** | Any renderer that puts text on images/video. This is the main new subsystem. |

---

## 2. The unifying rules

1. **Catalog = source of truth for book facts.** Add `heat_level` + `subgenre` (migration).
   Content Creator opens with the catalog book picker and never asks for facts again.
2. **Writing module = source of truth for book text.** A final manuscript linked to a book
   is what gets scanned. Scanning is **always manual** — a button, never automatic — so
   nobody pays for a feature they aren't using.
3. **The Hook Playbook = source of truth for voice.** Nothing generates hooks or copy
   without the playbook in its prompt (see §4). This is the anti-purple-prose insurance.
4. **No AI model is ever hard-coded.** Every AI task (scan, generate, image-prompt, copy)
   has a model setting whose options come from the live provider model list (the
   mechanism the Writing chat already uses). Defaults are just defaults — if a model is
   retired, you re-point a dropdown in Settings, not rebuild the feature.

---

## 3. The user flow (per Melissa, matching AuthorScale)

```
Pick book (catalog picker)
  └─ Scan manuscript  ──────────── manual button, per-chapter under the hood, resumable
        └─ Saved hook list  ─────── persists; browse, favorite, delete
              └─ Pick ONE hook
                    ├─ Direction notes: "open with this trend", "don't use these words",
                    │    tone guidance, target avatar          (optional, free text + toggles)
                    ├─ Slide count (2–10)
                    └─ Generate → carousel preview (slide 1, 2, 3… in order)
                          ├─ Edit any slide's text, reorder
                          ├─ Approve → backgrounds (generate-from-scene / library / upload)
                          └─ Output: download PNGs · compose video (§5) · save to library
```

Generation is **one hook at a time, on demand** — there is no "generate 20 slideshows"
button. The only bulk-ish operation is the manuscript scan itself, which runs
chapter-by-chapter from the browser (small requests, progress bar, resumable) so it can't
hit serverless timeouts.

Same pattern applies to Kindle Screenshots (§6): pick scene → annotate → export.

---

## 4. The Hook Playbook (Author Ad Copy Pro integration)

The concern is real: unguided models drift into purple prose, and hooks that don't follow
proven patterns waste generation money. So the playbook is a first-class feature, not an
afterthought:

- New tables: `hook_playbook_entries` (the curated hook patterns — the monthly batch you
  currently collect, convert to bookish form, and approve) and `playbook_rules` (writing
  rules: banned words/phrases, tone constraints, "no purple prose" style directives,
  avatar frameworks — what kind of reader this appeals to and what conversation they want
  to join).
- **Import:** paste or upload from your personalized Author Ad Copy Pro content (whatever
  format it lives in — see open question #2). The monthly refresh becomes: paste new
  batch → review → save.
- **Usage:** every scan, slideshow generation, and copy generation injects the relevant
  playbook entries + rules into the prompt. Hook extraction is told to find scenes that
  *match known-working hook patterns*; generation is told to write in the patterns'
  register, with the banned-word list enforced both in the prompt **and** by a free
  post-check in code (deterministic scan of output for banned words → auto-retry once,
  then flag).
- Entries can be tagged (genre, heat, format: slideshow/ad/screenshot) and scoped
  global or per pen name.

### Built-in banned words (ships with the app)
The app ships a **default platform-safety word list** (Facebook/TikTok ad-unfriendly
terms — "hunt," explicit anatomy, etc., seeded from published advertiser lists) that
applies to everyone automatically; users can disable individual entries and add their
own. Enforcement is two-layer and mostly free:
1. **Prompt layer** — the active list rides along in every generation prompt.
2. **Editor layer (deterministic, free)** — any banned word appearing in generated or
   hand-edited text gets flagged inline with one-click fixes: swap to an AI-suggested
   synonym, or apply a character mask that passes filters (accented letter or `@`
   substitution — "hùnt" / "h@nt"), whichever the user prefers.
So neither Melissa nor her users ever have to maintain this manually — it's just there.

This also improves per-book targeting: the scan pass receives the book's tropes, heat,
subgenre **and** the avatar framework, so hooks come out aimed at the right reader.

---

## 5. Video — answering the question directly

> "Is what you're saying that generating the video is expensive, or that putting the
> text on it is hard?"

Neither, mostly. Three separate things:

1. **Generating a video background** — already works in your Media module, costs whatever
   the model costs on your Fal key (roughly $0.10–$1 per short clip depending on model).
   Not a problem.
2. **Putting timed script text over a video** — **easy and free.** This is exactly what
   your Claude cowork HTML demo did: a video plays, a text layer sits on top, the text
   swaps every N seconds. That's just HTML/CSS. The Script Builder concept from the old
   wizard comes back for real here: hook → timed script → captions over your chosen
   video, previewed live in the app, per-line duration editable (like AuthorScale's
   per-slide Duration dropdowns).
3. **Baking it into one downloadable video file** — this was my only real caution.
   Browsers can record the composed result natively to **WebM** (fine, and TikTok's web
   uploader accepts it). What browsers can't do cheaply is **MP4** — that needs a heavy
   in-browser encoder or a server, and Vercel functions aren't suited to video encoding.

**So the revised plan:** build the composer (video background + timed script text + music
track), live preview in-app, export as WebM, plus "download assets separately" (video +
transparent caption PNGs) for anyone who prefers assembling in CapCut. MP4 export stays
out of v1; if WebM ever causes real friction we add a small render service or direct
TikTok posting as a follow-up. The image-slideshow video (AuthorScale's "Create Slideshow
Video": slides × durations × music) uses the exact same composer with still images.

**Music:** upload-your-own track (stored in `media-outputs`), or generate via
**ElevenLabs' music API — your keys are already stored** from the audiobook module. Suno
currently has no official public API, so it's out unless that changes.

---

## 6. Kindle Screenshots

Agreed — dropping the caution from v1. It's annotated text on a plain page, which is a
generic reading-app look, not Amazon trade dress; "Kindle screenshot" stays as the
feature name since that's what everyone calls it. Unchanged mechanics:

- Source text: pull from a hook's stored scene, browse chapters, or paste freely.
- Dialogue auto-detection is deterministic code (free, no AI). Toggleable highlights.
- Annotations: highlight color, strike-through (for the naughty words), underline,
  circle, heart, exclamation — placeable/movable hand-drawn-style stamps.
- Export PNG (paper or transparent background); drop it into the video composer (§5) for
  a video-background version.

---

## 7. Manuscript → Catalog autofill (new)

Since we're scanning the manuscript anyway, a second output of the same scan (or a
standalone "Analyze into catalog" button on a book) proposes catalog values:

- tropes, kinks, content warnings, heat level, subgenre, Amazon keyword candidates,
  themes, comp-author suggestions, series position hints.
- Presented as a **confirm screen** — nothing writes to the catalog without approval;
  accepted values fill the book record. You then only hand-enter the small stuff
  (pricing, ISBNs, dates).
- Blurb can't be *extracted* (it's not in the manuscript) but can be *drafted* from the
  scan + playbook as a starting point, clearly marked as a draft.

### Catalog quality-of-life (same phase)
- **A read view.** Opening a book shows a clean, organized display (collapsible sections
  / tabs, like your old Notion setup) — edit becomes an explicit mode or per-section
  inline edit.
- **Autosave** on edits (debounced, like the Writing module) — no more "save changes"
  every time.
- **Quiet the task nagging:** published books stop generating "fill this in" tasks by
  default; the checklist becomes an opt-in "completeness" panel instead of 30 standing
  to-dos.

(The full command-center interface redesign Melissa mentioned is explicitly **out of
scope** here — separate conversation, so this plan stays digestible.)

---

## 7b. Google Drive / Dropbox export (new — and why Calendar burned us but this won't)

Sending finished assets (slideshow PNGs, WebM videos, screenshots) straight to Drive or
Dropbox is feasible, and the Google Calendar verification wall **does not apply here**:

- **Why Calendar failed:** calendar scopes are classified *sensitive* by Google, so a
  public app must pass Google's verification review before anyone can authorize it.
- **Why Drive export is different:** Google offers a special scope, `drive.file`, that
  only lets the app touch **files the app itself created**. It's classified
  *non-sensitive* — exactly the scope designed to avoid that verification wall. Since
  export-to-Drive only ever writes our own output files, that's all we need. Bonus: the
  app already has per-user Google token storage from the Calendar attempt, so the
  plumbing exists.
- **Dropbox:** apps run in development mode for a generous user allowance, and moving to
  production is a lightweight review (nothing like Google's). Scoped to write-only file
  access.

Both appear as per-user "Connect" buttons in Settings, and every export screen gets
"Download / Send to Drive / Send to Dropbox." Scheduled as the final phase since plain
downloads work from day one.

---

## 8. Build phases (revised)

Each phase = one PR, app always working. Migrations idempotent, PR descriptions include
the Supabase SQL editor link, per house rules.

| Phase | Contents |
|---|---|
| **0 — Foundation** | Migrations: `heat_level` + `subgenre` on books; `content_hooks`, `content_scenes`, `content_creatives`, `hook_playbook_entries`, `playbook_rules`, per-task model settings. New **Content Creator** module shell (catalog picker + manuscript selector + empty tabs), replacing Marketing in the sidebar. Delete Ad Alchemy. Old Marketing tabs handled per open question #1. |
| **1 — Playbook + Scanner** | Playbook import/manage UI first, then the manual manuscript scan (per-chapter, resumable, playbook-informed) producing the saved hook list with scene context. Per-task model pickers live here from day one. |
| **2 — Slideshow Studio** | Pick hook → direction notes + slide count → carousel generation → slide editor (text, reorder) → backgrounds (scene-generated / media library / upload) → PNG export, saved to library. |
| **3 — Video Composer** | Timed script over video or image slides (per-slide duration), music (upload or ElevenLabs), live preview, WebM export + separate-assets download. Revives Script Builder as the caption engine. |
| **4 — Kindle Screenshots** | Scene picker, deterministic dialogue highlighting, annotation stamps, PNG export, feed into composer. |
| **5 — Catalog autofill + QoL** | Scan-to-catalog confirm screen; catalog read view with collapsible sections; autosave; task quieting for published books. |
| **6 — Cloud export** | Google Drive (`drive.file` scope — no verification wall) + Dropbox "send to" buttons on every export surface. |

Phases 4 and 5 are independent of each other and can swap order; 6 can slot in any time
after 2.

---

## 9. Model & cost policy (revised — nothing hard-coded)

- Every AI task gets a **settings-backed model choice** populated from the live model
  list of whichever provider key is configured (Anthropic / OpenRouter / OpenAI — the
  Writing module's existing pattern). Settings ship with sensible defaults
  (small/cheap model for per-chapter extraction; the app's standard default model for
  ranking, slideshow wording, and copy) but **any model can be swapped in the UI at any
  time** — a retired model means changing a dropdown, not rebuilding features.
- **Model favorites:** star any model in the dropdown; favorites pin to the top and can
  be set as the always-use default per task. The same favorites-aware dropdown component
  gets retrofitted into the Writing module's model picker (the thing Melissa wished it
  had).
- Cost shape at defaults: full-novel scan ≈ $0.20–0.40; slideshow generation ≈ a few
  cents; background image ≈ $0.003–0.08; video background ≈ $0.10–1. All on your own
  keys; every generation is user-initiated.
- Deterministic code (free, no AI): dialogue detection, banned-word post-check, page
  layout, slide rendering, caption timing, all exports, persistence.
- Runtime never shells out to a CLI; the app calls provider APIs through the existing
  encrypted-BYOK endpoints.

---

## 10. Decisions (locked)

1. **Promotions & Newsletters:** delete outright, Klaviyo included. UI/modules removed;
   DB tables left in place for now (optional cleanup migration later).
2. **Author Ad Copy Pro:** it's a plugin. Melissa will export its contents — the
   instructions/rules text, any knowledge/reference files, and a batch of approved hooks
   (any format: paste, txt/md/docx/csv). The Playbook importer accepts paste + file
   upload, so the exact export shape isn't a blocker for the build.
3. **Heat level:** 1–5 scale, flame display, editable labels.
4. **Module name:** **Content Creator.**
5. **Scanning:** always manual (user-initiated, user pays only when they choose to use it).
6. **Ad Alchemy:** deleted.
7. **Music:** upload-your-own + ElevenLabs (keys already stored); Suno excluded (no
   official public API).

**Next deliverable:** `docs/CONTENT_CREATOR_DIRECTIVE.md` — the full phase-by-phase build
instructions (schemas, endpoints, prompt templates including playbook injection,
acceptance checks) that a build session executes one PR at a time.
