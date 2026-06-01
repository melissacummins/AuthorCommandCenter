import { useCallback, useEffect, useState } from 'react';
import {
  connect as gConnect, disconnect as gDisconnect, isCalendarConfigured, wasConnected,
  listCalendars, listEvents, createEvent, updateEvent, deleteEvent,
  type GCalCalendar, type GCalEvent,
} from './google';

const SELECTED_KEY = 'planner-gcal-calendar';

// Thin React wrapper around the browser-only Google Calendar layer: tracks
// connection + the chosen calendar, and re-exposes the event CRUD helpers.
export function useGoogleCalendar() {
  const configured = isCalendarConfigured();
  // Start optimistically connected if we connected before, so navigating back
  // to the planner doesn't flash the "Connect Google Calendar" prompt while the
  // silent resume runs. loadCalendars() flips this back off if resume fails.
  const [connected, setConnected] = useState(() => configured && wasConnected());
  const [calendars, setCalendars] = useState<GCalCalendar[]>([]);
  const [calendarId, setCalendarId] = useState<string>(() => localStorage.getItem(SELECTED_KEY) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load the calendar list once we believe we're connected (validates the
  // session too — a failure means we need to re-consent).
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
      setError((e as Error).message);
    }
  }, []);

  // Resume a prior session silently on mount.
  useEffect(() => {
    if (configured && wasConnected()) loadCalendars();
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

  const disconnect = useCallback(() => {
    gDisconnect();
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
        setError((e as Error).message);
        return [];
      }
    },
    [connected, calendarId],
  );

  return {
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
