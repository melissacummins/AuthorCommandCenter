// Helpers for matching new ARC applicants against existing readers.
// Used by the "New applicants (CSV)" import flow.

export function normalizeName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeEmail(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().trim();
}

// Pull a canonical handle out of an Instagram/TikTok URL or raw input.
// People paste these in many forms — full URLs with tracking params,
// "@username", "instagram.com/username", just "username" — so we strip
// down to the handle itself for comparison.
//
// Returns '' if we can't find anything that looks like a handle.
export function normalizeIgHandle(input: string | null | undefined): string {
  return extractHandle(input, /(?:instagram\.com\/|^@?)([A-Za-z0-9_.]+)/i);
}

export function normalizeTtHandle(input: string | null | undefined): string {
  return extractHandle(input, /(?:tiktok\.com\/@|^@?)([A-Za-z0-9_.]+)/i);
}

function extractHandle(input: string | null | undefined, re: RegExp): string {
  if (!input) return '';
  const cleaned = input.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const m = cleaned.match(re);
  if (!m) return '';
  // Strip trailing slashes / query / fragment / common junk paths.
  const raw = m[1].replace(/[/?#].*$/, '').toLowerCase();
  if (!raw || raw === 'www' || raw === 'p' || raw === 'reel' || raw === 'tv') return '';
  return raw;
}

// Two-row dynamic programming Levenshtein distance. O(m * n) time,
// O(min(m, n)) space.
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// 0..1 similarity. 1 = identical, 0 = totally different.
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshteinDistance(a, b) / max;
}

// Token-set match — useful for "Megan Ley" vs "Ley Megan" or partial
// first-name matches. Returns the fraction of incoming-name tokens
// that appear (exactly) in the candidate name.
export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / ta.size;
}
