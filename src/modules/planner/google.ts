// Google Calendar access via a backend OAuth flow with a refresh token.
//
// The browser never sees the refresh token or the client secret. Instead:
//   - connect() opens a popup to /api/google/oauth-start's authorize_url;
//     the callback stores an ENCRYPTED refresh token server-side and
//     postMessages back to us.
//   - token() POSTs /api/google/token, which decrypts the refresh token
//     server-side and mints a fresh short-lived ACCESS token. That access
//     token is all the browser ever holds, cached for the tab session.
//
// This replaces the old browser-only GIS flow: the integration never
// silently unlinks and never re-prompts (the refresh token persists).
// The Calendar REST functions below are unchanged — they just get their
// access token from the backend now.

import { supabase } from '../../lib/supabase';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const CONNECTED_KEY = 'planner-gcal-connected';
// Cache the short-lived access token for the tab session so navigating
// away from the planner (or a reload) resumes silently without a popup.
const TOKEN_KEY = 'planner-gcal-token';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  return { Authorization: `Bearer ${token}` };
}

export function isCalendarConfigured(): boolean {
  // The real config check is server-side; we only gate the Connect UI on
  // the public client id being present.
  return !!CLIENT_ID;
}

export function wasConnected(): boolean {
  return localStorage.getItem(CONNECTED_KEY) === '1';
}

function setWasConnected(v: boolean): void {
  if (v) localStorage.setItem(CONNECTED_KEY, '1');
  else localStorage.removeItem(CONNECTED_KEY);
}

// --- Access-token cache ----------------------------------------------------

let accessToken: string | null = null;
let tokenExpiry = 0;

// Restore a still-valid access token cached earlier this tab session.
try {
  const raw = sessionStorage.getItem(TOKEN_KEY);
  if (raw) {
    const { t, e } = JSON.parse(raw) as { t: string; e: number };
    if (t && e && Date.now() < e) { accessToken = t; tokenExpiry = e; }
  }
} catch { /* ignore malformed cache */ }

function cacheToken(tok: string, expiresInSec: number): void {
  accessToken = tok;
  // Refresh a minute early to avoid using a token that expires mid-flight.
  tokenExpiry = Date.now() + expiresInSec * 1000 - 60_000;
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ t: accessToken, e: tokenExpiry })); } catch { /* quota/private mode */ }
}

function clearTokenCache(): void {
  accessToken = null;
  tokenExpiry = 0;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

function hasValidToken(): boolean {
  return !!accessToken && Date.now() < tokenExpiry;
}

// Thrown when a Calendar call needs a token we can't mint (no stored
// connection). Callers fall back to the Connect button rather than
// forcing a prompt.
export class GCalNeedsReconnect extends Error {
  constructor() { super('Google Calendar needs to be reconnected.'); this.name = 'GCalNeedsReconnect'; }
}

interface TokenResponse {
  connected: boolean;
  access_token?: string;
  expires_in?: number;
  google_email?: string | null;
}

// POST /api/google/token — mint (or status-check) an access token.
async function fetchToken(): Promise<TokenResponse> {
  const headers = await authHeader();
  const res = await fetch('/api/google/token', { method: 'POST', headers });
  const data = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string };
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Token request failed (${res.status}).`);
  }
  if (data.connected && data.access_token) {
    cacheToken(data.access_token, data.expires_in ?? 3600);
    setWasConnected(true);
  }
  return data;
}

// Non-interactive token accessor. Returns the cached access token if
// valid, else mints a fresh one via the backend. NEVER opens a popup.
async function token(): Promise<string> {
  if (hasValidToken()) return accessToken!;
  const res = await fetchToken();
  if (!res.connected || !res.access_token) {
    setWasConnected(false);
    throw new GCalNeedsReconnect();
  }
  return res.access_token;
}

// Connection-status probe used on mount: tells us whether we're connected
// (and caches the access token) without ever prompting.
export async function getStatus(): Promise<{ connected: boolean; google_email?: string | null }> {
  const res = await fetchToken();
  setWasConnected(res.connected);
  return { connected: res.connected, google_email: res.google_email ?? null };
}

// --- Connect / disconnect --------------------------------------------------

interface OAuthStartResponse { authorize_url: string }

// Opens the Google consent popup and resolves once the callback posts
// back { type:'gcal-oauth', ok:true }. Must be called inside a user
// gesture so the popup isn't blocked.
export async function connect(): Promise<void> {
  const headers = await authHeader();
  const res = await fetch('/api/google/oauth-start', { method: 'POST', headers });
  const data = (await res.json().catch(() => ({}))) as OAuthStartResponse & { error?: string };
  if (!res.ok || !data.authorize_url) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Failed to start OAuth (${res.status}).`);
  }

  const width = 500;
  const height = 640;
  const left = Math.max(0, Math.round((window.screen.width - width) / 2));
  const top = Math.max(0, Math.round((window.screen.height - height) / 2));
  const popup = window.open(
    data.authorize_url,
    'gcal-oauth',
    `width=${width},height=${height},left=${left},top=${top}`,
  );

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
      if (d?.type !== 'gcal-oauth') return;
      if (d.ok) {
        setWasConnected(true);
        finish(resolve);
      } else {
        finish(() => reject(new Error(d.error || 'Google connection failed.')));
      }
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

export async function disconnect(): Promise<void> {
  clearTokenCache();
  setWasConnected(false);
  try {
    const headers = await authHeader();
    await fetch('/api/google/disconnect', { method: 'POST', headers });
  } catch { /* best-effort; cache already cleared */ }
}

// --- Calendar REST API ----------------------------------------------------

async function api(path: string, init?: RequestInit): Promise<AnyObj> {
  const tok = await token();
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Calendar error ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  return res.status === 204 ? null : res.json();
}

export interface GCalCalendar {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
  accessRole?: string;
}

export interface GCalEvent {
  id: string;
  summary?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  colorId?: string;
}

export async function listCalendars(): Promise<GCalCalendar[]> {
  const data = await api('/users/me/calendarList?minAccessRole=reader');
  return (data.items ?? []) as GCalCalendar[];
}

export async function listEvents(calendarId: string, timeMin: string, timeMax: string): Promise<GCalEvent[]> {
  const q = new URLSearchParams({
    timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '100',
  });
  const data = await api(`/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
  return (data.items ?? []) as GCalEvent[];
}

// Create a timed time-block event with a popup reminder so Google notifies you.
export async function createEvent(
  calendarId: string,
  input: { summary: string; start: string; end: string; reminderMinutes?: number },
): Promise<GCalEvent> {
  const body: AnyObj = {
    summary: input.summary,
    start: { dateTime: input.start },
    end: { dateTime: input.end },
  };
  if (input.reminderMinutes != null) {
    body.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: input.reminderMinutes }] };
  }
  return api(`/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', body: JSON.stringify(body) });
}

export async function updateEvent(
  calendarId: string,
  eventId: string,
  patch: { summary?: string; start?: string; end?: string },
): Promise<GCalEvent> {
  const body: AnyObj = {};
  if (patch.summary != null) body.summary = patch.summary;
  if (patch.start) body.start = { dateTime: patch.start };
  if (patch.end) body.end = { dateTime: patch.end };
  return api(`/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  await api(`/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, { method: 'DELETE' });
}
