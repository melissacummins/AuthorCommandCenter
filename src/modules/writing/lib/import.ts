// Manuscript file → chapter-split HTML. Mirrors the Audiobook module's
// text-based chapter detection (src/modules/audiobook/lib/chapters.ts) but
// operates on HTML blocks so italics/bold survive a DOCX round-trip:
// mammoth's convertToHtml (rather than extractRawText) gives us that, and
// .txt/.md files are converted to simple HTML first so both paths share one
// splitter.

import type { ChapterDraft } from '../types';

const HEADING_RE = /^\s*(chapter|prologue|epilogue|part|book)\b.*$/i;
const NUMBER_ONLY_RE = /^\s*(\d{1,3}|[ivxlcdm]{1,7})\s*$/i;

function looksLikeHeadingText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 60) return false;
  if (HEADING_RE.test(trimmed)) return true;
  if (NUMBER_ONLY_RE.test(trimmed)) return true;
  return false;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Minimal Markdown → HTML: paragraphs, #/##/### headings, **strong**/*em*.
// Not a full CommonMark parser — enough for typical manuscript exports.
function markdownToHtml(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  const blocks = text.split(/\n{2,}/);
  return blocks
    .map(block => {
      const heading = block.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        return `<h${level}>${escapeHtml(heading[2].trim())}</h${level}>`;
      }
      const inline = escapeHtml(block.trim())
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
      return `<p>${inline}</p>`;
    })
    .join('\n');
}

function textToHtml(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  const blocks = text.split(/\n{2,}/);
  return blocks.map(b => `<p>${escapeHtml(b.trim()).replace(/\n/g, '<br>')}</p>`).join('\n');
}

// Pull HTML out of an uploaded manuscript file. .docx is parsed in-browser
// with mammoth's convertToHtml (dynamically imported so it stays out of the
// main bundle) which preserves italics/bold; .txt and .md are converted
// locally. Any other extension is read as plain text.
export async function extractHtmlFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth/mammoth.browser');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    return result.value ?? '';
  }
  const text = await file.text();
  if (name.endsWith('.md') || name.endsWith('.markdown')) return markdownToHtml(text);
  return textToHtml(text);
}

// Split HTML into chapters on heading-looking top-level blocks: real
// <h1>-<h3> tags, or a short <p> whose text matches a "Chapter 7" /
// "Prologue" / lone-number pattern (same heuristic as the Audiobook module,
// applied to element text instead of plain-text lines). A manuscript with no
// detected headings becomes a single chapter titled after the source file.
export function detectChaptersFromHtml(html: string, fallbackTitle: string): ChapterDraft[] {
  const trimmed = (html ?? '').trim();
  if (!trimmed) return [];

  const doc = new DOMParser().parseFromString(`<div id="root">${trimmed}</div>`, 'text/html');
  const root = doc.getElementById('root');
  const blocks = root ? Array.from(root.children) : [];
  if (blocks.length === 0) return [{ title: fallbackTitle, content_html: trimmed }];

  const breaks: { index: number; title: string }[] = [];
  blocks.forEach((el, i) => {
    const tag = el.tagName.toLowerCase();
    const text = (el.textContent ?? '').trim();
    if (/^h[1-3]$/.test(tag) && text) {
      breaks.push({ index: i, title: text });
    } else if (tag === 'p' && looksLikeHeadingText(text)) {
      breaks.push({ index: i, title: text });
    }
  });

  if (breaks.length === 0) return [{ title: fallbackTitle, content_html: trimmed }];

  const chapters: ChapterDraft[] = [];
  if (breaks[0].index > 0) {
    const pre = blocks.slice(0, breaks[0].index).map(b => b.outerHTML).join('\n').trim();
    if (pre) chapters.push({ title: 'Front matter', content_html: pre });
  }
  for (let b = 0; b < breaks.length; b++) {
    const start = breaks[b].index;
    const end = b + 1 < breaks.length ? breaks[b + 1].index : blocks.length;
    const body = blocks.slice(start, end).map(el => el.outerHTML).join('\n').trim();
    if (!body) continue;
    chapters.push({ title: breaks[b].title || `Chapter ${b + 1}`, content_html: body });
  }
  return chapters;
}
