import type { Book } from '../../catalog/types';
import type { PlaybookEntry, PlaybookRule, HookCandidate } from '../types';
import type { ActiveBannedWord } from './bannedWords';
import { builtinPlaybookBlock } from './builtinPlaybook';

// Prompt builders for the Content Creator AI tasks. Order inside the system
// preamble follows the directive's quality bar: book facts → playbook →
// style + avatar rules → banned words → task instruction → JSON contract.
// Methods follow docs/reference/aacp/ — avatar-grounded specificity, named
// hook framings, plain reader-facing language.

const HEAT_LABELS = ['', 'sweet', 'warm', 'steamy', 'spicy', 'scorching'];

export interface PreambleContext {
  book: Book;
  entries: PlaybookEntry[];  // pre-filtered to active + this pen name/global
  rules: PlaybookRule[];     // active style + avatar rules
  bannedWords: ActiveBannedWord[];
}

const MAX_PLAYBOOK_ENTRIES = 15;

export function buildPreamble(ctx: PreambleContext): string {
  const { book, entries, rules, bannedWords } = ctx;
  const parts: string[] = [];

  parts.push('You are a marketing assistant for a romance author. You find and write scroll-stopping hooks for TikTok, Instagram, and Meta ads.');

  const facts: string[] = [`Title: ${book.title}`];
  if (book.series) facts.push(`Series: ${book.series}${book.series_position ? ` #${book.series_position}` : ''}`);
  if (book.subgenre) facts.push(`Subgenre: ${book.subgenre}`);
  if (book.heat_level) facts.push(`Heat level: ${book.heat_level}/5 (${HEAT_LABELS[book.heat_level]})`);
  if (book.tropes.length) facts.push(`Tropes: ${book.tropes.join(', ')}`);
  if (book.kinks) facts.push(`Kinks/spice notes: ${book.kinks}`);
  if (book.blurb) facts.push(`Blurb: ${book.blurb.slice(0, 800)}`);
  parts.push(`BOOK FACTS\n${facts.join('\n')}`);

  // The built-in strategy library ships with the app — every account, every
  // book, zero setup. The user's own playbook entries extend it.
  parts.push(builtinPlaybookBlock());

  const activeEntries = entries.slice(0, MAX_PLAYBOOK_ENTRIES);
  if (activeEntries.length) {
    parts.push(`YOUR PLAYBOOK — the author's own curated patterns. These extend the library above and take priority when they conflict:\n${activeEntries
      .map(e => `- ${e.title}: ${e.pattern_text}${e.example_text ? ` (example: "${e.example_text.slice(0, 200)}")` : ''}`)
      .join('\n')}`);
  }

  const styleRules = rules.filter(r => r.rule_type === 'style' && r.active);
  const avatarRules = rules.filter(r => r.rule_type === 'avatar' && r.active);
  if (styleRules.length) {
    parts.push(`WRITING RULES — follow every one:\n${styleRules.map(r => `- ${r.content}`).join('\n')}`);
  }
  if (avatarRules.length) {
    parts.push(`READER AVATARS — write for these readers:\n${avatarRules.map(r => `- ${r.content}`).join('\n')}`);
  }

  if (bannedWords.length) {
    parts.push(`BANNED WORDS — never use any of these words in your output (ad platforms flag them): ${bannedWords.map(b => b.word).join(', ')}`);
  }

  return parts.join('\n\n');
}

// ---------------- The anatomy of a hook ----------------
// Distilled from docs/reference/aacp (tiktok-hook-research, video-hook-
// strategy-guide) plus Melissa's critiques of the first scan. Examples alone
// don't constrain a model; explicit structure + named failure modes do. This
// rides along on every hook-writing and hook-verifying call.

export const HOOK_ANATOMY = `WHAT A HOOK IS
A hook is caption copy written by a MARKETER, addressed TO the scrolling reader, ABOUT one moment in the book — framed from outside the story. It turns that moment into an open loop: the viewer learns just enough to have a question they can only answer by reading the book, and it lands in under 2 seconds. It reads like a viral BookTok caption ("when the vampire boss finally calls you mine"), NEVER like a line lifted off the page. It is NOT a summary, NOT a description of the couple's dynamic, and NOT a quote.

VOICE & FRAME — non-negotiable:
- Speak to the viewer in caption register. Frames include: "when...", "that moment when...", "POV: you...", a direct question ("what do you do when..."), a dare ("tell me you'd survive chapter 12"), a trope-forward declaration ("the vampire boss x the courier whose blood he craves"), and plan-vs-instead ("she snuck in to kill him. he made her stay for breakfast."). The frame's job is ADDRESSING THE READER — not literally starting with "when". Lowercase caption energy is fine.
- VARY THE FRAME across a set: a batch of hooks that all open with "when" or "POV:" is a craft failure even if each one works alone.
- Name characters by their trope role, the label a stranger instantly gets — "the vampire boss", "the grumpy bodyguard", "her masked stalker" — never by their in-book name (a stranger doesn't know who "Kieran" is).
- The viewer stands in the HEROINE'S/POV character's shoes, on the RECEIVING end of the love interest's attention. "POV: you..." means the fantasy happens TO you ("POV: the man who never smiles just told the whole court you're his") — never the viewer performing the protagonist's plot actions.
- ACCURACY GOVERNS FACTS, NOT WORDING. The hook's language is always your fresh copy; only words inside quotation marks must be verbatim from the scene. Copying the scene's prose is not accuracy — it is a failure.

STRUCTURE — every hook has exactly these parts:
1. FRAME: the reader-facing shape from above (when.../POV: you.../question).
2. GRABBER: one concrete moment from the book — an action taken or a thing said. Specific beats general ("she told the monster to chase her" beats "a possessive hero").
3. GAP: exactly one piece of withheld context that creates a genuine question (wait, why? who IS he? what happens next?). The withheld thing must actually be surprising or charged — never manufacture mystery around something ordinary.
4. NOTHING ELSE. No setup, no explanation, no second beat. If the hook answers its own question, it is dead. Less context = more pull.

PROVEN SHAPES (tested BookTok data — use these, don't invent new shapes):
- Finally-payoff: "when the [trope role] finally [charged payoff]" ("when the vampire boss finally calls you mine") — "finally" implies the whole slow burn.
- Curiosity gap: [trope role] + [unexpected action that raises a question] ("she told the monster to chase her")
- Pattern interrupt: [expected role] does the opposite ("she didn't run. she told him to chase her.")
- Framed devastating line: one visceral quoted line INSIDE a frame that supplies the gap ("when you touch his scars and the man who feels nothing says 'do it again'") — the frame is mandatory; a bare quote is not a hook.
- Plan vs. what happened: intended action, derailed spectacularly ("she snuck in to kill him. he made her stay for breakfast.")
- Disproportionate reaction: the love interest's outsized response IS the hook ("when he burns down a ballroom because someone else touched your hand")
- Vulnerable moment: the guarded one finally cracks ("that moment when the tattooed biker finally says he wants him")
- POV fantasy: "POV: you..." puts the viewer on the receiving end of the love interest ("POV: you're hiding from the vampire king and he says he can hear your heartbeat")

THE INTEREST TEST — apply before returning anything:
Would a stranger who has never heard of this book stop scrolling because they NEED the answer? If the honest answer is "it's fine," cut it. Returning fewer hooks is always better than padding with weak ones.

FAILURE MODES — anything matching these is rejected:
- RAW QUOTE / PAGE-LIFT: the hook is a line, sentence, or fragment copied from the manuscript with no reader-facing frame ("You are mine!" / "Because"—he hooked her knees). Dialogue may ONLY appear quoted inside a frame that tells the viewer why to care.
- MISAIMED POV: "POV: you" doing the protagonist's plot actions instead of receiving the romance payoff ("POV: you destroyed a room with vines").
- SUMMARY: describes the premise or dynamic ("He's powerful, but he'd drop everything for her") — that's back-cover copy, not a hook.
- FAKE MYSTERY: coy about something that isn't mysterious, or withholds/implies something the scene doesn't support.
- OVERSTUFFED: two or more beats, or explains who/why/how.
- MELODRAMA / PURPLE PROSE: ornate phrasing, stacked adjectives, events exaggerated beyond what the scene actually says.
- INACCURACY: ANY factual detail that differs from the scene — wrong pronoun, wrong speaker, invented event, altered dialogue. Words inside quotation marks must be copied verbatim and attributed to the person who actually said them; everything outside quotation marks must be your own fresh caption copy.`;

// ---------------- Extraction (per chapter) — LOCATE ONLY ----------------
// The extraction model finds and copies; it never writes marketing copy.
// Hook writing happens in the rank pass on the stronger model.

export function buildExtractPrompt(chapterTitle: string, chapterIdx: number, chapterText: string): string {
  return [
    `Read this chapter and locate 0-4 moments with hook potential — moments that could stop a romance reader mid-scroll: killer dialogue, "wait, WHAT?" beats, unhinged devotion, power flips, disproportionate reactions, plans derailing, guarded characters cracking.`,
    `Your job is ONLY to find and copy. Do not write marketing copy, do not editorialize, do not exaggerate.`,
    `For each moment return:`,
    `- moment: one plain, factual sentence describing exactly what happens — who does/says what (match the scene precisely: right people, right pronouns, right speaker)`,
    `- scene_excerpt: the passage itself, copied VERBATIM from the chapter (150-800 characters, enough to include the key action or dialogue)`,
    `- tags: 1-4 lowercase tags (trope, emotion, or moment type)`,
    `Skip chapters with nothing genuinely strong — returning zero is better than a weak pick.`,
    `Respond with JSON only, no prose before or after, matching: {"candidates": [{"moment": "...", "scene_excerpt": "...", "tags": ["..."]}]}`,
    ``,
    `CHAPTER ${chapterIdx + 1}: ${chapterTitle}`,
    ``,
    chapterText,
  ].join('\n');
}

// ---------------- Ranking + writing (once per scan) ----------------

export function buildRankPrompt(candidates: HookCandidate[], target: number): string {
  return [
    HOOK_ANATOMY,
    ``,
    `Below are ${candidates.length} moments located by a full manuscript scan, each with its verbatim scene excerpt. Choose the strongest material and WRITE up to ${Math.min(target, candidates.length)} hooks from it, best first — fewer is fine; only moments that pass the interest test.`,
    `Rules:`,
    `- Every hook must follow the VOICE & FRAME and STRUCTURE rules and use one of the PROVEN SHAPES above. Match the register of the strategy-library examples — they are the target sound.`,
    `- You are WRITING fresh caption copy about each moment, not excerpting it. Returning a line copied from the scene_excerpt as the hook is an automatic failure — quote the book only inside a frame, and only verbatim.`,
    `- Name characters by trope role (pull from the book facts/tags), never by in-book name.`,
    `- Every FACT in a hook must come straight from its scene_excerpt. If the excerpt doesn't support a detail, you can't use it.`,
    `- VARIETY IS MANDATORY: use a different strategy from the library (or a different PROVEN SHAPE) for every hook — never the same shape twice until every fitting one is used. Never return two hooks from the same moment.`,
    `- Pass each candidate's scene_excerpt through EXACTLY as given.`,
    `Return for each: hook_text (the hook), scene_excerpt (unchanged), rationale (start with the strategy/shape name, then one sentence on why it stops the scroll), tags.`,
    `Respond with JSON only, matching: {"hooks": [{"hook_text": "...", "scene_excerpt": "...", "rationale": "...", "tags": ["..."]}]}`,
    ``,
    `MOMENTS:`,
    JSON.stringify(candidates, null, 1),
  ].join('\n');
}

// ---------------- Quote workshop: one moment, many strategies ----------------
// The author pastes ONE quote/excerpt they already love; the model writes one
// hook per fitting strategy from the library so she can compare framings side
// by side. Variety is the whole point — strategy diversity is enforced by
// construction, not by asking nicely.

export interface HookVariation {
  strategy: string;
  hook_text: string;
  rationale: string;
}

export function buildVariationsPrompt(quote: string, sceneContext: string, notes: string, maxVariations: number): string {
  return [
    HOOK_ANATOMY,
    ``,
    `The author picked ONE moment from the book below — a quote she already believes in. Write up to ${maxVariations} DIFFERENT hooks from this single moment, each using a DIFFERENT strategy from the HOOK STRATEGY LIBRARY (or the author's own playbook patterns).`,
    `Rules:`,
    `- One hook per strategy, each a genuinely different framing — not the same sentence reworded. If two strategies would produce near-identical hooks, keep the stronger and move on.`,
    `- DON'T ORBIT THE QUOTE. Mine the surrounding scene (reactions, the beat before, the beat after, what's at stake) and the book facts (tropes, dynamic) — several strategies work best when the hook comes at the moment from an angle the quote alone doesn't give you.`,
    `- Vary the frame across the set: at most two hooks opening with "when", at most one "POV:". Use questions, dares, trope-forward declarations, and plan-vs-instead for the rest.`,
    `- Only use strategies that honestly fit this moment. Skipping a strategy beats forcing it; fewer strong variations beat ${maxVariations} padded ones.`,
    `- Every fact comes from the quote, the surrounding scene, or the book facts above. Words inside quotation marks must be verbatim from the quote or scene.`,
    `- strategy: the library/playbook entry title, exactly as written there.`,
    notes.trim() ? `AUTHOR DIRECTION (follow it): ${notes.trim()}` : '',
    `Respond with JSON only, best first: {"variations": [{"strategy": "...", "hook_text": "...", "rationale": "..."}]}`,
    ``,
    `THE QUOTE (the author's chosen moment, verbatim):`,
    quote.slice(0, 4000),
    ``,
    `SURROUNDING SCENE (verbatim from the manuscript — mine it):`,
    sceneContext.trim() || '(scene not found in the manuscript — work from the quote, the author direction, and the book facts only; invent nothing beyond them)',
  ].filter(Boolean).join('\n');
}

// ---------------- Verification (per surviving hook) ----------------
// Adversarial pass: fact-check the hook against its own excerpt and apply
// the interest test. Runs on the same strong model as ranking.

export interface HookVerdict {
  accurate: boolean;
  is_hook: boolean;
  problems: string[];
  fixed_hook_text: string | null;
}

export function buildVerifyPrompt(hookText: string, sceneExcerpt: string): string {
  return [
    HOOK_ANATOMY,
    ``,
    `You are the quality gate. Judge this hook against its source scene. Be harsh — a rejected hook costs nothing; a bad hook published costs money.`,
    `Check 1 — ACCURACY: verify every claim in the hook against the excerpt. Pronouns, who speaks each line, what actually happens, exact wording inside quotation marks. Any mismatch = not accurate.`,
    `Check 2 — IS IT A HOOK: apply the VOICE & FRAME rules, the STRUCTURE, the FAILURE MODES, and the INTEREST TEST above. Be especially ruthless about RAW QUOTE / PAGE-LIFT — if the hook is just a line from the book with no reader-facing frame, it is not a hook, no matter how good the line is (that's fixable: wrap the line in a frame in fixed_hook_text).`,
    `If the underlying moment is strong but the wording fails, write a corrected version in fixed_hook_text (following the anatomy, verbatim dialogue only). If the moment itself can't carry a hook, set is_hook to false and fixed_hook_text to null.`,
    `Respond with JSON only: {"accurate": true/false, "is_hook": true/false, "problems": ["..."], "fixed_hook_text": "..." or null}`,
    ``,
    `HOOK: ${hookText}`,
    ``,
    `SOURCE SCENE (verbatim from the manuscript):`,
    sceneExcerpt,
  ].join('\n');
}

// ---------------- Playbook import assist ----------------

export function buildImportSplitPrompt(pasted: string): string {
  return [
    `The author pasted raw hook-pattern material below (from their curated collection). Split it into discrete playbook entries.`,
    `Each entry needs: title (a short name for the pattern), pattern_text (how the pattern works, 1-3 sentences, imperative voice), example_text (one concrete example from the material, or "" if none), tags (1-4 lowercase tags).`,
    `Keep the author's wording where possible — you are organizing, not rewriting. Skip headers, filler, and anything that isn't a usable pattern or rule.`,
    `Respond with JSON only, matching: {"entries": [{"title": "...", "pattern_text": "...", "example_text": "...", "tags": ["..."]}]}`,
    ``,
    `MATERIAL:`,
    pasted.slice(0, 24000),
  ].join('\n');
}

// ---------------- Slideshow writing ----------------

export function buildSlidesPrompt(
  hookText: string, sceneExcerpt: string, notes: string, slideCount: number,
): string {
  return [
    HOOK_ANATOMY,
    ``,
    `Turn this approved hook into a ${slideCount}-slide TikTok/Instagram photo carousel. Each slide is one short text card shown over a background image.`,
    `Structure: slide 1 IS the hook (the grabber — you may tighten it, never blunt it). Middle slides escalate with real beats from the scene, one beat per slide, keeping the gap open. The final slide lands the payoff or the cliff that makes them need the book — never a summary, never "read to find out".`,
    `Rules: every fact and every quoted line must come straight from the scene below — invent nothing. Each slide under 110 characters, plain punchy reader voice, no hashtags, no emoji.`,
    notes.trim() ? `AUTHOR DIRECTION (follow it): ${notes.trim()}` : '',
    `Respond with JSON only: {"slides": [{"text": "..."}]}`,
    ``,
    `HOOK: ${hookText}`,
    ``,
    `SOURCE SCENE (verbatim):`,
    sceneExcerpt || '(no excerpt — stay strictly on the hook itself; do not invent scene details)',
  ].filter(Boolean).join('\n');
}

// ---------------- Scene → background image prompt ----------------

export function buildImagePromptPrompt(sceneExcerpt: string, slideText: string): string {
  return [
    `Write one image-generation prompt for a vertical background behind this slideshow text. Describe mood, setting, palette, and lighting drawn from the scene — atmospheric and cinematic, softly blurred/darkened enough for overlaid text, romance-aesthetic.`,
    `Never include: people's faces in close-up, any text or lettering, logos, watermarks.`,
    `Under 60 words. Respond with JSON only: {"prompt": "..."}`,
    ``,
    `SLIDE TEXT: ${slideText}`,
    `SCENE: ${sceneExcerpt || '(none — use the slide text mood alone)'}`,
  ].join('\n');
}

// ---------------- Video script writing ----------------

export function buildScriptPrompt(hookText: string, sceneExcerpt: string, notes: string, targetSeconds: number): string {
  return [
    HOOK_ANATOMY,
    ``,
    `Turn this approved hook into a timed caption script for a ~${targetSeconds}-second video. Each line is one text card shown over the video for a few seconds.`,
    `Structure: line 1 IS the hook. Middle lines escalate with real beats from the scene, one beat per line, keeping the gap open. The final line lands the payoff or cliff. 3-7 lines total; total seconds ≈ ${targetSeconds}.`,
    `Rules: every fact and quoted line comes straight from the scene — invent nothing. Each line under 90 characters, plain punchy reader voice, no hashtags, no emoji. Give each line a duration in whole seconds (2-6s; longer lines get more time).`,
    notes.trim() ? `AUTHOR DIRECTION (follow it): ${notes.trim()}` : '',
    `Respond with JSON only: {"lines": [{"text": "...", "seconds": 3}]}`,
    ``,
    `HOOK: ${hookText}`,
    ``,
    `SOURCE SCENE (verbatim):`,
    sceneExcerpt || '(no excerpt — stay strictly on the hook itself; do not invent scene details)',
  ].filter(Boolean).join('\n');
}

// ---------------- Synonym suggestion ----------------

export function buildSynonymPrompt(word: string, sentence: string): string {
  return [
    `The word "${word}" is banned by ad platforms. Suggest one replacement word or short phrase that keeps this sentence's meaning and tone and is platform-safe.`,
    `Respond with JSON only: {"replacement": "..."}`,
    ``,
    `SENTENCE: ${sentence}`,
  ].join('\n');
}

// ---------------- Manuscript -> catalog autofill ----------------

export function buildCatalogChapterPrompt(chapterTitle: string, chapterIdx: number, chapterText: string): string {
  return [
    `You are cataloguing a romance manuscript chapter by chapter. Summarize ONLY what is marketing-relevant in this chapter, in under 120 words:`,
    `- tropes present (use standard romance trope names)`,
    `- kinks / spice acts (frank but clinical), and how explicit the chapter is`,
    `- content warnings (violence, abuse, death, etc.)`,
    `- key relationship beats or themes`,
    `Plain factual notes only — no praise, no prose. Respond with JSON only: {"notes": "..."}`,
    ``,
    `CHAPTER ${chapterIdx + 1}: ${chapterTitle}`,
    ``,
    chapterText,
  ].join('\n');
}

export interface CatalogProposals {
  subgenre: string;
  heat_level: number;
  tropes: string[];
  kinks: string;
  content_warnings: string;
  amazon_keywords: string[];
  comp_authors: string[];
  blurb_draft: string;
}

export function buildCatalogSynthesisPrompt(bookTitle: string, chapterNotes: string[]): string {
  return [
    `Below are per-chapter cataloguing notes for the romance novel "${bookTitle}". Synthesize the book-level catalog facts.`,
    `Rules: only claim what the notes support. Trope names in standard reader-facing form ("enemies to lovers", "fated mates"). heat_level: 1 sweet (no on-page intimacy) … 5 scorching (frequent explicit scenes). amazon_keywords: 7 buyer-search phrases readers of THIS book would type. comp_authors: 3-6 authors whose readers would love this book. blurb_draft: a 3-paragraph back-cover blurb in the book's voice — hooky first line, stakes, no spoilers past the midpoint.`,
    `Respond with JSON only: {"subgenre": "...", "heat_level": 4, "tropes": ["..."], "kinks": "...", "content_warnings": "...", "amazon_keywords": ["..."], "comp_authors": ["..."], "blurb_draft": "..."}`,
    ``,
    `CHAPTER NOTES:`,
    chapterNotes.map((n, i) => `${i + 1}. ${n}`).join('\n'),
  ].join('\n');
}

// ---------------- JSON extraction ----------------

// Models occasionally wrap JSON in fences or preamble text despite the
// contract; find and parse the first JSON object/array in the response.
export function parseJsonResponse<T>(raw: string): T {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(text) as T; } catch { /* fall through */ }
  const start = text.search(/[[{]/);
  if (start >= 0) {
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    const end = text.lastIndexOf(close);
    if (end > start) {
      return JSON.parse(text.slice(start, end + 1)) as T;
    }
  }
  throw new Error('The model did not return valid JSON.');
}
