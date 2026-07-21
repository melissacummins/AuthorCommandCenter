// Scheduled, unattended backup — runs on a Vercel Cron (see vercel.json).
//
// WHAT IT DOES: for every user who has connected Dropbox and/or Google Drive,
// reads all their user-scoped tables with the service role and writes a dated
// data.json + manifest.json into
//   Author Command Center/Backups/backup_<stamp>/
// in each connected cloud — the same folder shape the in-app "Back up to
// cloud" button produces.
//
// WHY DATABASE-ONLY: this runs inside a serverless function with a hard
// execution limit. Table rows serialize in well under a second; downloading
// and re-uploading hundreds of MB of Storage files (audiobook audio, media)
// would blow past that limit and time out. So the cron guarantees a fresh
// daily copy of the irreplaceable typed data, and the in-app button (which
// runs in the browser with no timeout) captures the full rows + files set.
//
// SECURITY: Vercel sends `Authorization: Bearer <CRON_SECRET>` to cron
// invocations when CRON_SECRET is configured. We reject anything else, so the
// endpoint can't be triggered by outsiders.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GOOGLE_TOKEN_ENCRYPTION_SECRET   — master secret, ≥ 32 chars (shared)
//   CRON_SECRET                      — Vercel Cron auth (set in Vercel)
//   DROPBOX_APP_KEY, DROPBOX_APP_SECRET            — for Dropbox uploads
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET         — for Drive uploads

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDecipheriv, scryptSync, timingSafeEqual } from 'node:crypto';
import { BACKUP_TABLES, BACKUP_SCHEMA_VERSION } from '../../src/modules/settings/tables';

// Give the function room; DB-only work finishes fast, but many tables × users
// benefits from headroom on plans that allow it.
export const config = { maxDuration: 60 };

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};
type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
};

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CLOUD_FOLDER_NAME = 'Author Command Center';
const PAGE_SIZE = 1000;

function header(req: VercelRequest, name: string): string | null {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v ?? null;
}

function bearer(req: VercelRequest): string | null {
  const v = header(req, 'authorization');
  if (!v || !v.toLowerCase().startsWith('bearer ')) return null;
  return v.slice(7);
}

function decrypt(salt: string, encrypted: string, nonce: string, authTag: string, masterSecret: string): string {
  const key = scryptSync(masterSecret, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}

function stampNow(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

interface Env {
  supabaseUrl: string;
  serviceKey: string;
  masterSecret: string;
  cronSecret: string;
  dropboxAppKey?: string;
  dropboxAppSecret?: string;
  googleClientId?: string;
  googleClientSecret?: string;
}

function loadEnv(): Env | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const masterSecret = process.env.GOOGLE_TOKEN_ENCRYPTION_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  if (!supabaseUrl || !serviceKey || !masterSecret || masterSecret.length < 32 || !cronSecret) return null;
  return {
    supabaseUrl,
    serviceKey,
    masterSecret,
    cronSecret,
    dropboxAppKey: process.env.DROPBOX_APP_KEY,
    dropboxAppSecret: process.env.DROPBOX_APP_SECRET,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}

// --- Provider access tokens (minted from stored refresh tokens) -------------

async function mintDropboxToken(refreshToken: string, appKey: string, appSecret: string): Promise<string | null> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: appKey,
    client_secret: appSecret,
  });
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string };
  return res.ok && json.access_token ? json.access_token : null;
}

async function mintGoogleToken(refreshToken: string, clientId: string, clientSecret: string): Promise<{ token: string; scope: string } | null> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; scope?: string };
  if (!res.ok || !json.access_token) return null;
  return { token: json.access_token, scope: json.scope ?? '' };
}

// --- Uploads ----------------------------------------------------------------

async function dropboxUpload(token: string, path: string, blob: Blob): Promise<void> {
  const apiArg = { path, mode: 'add', autorename: true, mute: true };
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify(apiArg).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`),
      'Content-Type': 'application/octet-stream',
    },
    body: blob,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Dropbox upload failed (${res.status})${body ? `: ${body.slice(0, 160)}` : ''}`);
  }
}

async function driveEnsureFolder(token: string, name: string, parentId: string | null): Promise<string> {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentClause}`,
  );
  const findRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (findRes.ok) {
    const found = (await findRes.json().catch(() => ({}))) as { files?: Array<{ id: string }> };
    if (found.files?.[0]?.id) return found.files[0].id;
  }
  const body: Record<string, unknown> = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!createRes.ok) {
    const b = await createRes.text().catch(() => '');
    throw new Error(`Drive folder "${name}" failed (${createRes.status})${b ? `: ${b.slice(0, 160)}` : ''}`);
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

async function driveUpload(token: string, folderId: string, filename: string, blob: Blob): Promise<void> {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name: filename, parents: [folderId] })], { type: 'application/json' }));
  form.append('file', blob);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Drive upload failed (${res.status})${body ? `: ${body.slice(0, 160)}` : ''}`);
  }
}

// --- Backup one user --------------------------------------------------------

interface Row { [k: string]: unknown }

async function readUserTables(supabase: SupabaseClient, userId: string): Promise<{ tables: Record<string, Row[]>; totalRows: number }> {
  const tables: Record<string, Row[]> = {};
  let totalRows = 0;
  for (const t of BACKUP_TABLES) {
    const all: Row[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await supabase.from(t.name).select('*').eq('user_id', userId).range(from, from + PAGE_SIZE - 1);
      if (error) break; // table missing in this deploy — skip, keep going
      if (!data || data.length === 0) break;
      all.push(...(data as Row[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    tables[t.name] = all;
    totalRows += all.length;
  }
  return { tables, totalRows };
}

interface UserResult {
  user_id: string;
  providers: string[];
  total_rows: number;
  errors: string[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const env = loadEnv();
  if (!env) {
    res.status(500).json({ error: 'Service not configured (need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_TOKEN_ENCRYPTION_SECRET ≥ 32 chars, CRON_SECRET)' });
    return;
  }

  // Verify the caller is Vercel Cron (or someone holding CRON_SECRET).
  const provided = bearer(req);
  const expected = env.cronSecret;
  const ok = !!provided
    && provided.length === expected.length
    && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const supabase = createClient(env.supabaseUrl, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = stampNow(new Date());
  const exportedAt = new Date().toISOString();

  // Collect the union of users who have connected either cloud.
  const [{ data: dbxRows }, { data: googRows }] = await Promise.all([
    supabase.from('user_dropbox_tokens').select('user_id, encrypted_refresh_token, refresh_token_nonce, refresh_token_auth_tag'),
    supabase.from('user_google_tokens').select('user_id, encrypted_refresh_token, refresh_token_nonce, refresh_token_auth_tag'),
  ]);
  const dbxByUser = new Map((dbxRows ?? []).map((r: any) => [r.user_id, r]));
  const googByUser = new Map((googRows ?? []).map((r: any) => [r.user_id, r]));
  const userIds = new Set<string>([...dbxByUser.keys(), ...googByUser.keys()]);

  const results: UserResult[] = [];

  for (const userId of userIds) {
    const result: UserResult = { user_id: userId, providers: [], total_rows: 0, errors: [] };
    try {
      const { tables, totalRows } = await readUserTables(supabase, userId);
      result.total_rows = totalRows;

      const dataBlob = new Blob([JSON.stringify({ schema_version: BACKUP_SCHEMA_VERSION, exported_at: exportedAt, user_id: userId, tables })], { type: 'application/json' });
      const manifest = {
        schema_version: BACKUP_SCHEMA_VERSION,
        exported_at: exportedAt,
        stamp,
        user_id: userId,
        source: 'cron' as const,
        total_rows: totalRows,
        note: 'Database rows only. Storage files are captured by the in-app "Back up to cloud" button.',
      };
      const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });

      // Dropbox
      const dbx = dbxByUser.get(userId);
      if (dbx && env.dropboxAppKey && env.dropboxAppSecret) {
        try {
          const refresh = decrypt('dropbox-token-key-v1', dbx.encrypted_refresh_token, dbx.refresh_token_nonce, dbx.refresh_token_auth_tag, env.masterSecret);
          const token = await mintDropboxToken(refresh, env.dropboxAppKey, env.dropboxAppSecret);
          if (token) {
            const base = `/${CLOUD_FOLDER_NAME}/Backups/backup_${stamp}`;
            await dropboxUpload(token, `${base}/data.json`, dataBlob);
            await dropboxUpload(token, `${base}/manifest.json`, manifestBlob);
            result.providers.push('dropbox');
          } else {
            result.errors.push('dropbox: token refresh failed');
          }
        } catch (err) {
          result.errors.push(`dropbox: ${(err as Error).message}`);
        }
      }

      // Google Drive (only if the grant actually includes drive.file)
      const goog = googByUser.get(userId);
      if (goog && env.googleClientId && env.googleClientSecret) {
        try {
          const refresh = decrypt('google-token-key-v1', goog.encrypted_refresh_token, goog.refresh_token_nonce, goog.refresh_token_auth_tag, env.masterSecret);
          const minted = await mintGoogleToken(refresh, env.googleClientId, env.googleClientSecret);
          if (minted && minted.scope.includes(DRIVE_SCOPE)) {
            const appFolder = await driveEnsureFolder(minted.token, CLOUD_FOLDER_NAME, null);
            const backupsFolder = await driveEnsureFolder(minted.token, 'Backups', appFolder);
            const runFolder = await driveEnsureFolder(minted.token, `backup_${stamp}`, backupsFolder);
            await driveUpload(minted.token, runFolder, 'data.json', dataBlob);
            await driveUpload(minted.token, runFolder, 'manifest.json', manifestBlob);
            result.providers.push('drive');
          } else if (minted) {
            // Connected for Calendar but not Drive — nothing to do.
          } else {
            result.errors.push('drive: token refresh failed');
          }
        } catch (err) {
          result.errors.push(`drive: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      result.errors.push((err as Error).message);
    }
    results.push(result);
  }

  res.status(200).json({
    ok: true,
    stamp,
    users_backed_up: results.filter((r) => r.providers.length > 0).length,
    results,
  });
}
