import type { Keyword, ScoreColor } from './types';

// Ported from melissacummins/KDP-Optimizer (utils.ts) so the algorithm
// matches the standalone app exactly. Kept comments terse — the
// upstream file is the source of truth for behavior.

// ============================================
// Parsing helpers
// ============================================

export const parseNumberString = (str?: string): number => {
  if (!str) return 0;
  // Publisher Rocket uses "<100" sometimes. Treat as 50 for sorting.
  if (str.includes('<')) return 50;
  const clean = str.replace(/[$,\s]/g, '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
};

export const toTitleCase = (str: string): string =>
  str.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.substring(1).toLowerCase());

// ============================================
// Keyword optimization
// ============================================

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'with', 'in', 'on', 'at', 'to', 'by', 'and', '&',
  'is', 'are', 'or', 'it', 'this', 'that', 'kindle', 'book', 'books',
]);

export const isStopWord = (word: string): boolean => STOP_WORDS.has(word.toLowerCase());

export const cleanKeywordText = (text: string): string[] => {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 0 && !STOP_WORDS.has(w));
};

interface MetadataSource {
  title: string;
  subtitle: string | null;
  series: string;
  amazon_categories: string;
}

export const getMetadataWords = (book: MetadataSource): Set<string> => {
  const words = new Set<string>();
  const add = (txt?: string | null) => {
    if (!txt) return;
    cleanKeywordText(txt).forEach(w => words.add(w));
  };
  add(book.title);
  add(book.subtitle);
  add(book.series);
  add(book.amazon_categories);
  // Tropes are intentionally NOT added — they're internal organization,
  // not Amazon-facing metadata. Matches upstream behavior.
  return words;
};

const isWordCovered = (word: string, covered: Set<string>): boolean => {
  if (covered.has(word)) return true;
  if (word.endsWith('s') && covered.has(word.slice(0, -1))) return true;
  if (covered.has(word + 's')) return true;
  return false;
};

export interface CoverageResult {
  phraseWords: string[];
  neededWords: string[];
  coveredWords: string[];
  isFullyCovered: boolean;
}

export const analyzeKeywordCoverage = (phrase: string, covered: Set<string>): CoverageResult => {
  const phraseWords = cleanKeywordText(phrase);
  const neededWords: string[] = [];
  const coveredWords: string[] = [];
  for (const w of phraseWords) {
    if (isWordCovered(w, covered)) coveredWords.push(w);
    else neededWords.push(w);
  }
  return {
    phraseWords,
    neededWords,
    coveredWords,
    isFullyCovered: neededWords.length === 0,
  };
};

// Pack the unique uncovered words from a list of selected keyword
// phrases into 50-character boxes. Returns however many boxes are
// needed (UI shows 7 slots and warns if more are produced).
export const optimizeKeywords = (phrases: string[], metadataWords: Set<string>): string[] => {
  const uniqueNeeded = new Set<string>();
  for (const phrase of phrases) {
    for (const w of cleanKeywordText(phrase)) {
      if (!isWordCovered(w, metadataWords)) uniqueNeeded.add(w);
    }
  }

  // Sort shorter-first so when we drop singular/plural duplicates we
  // keep the shorter form (book vs books).
  const candidates = Array.from(uniqueNeeded).sort(
    (a, b) => a.length - b.length || a.localeCompare(b),
  );
  const finalWords = new Set<string>();
  for (const w of candidates) {
    if (!isWordCovered(w, finalWords)) finalWords.add(w);
  }

  const sorted = Array.from(finalWords).sort();
  const boxes: string[] = [];
  let cur = '';
  for (const w of sorted) {
    if (cur === '') cur = w;
    else if (cur.length + 1 + w.length <= 50) cur += ' ' + w;
    else {
      boxes.push(cur);
      cur = w;
    }
  }
  if (cur) boxes.push(cur);
  return boxes;
};

// ============================================
// CSV parsing — Publisher Rocket exports
// ============================================

export interface KeywordRawData {
  Keyword: string;
  'Average Pages'?: string;
  'Number Of Competitors'?: string;
  'Average Price'?: string;
  'Average Monthly Earnings'?: string;
  'Est. Amazon Searches/Month'?: string;
  'Amazon Searches/Month Color'?: string;
  'Competitive Score'?: string | number;
  'Competitive Score Color'?: string;
}

export const parseCSV = (csvText: string): KeywordRawData[] => {
  const lines = csvText.replace(/^﻿/, '').split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) {
        result.push(cur.trim().replace(/^"|"$/g, ''));
        cur = '';
      } else cur += ch;
    }
    result.push(cur.trim().replace(/^"|"$/g, ''));
    return result;
  };

  const headers = parseLine(lines[0]);
  const data: KeywordRawData[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    if (values.length === headers.length) {
      const entry: Record<string, string> = {};
      headers.forEach((h, idx) => { entry[h] = values[idx]; });
      data.push(entry as unknown as KeywordRawData);
    }
  }
  return data;
};

// Convert one CSV row into the DB shape (snake_case columns matching
// our keywords table). Trusts colors that PR provides; defaults to Gray.
export function csvRowToKeywordPayload(
  row: KeywordRawData,
  userId: string,
  tropeId: string,
): Omit<Keyword, 'id' | 'created_at' | 'external_id'> {
  const compRaw = row['Competitive Score'];
  const competitive_score =
    typeof compRaw === 'number' ? compRaw : parseNumberString(String(compRaw ?? ''));
  return {
    user_id: userId,
    trope_id: tropeId,
    text: row.Keyword.trim(),
    search_volume: parseNumberString(row['Est. Amazon Searches/Month']),
    search_volume_color: (row['Amazon Searches/Month Color'] || 'Gray') as ScoreColor,
    competitive_score,
    competitive_score_color: (row['Competitive Score Color'] || 'Gray') as ScoreColor,
    competitors: parseNumberString(row['Number Of Competitors']),
    avg_pages: parseNumberString(row['Average Pages']),
    avg_price: parseNumberString(row['Average Price']),
    avg_monthly_earnings: parseNumberString(row['Average Monthly Earnings']),
    last_updated: Date.now(),
  };
}
