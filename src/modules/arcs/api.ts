import { supabase } from '../../lib/supabase';
import type { ArcReader, ArcReaderInsert, ArcReaderUpdate, ArcStatus } from './types';
import { impliedFunnelStatus, isFunnelStatus, NOTION_STATUS_MAP } from './types';

export async function listArcReaders(userId: string): Promise<ArcReader[]> {
  const { data, error } = await supabase
    .from('arc_readers')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ArcReader[];
}

export async function createArcReader(userId: string, input: ArcReaderInsert): Promise<ArcReader> {
  const { data, error } = await supabase
    .from('arc_readers')
    .insert({ ...input, user_id: userId })
    .select('*')
    .single();
  if (error) throw error;
  return data as ArcReader;
}

export async function updateArcReader(id: string, patch: ArcReaderUpdate): Promise<ArcReader> {
  const { data, error } = await supabase
    .from('arc_readers')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as ArcReader;
}

export async function deleteArcReader(id: string): Promise<void> {
  const { error } = await supabase.from('arc_readers').delete().eq('id', id);
  if (error) throw error;
}

export async function bulkUpdateStatus(ids: string[], status: ArcStatus): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('arc_readers')
    .update({ status })
    .in('id', ids);
  if (error) throw error;
}

export type BulkBookField = 'applied_for' | 'received' | 'reviewed';

// Add or remove a book title from the given array field across many readers.
// Reads current arrays + status first so we can:
//   - preserve uniqueness on add / filter on remove per-row
//   - auto-toggle the funnel status (new → awaiting_arc → awaiting_review
//     → current_arc_member) based on what arrays are populated after the
//     change. Statuses outside the funnel set are user decisions and are
//     left alone.
// Updates run in parallel — sequential per-row writes were too slow on
// large selections (each round-trip is ~150ms; 50 readers ≈ 7s sequential).
export async function bulkUpdateBookField(
  ids: string[],
  field: BulkBookField,
  book: string,
  action: 'add' | 'remove',
): Promise<{ changed: number; unchanged: number }> {
  if (ids.length === 0 || !book) return { changed: 0, unchanged: 0 };
  const { data, error } = await supabase
    .from('arc_readers')
    .select('id, status, applied_for, received, reviewed')
    .in('id', ids);
  if (error) throw error;

  type Row = {
    id: string;
    status: ArcStatus;
    applied_for: string[] | null;
    received: string[] | null;
    reviewed: string[] | null;
  };
  const rows = (data ?? []) as Row[];

  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  let unchanged = 0;
  for (const row of rows) {
    const current = (row[field] as string[] | null) ?? [];
    const has = current.includes(book);
    if (action === 'add' && has) { unchanged++; continue; }
    if (action === 'remove' && !has) { unchanged++; continue; }
    const nextArr = action === 'add' ? [...current, book] : current.filter(b => b !== book);

    const arrays = {
      applied_for: row.applied_for ?? [],
      received: row.received ?? [],
      reviewed: row.reviewed ?? [],
      [field]: nextArr,
    } as Record<BulkBookField, string[]>;

    const patch: Record<string, unknown> = { [field]: nextArr };
    if (isFunnelStatus(row.status)) {
      const implied = impliedFunnelStatus(arrays.applied_for, arrays.received, arrays.reviewed);
      if (implied !== row.status) patch.status = implied;
    }
    updates.push({ id: row.id, patch });
  }

  const results = await Promise.all(updates.map(u =>
    supabase.from('arc_readers').update(u.patch).eq('id', u.id)
  ));
  const firstErr = results.find(r => r.error)?.error;
  if (firstErr) throw firstErr;

  return { changed: updates.length, unchanged };
}

// ============================================
// Notion JSON import
// ============================================
// Shape we accept (matches what a Notion export → JSON looks like for
// this database). All fields optional except Name.
export interface NotionArcRow {
  // Common Notion-export keys are listed for autocomplete, but the importer
  // tolerates any header that matches a known alias (see HEADER_ALIASES).
  id?: string;
  Name?: string;
  'Email Address'?: string;
  'Primary SM'?: string;
  'IG profile link'?: string;
  'TT profile link'?: string;
  'Goodreads profile link'?: string;
  'Blog link'?: string;
  Status?: string;
  'Application for'?: string[] | string;
  Received?: string[] | string;
  Reviewed?: string[] | string;
  'Place to Review'?: string[] | string;
  'Join my newsletter?'?: boolean | string;
  'Join my Promo team'?: string[] | string | boolean;
  notes?: string;
  [extra: string]: unknown;
}

export interface ImportSummary {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

function toArr(v: string[] | string | undefined | null): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
  return String(v)
    .split(/[,;]\s*/)
    .map(s => s.trim())
    .filter(Boolean);
}

function toBool(v: boolean | string | string[] | undefined): boolean {
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.some(s => /^yes$/i.test(s));
  if (typeof v === 'string') return /^(yes|true|__yes__|1)$/i.test(v.trim());
  return false;
}

// Look a value up in a row by trying each alias in order. Falls back to a
// case-insensitive match, then a substring match (aliases >= 4 chars only,
// to avoid 'fb'/'tt'/'ig' colliding with unrelated columns).
function pickRaw(row: NotionArcRow, aliases: string[]): unknown {
  for (const a of aliases) {
    if (a in row && row[a] !== undefined && row[a] !== null && row[a] !== '') return row[a];
  }
  const keys = Object.keys(row);
  const lowered = keys.map(k => k.toLowerCase().trim());
  for (const a of aliases) {
    const al = a.toLowerCase().trim();
    const i = lowered.findIndex(k => k === al);
    if (i >= 0 && row[keys[i]] !== undefined && row[keys[i]] !== '') return row[keys[i]];
  }
  for (const a of aliases) {
    if (a.length < 4) continue;
    const al = a.toLowerCase().trim();
    const i = lowered.findIndex(k => k.includes(al));
    if (i >= 0 && row[keys[i]] !== undefined && row[keys[i]] !== '') return row[keys[i]];
  }
  return undefined;
}

function pickStr(row: NotionArcRow, aliases: string[]): string {
  const v = pickRaw(row, aliases);
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.join(', ').trim();
  return '';
}

function rowToInsert(row: NotionArcRow): ArcReaderInsert | null {
  const name = pickStr(row, ['Name', 'Full Name']);
  if (!name) return null;
  const statusStr = pickStr(row, ['Status']);
  const status = (statusStr && NOTION_STATUS_MAP[statusStr]) ?? 'new';
  return {
    name,
    email: pickStr(row, ['Email Address', 'Email']) || null,
    primary_sm: pickStr(row, ['Primary SM', 'Primary Social']) || null,
    ig_profile_url: pickStr(row, ['IG profile link', 'Instagram', 'Instagram profile link']) || null,
    tt_profile_url: pickStr(row, ['TT profile link', 'Tiktok', 'Tiktok profile link', 'TikTok']) || null,
    threads_profile_url: pickStr(row, ['Threads', 'Threads profile link']) || null,
    fb_profile_url: pickStr(row, ['Facebook', 'Facebook profile link', 'FB profile link']) || null,
    goodreads_profile_url: pickStr(row, ['Goodreads profile link', 'Goodreads']) || null,
    amazon_reviewer_url: pickStr(row, ['Amazon Reviewer profile link', 'Amazon Reviewer', 'Amazon']) || null,
    blog_url: pickStr(row, ['Blog link', 'Blog', 'Website']) || null,
    status,
    applied_for: toArr(pickRaw(row, ['Application for', 'Applied for']) as string | string[] | undefined),
    received: toArr(pickRaw(row, ['Received']) as string | string[] | undefined),
    reviewed: toArr(pickRaw(row, ['Reviewed']) as string | string[] | undefined),
    place_to_review: toArr(pickRaw(row, [
      'Place to Review',
      'Places to Review',
      'Where do you plan to post your review?',
      'Where will you review',
      'post your review',
    ]) as string | string[] | undefined),
    newsletter_subscribed: toBool(pickRaw(row, [
      'Join my newsletter?',
      'Would you like to join my newsletter?',
      'Newsletter',
    ]) as boolean | string | string[] | undefined),
    promo_team: toBool(pickRaw(row, ['Join my Promo team', 'Promo team']) as boolean | string | string[] | undefined),
    notes: (row.notes ?? '') as string || null,
    external_id: (row.id ?? '').toString() || null,
  };
}

export async function importNotionJson(
  userId: string,
  rows: NotionArcRow[],
): Promise<ImportSummary> {
  const summary: ImportSummary = { inserted: 0, updated: 0, skipped: 0, errors: [] };

  // Pull all existing rows once for fast dedupe lookup.
  const { data: existing, error: exErr } = await supabase
    .from('arc_readers')
    .select('id, external_id, email, name')
    .eq('user_id', userId);
  if (exErr) throw exErr;

  const byExt = new Map<string, string>();
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const e of existing ?? []) {
    if (e.external_id) byExt.set(e.external_id, e.id);
    if (e.email) byEmail.set(e.email.toLowerCase().trim(), e.id);
    if (e.name) byName.set(e.name.toLowerCase().trim(), e.id);
  }

  const toInsert: Array<ArcReaderInsert & { user_id: string }> = [];
  const toUpdate: Array<{ id: string; patch: ArcReaderInsert }> = [];

  for (const row of rows) {
    const payload = rowToInsert(row);
    if (!payload) {
      summary.skipped++;
      continue;
    }
    const extId = payload.external_id;
    let existingId =
      (extId && byExt.get(extId)) ||
      (payload.email && byEmail.get(payload.email.toLowerCase().trim())) ||
      byName.get(payload.name.toLowerCase().trim()) ||
      null;
    if (existingId) {
      toUpdate.push({ id: existingId, patch: payload });
    } else {
      toInsert.push({ ...payload, user_id: userId });
    }
  }

  // Batch insert
  for (let i = 0; i < toInsert.length; i += 200) {
    const batch = toInsert.slice(i, i + 200);
    const { error } = await supabase.from('arc_readers').insert(batch);
    if (error) {
      summary.errors.push(error.message);
      break;
    }
    summary.inserted += batch.length;
  }

  // Updates — one at a time so partial failures don't lose data.
  for (const u of toUpdate) {
    const { error } = await supabase.from('arc_readers').update(u.patch).eq('id', u.id);
    if (error) {
      summary.errors.push(`${u.patch.name}: ${error.message}`);
      continue;
    }
    summary.updated++;
  }

  return summary;
}

// ============================================
// CSV import (Notion CSV export)
// ============================================
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

export function parseNotionCsv(csv: string): NotionArcRow[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const rows: NotionArcRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length !== headers.length) continue;
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = cells[j];
    rows.push(obj as NotionArcRow);
  }
  return rows;
}

// ============================================
// Notes backfill (Notion Markdown export)
// ============================================
// Applies notes-only updates to existing arc_readers rows. Matches by
// name (case-insensitive, trimmed) since Notion's standard CSV export
// doesn't include page IDs, so most existing rows have external_id NULL.
// Returns matched / unmatched / skipped counts plus the list of names
// that didn't match.

export interface NotesBackfillEntry {
  name: string;
  notes: string;
}

export interface NotesBackfillSummary {
  matched: number;
  skippedEmpty: number;
  unmatched: string[];
  errors: string[];
}

export async function backfillNotesByName(
  userId: string,
  entries: NotesBackfillEntry[],
): Promise<NotesBackfillSummary> {
  const summary: NotesBackfillSummary = {
    matched: 0,
    skippedEmpty: 0,
    unmatched: [],
    errors: [],
  };

  // Skip empty notes — no point overwriting existing notes with blanks.
  const meaningful = entries.filter(e => {
    if (!e.name?.trim()) return false;
    if (!e.notes?.trim()) {
      summary.skippedEmpty++;
      return false;
    }
    return true;
  });
  if (meaningful.length === 0) return summary;

  // Pull all readers once for fast lookup.
  const { data: rows, error } = await supabase
    .from('arc_readers')
    .select('id, name')
    .eq('user_id', userId);
  if (error) throw error;
  const byName = new Map<string, string>();
  for (const r of rows ?? []) {
    if (r.name) byName.set(r.name.toLowerCase().trim(), r.id);
  }

  for (const entry of meaningful) {
    const id = byName.get(entry.name.toLowerCase().trim());
    if (!id) {
      summary.unmatched.push(entry.name);
      continue;
    }
    const { error: uErr } = await supabase
      .from('arc_readers')
      .update({ notes: entry.notes })
      .eq('id', id);
    if (uErr) {
      summary.errors.push(`${entry.name}: ${uErr.message}`);
      continue;
    }
    summary.matched++;
  }

  return summary;
}
