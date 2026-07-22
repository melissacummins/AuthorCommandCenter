// Cloud backup orchestrator (client side).
//
// Composes the two existing halves — the full data export (createBackup) and
// the cloud uploader (cloudExport) — plus Supabase Storage files, into one
// dated backup folder in the user's Google Drive or Dropbox:
//
//   Author Command Center/Backups/backup_<stamp>/
//     data.json        — every user-scoped table (see settings/tables.ts)
//     manifest.json     — what's inside + counts + any skipped files
//     files/<bucket>/…  — the raw bytes of each Storage object
//
// The same folder shape is produced by the server-side cron
// (api/backup/[action].ts) so a restore tool never has to care which path
// created a given backup.

import { supabase } from './supabase';
import { createBackup } from '../modules/settings/backup';
import { BACKUP_BUCKETS, BACKUP_SCHEMA_VERSION } from '../modules/settings/tables';
import {
  type CloudService,
  openCloudBackup,
  uploadToCloudBackup,
  backupStamp,
  getDriveStatus,
  getDropboxStatus,
} from './cloudExport';

// Dropbox's single-shot upload endpoint caps at 150 MB; Drive's multipart at
// 5 GB. To keep one code path we skip anything above this and note it in the
// manifest rather than aborting the whole run. (Chunked/session uploads for
// the rare oversized audiobook file can be added later.)
const MAX_FILE_BYTES = 140 * 1024 * 1024;

export interface SkippedFile {
  bucket: string;
  path: string;
  size: number;
  reason: string;
}

export interface BackupManifest {
  schema_version: number;
  exported_at: string;
  stamp: string;
  user_id: string;
  source: 'client' | 'cron';
  app_origin: string;
  table_row_counts: Record<string, number>;
  total_rows: number;
  file_counts: Record<string, number>;
  total_files: number;
  total_file_bytes: number;
  skipped_files: SkippedFile[];
}

export interface CloudBackupResult {
  service: CloudService;
  stamp: string;
  totalRows: number;
  totalFiles: number;
  totalFileBytes: number;
  skipped: SkippedFile[];
}

interface StorageEntry {
  path: string; // full object path, including the leading `<user_id>/`
  size: number;
}

// Supabase's storage list() is one level deep, so walk folders ourselves.
// Every object lives under `<user_id>/…`, so we start at the user's folder.
async function listBucketFiles(bucket: string, userId: string): Promise<StorageEntry[]> {
  const out: StorageEntry[] = [];
  const PAGE = 100;

  async function walk(prefix: string): Promise<void> {
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) {
        // Bucket may not exist in this deploy, or the user has no files —
        // treat as empty rather than failing the whole backup.
        return;
      }
      if (!data || data.length === 0) break;
      for (const item of data) {
        // A folder placeholder has a null `id`; a real file has metadata.
        const isFolder = (item as { id: string | null }).id === null;
        const full = prefix ? `${prefix}/${item.name}` : item.name;
        if (isFolder) {
          await walk(full);
        } else {
          const size = (item.metadata as { size?: number } | null)?.size ?? 0;
          out.push({ path: full, size });
        }
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }

  await walk(userId);
  return out;
}

// Returns which cloud services are currently connected, so the auto-backup
// and the button can decide where to write (and disable when neither is).
export async function connectedBackupServices(): Promise<CloudService[]> {
  const services: CloudService[] = [];
  const [drive, dropbox] = await Promise.all([
    getDriveStatus().catch(() => ({ connected: false })),
    getDropboxStatus().catch(() => ({ connected: false })),
  ]);
  if (dropbox.connected) services.push('dropbox');
  if (drive.connected) services.push('drive');
  return services;
}

export interface RunCloudBackupOptions {
  service: CloudService;
  includeFiles?: boolean; // default true
  onProgress?: (msg: string) => void;
  now?: Date; // injectable for tests
}

export async function runCloudBackup(opts: RunCloudBackupOptions): Promise<CloudBackupResult> {
  const { service, onProgress } = opts;
  const includeFiles = opts.includeFiles ?? true;
  const now = opts.now ?? new Date();
  const stamp = backupStamp(now);

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) throw new Error('Not signed in');

  onProgress?.('Opening backup folder…');
  const dest = await openCloudBackup(service, stamp);

  // 1) Database rows → data.json
  const backup = await createBackup((msg) => onProgress?.(msg));
  const tableRowCounts: Record<string, number> = {};
  let totalRows = 0;
  for (const [name, rows] of Object.entries(backup.tables)) {
    tableRowCounts[name] = rows.length;
    totalRows += rows.length;
  }
  onProgress?.('Uploading data…');
  await uploadToCloudBackup(
    dest,
    new Blob([JSON.stringify(backup)], { type: 'application/json' }),
    [],
    'data.json',
  );

  // 2) Storage files → files/<bucket>/…
  const fileCounts: Record<string, number> = {};
  const skipped: SkippedFile[] = [];
  let totalFiles = 0;
  let totalFileBytes = 0;

  if (includeFiles) {
    for (const bucket of BACKUP_BUCKETS) {
      onProgress?.(`Scanning ${bucket.label}…`);
      const files = await listBucketFiles(bucket.id, user.id);
      fileCounts[bucket.id] = 0;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (f.size > MAX_FILE_BYTES) {
          skipped.push({ bucket: bucket.id, path: f.path, size: f.size, reason: 'exceeds 140 MB single-upload limit' });
          continue;
        }
        const { data: blob, error } = await supabase.storage.from(bucket.id).download(f.path);
        if (error || !blob) {
          skipped.push({ bucket: bucket.id, path: f.path, size: f.size, reason: error?.message || 'download failed' });
          continue;
        }
        // Path inside the backup: strip the leading `<user_id>/` so the tree
        // is clean; keep the bucket as the top segment.
        const rel = f.path.startsWith(`${user.id}/`) ? f.path.slice(user.id.length + 1) : f.path;
        const segments = rel.split('/');
        const filename = segments.pop() as string;
        try {
          onProgress?.(`Uploading ${bucket.label} (${i + 1}/${files.length})…`);
          await uploadToCloudBackup(dest, blob, ['files', bucket.id, ...segments], filename);
          fileCounts[bucket.id]++;
          totalFiles++;
          totalFileBytes += f.size;
        } catch (err) {
          skipped.push({ bucket: bucket.id, path: f.path, size: f.size, reason: (err as Error).message });
        }
      }
    }
  }

  // 3) manifest.json
  const manifest: BackupManifest = {
    schema_version: BACKUP_SCHEMA_VERSION,
    exported_at: backup.exported_at,
    stamp,
    user_id: user.id,
    source: 'client',
    app_origin: typeof window !== 'undefined' ? window.location.origin : '',
    table_row_counts: tableRowCounts,
    total_rows: totalRows,
    file_counts: fileCounts,
    total_files: totalFiles,
    total_file_bytes: totalFileBytes,
    skipped_files: skipped,
  };
  onProgress?.('Finishing…');
  await uploadToCloudBackup(
    dest,
    new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
    [],
    'manifest.json',
  );

  recordCloudBackup(now);

  return { service, stamp, totalRows, totalFiles, totalFileBytes, skipped };
}

// --- Last-cloud-backup tracking (drives the auto-backup cadence) ------------
// Separate from the "downloaded a JSON to this browser" key in backup.ts:
// this tracks the last time we successfully wrote to Drive/Dropbox.

const LAST_CLOUD_BACKUP_KEY = 'command-center:last-cloud-backup-at';

export function recordCloudBackup(when: Date = new Date()) {
  try {
    localStorage.setItem(LAST_CLOUD_BACKUP_KEY, when.toISOString());
  } catch {
    /* ignore (private mode, quota) */
  }
}

export function getLastCloudBackupAt(): Date | null {
  try {
    const v = localStorage.getItem(LAST_CLOUD_BACKUP_KEY);
    return v ? new Date(v) : null;
  } catch {
    return null;
  }
}

export function daysSinceCloudBackup(): number | null {
  const last = getLastCloudBackupAt();
  if (!last) return null;
  return Math.floor((Date.now() - last.getTime()) / (1000 * 60 * 60 * 24));
}
