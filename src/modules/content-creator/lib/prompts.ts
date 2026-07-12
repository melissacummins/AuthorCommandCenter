import type { Book } from '../../catalog/types';
import type { PlaybookEntry, PlaybookRule, HookCandidate } from '../types';
import type { ActiveBannedWord } from './bannedWords';

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

  const activeEntries = entries.slice(0, MAX_PLAYBOOK_ENTRIES);
  if (activeEntries.length) {
    parts.push(`HOOK PLAYBOOK — proven hook patterns. Prefer scenes and wordings that fit these patterns:\n${activeEntries
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

// ---------------- Extraction (per chapter) ----------------

export function buildExtractPrompt(chapterTitle: string, chapterIdx: number, chapterText: string): string {
  return [
    `Read this chapter and find 0-4 marketing hook candidates — moments that would stop a romance reader mid-scroll: killer dialogue, "wait, WHAT?" premise beats, unhinged-devotion moments, power flips, tension spikes.`,
    `Specificity wins: "She told the monster to chase her" beats "a possessive hero". Pull the actual moment, not a summary of the vibe. Skip chapters with nothing genuinely strong — returning zero candidates is better than a weak one.`,
    `For each candidate return:`,
    `- hook_text: the hook in plain, punchy, reader-facing words (under 200 characters; can quote the book's own dialogue)`,
    `- scene_excerpt: the exact passage it comes from, copied verbatim (100-600 characters)`,
    `- rationale: one sentence on why this stops the scroll`,
    `- tags: 1-4 lowercase tags (trope, emotion, or hook style)`,
    `Respond with JSON only, no prose before or after, matching: {"candidates": [{"hook_text": "...", "scene_excerpt": "...", "rationale": "...", "tags": ["..."]}]}`,
    ``,
    `CHAPTER ${chapterIdx + 1}: ${chapterTitle}`,
    ``,
    chapterText,
  ].join('\n');
}

// ---------------- Ranking (once per scan) ----------------

export function buildRankPrompt(candidates: HookCandidate[], target: number): string {
  return [
    `Below are ${candidates.length} hook candidates pulled from a full manuscript scan. Pick the strongest ${Math.min(target, candidates.length)}, best first.`,
    `Judge by: scroll-stopping power for this book's exact readers, fit with the hook playbook patterns, variety (don't return ten versions of the same moment), and usability across formats (slideshow, ad, screenshot).`,
    `You may tighten each hook's wording — keep it plain and punchy, keep any quoted dialogue verbatim, never invent things that aren't in the scene. Keep each candidate's scene_excerpt exactly as given.`,
    `Respond with JSON only, matching: {"hooks": [{"hook_text": "...", "scene_excerpt": "...", "rationale": "...", "tags": ["..."]}]}`,
    ``,
    `CANDIDATES:`,
    JSON.stringify(candidates, null, 1),
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
