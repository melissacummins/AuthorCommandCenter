// Browser-only Google Calendar access.
//
// We use Google Identity Services (GIS) to get a short-lived OAuth access token
// in the browser, then call the Calendar REST API directly with it. There is no
// backend and no client secret — only a public OAuth *client id*, supplied as
// VITE_GOOGLE_CLIENT_ID. The trade-off is that sync only happens while the app
// is open (tokens live ~1 hour and are re-requested silently while the Google
// session is active).

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
// Full calendar scope so we can read every calendar (Business Tasks, Deadlines…)
// and create/update time-block events.
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const CONNECTED_KEY = 'planner-gcal-connected';
// Cache the short-lived access token for the tab session so navigating away
// from the planner (or a reload) resumes silently instead of re-prompting.
const TOKEN_KEY = 'planner-gcal-token';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

export function isCalendarConfigured(): boolean {
  return !!CLIENT_ID;
}

export function wasConnected(): boolean {
  return localStorage.getItem(CONNECTED_KEY) === '1';
}

// --- GIS script + token client -------------------------------------------

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<void>((resolve, reject) => {
    if ((window as AnyObj).google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

let tokenClient: AnyObj = null;
let accessToken: string | null = null;
let tokenExpiry = 0;

// Restore a still-valid token cached earlier this tab session, so a remount or
// reload doesn't trigger a fresh consent/popup.
try {
  const raw = sessionStorage.getItem(TOKEN_KEY);
  if (raw) {
    const { t, e } = JSON.parse(raw) as { t: string; e: number };
    if (t && e && Date.now() < e) { accessToken = t; tokenExpiry = e; }
  }
} catch { /* ignore malformed cache */ }

async function ensureTokenClient(): Promise<void> {
  if (!CLIENT_ID) throw new Error('Google Calendar isn’t configured yet.');
  await loadGis();
  if (!tokenClient) {
    tokenClient = (window as AnyObj).google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: () => {}, // replaced per-request below
    });
  }
}

// prompt='consent' forces the account picker / consent (first connect);
// prompt='' tries to refresh silently using the existing Google session.
function requestToken(prompt: '' | 'consent'): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // Wire up the per-request callbacks, then ask GIS for a token.
    const fire = () => {
      tokenClient.callback = (resp: AnyObj) => {
        if (resp.error) {
          reject(new Error(resp.error_description || resp.error));
          return;
        }
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + (resp.expires_in ?? 3600) * 1000 - 60_000;
        localStorage.setItem(CONNECTED_KEY, '1');
        try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ t: accessToken, e: tokenExpiry })); } catch { /* quota/private mode */ }
        resolve(accessToken!);
      };
      // Without this, a silent (prompt='') resume that actually needs the user
      // — expired Google session, revoked grant, blocked popup — fires GIS's
      // error path instead of `callback`, leaving the promise pending forever.
      // That hang is what left the planner stuck "connected" with no events and
      // no way to re-open the consent popup. Rejecting here lets the caller fall
      // back to showing the Connect button again.
      tokenClient.error_callback = (err: AnyObj) => {
        reject(new Error(err?.message || 'Google sign-in was cancelled or blocked.'));
      };
      tokenClient.requestAccessToken({ prompt });
    };

    // The consent popup is opened by GIS via window.open, which browsers only
    // allow inside the synchronous user-gesture call stack. If the token client
    // is already initialised (prepare() runs on planner mount), fire SYNCHRONOUSLY
    // here — `new Promise`'s executor runs synchronously, so this stays inside the
    // click handler and the popup isn't blocked. Only fall back to the async GIS
    // load when we weren't prepared in time.
    if (tokenClient) {
      try { fire(); } catch (e) { reject(e as Error); }
      return;
    }
    ensureTokenClient().then(fire).catch(reject);
  });
}

// True when we hold a still-valid access token cached earlier this tab session
// — i.e. we can call Calendar without any user-visible prompt.
export function hasValidToken(): boolean {
  return !!accessToken && Date.now() < tokenExpiry;
}

// Thrown when a Calendar call needs a token we don't have. Callers should fall
// back to the Connect button rather than forcing a prompt.
export class GCalNeedsReconnect extends Error {
  constructor() { super('Google Calendar needs to be reconnected.'); this.name = 'GCalNeedsReconnect'; }
}

// Non-interactive token accessor. Returns the cached token or signals that a
// reconnect is needed — it NEVER calls requestAccessToken. Only an explicit
// connect() (inside a user click) may open Google's popup. The old silent
// resume (requestToken('')) escalated to a *visible* consent popup on browsers
// that block third-party cookies, which reopened the popup on every refresh.
async function token(): Promise<string> {
  if (hasValidToken()) return accessToken!;
  throw new GCalNeedsReconnect();
}

// Warm up the GIS script + token client ahead of time so an explicit Connect
// click can open the consent popup synchronously within the user-gesture window,
// instead of awaiting a network script load (which browsers may treat as a lost
// gesture and block the popup). Safe to call repeatedly; failures are ignored.
export function prepare(): void {
  if (!CLIENT_ID) return;
  ensureTokenClient().catch(() => { /* surfaced later on an explicit connect */ });
}

export async function connect(): Promise<void> {
  await requestToken('consent');
}

export function disconnect(): void {
  const tok = accessToken;
  accessToken = null;
  tokenExpiry = 0;
  localStorage.removeItem(CONNECTED_KEY);
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  if (tok) (window as AnyObj).google?.accounts?.oauth2?.revoke?.(tok, () => {});
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
