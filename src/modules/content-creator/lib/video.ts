// Video composer engine: timed caption lines over a video background, live
// preview helpers, realtime WebM export (canvas.captureStream + AudioContext
// mix + MediaRecorder), and the transparent caption-PNG bundle for CapCut.

import type { SlideStyle } from './slides';

export interface CaptionLine {
  text: string;
  seconds: number;
}

export interface VideoPayload {
  bg_url: string | null;      // public video URL (media-outputs or a generation)
  lines: CaptionLine[];
  music_url: string | null;   // public audio URL
  style: SlideStyle;
}

export const EXPORT_WIDTH = 1080;
export const EXPORT_HEIGHT = 1920;
export const MAX_EXPORT_SECONDS = 180;

const SIZE_FACTORS: Record<SlideStyle['size'], number> = { sm: 0.030, md: 0.038, lg: 0.048 };
const SAFE_TOP = 0.10;
const SAFE_BOTTOM = 0.16;

export function totalDuration(lines: CaptionLine[]): number {
  return lines.reduce((sum, l) => sum + Math.max(0.5, l.seconds), 0);
}

export function activeLineAt(lines: CaptionLine[], t: number): CaptionLine | null {
  let acc = 0;
  for (const l of lines) {
    acc += Math.max(0.5, l.seconds);
    if (t < acc) return l;
  }
  return null;
}

function drawCaption(ctx: CanvasRenderingContext2D, text: string, style: SlideStyle, w: number, h: number) {
  if (!text) return;
  const fontSize = Math.round(h * SIZE_FACTORS[style.size]);
  ctx.font = `700 ${fontSize}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.color === 'white' ? '#ffffff' : '#0f172a';
  if (style.shadow) {
    ctx.shadowColor = style.color === 'white' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)';
    ctx.shadowBlur = fontSize * 0.35;
    ctx.shadowOffsetY = fontSize * 0.05;
  }
  const maxWidth = w * 0.84;
  const lines = wrap(ctx, text, maxWidth);
  const lineHeight = fontSize * 1.35;
  const blockHeight = lines.length * lineHeight;
  const safeTop = h * SAFE_TOP;
  const safeBottom = h * (1 - SAFE_BOTTOM);
  let firstY: number;
  if (style.position === 'top') firstY = safeTop + lineHeight / 2;
  else if (style.position === 'bottom') firstY = safeBottom - blockHeight + lineHeight / 2;
  else firstY = (h - blockHeight) / 2 + lineHeight / 2;
  lines.forEach((line, i) => ctx.fillText(line, w / 2, firstY + i * lineHeight, maxWidth));
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) { out.push(line); line = word; }
    else line = candidate;
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

// Transparent caption card for the CapCut asset bundle.
export async function renderCaptionPng(text: string, style: SlideStyle): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_WIDTH;
  canvas.height = EXPORT_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  drawCaption(ctx, text, style, EXPORT_WIDTH, EXPORT_HEIGHT);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Caption export failed.'))), 'image/png');
  });
}

// Realtime WebM export: plays the (muted) video once while drawing frames +
// the active caption to a canvas; music is decoded and mixed into the
// recorder's audio track. Runs at 1x playback by nature of captureStream.
export async function exportWebm(
  payload: VideoPayload,
  onProgress: (fraction: number) => void,
): Promise<Blob> {
  if (!payload.bg_url) throw new Error('Pick a background video first.');
  const duration = Math.min(totalDuration(payload.lines) || 10, MAX_EXPORT_SECONDS);

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = payload.bg_url;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('Background video failed to load.'));
  });
  video.loop = video.duration < duration; // short clips loop under long scripts

  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_WIDTH;
  canvas.height = EXPORT_HEIGHT;
  const ctx = canvas.getContext('2d')!;

  const stream = canvas.captureStream(30);

  // Mix music into the recording if present.
  let audioCtx: AudioContext | null = null;
  if (payload.music_url) {
    audioCtx = new AudioContext();
    const buf = await fetch(payload.music_url).then(r => r.arrayBuffer()).then(b => audioCtx!.decodeAudioData(b));
    const dest = audioCtx.createMediaStreamDestination();
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.loop = buf.duration < duration;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.9;
    src.connect(gain).connect(dest);
    src.start();
    const track = dest.stream.getAudioTracks()[0];
    if (track) stream.addTrack(track);
  }

  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus'
    : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    recorder.onerror = () => reject(new Error('Recording failed.'));
  });

  await video.play();
  recorder.start(500);
  const startedAt = performance.now();
  let raf = 0;

  await new Promise<void>(resolve => {
    const draw = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      // Cover-fit the video frame.
      const scale = Math.max(EXPORT_WIDTH / video.videoWidth, EXPORT_HEIGHT / video.videoHeight);
      const dw = video.videoWidth * scale;
      const dh = video.videoHeight * scale;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
      ctx.drawImage(video, (EXPORT_WIDTH - dw) / 2, (EXPORT_HEIGHT - dh) / 2, dw, dh);
      const line = activeLineAt(payload.lines, elapsed);
      if (line) drawCaption(ctx, line.text, payload.style, EXPORT_WIDTH, EXPORT_HEIGHT);
      onProgress(Math.min(1, elapsed / duration));
      if (elapsed >= duration) { resolve(); return; }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
  });

  cancelAnimationFrame(raf);
  video.pause();
  recorder.stop();
  const blob = await done;
  if (audioCtx) await audioCtx.close().catch(() => undefined);
  return blob;
}
