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
A hook is ONE moment turned into an open loop: the viewer learns just enough to have a question they can only answer by reading the book. It must land in under 2 seconds. It is NOT a summary, NOT a description of the couple's dynamic, and NOT a synopsis with attitude.

STRUCTURE — every hook has exactly these parts:
1. GRABBER: one concrete moment or line from the book — an action taken or a thing said. Specific beats general ("She told the monster to chase her" beats "a possessive hero").
2. GAP: exactly one piece of withheld context that creates a genuine question (wait, why? who IS he? what happens next?). The withheld thing must actually be surprising or charged — never manufacture mystery around something ordinary.
3. NOTHING ELSE. No setup, no explanation, no second beat. If the hook answers its own question, it is dead. Less context = more pull.

PROVEN SHAPES (tested BookTok data — use these, don't invent new shapes):
- Curiosity gap: [subject] + [unexpected action that raises a question]
- Pattern interrupt: [expected role] does the opposite ("She didn't run. She told him to chase her.")
- Single devastating line: one visceral line under 8 words ("Touch her and you die.")
- Plan vs. what happened: intended action, derailed spectacularly
- Disproportionate reaction: the love interest's outsized response IS the hook ("His response? 'But do you feel better?'")
- Vulnerable moment: the guarded one finally cracks
- POV framing: "POV: you..." puts the viewer in the scene

THE INTEREST TEST — apply before returning anything:
Would a stranger who has never heard of this book stop scrolling because they NEED the answer? If the honest answer is "it's fine," cut it. Returning fewer hooks is always better than padding with weak ones.

FAILURE MODES — anything matching these is rejected:
- SUMMARY: describes the premise or dynamic ("He's powerful, but he'd drop everything for her") — that's back-cover copy, not a hook.
- FAKE MYSTERY: coy about something that isn't mysterious, or withholds/implies something the scene doesn't support.
- OVERSTUFFED: two or more beats, or explains who/why/how.
- MELODRAMA / PURPLE PROSE: ornate phrasing, stacked adjectives, events exaggerated beyond what the scene actually says.
- INACCURACY: ANY detail that differs from the scene — wrong pronoun, wrong speaker, invented event, altered dialogue. Quoted dialogue must be copied verbatim, attributed to the person who actually said it.`;

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
    `- Every hook must follow the STRUCTURE and use one of the PROVEN SHAPES above.`,
    `- Every fact in a hook must come straight from its scene_excerpt. Quoted dialogue: copied verbatim, right speaker. If the excerpt doesn't support a detail, you can't use it.`,
    `- Variety: don't return multiple versions of the same moment or the same shape ten times.`,
    `- Pass each candidate's scene_excerpt through EXACTLY as given.`,
    `Return for each: hook_text (the hook), scene_excerpt (unchanged), rationale (one sentence: which shape it uses and why it stops the scroll), tags.`,
    `Respond with JSON only, matching: {"hooks": [{"hook_text": "...", "scene_excerpt": "...", "rationale": "...", "tags": ["..."]}]}`,
    ``,
    `MOMENTS:`,
    JSON.stringify(candidates, null, 1),
  ].join('\n');
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
    `Check 1 — ACCURACY: verify every claim in the hook against the excerpt. Pronouns, who speaks each line, what actually happens, exact dialogue wording. Any mismatch = not accurate.`,
    `Check 2 — IS IT A HOOK: apply the STRUCTURE, the FAILURE MODES, and the INTEREST TEST above.`,
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

// ---------------- Synonym suggestion ----------------

export function buildSynonymPrompt(word: string, sentence: string): string {
  return [
    `The word "${word}" is banned by ad platforms. Suggest one replacement word or short phrase that keeps this sentence's meaning and tone and is platform-safe.`,
    `Respond with JSON only: {"replacement": "..."}`,
    ``,
    `SENTENCE: ${sentence}`,
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
