import type { DefaultBannedWord, PlaybookRule } from '../types';

// Deterministic banned-word guard (directive ground rule 4 — no AI for what
// plain code can do). Builds the active word set from the shared default list
// minus the user's opt-outs plus their own banned_word rules, scans text with
// word-boundary matching, and offers a character-mask substitution that
// passes platform filters ("hunt" → "hùnt").

export interface ActiveBannedWord {
  word: string;               // lowercase
  replacement: string | null; // user-preferred substitute, if any
}

export function buildActiveBannedWords(
  defaults: DefaultBannedWord[],
  optoutWordIds: string[],
  userRules: PlaybookRule[],
): ActiveBannedWord[] {
  const optedOut = new Set(optoutWordIds);
  const map = new Map<string, ActiveBannedWord>();
  for (const d of defaults) {
    if (optedOut.has(d.id)) continue;
    map.set(d.word.toLowerCase(), { word: d.word.toLowerCase(), replacement: null });
  }
  for (const r of userRules) {
    if (r.rule_type !== 'banned_word' || !r.active) continue;
    const w = r.content.trim().toLowerCase();
    if (!w) continue;
    map.set(w, { word: w, replacement: r.replacement?.trim() || null });
  }
  return [...map.values()];
}

export interface BannedMatch {
  word: string;        // the active-list word (lowercase)
  found: string;       // the text as it appears (original casing)
  replacement: string | null;
}

// Word-boundary scan; each active word reported once no matter how often it
// appears (the fix buttons replace all occurrences anyway).
export function scanForBannedWords(text: string, active: ActiveBannedWord[]): BannedMatch[] {
  if (!text) return [];
  const matches: BannedMatch[] = [];
  for (const entry of active) {
    const re = new RegExp(`\\b${escapeRegExp(entry.word)}\\b`, 'i');
    const m = re.exec(text);
    if (m) matches.push({ word: entry.word, found: m[0], replacement: entry.replacement });
  }
  return matches;
}

// Accent-mask a word so it reads the same but slips past keyword filters:
// first vowel gets a grave accent ("hunt" → "hùnt"); no vowel → swap the
// second letter for @ where possible.
const ACCENTS: Record<string, string> = { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', y: 'ý', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù', Y: 'Ý' };

export function maskWord(word: string): string {
  const chars = [...word];
  for (let i = 0; i < chars.length; i++) {
    const accented = ACCENTS[chars[i]];
    if (accented) {
      chars[i] = accented;
      return chars.join('');
    }
  }
  if (chars.length > 1) {
    chars[1] = '@';
    return chars.join('');
  }
  return word + '·';
}

// Replace every occurrence of a banned word (word-boundary, case-insensitive)
// with the substitute, preserving nothing fancier than the raw swap.
export function replaceBannedWord(text: string, word: string, substitute: string): string {
  const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi');
  return text.replace(re, substitute);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
