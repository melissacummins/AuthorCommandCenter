import { useCallback, useEffect, useState } from 'react';
import {
  connect as gConnect, disconnect as gDisconnect, isCalendarConfigured, wasConnected,
  getStatus, GCalNeedsReconnect,
  listCalendars, listEvents, createEvent, updateEvent, deleteEvent,
  type GCalCalendar, type GCalEvent,
} from './google';

const SELECTED_KEY = 'planner-gcal-calendar';

// Thin React wrapper around the backend-OAuth Google Calendar layer:
// tracks connection + the chosen calendar, and re-exposes the event CRUD
// helpers. Access tokens are minted server-side from a stored refresh
// token, so we never prompt on mount and never silently unlink.
export function useGoogleCalendar(enabled = true) {
  // Owner-only: the Calendar feature uses a sensitive Google OAuth scope that
  // would require Google app verification to offer to external customers, so we
  // keep it admin-only. When disabled the hook reports unavailable and the
  // planner shows no calendar UI at all.
  const available = enabled;
  const configured = enabled && isCalendarConfigured();
  // Optimistically render connected if we connected before; getStatus()
  // on mount confirms (and flips us off cleanly if the grant was revoked).
  const [connected, setConnected] = useState(() => configured && wasConnected());
  const [calendars, setCalendars] = useState<GCalCalendar[]>([]);
  const [calendarId, setCalendarId] = useState<string>(() => localStorage.getItem(SELECTED_KEY) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load the calendar list once we believe we're connected.
  const loadCalendars = useCallback(async () => {
    try {
      const cals = await listCalendars();
      setCalendars(cals);
      setConnected(true);
      setCalendarId(prev => {
        if (prev && cals.some(c => c.id === prev)) return prev;
        const primary = cals.find(c => c.primary) ?? cals[0];
        const next = primary?.id ?? '';
        if (next) localStorage.setItem(SELECTED_KEY, next);
        return next;
      });
    } catch (e) {
      setConnected(false);
      if (!(e instanceof GCalNeedsReconnect)) setError((e as Error).message);
    }
  }, []);

  // On mount, ask the backend whether we're connected (mints + caches an
  // access token if so), then load calendars. No popup, no GIS.
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    (async () => {
      try {
        const { connected: isConnected } = await getStatus();
        if (cancelled) return;
        setConnected(isConnected);
        if (isConnected) await loadCalendars();
      } catch {
        if (!cancelled) setConnected(false);
      }
    })();
    return () => { cancelled = true; };
  }, [configured, loadCalendars]);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await gConnect();
      await loadCalendars();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [loadCalendars]);

  const disconnect = useCallback(async () => {
    await gDisconnect();
    setConnected(false);
    setCalendars([]);
  }, []);

  const chooseCalendar = useCallback((id: string) => {
    setCalendarId(id);
    localStorage.setItem(SELECTED_KEY, id);
  }, []);

  const fetchEvents = useCallback(
    async (timeMin: string, timeMax: string): Promise<GCalEvent[]> => {
      if (!connected || !calendarId) return [];
      try {
        return await listEvents(calendarId, timeMin, timeMax);
      } catch (e) {
        // Grant lapsed mid-session — drop to the Connect button instead of
        // surfacing a raw error or forcing a popup.
        if (e instanceof GCalNeedsReconnect) setConnected(false);
        else setError((e as Error).message);
        return [];
      }
    },
    [connected, calendarId],
  );

  return {
    available,
    configured,
    connected,
    busy,
    error,
    setError,
    calendars,
    calendarId,
    chooseCalendar,
    connect,
    disconnect,
    fetchEvents,
    createEvent: (input: { summary: string; start: string; end: string; reminderMinutes?: number }) =>
      createEvent(calendarId, input),
    updateEvent: (eventId: string, patch: { summary?: string; start?: string; end?: string }) =>
      updateEvent(calendarId, eventId, patch),
    deleteEvent: (eventId: string) => deleteEvent(calendarId, eventId),
  };
}

export type UseGoogleCalendar = ReturnType<typeof useGoogleCalendar>;
