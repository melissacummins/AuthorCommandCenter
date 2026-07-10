// Per-chapter and whole-manuscript export. .docx is built directly from our
// stored content_html via the `docx` package (walking blocks/inline runs) so
// bold/italic survive; .txt/.md/.html are string transforms of the same HTML.
// No print-window hacks (ai-writing-hub's old "PDF export" trick).
//
// `docx` is dynamically imported (~1MB minified) so it stays out of the main
// bundle until someone actually exports to Word — same reasoning as mammoth
// in lib/import.ts.

import { htmlToPlainText } from '../types';
import type { Manuscript, ManuscriptChapter } from '../types';
import type { Book } from '../../catalog/types';

export type ExportFormat = 'docx' | 'txt' | 'md' | 'html';

// The shape of the `docx` module, without a static import (see note above).
type DocxModule = typeof import('docx');

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeFilename(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'untitled';
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---- docx ----

function inlineRuns(docx: DocxModule, node: Node, bold = false, italics = false): InstanceType<DocxModule['TextRun']>[] {
  const runs: InstanceType<DocxModule['TextRun']>[] = [];
  node.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (text) runs.push(new docx.TextRun({ text, bold, italics }));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'br') runs.push(new docx.TextRun({ text: '', break: 1 }));
      else if (tag === 'strong' || tag === 'b') runs.push(...inlineRuns(docx, el, true, italics));
      else if (tag === 'em' || tag === 'i') runs.push(...inlineRuns(docx, el, bold, true));
      else runs.push(...inlineRuns(docx, el, bold, italics));
    }
  });
  return runs;
}

function blockToParagraphs(docx: DocxModule, el: Element): InstanceType<DocxModule['Paragraph']>[] {
  const tag = el.tagName.toLowerCase();
  if (tag === 'h1') return [new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, children: inlineRuns(docx, el) })];
  if (tag === 'h2') return [new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, children: inlineRuns(docx, el) })];
  if (tag === 'h3') return [new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_3, children: inlineRuns(docx, el) })];
  if (tag === 'blockquote') {
    const items = el.children.length ? Array.from(el.children) : [el];
    return items.map(item => new docx.Paragraph({ indent: { left: 720 }, children: inlineRuns(docx, item) }));
  }
  if (tag === 'ul' || tag === 'ol') {
    return Array.from(el.children).map((li, i) => new docx.Paragraph({
      children: [new docx.TextRun(tag === 'ol' ? `${i + 1}. ` : '• '), ...inlineRuns(docx, li)],
    }));
  }
  return [new docx.Paragraph({ children: inlineRuns(docx, el), spacing: { after: 200 } })];
}

function htmlToDocxParagraphs(docx: DocxModule, html: string): InstanceType<DocxModule['Paragraph']>[] {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root');
  const blocks = root ? Array.from(root.children) : [];
  return blocks.length ? blocks.flatMap(b => blockToParagraphs(docx, b)) : [new docx.Paragraph('')];
}

async function chapterDocxBlob(chapter: ManuscriptChapter): Promise<Blob> {
  const docx = await import('docx');
  const doc = new docx.Document({
    sections: [{
      children: [
        new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, children: [new docx.TextRun(chapter.title || 'Untitled chapter')] }),
        ...htmlToDocxParagraphs(docx, chapter.content_html),
      ],
    }],
  });
  return docx.Packer.toBlob(doc);
}

async function manuscriptDocxBlob(manuscript: Manuscript, chapters: ManuscriptChapter[], book: Book | null): Promise<Blob> {
  const docx = await import('docx');
  const titleChildren = [
    new docx.Paragraph({ heading: docx.HeadingLevel.TITLE, alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun(manuscript.title)] }),
  ];
  if (book?.title && book.title !== manuscript.title) {
    titleChildren.push(new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text: book.title, italics: true })] }));
  }
  const chapterBlocks = chapters.flatMap(c => [
    new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new docx.TextRun(c.title || 'Untitled chapter')] }),
    ...htmlToDocxParagraphs(docx, c.content_html),
  ]);
  const doc = new docx.Document({ sections: [{ children: [...titleChildren, ...chapterBlocks] }] });
  return docx.Packer.toBlob(doc);
}

// ---- markdown ----

function inlineMarkdown(node: Node): string {
  let out = '';
  node.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent ?? '';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'br') out += '  \n';
      else if (tag === 'strong' || tag === 'b') out += `**${inlineMarkdown(el)}**`;
      else if (tag === 'em' || tag === 'i') out += `*${inlineMarkdown(el)}*`;
      else out += inlineMarkdown(el);
    }
  });
  return out;
}

function blockToMarkdown(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'h1') return `# ${inlineMarkdown(el)}`;
  if (tag === 'h2') return `## ${inlineMarkdown(el)}`;
  if (tag === 'h3') return `### ${inlineMarkdown(el)}`;
  if (tag === 'blockquote') return `> ${inlineMarkdown(el)}`;
  if (tag === 'ul') return Array.from(el.children).map(li => `- ${inlineMarkdown(li)}`).join('\n');
  if (tag === 'ol') return Array.from(el.children).map((li, i) => `${i + 1}. ${inlineMarkdown(li)}`).join('\n');
  return inlineMarkdown(el);
}

function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root');
  const blocks = root ? Array.from(root.children) : [];
  return blocks.map(blockToMarkdown).join('\n\n');
}

// ---- html ----

function standaloneHtmlDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:Georgia,'Times New Roman',serif;max-width:40rem;margin:2rem auto;padding:0 1.5rem;line-height:1.6;color:#1e293b;}h1{font-size:1.4rem;margin-top:2.5rem;}</style>
</head><body>${bodyHtml}</body></html>`;
}

// ---- public API ----

export async function downloadChapter(chapter: ManuscriptChapter, format: ExportFormat): Promise<void> {
  const base = safeFilename(chapter.title || 'chapter');
  if (format === 'docx') {
    downloadBlob(await chapterDocxBlob(chapter), `${base}.docx`);
  } else if (format === 'txt') {
    downloadBlob(new Blob([`${chapter.title}\n\n${htmlToPlainText(chapter.content_html)}`], { type: 'text/plain' }), `${base}.txt`);
  } else if (format === 'md') {
    downloadBlob(new Blob([`# ${chapter.title}\n\n${htmlToMarkdown(chapter.content_html)}`], { type: 'text/markdown' }), `${base}.md`);
  } else {
    downloadBlob(
      new Blob([standaloneHtmlDocument(chapter.title, `<h1>${escapeHtml(chapter.title)}</h1>${chapter.content_html}`)], { type: 'text/html' }),
      `${base}.html`,
    );
  }
}

export async function downloadManuscript(
  manuscript: Manuscript,
  chapters: ManuscriptChapter[],
  book: Book | null,
  format: ExportFormat,
): Promise<void> {
  const base = safeFilename(manuscript.title || 'manuscript');
  if (format === 'docx') {
    downloadBlob(await manuscriptDocxBlob(manuscript, chapters, book), `${base}.docx`);
    return;
  }
  if (format === 'txt') {
    const text = [manuscript.title, '', ...chapters.map(c => `${c.title}\n\n${htmlToPlainText(c.content_html)}`)].join('\n\n');
    downloadBlob(new Blob([text], { type: 'text/plain' }), `${base}.txt`);
    return;
  }
  if (format === 'md') {
    const md = [`# ${manuscript.title}`, ...chapters.map(c => `## ${c.title}\n\n${htmlToMarkdown(c.content_html)}`)].join('\n\n');
    downloadBlob(new Blob([md], { type: 'text/markdown' }), `${base}.md`);
    return;
  }
  const body = chapters.map(c => `<h1>${escapeHtml(c.title)}</h1>${c.content_html}`).join('\n');
  const html = standaloneHtmlDocument(manuscript.title, `<h1 style="text-align:center">${escapeHtml(manuscript.title)}</h1>${body}`);
  downloadBlob(new Blob([html], { type: 'text/html' }), `${base}.html`);
}
