import { supabase } from '../../lib/supabase';
import {
  normalizeEmail, normalizeIgHandle, normalizeName, normalizeTtHandle,
  similarity, tokenOverlap,
} from './match';
import type { ArcReader } from './types';
import { linkReaderBooksFromTitles } from './api';

// ============================================
// Flexible CSV parsing
// ============================================
// New-applicant CSVs come from arbitrary form tools (Tally, Google
// Forms, Jotform, Notion). Header names vary. We match each known
// field to a small set of header aliases (case + whitespace
// insensitive) so the user doesn't have to rename columns.

interface FieldAliases {
  name: string[];
  email: string[];
  ig: string[];
  tt: string[];
  threads: string[];
  fb: string[];
  goodreads: string[];
  amazon: string[];
  blog: string[];
  primary_sm: string[];
  newsletter: string[];
  promo_team: string[];
  notes: string[];
  places: string[];
}

// Order matters for the substring fallback in findColumn(): list shorter,
// more-generic aliases first. Single-letter / 2-3 char aliases (ig, tt, fb)
// are exact-match only — see the length guard in findColumn().
const ALIASES: FieldAliases = {
  name: ['name', 'full name', 'reader name', 'your name', 'first and last name'],
  email: ['email', 'email address', 'your email', 'e-mail'],
  ig: ['instagram', 'instagram profile link', 'ig profile link', 'instagram url', 'instagram handle', 'ig'],
  tt: ['tiktok', 'tiktok profile link', 'tt profile link', 'tiktok url', 'tiktok handle', 'tt'],
  threads: ['threads', 'threads profile link', 'threads url'],
  fb: ['facebook', 'facebook profile link', 'facebook url', 'fb profile link', 'fb'],
  goodreads: ['goodreads', 'goodreads profile link', 'goodreads url', 'goodreads, storygraph, bookbub profile link'],
  amazon: ['amazon reviewer', 'amazon', 'amazon reviewer profile link', 'amazon profile link'],
  blog: ['blog', 'blog link', 'blog url', 'website', 'blog, podcast, or other profile link'],
  primary_sm: ['primary sm', 'primary social', 'primary social media', 'main social'],
  newsletter: ['newsletter', 'join my newsletter?', 'would you like to join my newsletter?', 'subscribe to newsletter', 'join newsletter'],
  promo_team: ['promo team', 'join my promo team', 'join promo team'],
  notes: ['notes', 'anything else', 'additional info', 'comments'],
  places: ['post your review', 'place to review', 'places to review', 'where will you review', 'where do you plan to post your review?', 'where do you plan to post your review'],
};

export interface ApplicantRow {
  rowIndex: number;
  name: string;
  email: string | null;
  ig_profile_url: string | null;
  tt_profile_url: string | null;
  threads_profile_url: string | null;
  fb_profile_url: string | null;
  goodreads_profile_url: string | null;
  amazon_reviewer_url: string | null;
  blog_url: string | null;
  primary_sm: string | null;
  newsletter_subscribed: boolean;
  promo_team: boolean;
  notes: string | null;
  place_to_review: string[];
}

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
      } else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function findColumn(headers: string[], aliases: string[]): number {
  const lowered = headers.map(h => h.toLowerCase().trim());
  // 1. exact match against any alias.
  for (const alias of aliases) {
    const i = lowered.findIndex(h => h === alias);
    if (i >= 0) return i;
  }
  // 2. substring fallback against any alias >= 4 chars. Short aliases like
  // 'fb', 'ig', 'tt' are skipped here — they'd collide with unrelated words.
  for (const alias of aliases) {
    if (alias.length < 4) continue;
    const i = lowered.findIndex(h => h.includes(alias));
    if (i >= 0) return i;
  }
  return -1;
}

function asBool(v: string | undefined): boolean {
  if (!v) return false;
  return /^(yes|true|y|1|checked|on)$/i.test(v.trim());
}

function asList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(/[,;]\s*/)
    .map(s => s.trim())
    .filter(Boolean);
}

export interface CsvParseResult {
  rows: ApplicantRow[];
  detectedColumns: Partial<Record<keyof FieldAliases, string>>;
  missingNameColumn: boolean;
}

export function parseApplicantCsv(csv: string): CsvParseResult {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], detectedColumns: {}, missingNameColumn: true };
  }

  const headers = splitCsvLine(lines[0]);
  const cols: Partial<Record<keyof FieldAliases, number>> = {};
  const detectedColumns: Partial<Record<keyof FieldAliases, string>> = {};
  for (const key of Object.keys(ALIASES) as (keyof FieldAliases)[]) {
    const idx = findColumn(headers, ALIASES[key]);
    if (idx >= 0) {
      cols[key] = idx;
      detectedColumns[key] = headers[idx];
    }
  }
  if (cols.name === undefined) {
    return { rows: [], detectedColumns, missingNameColumn: true };
  }

  const get = (cells: string[], k: keyof FieldAliases): string | undefined => {
    const i = cols[k];
    return i === undefined ? undefined : cells[i];
  };

  const rows: ApplicantRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const name = (get(cells, 'name') ?? '').trim();
    if (!name) continue;
    rows.push({
      rowIndex: i,
      name,
      email: (get(cells, 'email') ?? '').trim() || null,
      ig_profile_url: (get(cells, 'ig') ?? '').trim() || null,
      tt_profile_url: (get(cells, 'tt') ?? '').trim() || null,
      threads_profile_url: (get(cells, 'threads') ?? '').trim() || null,
      fb_profile_url: (get(cells, 'fb') ?? '').trim() || null,
      goodreads_profile_url: (get(cells, 'goodreads') ?? '').trim() || null,
      amazon_reviewer_url: (get(cells, 'amazon') ?? '').trim() || null,
      blog_url: (get(cells, 'blog') ?? '').trim() || null,
      primary_sm: (get(cells, 'primary_sm') ?? '').trim() || null,
      newsletter_subscribed: asBool(get(cells, 'newsletter')),
      promo_team: asBool(get(cells, 'promo_team')),
      notes: (get(cells, 'notes') ?? '').trim() || null,
      place_to_review: asList(get(cells, 'places')),
    });
  }
  return { rows, detectedColumns, missingNameColumn: false };
}

// ============================================
// Match candidates
// ============================================

export type MatchReason =
  | 'exact_email'
  | 'exact_ig'
  | 'exact_tt'
  | 'exact_name'
  | 'fuzzy_name'
  | 'token_overlap';

export interface MatchCandidate {
  readerId: string;
  readerName: string;
  readerEmail: string | null;
  confidence: number; // 0..1
  reason: MatchReason;
}

export interface MatchPreview {
  applicant: ApplicantRow;
  candidates: MatchCandidate[];
  suggestedDecision: 'merge' | 'create';
  suggestedReaderId: string | null;
}

const FUZZY_THRESHOLD = 0.78; // empirical
const TOKEN_THRESHOLD = 0.6;

export async function computeApplicantMatches(
  userId: string,
  applicants: ApplicantRow[],
): Promise<{ previews: MatchPreview[]; readers: ArcReader[] }> {
  const { data, error } = await supabase
    .from('arc_readers')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  const readers = (data ?? []) as ArcReader[];

  // Pre-normalize. Email, IG handle, and TT handle are unique
  // identifiers — those drive the auto-merge suggestion. Name is too
  // noisy (common names, nicknames, spelling drift) so it surfaces as
  // a selectable candidate only.
  const byEmail = new Map<string, ArcReader>();
  const byIg = new Map<string, ArcReader>();
  const byTt = new Map<string, ArcReader>();
  const normalized = readers.map(r => {
    const nName = normalizeName(r.name);
    const nEmail = normalizeEmail(r.email);
    const nIg = normalizeIgHandle(r.ig_profile_url);
    const nTt = normalizeTtHandle(r.tt_profile_url);
    if (nEmail) byEmail.set(nEmail, r);
    if (nIg) byIg.set(nIg, r);
    if (nTt) byTt.set(nTt, r);
    return { reader: r, nName };
  });

  const previews: MatchPreview[] = applicants.map(applicant => {
    const aName = normalizeName(applicant.name);
    const aEmail = normalizeEmail(applicant.email);
    const aIg = normalizeIgHandle(applicant.ig_profile_url);
    const aTt = normalizeTtHandle(applicant.tt_profile_url);

    const candidates: MatchCandidate[] = [];
    const pushUnique = (c: MatchCandidate) => {
      if (!candidates.some(x => x.readerId === c.readerId)) candidates.push(c);
    };

    if (aEmail) {
      const hit = byEmail.get(aEmail);
      if (hit) pushUnique({
        readerId: hit.id, readerName: hit.name, readerEmail: hit.email,
        confidence: 1, reason: 'exact_email',
      });
    }
    if (aIg) {
      const hit = byIg.get(aIg);
      if (hit) pushUnique({
        readerId: hit.id, readerName: hit.name, readerEmail: hit.email,
        confidence: 0.97, reason: 'exact_ig',
      });
    }
    if (aTt) {
      const hit = byTt.get(aTt);
      if (hit) pushUnique({
        readerId: hit.id, readerName: hit.name, readerEmail: hit.email,
        confidence: 0.97, reason: 'exact_tt',
      });
    }

    for (const { reader, nName } of normalized) {
      if (candidates.some(c => c.readerId === reader.id)) continue;
      if (aName && nName === aName) {
        pushUnique({
          readerId: reader.id, readerName: reader.name, readerEmail: reader.email,
          confidence: 0.85, reason: 'exact_name',
        });
        continue;
      }
      if (aName && nName) {
        const sim = similarity(aName, nName);
        if (sim >= FUZZY_THRESHOLD) {
          pushUnique({
            readerId: reader.id, readerName: reader.name, readerEmail: reader.email,
            confidence: sim * 0.85, reason: 'fuzzy_name',
          });
          continue;
        }
        const tok = tokenOverlap(aName, nName);
        if (tok >= TOKEN_THRESHOLD) {
          pushUnique({
            readerId: reader.id, readerName: reader.name, readerEmail: reader.email,
            confidence: 0.55 + tok * 0.15, reason: 'token_overlap',
          });
        }
      }
    }

    candidates.sort((a, b) => b.confidence - a.confidence);

    // Auto-merge ONLY on unique identifiers: email or social handle.
    // Name matches surface as candidates but never auto-pick.
    const autoMergeReasons: MatchReason[] = ['exact_email', 'exact_ig', 'exact_tt'];
    const autoMerge = candidates.find(c => autoMergeReasons.includes(c.reason));
    const suggestedDecision: 'merge' | 'create' = autoMerge ? 'merge' : 'create';
    const suggestedReaderId = autoMerge?.readerId ?? null;

    return {
      applicant,
      candidates: candidates.slice(0, 3),
      suggestedDecision,
      suggestedReaderId,
    };
  });

  return { previews, readers };
}

// ============================================
// Apply decisions
// ============================================

export type Decision =
  | { kind: 'skip'; rowIndex: number }
  | { kind: 'create'; rowIndex: number }
  | { kind: 'merge'; rowIndex: number; readerId: string };

export interface ApplySummary {
  created: number;
  merged: number;
  skipped: number;
  errors: string[];
}

function appendUnique(arr: string[], v: string): string[] {
  if (!v) return arr;
  if (arr.includes(v)) return arr;
  return [...arr, v];
}

export async function applyApplicantDecisions(
  userId: string,
  decisions: Decision[],
  applicants: ApplicantRow[],
  existingReaders: ArcReader[],
  selectedBookTitle: string | null,
): Promise<ApplySummary> {
  const summary: ApplySummary = { created: 0, merged: 0, skipped: 0, errors: [] };
  const byRowIndex = new Map(applicants.map(a => [a.rowIndex, a]));
  const byReaderId = new Map(existingReaders.map(r => [r.id, r]));

  for (const d of decisions) {
    const applicant = byRowIndex.get(d.rowIndex);
    if (!applicant) continue;

    if (d.kind === 'skip') {
      summary.skipped++;
      continue;
    }

    if (d.kind === 'create') {
      const payload = {
        user_id: userId,
        name: applicant.name,
        email: applicant.email,
        ig_profile_url: applicant.ig_profile_url,
        tt_profile_url: applicant.tt_profile_url,
        threads_profile_url: applicant.threads_profile_url,
        fb_profile_url: applicant.fb_profile_url,
        goodreads_profile_url: applicant.goodreads_profile_url,
        amazon_reviewer_url: applicant.amazon_reviewer_url,
        blog_url: applicant.blog_url,
        primary_sm: applicant.primary_sm,
        status: 'new' as const,
        applied_for: selectedBookTitle ? [selectedBookTitle] : [],
        received: [],
        reviewed: [],
        place_to_review: applicant.place_to_review,
        newsletter_subscribed: applicant.newsletter_subscribed,
        promo_team: applicant.promo_team,
        notes: applicant.notes,
        external_id: null,
      };
      const { data: inserted, error } = await supabase
        .from('arc_readers')
        .insert(payload)
        .select('id')
        .single();
      if (error) {
        summary.errors.push(`${applicant.name}: ${error.message}`);
        continue;
      }
      // Link the applied-for book to the junction. linkReaderBooksFromTitles
      // also stashes the title in unmatched_titles when no Catalog match,
      // so the UI can surface it for cleanup.
      if (selectedBookTitle) {
        try {
          await linkReaderBooksFromTitles(userId, (inserted as { id: string }).id, {
            applied: [selectedBookTitle],
          });
        } catch (linkErr: any) {
          summary.errors.push(`${applicant.name}: linked reader but couldn't attach book — ${linkErr?.message ?? linkErr}`);
        }
      }
      summary.created++;
      continue;
    }

    // merge
    const reader = byReaderId.get(d.readerId);
    if (!reader) {
      summary.errors.push(`${applicant.name}: target reader not found`);
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (selectedBookTitle) {
      patch.applied_for = appendUnique(reader.applied_for, selectedBookTitle);
    }
    // Fill blank fields from the applicant — don't overwrite.
    if (!reader.email && applicant.email) patch.email = applicant.email;
    if (!reader.ig_profile_url && applicant.ig_profile_url) patch.ig_profile_url = applicant.ig_profile_url;
    if (!reader.tt_profile_url && applicant.tt_profile_url) patch.tt_profile_url = applicant.tt_profile_url;
    if (!reader.threads_profile_url && applicant.threads_profile_url) patch.threads_profile_url = applicant.threads_profile_url;
    if (!reader.fb_profile_url && applicant.fb_profile_url) patch.fb_profile_url = applicant.fb_profile_url;
    if (!reader.goodreads_profile_url && applicant.goodreads_profile_url) patch.goodreads_profile_url = applicant.goodreads_profile_url;
    if (!reader.amazon_reviewer_url && applicant.amazon_reviewer_url) patch.amazon_reviewer_url = applicant.amazon_reviewer_url;
    if (!reader.blog_url && applicant.blog_url) patch.blog_url = applicant.blog_url;
    if (!reader.primary_sm && applicant.primary_sm) patch.primary_sm = applicant.primary_sm;
    // Booleans: turn on if applicant says yes — never silently off.
    if (applicant.newsletter_subscribed && !reader.newsletter_subscribed) patch.newsletter_subscribed = true;
    if (applicant.promo_team && !reader.promo_team) patch.promo_team = true;
    // Merge place_to_review (union).
    if (applicant.place_to_review.length > 0) {
      const next = Array.from(new Set([...reader.place_to_review, ...applicant.place_to_review]));
      if (next.length !== reader.place_to_review.length) patch.place_to_review = next;
    }
    // Notes — append rather than overwrite.
    if (applicant.notes && !((reader.notes ?? '').includes(applicant.notes))) {
      patch.notes = reader.notes ? `${reader.notes}\n\n${applicant.notes}` : applicant.notes;
    }
    // Always run the junction link for merges so adding a book to an
    // existing reader works even when the rest of the row didn't change.
    if (selectedBookTitle) {
      try {
        await linkReaderBooksFromTitles(userId, d.readerId, { applied: [selectedBookTitle] });
      } catch (linkErr: any) {
        summary.errors.push(`${applicant.name}: ${linkErr?.message ?? linkErr}`);
      }
    }
    if (Object.keys(patch).length === 0) {
      summary.merged++;
      continue;
    }
    const { error } = await supabase.from('arc_readers').update(patch).eq('id', d.readerId);
    if (error) {
      summary.errors.push(`${applicant.name}: ${error.message}`);
      continue;
    }
    summary.merged++;
  }

  return summary;
}

export const REASON_LABELS: Record<MatchReason, string> = {
  exact_email: 'Same email',
  exact_ig: 'Same Instagram',
  exact_tt: 'Same TikTok',
  exact_name: 'Same name',
  fuzzy_name: 'Similar name',
  token_overlap: 'Shared name words',
};
