// Manuscript → speaker-tagged segments, client side.
//
// Why chunk: a full manuscript is far too large for one Claude call, and asking
// the model to re-emit every word balloons the output. We split the text into
// paragraph-aligned chunks (~3,500 chars), attribute each chunk, then stitch the
// results back into one continuously-indexed list. Splitting on blank lines keeps
// dialogue and its narration together so attribution stays accurate.

import type { Speaker } from '../types';
import { attributeChunk } from './client';
import type { NarrationMode } from '../types';

export interface AttributedSegment {
  speaker: Speaker;
  character_name: string | null;
  text: string;
}

const CHUNK_TARGET = 3500;

// Split into chunks no larger than ~CHUNK_TARGET chars, breaking only between
// paragraphs. A single oversized paragraph becomes its own chunk rather than
// being cut mid-sentence.
export function chunkManuscript(raw: string): string[] {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (current && current.length + para.length + 2 > CHUNK_TARGET) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${para}` : para;
    if (current.length >= CHUNK_TARGET) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export interface AttributeProgress { done: number; total: number }

// Attribute the whole manuscript chunk-by-chunk, reporting progress so the UI can
// show "analyzing 3 / 12". Chunks run sequentially to stay gentle on the user's
// Claude rate limits.
export async function attributeManuscript(
  manuscript: string,
  mode: NarrationMode,
  onProgress?: (p: AttributeProgress) => void,
): Promise<AttributedSegment[]> {
  const chunks = chunkManuscript(manuscript);
  const all: AttributedSegment[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const segments = await attributeChunk(chunks[i], mode);
    all.push(...segments);
    onProgress?.({ done: i + 1, total: chunks.length });
  }
  return all;
}
