import type { Keyword, ScoreColor } from './types';

// ============================================
// METADATA INDEXING
// ============================================
// Amazon already indexes the title, subtitle, series, and chosen
// categories. Splitting those into normalized words tells us which
// words inside any keyword phrase are already "covered" — and the
// 7-box packer should skip those.

const WORD_SPLIT = /[^a-z0-9]+/i;

export function normalizeWords(...sources: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const s of sources) {
    if (!s) continue;
    for (const w of s.toLowerCase().split(WORD_SPLIT)) {
      if (w.length >= 2) out.add(w);
    }
  }
  return out;
}

export function keywordWords(text: string): string[] {
  return text.toLowerCase().split(WORD_SPLIT).filter(w => w.length >= 2);
}

// True if every meaningful word in `keyword` is already in `covered`.
export function isFullyCovered(keyword: string, covered: Set<string>): boolean {
  const words = keywordWords(keyword);
  if (words.length === 0) return false;
  return words.every(w => covered.has(w));
}

// ============================================
// 7-BOX OPTIMIZER
// ============================================
// Amazon gives you 7 keyword fields, each up to 50 characters. Each
// field is treated as a bag of words — anything in your title /
// subtitle / series / categories is already indexed, so we shouldn't
// re-spend characters on them.
//
// Strategy: collect every unique word from your selected keywords,
// drop any that are already in metadata, then greedy-pack alphabet-
// ically into 7 boxes of <= 50 chars (space-separated).

export const MAX_BOX_CHARS = 50;
export const BOX_COUNT = 7;

export interface PackResult {
  boxes: string[];
  unused: string[]; // words we couldn't fit
  totalWords: number;
}

export function packAmazonBoxes(
  selectedKeywords: Pick<Keyword, 'text'>[],
  metadataCovered: Set<string>,
): PackResult {
  const wordSet = new Set<string>();
  for (const k of selectedKeywords) {
    for (const w of keywordWords(k.text)) {
      if (!metadataCovered.has(w)) wordSet.add(w);
    }
  }
  const words = Array.from(wordSet).sort();
  const boxes: string[] = Array(BOX_COUNT).fill('');
  const unused: string[] = [];

  for (const w of words) {
    let placed = false;
    for (let i = 0; i < BOX_COUNT; i++) {
      const next = boxes[i] === '' ? w : `${boxes[i]} ${w}`;
      if (next.length <= MAX_BOX_CHARS) {
        boxes[i] = next;
        placed = true;
        break;
      }
    }
    if (!placed) unused.push(w);
  }

  return { boxes, unused, totalWords: words.length };
}

// ============================================
// CSV IMPORT (Publisher Rocket-ish)
// ============================================
// Real Publisher Rocket exports use column names like:
//   Keyword, Estimated Amazon Searches, Competition Score, ...
// Be lenient about exact column casing/spacing; we map a small set
// of synonyms to our schema.

const COLUMN_SYNONYMS: Record<keyof CsvRow, string[]> = {
  text: ['keyword', 'keywords', 'phrase', 'search term'],
  search_volume: ['estimated amazon searches', 'est searches', 'est. searches', 'search volume', 'searches'],
  competitive_score: ['competition score', 'comp score', 'competitive score'],
  competitors: ['competitors', 'number of competitors'],
  avg_pages: ['avg pages', 'average number of pages', 'average pages'],
  avg_price: ['avg price', 'average price'],
  avg_monthly_earnings: ['avg monthly earnings', 'average monthly earnings', 'monthly earnings'],
};

export interface CsvRow {
  text: string;
  search_volume: number;
  competitive_score: number;
  competitors: number;
  avg_pages: number;
  avg_price: number;
  avg_monthly_earnings: number;
}

function colorForVolume(v: number): ScoreColor {
  if (v <= 0) return 'Gray';
  if (v < 100) return 'Red';
  if (v < 1000) return 'Yellow';
  return 'Green';
}

function colorForCompetition(c: number): ScoreColor {
  if (c <= 0) return 'Gray';
  if (c >= 70) return 'Red';
  if (c >= 40) return 'Yellow';
  return 'Green';
}

export interface ParsedCsv {
  rows: (CsvRow & {
    search_volume_color: ScoreColor;
    competitive_score_color: ScoreColor;
  })[];
  warnings: string[];
}

export function parseRocketCsv(csv: string): ParsedCsv {
  const warnings: string[] = [];
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], warnings: ['Empty CSV.'] };

  const headerCells = splitCsvLine(lines[0]).map(s => s.trim().toLowerCase());
  const colIndex: Partial<Record<keyof CsvRow, number>> = {};
  for (const [field, synonyms] of Object.entries(COLUMN_SYNONYMS) as [keyof CsvRow, string[]][]) {
    const i = headerCells.findIndex(h => synonyms.includes(h));
    if (i >= 0) colIndex[field] = i;
  }
  if (colIndex.text === undefined) {
    return { rows: [], warnings: ['Could not find a "Keyword" column in the header.'] };
  }

  const rows: ParsedCsv['rows'] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const text = (cells[colIndex.text!] ?? '').trim();
    if (!text) continue;
    const sv = num(cells[colIndex.search_volume ?? -1]);
    const cs = num(cells[colIndex.competitive_score ?? -1]);
    rows.push({
      text,
      search_volume: sv,
      competitive_score: cs,
      competitors: num(cells[colIndex.competitors ?? -1]),
      avg_pages: num(cells[colIndex.avg_pages ?? -1]),
      avg_price: num(cells[colIndex.avg_price ?? -1]),
      avg_monthly_earnings: num(cells[colIndex.avg_monthly_earnings ?? -1]),
      search_volume_color: colorForVolume(sv),
      competitive_score_color: colorForCompetition(cs),
    });
  }

  if (rows.length === 0) warnings.push('No data rows found — only a header was detected.');
  return { rows, warnings };
}

// Lightweight CSV splitter — handles double-quoted cells and embedded commas.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function num(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const cleaned = raw.replace(/[$,%\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
