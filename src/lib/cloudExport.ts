// Cloud export: send finished creatives (slide PNGs, screenshots, WebM
// videos) straight to the user's Google Drive or Dropbox.
//
// Both services follow the same backend OAuth pattern as the planner's
// Google Calendar integration (src/modules/planner/google.ts): the
// browser never sees a refresh token or client secret — it opens a
// consent popup, the serverless callback stores an encrypted refresh
// token, and the browser mints short-lived access tokens on demand via
// /api/google/token and /api/dropbox/token.
//
// Uploads go DIRECTLY from the browser to the provider's upload API with
// that short-lived token. Routing file bytes through our own serverless
// functions would hit Vercel's ~4.5 MB request-body limit, which a WebM
// video blows straight past; browser-direct uploads have no such cap.
//
// Google uses the drive.file scope only: the app can see and touch ONLY
// files and folders it created itself. That scope is non-sensitive, so
// the OAuth app works for any user without Google's verification review
// (the wall the broader Calendar scope hit).

import { supabase } from './supabase';

export type CloudService = 'drive' | 'dropbox';

// Everything we export lands in (or under) a folder with this name so
// users always know where to look.
export const CLOUD_FOLDER_NAME = 'Author Command Center';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  return { Authorization: `Bearer ${token}` };
}

// --- Short-lived provider access-token cache (per tab session) -------------

interface CachedToken { t: string; e: number }

const tokenCache: Partial<Record<CloudService, CachedToken>> = {};

function cacheKey(service: CloudService): string {
  return `cloud-export-token-${service}`;
}

function getCachedToken(service: CloudService): string | null {
  let entry = tokenCache[service];
  if (!entry) {
    try {
      const raw = sessionStorage.getItem(cacheKey(service));
      if (raw) entry = JSON.parse(raw) as CachedToken;
    } catch { /* ignore malformed cache */ }
  }
  if (entry && entry.t && Date.now() < entry.e) {
    tokenCache[service] = entry;
    return entry.t;
  }
  return null;
}

function cacheToken(service: CloudService, token: string, expiresInSec: number): void {
  // Refresh a minute early to avoid using a token that expires mid-upload.
  const entry: CachedToken = { t: token, e: Date.now() + expiresInSec * 1000 - 60_000 };
  tokenCache[service] = entry;
  try { sessionStorage.setItem(cacheKey(service), JSON.stringify(entry)); } catch { /* quota/private mode */ }
}

function clearTokenCache(service: CloudService): void {
  delete tokenCache[service];
  try { sessionStorage.removeItem(cacheKey(service)); } catch { /* ignore */ }
}

// --- Status probes ----------------------------------------------------------

export interface CloudStatus {
  connected: boolean;
  email: string | null;
}

interface GoogleTokenResponse {
  connected: boolean;
  access_token?: string;
  expires_in?: number;
  google_email?: string | null;
  scopes?: string | null;
  error?: string;
}

interface DropboxTokenResponse {
  connected: boolean;
  access_token?: string;
  expires_in?: number;
  dropbox_email?: string | null;
  error?: string;
}

// The Google row is shared with the Calendar integration, so "a row
// exists" isn't enough — Drive is only usable if the grant actually
// includes drive.file.
async function fetchGoogleToken(): Promise<GoogleTokenResponse & { driveReady: boolean }> {
  const headers = await authHeader();
  const res = await fetch('/api/google/token', { method: 'POST', headers });
  const data = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!res.ok) throw new Error(data.error || `Google token request failed (${res.status}).`);
  const driveReady = !!data.connected && !!data.access_token && (data.scopes ?? '').includes(DRIVE_SCOPE);
  if (driveReady) cacheToken('drive', data.access_token!, data.expires_in ?? 3600);
  return { ...data, driveReady };
}

async function fetchDropboxToken(): Promise<DropboxTokenResponse> {
  const headers = await authHeader();
  const res = await fetch('/api/dropbox/token', { method: 'POST', headers });
  const data = (await res.json().catch(() => ({}))) as DropboxTokenResponse;
  if (!res.ok) throw new Error(data.error || `Dropbox token request failed (${res.status}).`);
  if (data.connected && data.access_token) cacheToken('dropbox', data.access_token, data.expires_in ?? 14400);
  return data;
}

export async function getDriveStatus(): Promise<CloudStatus> {
  const data = await fetchGoogleToken();
  return { connected: data.driveReady, email: data.google_email ?? null };
}

export async function getDropboxStatus(): Promise<CloudStatus> {
  const data = await fetchDropboxToken();
  return { connected: data.connected, email: data.dropbox_email ?? null };
}

// --- Connect / disconnect ---------------------------------------------------

// Opens a provider consent popup and resolves once the OAuth callback
// postMessages back. Must be called inside a user gesture so the popup
// isn't blocked.
async function connectViaPopup(startUrl: string, body: unknown, messageType: string, windowName: string): Promise<void> {
  const headers = await authHeader();
  const res = await fetch(startUrl, {
    method: 'POST',
    headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { authorize_url?: string; error?: string };
  if (!res.ok || !data.authorize_url) {
    throw new Error(data.error || `Failed to start OAuth (${res.status}).`);
  }

  const width = 500;
  const height = 640;
  const left = Math.max(0, Math.round((window.screen.width - width) / 2));
  const top = Math.max(0, Math.round((window.screen.height - height) / 2));
  const popup = window.open(data.authorize_url, windowName, `width=${width},height=${height},left=${left},top=${top}`);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearInterval(poll);
      fn();
    };

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const d = event.data as { type?: string; ok?: boolean; error?: string } | undefined;
      if (d?.type !== messageType) return;
      if (d.ok) finish(resolve);
      else finish(() => reject(new Error(d.error || 'Connection failed.')));
    }

    // If the popup is closed before posting a message, give up cleanly.
    const poll = window.setInterval(() => {
      if (popup && popup.closed) {
        finish(() => reject(new Error('Connection window closed before finishing.')));
      }
    }, 500);

    window.addEventListener('message', onMessage);
  });
}

export async function connectDrive(): Promise<void> {
  clearTokenCache('drive');
  await connectViaPopup('/api/google/oauth-start', { service: 'drive' }, 'gcal-oauth', 'gdrive-oauth');
}

export async function connectDropbox(): Promise<void> {
  clearTokenCache('dropbox');
  await connectViaPopup('/api/dropbox/start', null, 'dropbox-oauth', 'dropbox-oauth');
}

// NOTE: this tears down the whole Google connection (the row is shared),
// so Calendar disconnects too. The Settings UI says so.
export async function disconnectGoogle(): Promise<void> {
  clearTokenCache('drive');
  try {
    const headers = await authHeader();
    await fetch('/api/google/disconnect', { method: 'POST', headers });
  } catch { /* best-effort; cache already cleared */ }
}

export async function disconnectDropbox(): Promise<void> {
  clearTokenCache('dropbox');
  try {
    const headers = await authHeader();
    await fetch('/api/dropbox/disconnect', { method: 'POST', headers });
  } catch { /* best-effort; cache already cleared */ }
}

// --- Provider tokens (non-interactive) --------------------------------------

export class CloudNeedsConnect extends Error {
  service: CloudService;
  constructor(service: CloudService) {
    super(service === 'drive'
      ? 'Google Drive isn\'t connected yet. Connect it in Settings → Cloud export.'
      : 'Dropbox isn\'t connected yet. Connect it in Settings → Cloud export.');
    this.name = 'CloudNeedsConnect';
    this.service = service;
  }
}

async function driveToken(): Promise<string> {
  const cached = getCachedToken('drive');
  if (cached) return cached;
  const data = await fetchGoogleToken();
  if (!data.driveReady) throw new CloudNeedsConnect('drive');
  return data.access_token!;
}

async function dropboxToken(): Promise<string> {
  const cached = getCachedToken('dropbox');
  if (cached) return cached;
  const data = await fetchDropboxToken();
  if (!data.connected || !data.access_token) throw new CloudNeedsConnect('dropbox');
  return data.access_token;
}

// --- Google Drive upload -----------------------------------------------------

// The drive.file scope only lets us see folders WE created, so this
// find-or-create converges on a single app folder per account. Cache the
// id for the tab session to skip the lookup on repeat exports.
let driveFolderId: string | null = null;

async function ensureDriveFolder(token: string): Promise<string> {
  if (driveFolderId) return driveFolderId;

  const q = encodeURIComponent(
    `name = '${CLOUD_FOLDER_NAME.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const findRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (findRes.ok) {
    const found = (await findRes.json().catch(() => ({}))) as { files?: Array<{ id: string }> };
    if (found.files?.[0]?.id) {
      driveFolderId = found.files[0].id;
      return driveFolderId;
    }
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: CLOUD_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => '');
    throw new Error(`Couldn't create the Drive folder (${createRes.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const created = (await createRes.json()) as { id: string };
  driveFolderId = created.id;
  return driveFolderId;
}

export interface CloudUploadResult {
  // A link the user can open to see the uploaded file, when the provider
  // returns one.
  link: string | null;
}

// Multipart upload: metadata JSON part + file bytes part in one request.
// Fine for our sizes (PNGs are ~1–3 MB; WebM videos tens of MB — well
// under the 5 GB multipart cap).
export async function uploadToDrive(blob: Blob, filename: string): Promise<CloudUploadResult> {
  const token = await driveToken();
  const folderId = await ensureDriveFolder(token);

  const metadata = {
    name: filename,
    parents: [folderId],
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    if (res.status === 401) clearTokenCache('drive');
    const body = await res.text().catch(() => '');
    throw new Error(`Drive upload failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const json = (await res.json().catch(() => ({}))) as { webViewLink?: string };
  return { link: json.webViewLink ?? null };
}

// --- Dropbox upload ----------------------------------------------------------

// Single-call upload (cap 150 MB — far above anything we export). With
// the recommended "App folder" access type this lands in
// Apps/<your app>/Author Command Center/.
export async function uploadToDropbox(blob: Blob, filename: string): Promise<CloudUploadResult> {
  const token = await dropboxToken();

  const apiArg = {
    path: `/${CLOUD_FOLDER_NAME}/${filename}`,
    mode: 'add',
    autorename: true,
    mute: true,
  };
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      // Dropbox-API-Arg must be ASCII-safe; escape non-ASCII per their spec.
      'Dropbox-API-Arg': JSON.stringify(apiArg).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`),
      'Content-Type': 'application/octet-stream',
    },
    body: blob,
  });
  if (!res.ok) {
    if (res.status === 401) clearTokenCache('dropbox');
    const body = await res.text().catch(() => '');
    throw new Error(`Dropbox upload failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  // files/upload returns metadata but no browsable link; the folder path
  // is stable, so that's what the UI shows.
  return { link: null };
}

// --- Unified entry point ------------------------------------------------------

export const SERVICE_LABELS: Record<CloudService, string> = {
  drive: 'Google Drive',
  dropbox: 'Dropbox',
};

export async function uploadToCloud(service: CloudService, blob: Blob, filename: string): Promise<CloudUploadResult> {
  return service === 'drive' ? uploadToDrive(blob, filename) : uploadToDropbox(blob, filename);
}

// --- Nested-folder backup uploads -------------------------------------------
//
// The backup system writes a whole tree per run —
//   Author Command Center/Backups/backup_<timestamp>/
//     data.json
//     manifest.json
//     files/<bucket>/<path…>
// — so it needs uploads into arbitrary subfolders, not just the flat app
// folder the creative export uses. A "destination" is opened once per run
// (resolving/creating the dated folder) and reused for every file.

const BACKUPS_FOLDER_NAME = 'Backups';

interface DriveBackupDest {
  service: 'drive';
  // Cache of "a/b/c" relative path → Drive folder id, seeded with '' → the
  // run's root folder. Drive folders are id-addressed, so we resolve each
  // subfolder once and reuse it.
  folderCache: Map<string, string>;
}

interface DropboxBackupDest {
  service: 'dropbox';
  basePath: string; // e.g. /Author Command Center/Backups/backup_<ts>
}

export type CloudBackupDest = DriveBackupDest | DropboxBackupDest;

async function ensureDriveSubfolder(token: string, parentId: string, name: string): Promise<string> {
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const findRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (findRes.ok) {
    const found = (await findRes.json().catch(() => ({}))) as { files?: Array<{ id: string }> };
    if (found.files?.[0]?.id) return found.files[0].id;
  }
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => '');
    throw new Error(`Couldn't create Drive folder "${name}" (${createRes.status})${body ? `: ${body.slice(0, 160)}` : ''}`);
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

// Opens (creating as needed) the dated run folder for this backup and returns
// a reusable destination handle. `stamp` should be filesystem-safe.
export async function openCloudBackup(service: CloudService, stamp: string): Promise<CloudBackupDest> {
  if (service === 'dropbox') {
    await dropboxToken(); // surface a not-connected error early
    return { service: 'dropbox', basePath: `/${CLOUD_FOLDER_NAME}/${BACKUPS_FOLDER_NAME}/backup_${stamp}` };
  }
  const token = await driveToken();
  const appFolder = await ensureDriveFolder(token);
  const backups = await ensureDriveSubfolder(token, appFolder, BACKUPS_FOLDER_NAME);
  const runFolder = await ensureDriveSubfolder(token, backups, `backup_${stamp}`);
  const cache = new Map<string, string>();
  cache.set('', runFolder);
  return { service: 'drive', folderCache: cache };
}

async function resolveDriveDir(token: string, dest: DriveBackupDest, segments: string[]): Promise<string> {
  const key = segments.join('/');
  const cached = dest.folderCache.get(key);
  if (cached) return cached;
  // Walk down from the run root, creating (and caching) each missing segment.
  let parentId = dest.folderCache.get('')!;
  const acc: string[] = [];
  for (const seg of segments) {
    acc.push(seg);
    const k = acc.join('/');
    let id = dest.folderCache.get(k);
    if (!id) {
      id = await ensureDriveSubfolder(token, parentId, seg);
      dest.folderCache.set(k, id);
    }
    parentId = id;
  }
  return parentId;
}

// Uploads one file into the run folder at the given relative directory
// (segments) under `filename`. Reuses the short-lived token cache.
export async function uploadToCloudBackup(
  dest: CloudBackupDest,
  blob: Blob,
  dirSegments: string[],
  filename: string,
): Promise<void> {
  const dirs = dirSegments.filter(Boolean);
  if (dest.service === 'dropbox') {
    const token = await dropboxToken();
    const path = [dest.basePath, ...dirs, filename].join('/');
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
      if (res.status === 401) clearTokenCache('dropbox');
      const body = await res.text().catch(() => '');
      throw new Error(`Dropbox upload failed (${res.status})${body ? `: ${body.slice(0, 160)}` : ''}`);
    }
    return;
  }

  const token = await driveToken();
  const folderId = await resolveDriveDir(token, dest, dirs);
  const metadata = { name: filename, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    if (res.status === 401) clearTokenCache('drive');
    const body = await res.text().catch(() => '');
    throw new Error(`Drive upload failed (${res.status})${body ? `: ${body.slice(0, 160)}` : ''}`);
  }
}

// A stable, filesystem-safe timestamp for a backup run, e.g.
// 2026-07-21_1530. Callers pass this to openCloudBackup and reuse it in
// status messages.
export function backupStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
