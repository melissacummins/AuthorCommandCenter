// Kindle Screenshot data model + deterministic helpers: dialogue detection,
// the XHTML page builder, and SVG-foreignObject rasterization to PNG. All
// plain code — no AI anywhere in this feature (directive ground rule 4).

export type PageBg = 'paper' | 'cream' | 'transparent';
export type HighlightColor = 'yellow' | 'pink' | 'green' | 'blue';
export type StampKind = 'heart' | 'circle' | 'exclamation' | 'underline';

export interface CharRange { start: number; end: number }

export interface Highlight extends CharRange { color: HighlightColor }

export interface Stamp {
  kind: StampKind;
  // Position/size as fractions of page width/height so they survive resizes.
  x: number;
  y: number;
  scale: number; // 1 = default size
}

export interface ScreenshotPayload {
  source_text: string;
  page: {
    bg: PageBg;
    fontSize: 'sm' | 'md' | 'lg';
    showHeader: boolean;
    showFooter: boolean;
    headerText: string;   // "Title · Author"
    footerText: string;   // "37%"
  };
  highlights: Highlight[];
  strikes: CharRange[];
  stamps: Stamp[];
}

export const PAGE_BGS: Record<PageBg, { fill: string; text: string; label: string }> = {
  paper: { fill: '#ffffff', text: '#1c1917', label: 'Paper' },
  cream: { fill: '#f7f1e3', text: '#292524', label: 'Cream' },
  transparent: { fill: 'transparent', text: '#1c1917', label: 'Transparent' },
};

export const HIGHLIGHT_FILLS: Record<HighlightColor, string> = {
  yellow: 'rgba(253, 224, 71, 0.55)',
  pink: 'rgba(249, 168, 212, 0.55)',
  green: 'rgba(134, 239, 172, 0.55)',
  blue: 'rgba(147, 197, 253, 0.55)',
};

export const FONT_SIZES: Record<'sm' | 'md' | 'lg', number> = { sm: 15, md: 18, lg: 22 };

// Page geometry (CSS px at 1x; export renders at 2x).
export const PAGE_WIDTH = 480;
export const PAGE_PADDING = 40;

// ---------------- Dialogue detection (deterministic) ----------------

// Find quoted spans using straight and curly quotes. Each span includes the
// quotes themselves. Unclosed quotes are ignored rather than guessed at.
export function detectDialogue(text: string): CharRange[] {
  const ranges: CharRange[] = [];
  const re = /“[^”]{2,500}”|"[^"\n]{2,500}"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
}

// The word containing a char offset (for strike-through toggling).
export function wordRangeAt(text: string, offset: number): CharRange | null {
  if (offset < 0 || offset >= text.length) return null;
  if (/\s/.test(text[offset])) return null;
  let start = offset;
  let end = offset;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return { start, end };
}

export function rangesOverlap(a: CharRange, b: CharRange): boolean {
  return a.start < b.end && b.start < a.end;
}

// ---------------- Rendering ----------------

// Split the text into segments at every highlight/strike boundary so each
// segment carries a single set of decorations. Shared by the live preview
// and the XHTML export so they render identically.
export interface Segment {
  text: string;
  start: number;
  highlight: HighlightColor | null;
  struck: boolean;
}

export function segmentText(payload: ScreenshotPayload): Segment[][] {
  const { source_text: text, highlights, strikes } = payload;
  const cuts = new Set<number>([0, text.length]);
  for (const r of [...highlights, ...strikes]) { cuts.add(r.start); cuts.add(r.end); }
  // Paragraph boundaries are also cuts.
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') { cuts.add(i); cuts.add(i + 1); }
  const points = [...cuts].filter(p => p >= 0 && p <= text.length).sort((a, b) => a - b);

  const paragraphs: Segment[][] = [[]];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const chunk = text.slice(start, end);
    if (chunk === '\n') { paragraphs.push([]); continue; }
    const range = { start, end };
    const hl = highlights.find(h => rangesOverlap(h, range));
    const struck = strikes.some(s => rangesOverlap(s, range));
    paragraphs[paragraphs.length - 1].push({ text: chunk, start, highlight: hl?.color ?? null, struck });
  }
  return paragraphs.filter(p => p.length > 0);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Hand-drawn-style stamp shapes (viewBox 0 0 100 100), stroke-based so they
// read as annotations, not clipart.
const STAMP_PATHS: Record<StampKind, string> = {
  heart: '<path d="M50 84 C20 62 8 42 16 27 C24 13 42 15 50 30 C58 15 76 13 84 27 C92 42 80 62 50 84 Z" fill="none" stroke="#e11d48" stroke-width="6" stroke-linecap="round" transform="rotate(-4 50 50)"/>',
  circle: '<ellipse cx="50" cy="50" rx="42" ry="34" fill="none" stroke="#e11d48" stroke-width="5" stroke-linecap="round" transform="rotate(-6 50 50)" stroke-dasharray="200 12"/>',
  exclamation: '<path d="M52 12 C50 34 49 48 49 62 M50 78 L50 84" fill="none" stroke="#e11d48" stroke-width="9" stroke-linecap="round" transform="rotate(6 50 50)"/>',
  underline: '<path d="M6 55 C30 48 72 50 94 53" fill="none" stroke="#e11d48" stroke-width="6" stroke-linecap="round"/>',
};

export function stampSvg(kind: StampKind): string {
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${STAMP_PATHS[kind]}</svg>`;
}

// Build the complete page as XHTML (valid inside an SVG foreignObject). The
// live preview mirrors this structure so what you see is what exports.
export function buildPageXhtml(payload: ScreenshotPayload, pageHeight: number): string {
  const bg = PAGE_BGS[payload.page.bg];
  const fontSize = FONT_SIZES[payload.page.fontSize];
  const paragraphs = segmentText(payload);

  const paraHtml = paragraphs.map(segs => {
    const spans = segs.map(seg => {
      const styles: string[] = [];
      if (seg.highlight) styles.push(`background:${HIGHLIGHT_FILLS[seg.highlight]}`, 'border-radius:2px');
      if (seg.struck) styles.push('text-decoration:line-through', 'text-decoration-thickness:2px', 'text-decoration-color:#dc2626');
      return `<span${styles.length ? ` style="${styles.join(';')}"` : ''}>${escapeXml(seg.text)}</span>`;
    }).join('');
    return `<p style="margin:0 0 ${Math.round(fontSize * 0.8)}px 0;text-indent:1.4em">${spans}</p>`;
  }).join('');

  const stampsHtml = payload.stamps.map(st => {
    const size = Math.round(64 * st.scale);
    return `<div style="position:absolute;left:${(st.x * 100).toFixed(2)}%;top:${(st.y * 100).toFixed(2)}%;width:${size}px;height:${size}px;transform:translate(-50%,-50%)">${stampSvg(st.kind)}</div>`;
  }).join('');

  return `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${PAGE_WIDTH}px;height:${pageHeight}px;background:${bg.fill};color:${bg.text};font-family:Georgia,'Times New Roman',serif;font-size:${fontSize}px;line-height:1.65;box-sizing:border-box;padding:${PAGE_PADDING}px;overflow:hidden">
    ${payload.page.showHeader ? `<div style="position:absolute;top:14px;left:0;right:0;text-align:center;font-size:11px;letter-spacing:0.08em;color:${bg.text};opacity:0.45">${escapeXml(payload.page.headerText)}</div>` : ''}
    <div style="position:relative">${paraHtml}</div>
    ${payload.page.showFooter ? `<div style="position:absolute;bottom:12px;right:${PAGE_PADDING}px;font-size:11px;color:${bg.text};opacity:0.45">${escapeXml(payload.page.footerText)}</div>` : ''}
    ${stampsHtml}
  </div>`;
}

// Rasterize the page to PNG at 2x via SVG foreignObject (all content inline,
// so the canvas stays untainted).
export async function renderScreenshotToPng(payload: ScreenshotPayload, pageHeight: number): Promise<Blob> {
  const xhtml = buildPageXhtml(payload, pageHeight);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${pageHeight}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Page render failed.'));
    i.src = url;
  });

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH * scale;
  canvas.height = pageHeight * scale;
  const ctx = canvas.getContext('2d')!;
  if (payload.page.bg !== 'transparent') {
    ctx.fillStyle = PAGE_BGS[payload.page.bg].fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG export failed.'))), 'image/png');
  });
}
