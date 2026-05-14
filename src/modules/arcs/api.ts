import { supabase } from '../../lib/supabase';
import type { ArcReader, ArcReaderInsert, ArcReaderUpdate, ArcStatus } from './types';
import { NOTION_STATUS_MAP } from './types';

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

// ============================================
// Notion JSON import
// ============================================
// Shape we accept (matches what a Notion export → JSON looks like for
// this database). All fields optional except Name.
export interface NotionArcRow {
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
  'Awaiting Review for'?: string[] | string;
  'Place to Review'?: string[] | string;
  'Join my newsletter?'?: boolean | string;
  'Join my Promo team'?: string[] | string | boolean;
  notes?: string;
  // Free-form extras get dropped into notes.
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

function rowToInsert(row: NotionArcRow): ArcReaderInsert | null {
  const name = (row.Name ?? '').trim();
  if (!name) return null;
  const status = (row.Status && NOTION_STATUS_MAP[row.Status]) ?? 'new';
  return {
    name,
    email: (row['Email Address'] ?? '').trim() || null,
    primary_sm: (row['Primary SM'] ?? '').trim() || null,
    ig_profile_url: (row['IG profile link'] ?? '').trim() || null,
    tt_profile_url: (row['TT profile link'] ?? '').trim() || null,
    goodreads_profile_url: (row['Goodreads profile link'] ?? '').trim() || null,
    blog_url: (row['Blog link'] ?? '').trim() || null,
    status,
    applied_for: toArr(row['Application for']),
    received: toArr(row.Received),
    reviewed: toArr(row.Reviewed),
    awaiting_review_for: toArr(row['Awaiting Review for']),
    place_to_review: toArr(row['Place to Review']),
    newsletter_subscribed: toBool(row['Join my newsletter?']),
    promo_team: toBool(row['Join my Promo team']),
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
