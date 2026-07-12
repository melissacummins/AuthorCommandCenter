// Locate a pasted quote inside the book's linked manuscript and return the
// surrounding scene. Deterministic string search — no AI call, no cost.
//
// Why: in the Hook workshop the author pastes one line she loves. The line
// alone starves both the variation writer (nothing to mine but the quote)
// and any slideshow/video later built from the saved hook (middle slides
// need real beats). If we can find the line in a chapter, we hand back
// ~a page of context around it.
//
// Matching is forgiving: curly vs straight quotes, dash styles, and
// whitespace/line-break differences between the paste and the chapter text
// all still match. If the full paste isn't found (typo, partial line), we
// retry with its longest sentences.

import { listChapters } from '../../writing/api';

export interface FoundScene {
  chapterTitle: string;
  excerpt: string;
}

// Characters of context kept on each side of the matched quote.
const CONTEXT_CHARS = 1200;
const MIN_PROBE_LENGTH = 20;
const MAX_PROBE_LENGTH = 400;

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

// Turn a literal probe string into a regex that tolerates the usual
// paste-vs-source drift: smart quotes, dash styles, collapsed whitespace.
function looseRegex(probe: string): RegExp | null {
  const trimmed = probe.trim().slice(0, MAX_PROBE_LENGTH);
  if (trimmed.length < MIN_PROBE_LENGTH) return null;
  const pattern = trimmed
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/['‘’]/g, "['‘’]")
    .replace(/["“”]/g, '["“”]')
    .replace(/[-–—]/g, '[-–—]')
    .replace(/\s+/g, '\\s+');
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

// Full paste first; if that misses, its longest sentences.
function buildProbes(quote: string): RegExp[] {
  const probes: RegExp[] = [];
  const full = looseRegex(quote);
  if (full) probes.push(full);
  const sentences = quote
    .split(/(?<=[.!?…])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= MIN_PROBE_LENGTH)
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
  for (const s of sentences) {
    const r = looseRegex(s);
    if (r) probes.push(r);
  }
  return probes;
}

// Slice context around the match, snapping the cut points to word
// boundaries so the excerpt never starts or ends mid-word.
function expandMatch(text: string, index: number, length: number): string {
  let start = Math.max(0, index - CONTEXT_CHARS);
  let end = Math.min(text.length, index + length + CONTEXT_CHARS);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < index) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > index + length) end = space;
  }
  const prefix = start > 0 ? '… ' : '';
  const suffix = end < text.length ? ' …' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

export async function findSceneForQuote(manuscriptId: string, quote: string): Promise<FoundScene | null> {
  const probes = buildProbes(quote);
  if (!probes.length) return null;
  const chapters = await listChapters(manuscriptId);
  for (const chapter of chapters) {
    const text = htmlToText(chapter.content_html);
    if (text.length < MIN_PROBE_LENGTH) continue;
    for (const probe of probes) {
      const m = probe.exec(text);
      if (m) {
        return { chapterTitle: chapter.title, excerpt: expandMatch(text, m.index, m[0].length) };
      }
    }
  }
  return null;
}
