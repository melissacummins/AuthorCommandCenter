# Content Creator — Build Directive

Instructions for the build session(s) implementing the plan approved in
`docs/MARKETING_STUDIO_AUDIT.md` (v3). Read that document first for the why; this
document is the how. Execute **one phase per PR**, in order. The app must build, deploy,
and function after every phase.

---

## Ground rules (apply to every phase)

1. **Follow existing patterns, don't invent new ones.** Before writing code in an area,
   read the closest existing implementation and mirror it:
   - AI endpoint + BYOK key handling → `api/writing/ai.ts` (action-routed handler,
     AES-256-GCM per-user keys, bearer-token auth via Supabase service role)
   - Client AI wrapper → `src/modules/writing/lib/ai.ts`
   - Book selection → `src/components/CatalogBookPicker.tsx` (used by planner, writing,
     kdp-optimizer)
   - Pen-name context → `usePenNames()`
   - Image/video generation → call `api/media/generate.ts`; do not duplicate its logic
   - File import/parsing → `src/modules/writing/lib/import.ts` (mammoth for .docx)
   - Storage → `media-outputs` bucket conventions from `api/media/generate.ts`
2. **Migrations:** numbered sequentially from the current max in `supabase/migrations/`
   (next is `100_…`). Every statement idempotent (`IF NOT EXISTS`,
   `DROP POLICY IF EXISTS` before `CREATE POLICY`). RLS owner-scoped (`user_id =
   auth.uid()`) on every new table. Every PR description containing a migration must
   include the Supabase SQL editor link:
   `https://supabase.com/dashboard/project/vinnvzmuuwmssijwdomt/sql/new`
3. **No hard-coded AI models — anywhere.** Model IDs live only in
   `content_model_settings` rows and in the `DEFAULT_MODELS` constant (one place,
   `src/modules/content-creator/lib/models.ts`), which seeds settings on first use.
   Every AI call reads task → provider+model from settings. Model dropdowns are
   populated from the provider's live model list (`?action=models`, already implemented
   in `api/writing/ai.ts` — extend, don't fork).
4. **Deterministic before generative.** Anything computable in plain TypeScript
   (dialogue detection, banned-word scanning, layout, exports, timing) must not call a
   model. AI calls are reserved for: hook extraction, ranking, slide/copy/script
   writing, image-prompt drafting, synonym suggestions, catalog-autofill analysis.
5. **Sidebar:** `Content Creator` goes in the **Marketing** group in both
   `src/components/Layout.tsx` and `src/pages/Home.tsx` (same order in both, per
   CLAUDE.md). Do not add a fifth group.
6. **Every generation is user-initiated.** No background jobs, no auto-scans, no
   generation on page load.
7. **Scope discipline.** Do not modify unrelated modules except where a phase explicitly
   says so (e.g. the Writing model-picker retrofit in Phase 1, catalog work in Phase 5).
8. **Builder model guidance:** Sonnet-tier is sufficient for all phases. Use one Claude
   Code session per phase; start each session by reading this directive, the audit doc,
   and the files named in the phase.

---

## Phase 0 — Foundation (migration + module shell + demolition)

### Migration `100_content_creator.sql`
```sql
-- books: the two missing marketing facts
ALTER TABLE books ADD COLUMN IF NOT EXISTS heat_level SMALLINT
  CHECK (heat_level BETWEEN 1 AND 5);
ALTER TABLE books ADD COLUMN IF NOT EXISTS subgenre TEXT;

-- content_hooks: scanner output + manual entries
-- (id uuid pk, user_id, book_id fk books null, manuscript_id fk manuscripts null,
--  hook_text text, scene_excerpt text, rationale text, tags text[],
--  status text check in ('candidate','approved','archived') default 'candidate',
--  favorite boolean default false, source text check in ('scan','manual'),
--  created_at, updated_at)

-- content_scans: resumable scan state
-- (id, user_id, manuscript_id fk, status text check in ('running','done','cancelled'),
--  scanned_chapter_ids uuid[] default '{}', model_used text, created_at, updated_at)

-- content_creatives: slideshows, screenshots, videos
-- (id, user_id, book_id fk null, hook_id fk content_hooks null,
--  type text check in ('slideshow','screenshot','video'),
--  title text, payload jsonb, status text default 'draft', created_at, updated_at)
-- payload shapes documented in src/modules/content-creator/types.ts (see phases 2-4)

-- hook_playbook_entries: curated hook patterns (AACP import)
-- (id, user_id, title, pattern_text, example_text, tags text[],
--  pen_name_id fk pen_names null (null = global), formats text[] default '{}',
--  active boolean default true, created_at, updated_at)

-- playbook_rules: style rules, avatar frameworks, user banned words
-- (id, user_id, rule_type text check in ('style','avatar','banned_word'),
--  content text, replacement text null, active boolean default true, created_at)

-- default_banned_words: shared platform-safety list, no user_id
-- (id, word text unique, platform text default 'meta', note text)
-- RLS: SELECT for all authenticated users; no insert/update/delete from clients.
-- Seed ~50-100 entries in this migration from published Meta/TikTok advertiser
-- word lists ('hunt', explicit anatomy, violence terms, etc.).
-- user opt-outs live in a small table: user_banned_word_optouts(user_id, word_id).

-- content_model_settings: per-user per-task model choice
-- (user_id, task text check in
--   ('extract','rank','slides','script','copy','image_prompt','synonym','catalog'),
--  provider text, model_id text, primary key (user_id, task))

-- model_favorites: starred models, shared across the app
-- (user_id, provider, model_id, primary key (user_id, provider, model_id))
```
Write the actual SQL fully; the comments above are the spec.

### Module shell
- `src/modules/content-creator/ContentCreatorModule.tsx`: header = CatalogBookPicker +
  pen-name awareness + manuscript selector (finals for the selected book via
  `getManuscriptsForBook`, plus any manuscript if none is linked). Tabs: **Hooks ·
  Slideshows · Kindle Screenshots · Videos · Playbook** (all placeholder bodies this
  phase). Route + sidebar entries added; module remembers last-selected book
  (localStorage).

### Demolition
- Delete `src/modules/ad-alchemy/`, `src/modules/marketing/`,
  `src/modules/promotions/`, `src/modules/newsletters/`, `src/lib/klaviyo.ts`,
  `api/klaviyo/`, and their routes/sidebar entries (Layout.tsx **and** Home.tsx).
- Remove the now-dead ad types from `src/lib/types.ts` (`BookAnalysis`, `AdCreative`,
  `AdHook`, `AdCopySet`, etc.) — grep for usages first; they should be unused.
- Leave all existing promotions/newsletters DB tables untouched. Note in the PR body
  that a cleanup migration can drop them later once Melissa confirms.

### Acceptance
- App builds; sidebar shows Content Creator (Marketing group) and no longer shows
  Marketing or Ad Alchemy; picking a book shows its facts (including new heat/subgenre
  fields, editable in Catalog's form which gains the two inputs); migration applies
  cleanly twice in a row (idempotency check).

---

## Phase 1 — Playbook + Scanner

### Playbook tab
- CRUD for `hook_playbook_entries` and `playbook_rules`. Import panel: textarea paste +
  file upload (.txt/.md/.docx via the writing importer's mammoth path, .csv via
  simple parse). After upload, an AI-assisted split (task `copy`) proposes discrete
  entries from the pasted blob for user review — nothing saves without confirmation.
- Banned words section shows the default list (read-only rows with per-row disable
  toggle writing to `user_banned_word_optouts`) + user's own `banned_word` rules with
  optional preferred `replacement`.

### AI endpoint `api/content/ai.ts`
- Action-routed like `api/writing/ai.ts`; reuse its key-decryption helpers (import,
  don't copy). Actions: `extract`, `rank`, `slides`, `script`, `copy`, `image_prompt`,
  `synonym`, `catalog`. Each POST body: `{ task, provider, model, payload }`; the
  handler validates the user owns a key for the provider and forwards a JSON-only
  prompt. All prompts live in `api/content/_prompts.ts` with this shared preamble
  builder:
  - book facts block (title, series, pen name, subgenre, heat 1–5, tropes, blurb)
  - playbook block: active entries (filtered by format + pen name, cap ~15, prefer
    tag-matched), style rules, avatar rules
  - banned words block: "never output these words: […]"
  - output contract: "Respond with JSON only, matching this schema: …"
- `extract` input: one chapter's plain text (client strips HTML) + chapter idx/title.
  Output: `{ candidates: [{ hook_text, scene_excerpt, rationale, tags[] }] }` (0–5 per
  chapter; instruct the model to prefer scenes matching playbook patterns).
- `rank` input: all candidates + target count (default 20). Output: ordered survivor
  list with improved `hook_text` wording. Survivors are what gets written to
  `content_hooks`.

### Scan orchestration (client-side, in the Hooks tab)
- "Scan manuscript" button → creates `content_scans` row → loops chapters sequentially:
  skip ids already in `scanned_chapter_ids`, call `extract`, accumulate candidates,
  update the scan row after each chapter (this is the resume point). Progress bar
  (`chapter x of y`), Cancel (status='cancelled'; resumable later). After the last
  chapter: `rank` call → insert `content_hooks` → status='done'.
- Hooks list UI: filter by book/status/favorite, edit hook text inline, approve /
  archive / favorite, "view scene" expands the stored excerpt. Manual "add hook" too.

### Banned-word guard (deterministic, shared lib)
- `src/modules/content-creator/lib/bannedWords.ts`: builds the active set (defaults −
  opt-outs + user rules), `scan(text) → matches`, `mask(word) → 'hùnt'/'h@nt'` style
  substitution (accent map first, '@' fallback). Used by every editor in later phases:
  flagged words render underlined-red with a popover: **[use replacement] [mask]
  [ask AI for synonym]** (synonym = `synonym` task, one short call).

### Model settings + favorites
- Settings section "Content Creator AI": one dropdown per task, options from the live
  provider model list, favorites (⭐) pinned on top; writes `content_model_settings` /
  `model_favorites`. Extract defaults to the cheapest current small model of the
  configured provider; all other tasks default to the provider's standard default model
  (same constants file, one place to change).
- **Writing retrofit:** swap the Writing chat's model `<select>` for the new
  favorites-aware dropdown component (shared in `src/components/ModelPicker.tsx`).

### Acceptance
- With an Anthropic or OpenRouter key configured: scan a real manuscript end-to-end;
  kill the tab mid-scan and confirm resume skips done chapters; hooks persist and are
  editable; a banned word typed into a hook gets flagged with working fixes; model
  dropdowns list live models and remember favorites; Writing chat still works with the
  new picker.

---

## Phase 2 — Slideshow Studio

- Slideshows tab: "New slideshow" requires an approved hook. Direction form: free-text
  notes ("open with…", tone), extra banned words (session-only additions), slide count
  (2–10, default 5), optional avatar rule pick. → `slides` task returns
  `{ slides: [{ text }] }` in narrative order (hook → escalation → payoff/CTA).
- Editor: vertical 9:16 carousel (1080×1920 design size). Per slide: editable text
  (banned-word guard live), drag-reorder (dnd-kit, already a dependency), background =
  none / **generate** (`image_prompt` task on the hook's scene_excerpt → user can edit
  the prompt → POST `api/media/generate` with an existing cheap image model preset;
  show cost hint) / **library** (picker over `media-outputs`) / **upload**. Text style
  controls: font (3–4 licensed/system choices), size, weight, position (top/middle/
  bottom), color + shadow toggle; TikTok safe-area guides overlay.
- Persistence: `content_creatives` type='slideshow',
  `payload = { slides: [{ text, bg_url, style }], direction_notes }` — autosave
  debounced.
- Export: render each slide off-screen at 1080×1920 → PNG (canvas; if a helper lib is
  needed prefer `html-to-image`, keep it lazy-loaded). "Download all" (zip via
  client-side jszip) + "Save to Media library" (upload PNGs to `media-outputs`).
- "Copy text" button per slide (AuthorScale parity).

### Acceptance
- Hook → directed 5-slide generation honoring a direction note and never emitting a
  banned word (verify guard catches a seeded case); reorder, edit, per-slide
  backgrounds from all three sources; exported PNGs are 1080×1920 and legible;
  creative reloads intact after refresh.

---

## Phase 3 — Video Composer

- Videos tab. Inputs: **background** (video from media library / upload to
  `media-outputs`, or the image slides of an existing slideshow), **captions** —
  either an existing slideshow's slide texts or `script` task output from a hook
  (`{ lines: [{ text, seconds }] }`), fully editable with per-line duration
  (0.5s steps), **music** — none / upload (audio to `media-outputs`) / generate via
  ElevenLabs (new `api/content/music.ts` reusing `user_elevenlabs_keys` decryption from
  `api/audiobook`; prompt + duration → track saved to bucket).
- Preview: layered `<video>`/slide renderer + absolutely-positioned caption text driven
  by a shared clock; `<audio>` for music; play/pause/scrub; safe-area guides; caption
  styling identical to the slideshow text controls.
- Export:
  1. **WebM** — offscreen canvas draws frames (video frame or current slide + caption)
     → `canvas.captureStream(30)`; music routed through `AudioContext` →
     `MediaStreamDestination`; combine tracks in `MediaRecorder`
     (`video/webm;codecs=vp9`); show a recording progress overlay (export runs at 1×
     playback). Cap length ~3 min.
  2. **Assets bundle** — background file + transparent caption PNGs (one per line,
     numbered with durations in the filename) + music file, zipped, for CapCut users.
- Persistence: `content_creatives` type='video', payload = refs + caption lines +
  music ref + style.
- MP4 is explicitly out of scope; the export UI copy says "WebM (works with TikTok web
  upload) — need MP4? Download assets for CapCut."

### Acceptance
- Compose script-over-generated-video with music, preview matches export timing, WebM
  plays in Chrome/QuickTime-alternative and uploads to TikTok web; assets bundle
  contains correct per-line PNGs; ElevenLabs generation works with a stored key and
  fails gracefully without one.

---

## Phase 4 — Kindle Screenshots

- Kindle Screenshots tab. Source: hook scene / chapter browser (chapter HTML from the
  writing tables, italics preserved) / free paste. Editable text area, then "Render
  page."
- Page renderer: clean reading-app look — serif font, adjustable size/line-height/page
  width, background paper-white / cream / transparent, small header (title · author)
  and footer (progress %) toggles. Deterministic pagination if text overflows (page
  navigation).
- Dialogue detection (deterministic): scan for straight and curly quote pairs across
  the rendered text; each detected span becomes a toggleable highlight region. Default
  highlight = yellow; per-span color choice.
- Annotation layer (SVG over the page): freeform tools — highlight (drag over any
  text), strike-through (for naughty words — one click on a word strikes it), underline,
  and stamp shapes: circle, heart, exclamation, drawn in a hand-drawn style (2–3 svg
  path variants each, slight rotation jitter). Stamps are placeable, draggable,
  resizable, deletable. Banned-word guard runs here too (a struck word counts as
  handled).
- Persistence: `content_creatives` type='screenshot', payload = source text ref +
  page style + annotations array.
- Export: PNG (page background or transparent) at 2× for crispness; "Save to Media
  library"; "Send to Video Composer" creates a video draft with this PNG as a slide.

### Acceptance
- Pull a scene from a hook, auto-detected dialogue toggles highlight correctly with
  curly quotes, strike a word, place a heart + exclamation, export transparent PNG,
  and open it as a composer slide.

---

## Phase 5 — Catalog autofill + Catalog QoL

### Autofill
- On a Catalog book with a linked final manuscript: "Analyze manuscript" button →
  same client-side per-chapter loop (reuse the Phase 1 orchestrator with the `catalog`
  task; a scan summary accumulator keeps per-chapter outputs small) → final `catalog`
  synthesis call returns proposals: `tropes[], kinks, content_warnings, heat_level,
  subgenre, amazon_keyword_candidates[], themes[], comp_authors[], blurb_draft`.
- Confirm screen: per-field current value vs proposed, accept/skip each; accepted
  values PATCH the book. `blurb_draft` is labeled DRAFT and only fills an empty blurb.
- Also callable from Content Creator's book header when the catalog record is sparse.

### Catalog QoL (scoped strictly to these three items)
1. **Read view:** book detail opens in display mode — collapsible sections (Identity,
   Copy, Production, Pricing & Identifiers, Discovery, Reviews/Notes) rendering values
   cleanly; per-section Edit toggles inline editing.
2. **Autosave:** debounced (~1.5s) saves in edit mode, with a saved/saving indicator;
   remove the manual save-button requirement (keep it as a no-op fallback if risky).
3. **Task quieting:** books with status `published` stop generating auto "fill this in"
   tasks; replace with an opt-in "Completeness" collapsible panel in the read view
   showing missing fields passively. Locate the task-generation source (grep for where
   book to-dos are produced) and gate on status.

### Acceptance
- Autofill proposes sensible values on a real manuscript and writes only accepted
  fields; read view renders all sections collapsed→expanded correctly; edits autosave;
  a published book generates zero new auto-tasks while the completeness panel still
  lists gaps.

---

## Phase 6 — Cloud export (Drive + Dropbox)

- **Google Drive:** OAuth with **only** the `drive.file` scope (non-sensitive — avoids
  the Calendar-style verification wall because the app only touches files it creates).
  Reuse/extend the existing `user_google_tokens` storage + `api/google/` OAuth plumbing
  from the Calendar attempt; add a `Drive` connect state in Settings. Export = upload
  file(s) to a "Author Command Center" folder (create if missing, remember folder id
  per user).
- **Dropbox:** standard OAuth app (scopes: `files.content.write` only), same encrypted
  token-storage pattern, `api/dropbox/` endpoints for auth + upload to
  `/Apps/AuthorCommandCenter/`. Note in Settings copy that the Dropbox app runs in
  development mode until user volume requires production review.
- Every export surface (slideshow PNGs/zip, composer WebM/assets, screenshot PNG) gets
  a split button: Download / Send to Drive / Send to Dropbox (cloud options disabled
  with a "connect in Settings" hint when unlinked).

### Acceptance
- Connect both providers fresh, export one asset of each type to each destination,
  disconnect revokes cleanly, and an expired token re-prompts rather than failing
  silently.

---

## Prompt-quality bar (applies to phases 1, 2, 3, 5)

Every generation prompt must include, in order: book facts block → playbook entries →
style + avatar rules → banned words → task instruction → JSON schema. Style rules must
contain (seeded as a default `style` rule in the Phase 0 migration):

> "Write in plain, punchy, contemporary social-media voice. No purple prose: no ornate
> metaphors, no archaic vocabulary, no melodramatic narration. Short sentences. Sound
> like a real reader talking, not a novelist narrating."

Test each generation task against at least one real manuscript before closing its phase.
