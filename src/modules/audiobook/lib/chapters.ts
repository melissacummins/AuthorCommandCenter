// Manuscript → chapters. Two paths: a free, instant heuristic that splits on
// chapter-heading lines, and (in client.ts) an AI rescan for manuscripts whose
// headings are unconventional. Also handles extracting plain text from an
// uploaded .txt or .docx file.

import type { ChapterDraft } from '../types';

// Lines that look like a chapter heading: "Chapter 7", "CHAPTER VII",
// "Prologue", "Epilogue", "Part Two", or a lone number / roman numeral on its
// own short line.
const HEADING_RE = /^\s*(chapter|prologue|epilogue|part|book)\b.*$/i;
const NUMBER_ONLY_RE = /^\s*(\d{1,3}|[ivxlcdm]{1,7})\s*$/i;

function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) return false;
  if (HEADING_RE.test(trimmed)) return true;
  if (NUMBER_ONLY_RE.test(trimmed)) return true;
  return false;
}

// Split into chapters on heading lines. The heading line is kept as the chapter
// title and also left in the body (so the narrator announces it). Any text
// before the first heading becomes a "Front matter" chapter. If nothing looks
// like a heading, the whole manuscript is one chapter.
export function detectChapters(raw: string): ChapterDraft[] {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const lines = text.split('\n');

  const breaks: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (looksLikeHeading(lines[i])) breaks.push(i);
  }
  if (breaks.length === 0) {
    return [{ title: 'Full manuscript', source_text: text }];
  }

  const chapters: ChapterDraft[] = [];
  // Text before the first heading, if any.
  if (breaks[0] > 0) {
    const pre = lines.slice(0, breaks[0]).join('\n').trim();
    if (pre) chapters.push({ title: 'Front matter', source_text: pre });
  }
  for (let b = 0; b < breaks.length; b++) {
    const start = breaks[b];
    const end = b + 1 < breaks.length ? breaks[b + 1] : lines.length;
    const body = lines.slice(start, end).join('\n').trim();
    if (!body) continue;
    chapters.push({ title: lines[start].trim() || `Chapter ${b + 1}`, source_text: body });
  }
  return chapters;
}

// Turn AI-returned anchor markers (the verbatim opening snippet of each chapter)
// into real chapter slices by locating each marker in the manuscript. Markers
// that can't be found are skipped so a bad anchor never drops text.
export function splitByMarkers(raw: string, markers: { title: string; first_line: string }[]): ChapterDraft[] {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const found: { title: string; at: number }[] = [];
  let cursor = 0;
  for (const m of markers) {
    const needle = (m.first_line ?? '').trim();
    if (!needle) continue;
    const at = text.indexOf(needle, cursor);
    if (at === -1) continue;
    found.push({ title: m.title?.trim() || `Chapter ${found.length + 1}`, at });
    cursor = at + needle.length;
  }
  if (found.length === 0) return [{ title: 'Full manuscript', source_text: text }];

  const chapters: ChapterDraft[] = [];
  if (found[0].at > 0) {
    const pre = text.slice(0, found[0].at).trim();
    if (pre) chapters.push({ title: 'Front matter', source_text: pre });
  }
  for (let i = 0; i < found.length; i++) {
    const start = found[i].at;
    const end = i + 1 < found.length ? found[i + 1].at : text.length;
    const body = text.slice(start, end).trim();
    if (body) chapters.push({ title: found[i].title, source_text: body });
  }
  return chapters;
}

// Pull plain text out of an uploaded manuscript file. .docx is parsed in-browser
// with mammoth (dynamically imported so it stays out of the main bundle); .txt
// and other text types are read directly.
export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth/mammoth.browser');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value ?? '';
  }
  // .txt, .md, or anything else readable as text.
  return file.text();
}
