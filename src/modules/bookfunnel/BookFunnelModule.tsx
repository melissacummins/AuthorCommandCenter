import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UserPlus, Copy, Check, Loader2, Mail, FileText, BookOpen, ChevronDown, ChevronRight,
  Trash2, BellRing, CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  deleteEvent, getOrCreateWebhookSecret, listEvents, markAllHandled, setHandled,
  type BookFunnelEvent,
} from './api';

export default function BookFunnelModule() {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const [secret, setSecret] = useState<string | null>(null);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [events, setEvents] = useState<BookFunnelEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Load (or lazily create) the per-user webhook secret on mount.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    getOrCreateWebhookSecret()
      .then(s => { if (alive) setSecret(s); })
      .catch(e => { if (alive) setSecretError(e instanceof Error ? e.message : 'Failed to load webhook URL'); });
    return () => { alive = false; };
  }, [user]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listEvents();
      setEvents(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load subscribers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    reload();
  }, [user, reload]);

  // Path-based (…/<user>/<secret>) — BookFunnel drops query strings on send.
  const webhookUrl = secret
    ? `${window.location.origin}/api/bookfunnel/${userId}/${secret}`
    : '';

  const unhandledCount = useMemo(() => events.filter(e => !e.handled).length, [events]);

  async function copyUrl() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore — some browsers block clipboard without a user gesture
    }
  }

  async function handleToggle(ev: BookFunnelEvent) {
    // Optimistic flip; reload from the server reconciles on failure.
    setEvents(prev => prev.map(e => (e.id === ev.id ? { ...e, handled: !e.handled } : e)));
    try {
      await setHandled(ev.id, !ev.handled);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
      reload();
    }
  }

  async function handleMarkAll() {
    setBusy(true);
    try {
      await markAllHandled();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark all handled');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setEvents(prev => prev.filter(e => e.id !== id));
    try {
      await deleteEvent(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
      reload();
    }
  }

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <UserPlus className="w-6 h-6 text-pink-500" /> BookFunnel
        </h1>
        <p className="text-slate-500 mt-1 text-sm">
          Capture every newsletter opt-in from your BookFunnel reader magnets, so you
          never miss a batch of subscribers to export.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      {/* 1. Setup card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Connect BookFunnel</h2>
        <p className="text-sm text-slate-500 mb-4">
          Paste this webhook URL into BookFunnel so new subscribers show up here.
        </p>

        {secretError ? (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{secretError}</div>
        ) : !secret ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Generating your webhook URL…
          </div>
        ) : (
          <>
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={webhookUrl}
                onFocus={e => e.currentTarget.select()}
                className="flex-1 min-w-0 px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 bg-slate-50 text-slate-700"
              />
              <button
                onClick={copyUrl}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm shrink-0"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Keep this URL private — anyone with it could post fake subscribers.
            </p>

            <ol className="mt-4 space-y-1.5 text-sm text-slate-600 list-decimal list-inside">
              <li>In BookFunnel, go to <span className="font-medium">Integrations → Add Integration</span>.</li>
              <li>Choose <span className="font-medium">"BookFunnel API"</span> and create an API key.</li>
              <li>Add a webhook and paste the URL above.</li>
              <li>Set <span className="font-medium">Send Data As → PARAMS</span> <span className="text-slate-400">(BookFunnel's JSON mode has a connection bug — PARAMS works).</span></li>
              <li>Select the <span className="font-medium">new_subscriber</span> event.</li>
            </ol>
          </>
        )}
      </div>

      {/* 2. Alert banner */}
      {!loading && (
        unhandledCount > 0 ? (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <BellRing className="w-5 h-5 text-amber-500 shrink-0" />
            <div className="flex-1 min-w-[14rem] text-sm text-amber-800">
              <span className="font-semibold">
                {unhandledCount} new subscriber{unhandledCount === 1 ? '' : 's'} waiting
              </span>{' '}
              — export them from BookFunnel and import to your email tool.
            </div>
            <button
              onClick={handleMarkAll}
              disabled={busy}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg shadow-sm"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Mark all handled
            </button>
          </div>
        ) : events.length > 0 ? (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-teal-200 bg-teal-50 p-4">
            <CheckCircle2 className="w-5 h-5 text-teal-500 shrink-0" />
            <div className="text-sm text-teal-800">You're all caught up.</div>
          </div>
        ) : null
      )}

      {/* 3. Events list */}
      {loading ? (
        <div className="text-center py-16 text-slate-500 text-sm">Loading subscribers…</div>
      ) : events.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {events.map(ev => (
            <EventRow
              key={ev.id}
              event={ev}
              expanded={expanded.has(ev.id)}
              onToggleExpanded={() => toggleExpanded(ev.id)}
              onToggleHandled={() => handleToggle(ev)}
              onDelete={() => handleDelete(ev.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({
  event, expanded, onToggleExpanded, onToggleHandled, onDelete,
}: {
  event: BookFunnelEvent;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleHandled: () => void;
  onDelete: () => void;
}) {
  const name = [event.first_name, event.last_name].filter(Boolean).join(' ').trim();
  return (
    <div
      className={`rounded-2xl border p-4 transition-colors ${
        event.handled ? 'border-slate-200 bg-slate-50/60 opacity-70' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-start gap-3">
        <label className="flex items-center pt-0.5 shrink-0 cursor-pointer" title="Mark handled">
          <input
            type="checkbox"
            checked={event.handled}
            onChange={onToggleHandled}
            className="w-4 h-4 rounded border-slate-300 text-indigo-600"
          />
        </label>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-pink-100 text-pink-700 whitespace-nowrap">
              {event.event_type || 'unknown'}
            </span>
            <span className="text-xs text-slate-400">{formatReceived(event.received_at)}</span>
          </div>

          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <Field icon={<Mail className="w-3.5 h-3.5" />} label="Email" value={event.email} mono />
            <Field label="Name" value={name || null} />
            <Field icon={<FileText className="w-3.5 h-3.5" />} label="Page" value={event.page} />
            <Field icon={<BookOpen className="w-3.5 h-3.5" />} label="Book" value={event.book} />
          </div>

          <div className="mt-3 flex items-center gap-4">
            <button
              onClick={onToggleExpanded}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              {expanded ? 'Hide raw' : 'Show raw'}
            </button>
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-rose-600"
              title="Delete this event"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>

          {expanded && (
            <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-900 text-slate-100 text-xs font-mono p-3">
              {JSON.stringify(event.raw, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  icon, label, value, mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-slate-400 shrink-0">{icon}</span>
      <span className="text-slate-400 shrink-0">{label}:</span>
      {value ? (
        <span className={`text-slate-700 truncate ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
      ) : (
        <span className="text-slate-300 italic">not provided</span>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300">
      <UserPlus className="w-10 h-10 text-pink-400 mx-auto mb-3" />
      <h3 className="text-lg font-semibold text-slate-800 mb-1">No subscribers yet</h3>
      <p className="text-sm text-slate-500 max-w-md mx-auto">
        Once BookFunnel is connected, every new newsletter opt-in will appear here. The
        first one will reveal exactly what data BookFunnel sends — open <span className="font-medium">Show raw</span> on
        it to see the full payload.
      </p>
    </div>
  );
}

// Short relative time for recent events, falling back to a short date.
function formatReceived(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
