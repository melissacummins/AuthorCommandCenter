// Slideshow payload shapes + the deterministic canvas renderer that turns a
// slide into a platform-ready PNG. Slides are LAYOUTS, not bitmaps: switching
// format re-renders (never crops), so text always fits the target platform.

export type SlideFormat = '9:16' | '4:5';

export const SLIDE_FORMATS: Record<SlideFormat, { width: number; height: number; label: string; hint: string }> = {
  '9:16': { width: 1080, height: 1920, label: '9:16', hint: 'TikTok photo mode / Reels' },
  '4:5': { width: 1080, height: 1350, label: '4:5', hint: 'Instagram & Facebook feed (feed crops 9:16 — use this for carousels)' },
};

export type SlideTextSize = 'sm' | 'md' | 'lg';
export type SlideTextPosition = 'top' | 'middle' | 'bottom';

export interface SlideStyle {
  size: SlideTextSize;
  position: SlideTextPosition;
  color: 'white' | 'black';
  shadow: boolean;
}

export const DEFAULT_SLIDE_STYLE: SlideStyle = { size: 'md', position: 'middle', color: 'white', shadow: true };

export interface Slide {
  text: string;
  bg_url: string | null; // public URL (media-outputs) or null for the gradient default
  style: SlideStyle;
}

export interface SlideshowPayload {
  format: SlideFormat;
  slides: Slide[];
  direction_notes: string;
}

// Font sizes are proportional to canvas height so both formats read the same.
const SIZE_FACTORS: Record<SlideTextSize, number> = { sm: 0.032, md: 0.042, lg: 0.056 };

// The gradient fallback background (no image picked).
const GRADIENT_STOPS: [string, string] = ['#1e1b4b', '#831843'];

// TikTok/Reels UI overlays: keep text inside ~76% vertical band.
const SAFE_TOP = 0.10;
const SAFE_BOTTOM = 0.16;

export async function renderSlideToPng(slide: Slide, format: SlideFormat): Promise<Blob> {
  const { width, height } = SLIDE_FORMATS[format];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  if (slide.bg_url) {
    try {
      const img = await loadImage(slide.bg_url);
      drawCover(ctx, img, width, height);
      // Subtle scrim so text stays readable over any image.
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, 0, width, height);
    } catch {
      drawGradient(ctx, width, height);
    }
  } else {
    drawGradient(ctx, width, height);
  }

  drawSlideText(ctx, slide, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG export failed.'))), 'image/png');
  });
}

function drawGradient(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, GRADIENT_STOPS[0]);
  g.addColorStop(1, GRADIENT_STOPS[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function drawSlideText(ctx: CanvasRenderingContext2D, slide: Slide, w: number, h: number) {
  const fontSize = Math.round(h * SIZE_FACTORS[slide.style.size]);
  ctx.font = `700 ${fontSize}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = slide.style.color === 'white' ? '#ffffff' : '#0f172a';
  if (slide.style.shadow) {
    ctx.shadowColor = slide.style.color === 'white' ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.75)';
    ctx.shadowBlur = fontSize * 0.35;
    ctx.shadowOffsetY = fontSize * 0.05;
  }

  const maxWidth = w * 0.82;
  const lines = wrapText(ctx, slide.text, maxWidth);
  const lineHeight = fontSize * 1.35;
  const blockHeight = lines.length * lineHeight;

  const safeTop = h * SAFE_TOP;
  const safeBottom = h * (1 - SAFE_BOTTOM);
  let firstLineY: number;
  if (slide.style.position === 'top') firstLineY = safeTop + lineHeight / 2;
  else if (slide.style.position === 'bottom') firstLineY = safeBottom - blockHeight + lineHeight / 2;
  else firstLineY = (h - blockHeight) / 2 + lineHeight / 2;

  lines.forEach((line, i) => {
    ctx.fillText(line, w / 2, firstLineY + i * lineHeight, maxWidth);
  });
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Supabase storage serves permissive CORS
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Background failed to load.'));
    img.src = url;
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
