import { supabase } from '../../lib/supabase';
import {
  BACKUP_TABLES,
  BACKUP_SCHEMA_VERSION,
  type BackupFile,
} from './tables';

const PAGE_SIZE = 1000;

async function fetchAllRows(table: string): Promise<any[]> {
  const all: any[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export async function createBackup(
  onProgress?: (msg: string) => void,
): Promise<BackupFile> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) throw new Error('Not signed in');

  const tables: Record<string, any[]> = {};
  for (const t of BACKUP_TABLES) {
    onProgress?.(`Exporting ${t.label}…`);
    try {
      tables[t.name] = await fetchAllRows(t.name);
    } catch (err: any) {
      // Table might not exist in this deploy — skip it and keep going
      console.warn(`Skipping ${t.name}: ${err.message}`);
      tables[t.name] = [];
    }
  }

  return {
    schema_version: BACKUP_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    user_id: user.id,
    tables,
  };
}

export function downloadBackup(backup: BackupFile) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const date = new Date().toISOString().split('T')[0];
  link.download = `command-center-backup_${date}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface RestoreProgress {
  table: string;
  action: 'deleting' | 'inserting';
  rowsWritten?: number;
}

export async function restoreBackup(
  backup: BackupFile,
  onProgress?: (p: RestoreProgress) => void,
): Promise<{ rowsRestored: number }> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) throw new Error('Not signed in');

  // Accept this version and any OLDER one. A v1 file simply carries fewer
  // tables than v2 knows about; restore already tolerates tables a file
  // doesn't contain, so an older backup restores cleanly. We only refuse a
  // NEWER file than this build understands, since it may contain tables or
  // shapes we can't place safely.
  if (backup.schema_version > BACKUP_SCHEMA_VERSION) {
    throw new Error(
      `This backup was made by a newer version of the app (schema v${backup.schema_version}, this build understands up to v${BACKUP_SCHEMA_VERSION}). Update the app, then restore.`,
    );
  }

  // Delete in reverse order (children before parents)
  for (let i = BACKUP_TABLES.length - 1; i >= 0; i--) {
    const t = BACKUP_TABLES[i];
    onProgress?.({ table: t.name, action: 'deleting' });
    const { error } = await supabase
      .from(t.name)
      .delete()
      .eq('user_id', user.id);
    if (error) {
      // Tolerate tables that don't exist (missing migration) or missing user_id column
      console.warn(`Could not clear ${t.name}: ${error.message}`);
    }
  }

  // Insert in forward order (parents before children)
  let rowsRestored = 0;
  for (const t of BACKUP_TABLES) {
    const rows = backup.tables[t.name];
    if (!rows || rows.length === 0) continue;

    // Rewrite user_id on every row so the backup can be restored by any user
    const rewritten = rows.map((row: any) => ({ ...row, user_id: user.id }));

    onProgress?.({ table: t.name, action: 'inserting' });
    // Insert in chunks to avoid giant payloads
    const CHUNK = 500;
    for (let i = 0; i < rewritten.length; i += CHUNK) {
      const chunk = rewritten.slice(i, i + CHUNK);
      const { error } = await supabase.from(t.name).insert(chunk);
      if (error) {
        throw new Error(
          `Restore failed at ${t.name}: ${error.message}. Data may be partially restored.`,
        );
      }
      rowsRestored += chunk.length;
      onProgress?.({
        table: t.name,
        action: 'inserting',
        rowsWritten: i + chunk.length,
      });
    }
  }

  return { rowsRestored };
}

// Local-only tracking of when the user last downloaded a backup, to drive the
// "you haven't backed up in a while" banner. Stored per-browser in
// localStorage — not synced across devices.
const LAST_BACKUP_KEY = 'command-center:last-backup-at';

export function recordBackupDownloaded() {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
  } catch {
    // ignore (private mode, etc.)
  }
}

export function getLastBackupAt(): Date | null {
  try {
    const v = localStorage.getItem(LAST_BACKUP_KEY);
    return v ? new Date(v) : null;
  } catch {
    return null;
  }
}

export function daysSinceLastBackup(): number | null {
  const last = getLastBackupAt();
  if (!last) return null;
  return Math.floor((Date.now() - last.getTime()) / (1000 * 60 * 60 * 24));
}
