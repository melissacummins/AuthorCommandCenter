# Build Directive: Writing Module ("Manuscripts")

> **Status: Phases 1–3.5 shipped** (#207, #208, #209 for Phases 1–3; Phase 3.5
> is this PR — July 2026). Phase 4 (story bible) remains gated behind
> explicit approval, per §6b.

**Audience:** the AI model / developer implementing this module. This document is
self-contained — all repo discovery has already been done. Follow it as written;
do not re-audit the old repos. Where this directive conflicts with something you
find in the codebase, the codebase's existing conventions win — flag the
conflict in the PR description instead of improvising.

**Goal:** add a Writing area to the Author Command Center whose **primary job is
manuscript import and storage keyed to a Catalog book**, so that every other
module (Marketing, KDP Optimizer, Cross-Sell, ARCs, Audiobook) can later consume
the manuscript text. Editing and AI assistance are built on top of that
foundation, in phases. Import-first is the explicit priority — a Writing module
that can't hold a manuscript is a failure even if the editor is beautiful.

---

## 1. Background (already decided — do not relitigate)

This module replaces two abandoned prototypes:

- **ai-writing-hub** — single-file Firebase app. TinyMCE editor, PDF/DOCX/TXT
  import (flattened to one blob, no chapters), per-document DOCX/PDF/HTML/TXT
  export, OpenRouter-based AI (send-with-context, continue-writing, multi-chat,
  prompt library, per-project "agents" with model configs), 12 themes.
- **Omniscribe** (audited from the `Omniscribe---January` repo, the latest
  version) — React 19 + Gemini studio. Series → Books → Chapters → Scenes
  structure; story bible (characters with relationships/traits/aliases, world
  lore items, pitch/comps); planning (plot points with status, three-act
  structure, chapter breakdown); daily word-count logs (drafted vs revised)
  with an analytics view; whole-book compile export (DOCX + Markdown);
  localStorage/IndexedDB persistence with JSON backup and File System Access
  disk sync; multi-provider AI settings (Google/OpenAI/OpenRouter) with model
  presets; AI features: context-doc chat with **tool-calling knowledge-base
  updates**, manuscript↔bible consistency sync, refine-selection, metadata
  extraction (themes/tropes/blurb as JSON), character-profile generation from
  manuscript text, and Gemini image generation for covers/portraits. Notably it
  had **no manuscript file import** (JSON backups only) — ai-writing-hub was
  the only one of the two that could ingest a DOCX/PDF.

**Decisions taken from the audit:**

| Keep (rebuild here) | Drop (and why) |
|---|---|
| Manuscript import (DOCX/TXT, PDF later) | Per-project AI "agents" with saved model configs — needless complexity for v1 |
| OpenRouter as a second BYOK provider alongside the existing Anthropic infra (the app is a sellable product; OpenRouter's one OpenAI-compatible endpoint lets any customer bring any model) | Full model-manager UI (search/favorite/hide hundreds of models) — a simple picker suffices |
| Chapter-structured storage (improves on both old apps, which had none) | Category → Project → Material hierarchy — redundant; Pen Names → Books already exists |
| Autosaving editor | TinyMCE — heavy external dependency; use TipTap (MIT) instead |
| AI continue/rewrite/chat **with manuscript context** | 12 themes / font manager — app already has ThemeContext |
| Export (DOCX/TXT/HTML/Markdown), incl. Omniscribe's whole-book compile | Print-window "PDF export" hack |
| Word-count progress (Omniscribe's daily drafted/revised log maps onto existing `book_word_logs`) | Firebase single-document state (1 MB limit workarounds) — Supabase rows instead |
| AI metadata extraction (themes/tropes/blurb from manuscript → written into the Catalog `books` row, which already has `blurb` and `tropes[]` fields) | Multi-chat pin/archive management — defer; one assistant thread per manuscript is enough |
| Chapter structure (Omniscribe validated it; drop its extra Scenes sub-level — chapters are enough) | Model presets / fav-hidden model lists — defer; a provider toggle + model dropdown is enough |
| — | Gemini image generation for covers/portraits — key infra for image AI (fal/Ideogram) already exists in other modules; out of scope here |
| — | File System Access disk sync + JSON backup import — Supabase is the source of truth; export (§5) covers backup |
| — | Series entity — Catalog `books` already has `series`/`series_position` |

**Enhancements neither old app had (in scope):** chapter splitting on import,
snapshots/revision history, whole-manuscript compile export, word-count goals
wired to existing `books.target_word_count` + `book_word_logs`, and a clean
cross-module read API.

---

## 2. Repo facts you need (pre-researched — trust these)

- Stack: Vite 6, React 19, TS 5.8, `react-router-dom` v7, Tailwind v4
  (utility classes, **no component library**), `lucide-react`, Supabase JS v2.
  `mammoth` is **already a dependency** (used by the Audiobook module).
  Lint/typecheck = `npx tsc --noEmit`. Serverless functions live in `api/`
  (Vercel), not Supabase Edge.
- **The single best template to copy is the Audiobook module**:
  `src/modules/audiobook/` + migrations `082`–`084`. It already stores a full
  manuscript (`audiobook_projects.manuscript`, `audiobook_chapters` with
  `idx`/`title`/`source_text`), imports DOCX via mammoth, and splits chapters
  in `src/modules/audiobook/lib/chapters.ts`. Reuse/adapt its chapter-splitting
  heuristics rather than writing new ones.
- Module registration requires touching **five places** (miss one and the
  module silently doesn't appear):
  1. `src/App.tsx` — `lazy(() => import('./modules/writing/WritingModule'))`.
  2. `src/App.tsx` — add `'writing': <WritingModule />` to `GATED_ELEMENTS`.
  3. `src/lib/access.ts` — add `{ key: 'writing', path: '/writing', label: 'Writing' }` to `GATED_MODULES`.
  4. `src/components/Layout.tsx` — add to the `modules` array (icon + color)
     **and** to the `sections` array, inside the **Catalog** group
     (CLAUDE.md: never introduce a fifth sidebar group).
  5. `src/pages/Home.tsx` — add the module card to `moduleByPath` **and**
     mirror the Catalog-group placement in its `sections`.
  Access note: admins see new modules automatically; non-admin members need
  `'writing'` appended to their `app_members.modules` row.
- Auth/data conventions: `useAuth()` from `src/contexts/AuthContext.tsx`; every
  query filters `.eq('user_id', user.id)`. Pen-name scoping via `usePenNames()`
  (`PenNameContext`) — filter book lists by `selectedPenNameId` like
  `CatalogModule.tsx` does.
- Book linkage: use the shared `src/components/CatalogBookPicker.tsx`
  (imports `listBooks`/`createBook` from `src/modules/catalog/api`). Books live
  in the `books` table with `title`, `series`, `status`, `word_count`,
  `target_word_count`, `manuscript_due_date`, etc.
- Word-count history: `book_word_logs` (upsert per `book_id, day` via
  `logWordCount` in `src/modules/catalog/api.ts`). **Reuse it — do not create a
  parallel word-log table.**
- AI infra (Claude, bring-your-own-key): per-user encrypted keys in
  `user_anthropic_keys` (migration `069`); serverless pattern in
  `api/planner/ai.ts` (verifies the Supabase bearer token, decrypts with
  `ANTHROPIC_KEY_ENCRYPTION_SECRET`, calls the Anthropic Messages API);
  frontend wrapper `plannerComplete()` in `src/modules/planner/ai.ts`. The
  Audiobook module's `api/audiobook/index.ts` proves a second module can reuse
  the same key table with zero new secrets. **Do the same.**
- UI skeleton to copy: `src/modules/catalog/CatalogModule.tsx` — `p-6 lg:p-8
  max-w-6xl mx-auto` wrapper, `text-2xl font-bold text-slate-800` header with a
  lucide icon, tab strip with the local `TabButton` helper, card grid
  `bg-white rounded-2xl border border-slate-200`. Module accent color: pick an
  unused Tailwind family — suggest **sky** (indigo=Catalog, fuchsia=Audiobook,
  teal=Planner, emerald=Cross-Sell are taken).
- Migrations: `supabase/migrations/NNN_name.sql`, zero-padded, next number is
  the highest existing + 1 (was `094` at time of writing — **check before
  creating**). Must be **idempotent** (`IF NOT EXISTS`, `DROP POLICY/TRIGGER IF
  EXISTS` before `CREATE`) because Supabase Preview Branching re-applies them.
  PR descriptions that add a migration must include the SQL editor link:
  `https://supabase.com/dashboard/project/vinnvzmuuwmssijwdomt/sql/new`.

---

## 3. Data model (Phase 1 migration)

One migration, e.g. `095_writing_manuscripts.sql` (renumber to next available).
Follow the house RLS pattern exactly: `user_id UUID NOT NULL REFERENCES
auth.users(id) ON DELETE CASCADE`, four named policies per table
(SELECT/INSERT/UPDATE/DELETE, `"Users read own X"` style, `auth.uid() =
user_id`), `created_at`/`updated_at TIMESTAMPTZ DEFAULT NOW()`, a
`<table>_set_updated_at()` trigger, indexes on `(user_id)` and hot filters.

```
manuscripts
  id            UUID PK DEFAULT gen_random_uuid()
  user_id       UUID NOT NULL → auth.users ON DELETE CASCADE
  book_id       UUID NULL → books(id) ON DELETE SET NULL   -- loose link, audiobook-style
  title         TEXT NOT NULL
  status        TEXT NOT NULL DEFAULT 'draft'              -- draft|revising|final
  source_filename TEXT                                     -- original upload name
  word_count    INTEGER NOT NULL DEFAULT 0                 -- denormalized rollup
  created_at / updated_at

manuscript_chapters
  id            UUID PK
  user_id       UUID NOT NULL (duplicate for simple RLS, matches audiobook_chapters)
  manuscript_id UUID NOT NULL → manuscripts(id) ON DELETE CASCADE
  idx           INTEGER NOT NULL                           -- order
  title         TEXT NOT NULL DEFAULT ''
  content_html  TEXT NOT NULL DEFAULT ''                   -- canonical, preserves italics/bold
  word_count    INTEGER NOT NULL DEFAULT 0
  created_at / updated_at
  UNIQUE (manuscript_id, idx) is NOT required — reorder by updating idx; index on (manuscript_id, idx)

manuscript_revisions        -- Phase 2, but create the table now so the schema ships once
  id            UUID PK
  user_id       UUID NOT NULL
  chapter_id    UUID NOT NULL → manuscript_chapters(id) ON DELETE CASCADE
  content_html  TEXT NOT NULL
  word_count    INTEGER NOT NULL DEFAULT 0
  label         TEXT                                        -- 'autosnapshot' | user label
  created_at
```

**Why `content_html`:** DOCX import via `mammoth.convertToHtml` preserves
italics/bold (fiction authors need italics survive round-trips); TipTap edits
HTML natively; and consumers that want plain text get it through a helper (§6)
that strips tags. Do not store TinyMCE-style bloated HTML — mammoth output +
TipTap output are both clean.

---

## 4. Phase 1 — Import & foundation (build this first, fully)

Scaffold `src/modules/writing/{WritingModule.tsx, api.ts, types.ts, components/, lib/}`
and register in the five places (§2).

1. **Manuscript list view** — card grid of the user's manuscripts (title, linked
   book chip, status, word count, updated date). Pen-name filter: when a
   manuscript has a `book_id`, respect the header pen-name selection the way
   Catalog does. "New manuscript" offers **Import a file** (primary) and
   **Start blank**.
2. **Import pipeline** (`lib/import.ts`):
   - `.docx` → `mammoth.convertToHtml` (browser build is already typed in the
     repo — see `src/modules/audiobook/mammoth-browser.d.ts`).
   - `.txt` / `.md` → paragraphs to `<p>`, single newlines to `<br>`; for `.md`
     at minimum convert `*em*`/`**strong**` and `#` headings.
   - **Chapter splitting**: adapt the heuristics from
     `src/modules/audiobook/lib/chapters.ts` (heading detection: `<h1>`–`<h3>`,
     "Chapter N", "Prologue/Epilogue", all-caps short lines). After the split,
     show a **review step** — a two-pane preview where the user can merge,
     re-split at a paragraph, rename, or reorder chapters **before** saving.
     Both old apps failed here (one blob); this review step is the fix.
   - Whole file with no detectable chapters → a single chapter titled after the
     file, not an error.
   - `.pdf` is **out of scope for Phase 1** (note it in the UI as "coming
     soon"); if added later, port the PDF.js line-reconstruction approach, but
     do not block Phase 1 on it.
3. **Book link** — optional `CatalogBookPicker` at import time and editable
   afterwards. On save/update, roll up `word_count` to the manuscript row, and
   if a book is linked, upsert today's `book_word_logs` row via the existing
   `logWordCount` and update `books.word_count`.
4. **Manuscript view** — chapter sidebar (idx, title, per-chapter word count)
   + read pane rendering `content_html` in a serif font (Omniscribe's one
   surviving good idea: `font-serif`, comfortable measure ~`max-w-prose`).
5. **Cross-module read API** (in `api.ts` — this is the "most important part"
   of the whole module):
   ```ts
   getManuscriptForBook(userId, bookId): Promise<Manuscript | null>
   getManuscriptChapters(userId, manuscriptId): Promise<ManuscriptChapter[]>
   getManuscriptPlainText(userId, manuscriptId, opts?: { chapterIds?: string[] }): Promise<string>
   // plain text = content_html stripped of tags, chapters joined with
   // "\n\n=== {title} ===\n\n" separators; cap nothing — callers truncate.
   ```
   Other modules import these directly (house convention — e.g. Catalog already
   imports from kdp-optimizer). Keep them dependency-free beyond `supabase`.

**Phase 1 acceptance:** import a real DOCX novel → chapters detected → adjust
splits in review → save → reload page → manuscript persists with correct
chapter order and word counts → `getManuscriptPlainText` returns clean text →
`npx tsc --noEmit` passes → module visible in sidebar (Catalog group) and Home.

## 5. Phase 2 — Editing, revisions, export

1. **Editor**: TipTap (`@tiptap/react`, `@tiptap/starter-kit` — MIT, the only
   new dependencies this module may add). One chapter open at a time. Toolbar:
   bold, italic, headings, blockquote, ordered/bullet list, undo/redo — nothing
   more. Debounced autosave (~2 s after last keystroke) to
   `manuscript_chapters.content_html`; "Saved"/"Saving…" indicator; recompute
   word counts on save and refresh the `book_word_logs` rollup.
2. **Revisions**: automatic snapshot to `manuscript_revisions` at most once per
   chapter per hour of active editing, plus a manual "Snapshot" button with a
   label. Simple restore (list → preview → restore replaces current content,
   itself snapshotted first). No diffing UI.
3. **Chapter ops**: add, rename, delete (confirm), drag-reorder (`@dnd-kit` is
   already a dependency), merge-with-next, split-at-cursor.
4. **Export** (`lib/export.ts`): per-chapter and whole-manuscript compile.
   Formats: `.docx` (via the `docx` npm package or html-docx conversion — pick
   one, no print-window hacks), `.txt`, `.md`, `.html`. Compile = title page
   (book title/pen name if linked) + chapters with `<h1>` titles.
5. **Progress**: small header widget — total words vs `books.target_word_count`
   when linked, and a 30-day sparkline from `book_word_logs` (recharts is
   already a dependency).

## 6. Phase 3 — AI assist (only after 1 & 2 are merged)

The writing AI supports **two BYOK providers: Anthropic (existing infra) and
OpenRouter (new)**. OpenRouter matters commercially — the Command Center will
be sold, and OpenRouter's single OpenAI-compatible endpoint
(`https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer`,
plus `HTTP-Referer` and `X-Title` headers) lets any customer use any model
with one key.

Implementation:
- **Key storage**: new `user_openrouter_keys` table cloned field-for-field from
  `user_anthropic_keys` (migration `069` — `encrypted_key`/`nonce`/`auth_tag`/
  `key_hint`, AES-256-GCM, owner-only RLS). Encrypt with the same
  `ANTHROPIC_KEY_ENCRYPTION_SECRET` (it's a generic AES secret despite the
  name — `user_elevenlabs_keys` and others already share this pattern). Add
  key entry/removal to `src/modules/settings/ApiKeysSection.tsx` alongside the
  existing providers, validating the `sk-or-` prefix.
- **Serverless endpoint**: create `api/writing/ai.ts` cloned from
  `api/planner/ai.ts` (same Supabase bearer-token verification, same
  decryption), extended with a `provider: 'anthropic' | 'openrouter'` request
  field that selects which key table to read and which upstream API shape to
  call (Anthropic Messages API vs OpenAI-style chat completions). Never call
  OpenRouter from the browser — keys stay server-side like every other
  provider in this app.
- **Model selection**: per-user setting (localStorage is fine for v1) —
  provider toggle + model dropdown. For Anthropic, the small allowlist from
  `api/planner/ai.ts`. For OpenRouter, fetch the public
  `https://openrouter.ai/api/v1/models` list client-side (no key required)
  with a text filter; default `anthropic/claude-sonnet-4-6`. No
  favorites/hide/preset management in v1.
- All Phase 3 features below are provider-agnostic — they format a prompt and
  read back text; only the endpoint routing differs.

Features, in priority order:
1. **Continue writing** — sends the current chapter's tail (last ~2,000 words,
   plain text) with "continue in the same style/voice"; response appears in a
   review panel with **Append / Insert at cursor / Discard / Retry** (the old
   app's accept-flow was its best UX — keep it; never write into the chapter
   without review).
2. **Selection actions** — select text → Rewrite / Tighten / Expand /
   Describe more. Same review panel, **Replace selection** instead of Append.
3. **Manuscript-aware chat** — one assistant thread per manuscript (persist in
   a `manuscript_chats` table only if/when this ships; don't schema it in
   Phase 1). Context = user-checked chapters via `getManuscriptPlainText`,
   truncated to a sane budget (~30k words) with a visible note when truncated.
   This replicates the old app's "enabled materials" context toggle — its
   second-best idea.
4. **Sync to Catalog** (from Omniscribe's `analyzeStoryMetadata` — the
   highest-leverage AI feature for this app): a "Analyze for Catalog" button
   that sends the manuscript plain text (truncated ~30k words) and asks for
   strict JSON — `{ themes[], tropes[], suggestedBlurb }` — then shows a review
   panel where the user can accept each field into the linked `books` row
   (`blurb`, `tropes`; merge, don't overwrite silently). This is the concrete
   payoff of manuscript-in-one-place: Catalog, Marketing, and KDP Optimizer all
   read those fields today.
5. Skip entirely: prompt library, per-project agents, extended-thinking
   toggles, model preset/favorite management.

## 6b. Phase 4 (optional — do NOT start without explicit approval)

Omniscribe's story-bible layer (characters with relationships/traits/aliases,
world lore items, plot points, AI manuscript↔bible consistency sync,
AI character-profile generation from manuscript text) is genuinely valuable for
series continuity — but it is a module-sized project of its own. If approved
later, it gets its own directive; the only accommodation to make now is that
`getManuscriptPlainText` (§4.5) accepts `chapterIds` so a future bible-sync can
analyze incrementally. Do not create character/lore tables in the Phase 1
migration.

## 7. Ground rules

- One PR per phase. Each PR: `npx tsc --noEmit` clean; migration idempotent;
  PR description includes the Supabase SQL editor link when a migration is
  added, plus a manual test script (steps you actually performed).
- Follow existing code style: hand-rolled Tailwind, no new UI libraries, no
  CSS files, `clsx`/`tailwind-merge` from `src/lib/utils.ts` where helpful.
- Do not modify other modules except: the five registration files, and (Phase 3
  only) reading `src/modules/planner/ai.ts` and adding the OpenRouter key
  entry to `src/modules/settings/ApiKeysSection.tsx`. Never edit the Audiobook
  module — copy from it.
- Do not add themes, fonts settings, or anything from the "Drop" column in §1.
- If a decision isn't covered here, choose the smallest option consistent with
  the Audiobook/Catalog precedents and note it in the PR description.

---

## 8. Phase 3.5 — Author feedback round 1 (UX, providers & AI settings)

Melissa used Phases 1–3 and gave direct feedback. This phase is that feedback,
turned into instructions. Everything here modifies the existing Writing module
(`src/modules/writing/`, `api/writing/ai.ts`) — re-read §2's repo facts and
§7's ground rules before starting. One PR. All pre-researched API facts in
§8.5–§8.7 were verified against current provider documentation — trust them
over training-data recall, especially the "rejected parameters" rules.

### 8.1 Layout — the text area gets the space

The current manuscript view wastes vertical space (header block, linked-book
picker, progress card all stack above the draft) and caps width at
`max-w-6xl`. Fix:

- The manuscript view escapes the `max-w-6xl` container — full viewport width
  (`px-4 lg:px-6`), editor/reading pane filling the remaining height. Keep the
  *text measure* comfortable (`max-w-[72ch]` centered inside the pane) — wide
  pane, readable column.
- Collapse the header to **one compact row**: back arrow, inline-editable
  title, word-count text, status pill, then icon-only actions (export, chat,
  sync-to-catalog, delete). No subtitle line, no always-visible book picker,
  no progress card in the writing view.
- Give each manuscript **two tabs: Write | Analytics** (house `TabButton`
  pattern). Write = collapsible chapter sidebar (collapse to a narrow rail,
  persist state in localStorage) + the pane. **Edit mode becomes the default**
  when a chapter opens — this is a writing app; keep the reading-view toggle.
- Editor pane minimum height ~70vh so the draft dominates the screen (the
  benchmark: the old Google AI Studio build, where the text area was the page).

### 8.2 Analytics tab

Everything measurement-related moves here (from Omniscribe's analytics view):

- Total words; per-chapter word counts (simple horizontal bar list, no
  library gymnastics — recharts is available if needed).
- **Manuscript-level goal**: new `manuscripts.target_word_count` column
  (migration, §8.8) with an editable goal field and a progress bar. The goal
  lives on the manuscript now, NOT on the Catalog book — `ProgressWidget`'s
  read of `books.target_word_count` goes away.
- **Daily words chart (last 30 days)** from a new `manuscript_word_logs`
  table (§8.8) — one row per manuscript per day, upserted by the same
  `syncWordCount` path that already rolls counts up. This makes analytics
  work with no Catalog link at all.
- A small **Connections** card at the bottom of Analytics is the new (only)
  home of `CatalogBookPicker`, with one line of copy: "Status and word count
  sync to this book in Catalog."

### 8.3 Loosen the Catalog coupling

The link becomes one-way, Writing → Catalog, and minimal:

- Keep: word-count push to `books.word_count` + `book_word_logs` when linked
  (unchanged), and the book link itself (Analytics → Connections + import).
- Add: the Catalog book form/detail shows a small read-only chip for a linked
  manuscript — its status and word count — via `getManuscriptForBook`
  (this is the one permitted edit outside the writing module + settings).
- Remove: any Writing-module read of `books.target_word_count`; the pen-name
  filter on the manuscript list stays (it's cheap and correct).

### 8.4 Chat becomes a docked side panel

The modal-over-the-draft is gone. Instead:

- Chat opens as a **right-docked panel** (~`w-[380px]`, full height of the
  Write tab) beside the draft; the draft stays visible and editable. Toggle
  from the header icon; persist open/closed in localStorage.
- Every assistant message gets two small actions: **Copy** (clipboard) and
  **Insert into draft** — inserts that message's text at the cursor of the
  open editor via the same `plainTextToHtml` + `insertContent` path the
  review panel uses. If the reading view is active, the insert button is
  disabled with a tooltip ("Switch to Edit to insert").
- Keep the chapter-context checkboxes and the 30k-word truncation note.
- RevisionsPanel and SyncToCatalogPanel stay as modals (review flows —
  not part of this complaint).

### 8.5 AI Settings — full generation parameters, provider-aware

Replace `AiModelPicker` with an **AI Settings popover/panel** (gear icon in
the editor AI row and in the chat panel; one shared component, one shared
localStorage-persisted settings object extending `getAiSettings()`), exposing:
provider, model, max tokens, temperature, top-p, frequency penalty, presence
penalty, repetition penalty, reasoning/effort, and an "Enable caching" toggle.

**Show each knob only where it actually works.** These applicability rules
are verified current API behavior — sending an unsupported parameter is a
hard 400, not a no-op:

| Knob | Anthropic | OpenAI | OpenRouter |
|---|---|---|---|
| Max tokens | ✓ (`max_tokens`) | ✓ (`max_completion_tokens`) | ✓ (`max_tokens`) |
| Temperature / Top-P | **Only** on Sonnet 4.6 / Opus 4.6 and older. **Rejected (400) on Sonnet 5, Opus 4.7/4.8, Fable 5** — omit entirely there | ✓ (omit on o-series / gpt-5 reasoning models, which reject them) | ✓ |
| Frequency / Presence penalty | ✗ never supported | ✓ (not on reasoning models) | ✓ |
| Repetition penalty | ✗ | ✗ | ✓ (OpenRouter-specific) |
| Reasoning | **Effort level** `low/medium/high/xhigh/max` via `output_config: {effort}` + `thinking: {type: "adaptive"}`. `budget_tokens` is REMOVED on modern models (400) — do not implement a token-budget knob for Anthropic. On Fable 5, omit the `thinking` param entirely (always on); effort still applies | `reasoning_effort` (reasoning models only) | `reasoning: {effort}` or `reasoning: {max_tokens}` per OpenRouter's unified param |
| Enable caching | ✓ — send `system` as a content-block array with `cache_control: {type: "ephemeral"}` on the last system block (this is where the manuscript context lives, so chat re-turns pay ~10% for the cached prefix; writes cost 1.25×; 5-min TTL; short prompts below the per-model minimum silently don't cache — fine) | hide the toggle (OpenAI caches automatically) | pass `cache_control` through for `anthropic/*` models; hide otherwise |

Implementation notes:

- The **server strips defensively too**: `api/writing/ai.ts` accepts the full
  param object but drops whatever the target provider/model can't take
  (e.g. any `temperature` sent with `claude-sonnet-5`), so a stale client
  can't 400 the request.
- UI: knobs not applicable to the current provider+model render disabled with
  a one-line reason, not hidden entirely — Melissa is selling this; users
  should see what exists.
- Defaults: max tokens 1024 (editor actions) / 1500 (chat), everything else
  provider default (i.e. omitted from the request unless the user changes it).

### 8.6 Dynamic model lists — every version, including Fable

The hardcoded 3-model Anthropic allowlist is the complaint; kill it.

- New server action `GET /api/writing/ai?action=models&provider=anthropic|openai`:
  decrypts the caller's key for that provider and proxies the provider's
  models list — Anthropic: `GET https://api.anthropic.com/v1/models` (headers
  `x-api-key` + `anthropic-version: 2023-06-01`; items carry `id` and
  `display_name`); OpenAI: `GET https://api.openai.com/v1/models` (Bearer),
  client-filtered to chat-capable families (`gpt-*`, `o*`, `chatgpt-*`;
  exclude embeddings/audio/image/moderation ids). Return `[{id, name}]`.
- **Remove `ANTHROPIC_ALLOWED_MODELS`** from the completion path — accept any
  non-empty model id ≤ 100 chars; the user's own key gates access. This is
  what surfaces every dated version and `claude-fable-5` when the key has it
  (note in the picker UI that Fable-tier models bill ~2× Opus).
- OpenRouter keeps its existing public client-side list. Cache all lists
  in-memory per session.

### 8.7 OpenAI as a third chat provider

`user_openai_keys` already exists (Media module) — reuse it, do NOT create a
table or a new Settings row.

- ⚠️ **Different master secret**: the Media module encrypts OpenAI keys with
  `FAL_KEY_ENCRYPTION_SECRET` and salt `media-openai-key-v1` (see
  `api/media/key.ts` → `PROVIDERS.openai`) — NOT the Anthropic secret the
  rest of `api/writing/ai.ts` uses. The writing endpoint must read that env
  var + salt pair for the openai table or it will decrypt garbage.
- Completion: `POST https://api.openai.com/v1/chat/completions`, OpenAI
  message shape (same as the OpenRouter branch), `Authorization: Bearer`,
  `max_completion_tokens`. Omit temperature/top-p/penalties for reasoning
  models (`o*`, `gpt-5*`) per §8.5.
- Provider type becomes `'anthropic' | 'openrouter' | 'openai'` end to end
  (server routing, `lib/ai.ts`, settings panel). Key status for the picker
  UI comes from the existing `getOpenaiKeyStatus` in
  `src/modules/media/lib/client.ts`.

### 8.8 Migration — `writing_manuscript_analytics`

One idempotent migration (next free number; check `ls supabase/migrations`):

```
ALTER TABLE manuscripts ADD COLUMN IF NOT EXISTS target_word_count INTEGER;

manuscript_word_logs
  id            UUID PK DEFAULT gen_random_uuid()
  user_id       UUID NOT NULL → auth.users ON DELETE CASCADE
  manuscript_id UUID NOT NULL → manuscripts(id) ON DELETE CASCADE
  day           DATE NOT NULL
  word_count    INTEGER NOT NULL DEFAULT 0
  created_at / updated_at
  UNIQUE (manuscript_id, day)   -- upsert target, mirrors book_word_logs
```

House RLS pattern (four named owner policies), indexes on `(user_id)` and
`(manuscript_id, day)`, `updated_at` trigger reusing
`manuscripts_set_updated_at()`.

### 8.9 Acceptance

Import or open a manuscript → Write tab: draft fills the screen, chapter rail
collapses, editing is the default → open chat: panel docks beside the draft,
an assistant reply can be inserted at the cursor → gear: switch to OpenRouter,
see the full model list; switch to Claude, see every model the key can access
(incl. dated versions); temperature knob disables itself on Sonnet 5+ with an
explanatory note; enable caching and confirm a second chat turn returns
(server may log `cache_read_input_tokens` for verification) → Analytics tab:
set a goal, see the progress bar and per-chapter bars; write, save, and see
today's row in `manuscript_word_logs` → Catalog book form shows the linked
manuscript chip → `npx tsc --noEmit` clean → PR includes the Supabase SQL
editor link.

**Out of scope (unchanged decisions):** prompt library, per-project agents,
model preset/favorite management, themes, Phase 4 story bible.
