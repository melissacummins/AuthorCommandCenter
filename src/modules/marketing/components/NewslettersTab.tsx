import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, AlertCircle, Mail, RefreshCw, X, Calendar, Users, Eye, MousePointerClick,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { usePenNames } from '../../../contexts/PenNameContext';
import PenNameChip from '../../../components/PenNameChip';
import CatalogBookPicker from '../../../components/CatalogBookPicker';
import {
  createNewsletterEvent,
  deleteNewsletterEvent,
  listNewsletterEvents,
  refreshNewsletterMetrics,
} from '../../newsletters/api';
import type { NewsletterEvent } from '../../newsletters/types';
import { openRate, clickRate } from '../../newsletters/types';
import {
  getKlaviyoKeyStatus,
  listKlaviyoCampaigns,
  type KlaviyoCampaign,
} from '../../../lib/klaviyo';

type Phase =
  | { mode: 'list' }
  | { mode: 'pick-source' }
  | { mode: 'attribute'; draft: NewsletterDraft; sourceCampaign: KlaviyoCampaign | null };

interface NewsletterDraft {
  klaviyo_campaign_id: string | null;
  subject: string;
  sent_at: string;
  sent_count: number;
  open_count: number;
  click_count: number;
  unsubscribe_count: number;
  book_ids: string[];
  notes: string;
}

function emptyDraft(): NewsletterDraft {
  return {
    klaviyo_campaign_id: null,
    subject: '',
    sent_at: new Date().toISOString().slice(0, 16),
    sent_count: 0,
    open_count: 0,
    click_count: 0,
    unsubscribe_count: 0,
    book_ids: [],
    notes: '',
  };
}

// Newsletter events feed the Timeline as the email-marketing pulse on
// each book. The Klaviyo path pulls a sent campaign + its metrics in
// one click; the manual path is for non-Klaviyo sends (Substack,
// MailerLite, hand-rolled) so nothing is locked into one ESP.
export default function NewslettersTab() {
  const { user } = useAuth();
  const { selectedPenNameId, penNames } = usePenNames();
  const [events, setEvents] = useState<NewsletterEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ mode: 'list' });
  const [saving, setSaving] = useState(false);

  const penNameById = useMemo(() => new Map(penNames.map(p => [p.id, p])), [penNames]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    listNewsletterEvents(user.id)
      .then(rows => { if (!cancelled) setEvents(rows); })
      .catch(err => { if (!cancelled) setError(err?.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  // Filter events to those that attribute at least one book in the
  // active pen name. Events with no attribution at all show under
  // "All pen names".
  const visible = selectedPenNameId
    ? events.filter(e => (e.books ?? []).some(b => b.pen_name_id === selectedPenNameId))
    : events;

  async function handleSave(draft: NewsletterDraft) {
    if (!user) return;
    setSaving(true);
    try {
      const created = await createNewsletterEvent(user.id, {
        klaviyo_campaign_id: draft.klaviyo_campaign_id,
        subject: draft.subject,
        sent_at: new Date(draft.sent_at).toISOString(),
        sent_count: draft.sent_count,
        open_count: draft.open_count,
        click_count: draft.click_count,
        unsubscribe_count: draft.unsubscribe_count,
        metrics_refreshed_at: draft.klaviyo_campaign_id ? new Date().toISOString() : null,
        notes: draft.notes || null,
        book_ids: draft.book_ids,
      });
      setEvents(prev => [created, ...prev]);
      setPhase({ mode: 'list' });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this newsletter event? The timeline marker will go with it.')) return;
    try {
      await deleteNewsletterEvent(id);
      setEvents(prev => prev.filter(e => e.id !== id));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }

  async function handleRefresh(ev: NewsletterEvent) {
    if (!user) return;
    try {
      const updated = await refreshNewsletterMetrics(user.id, ev);
      setEvents(prev => prev.map(e => (e.id === ev.id ? updated : e)));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }

  if (phase.mode === 'pick-source') {
    return (
      <SourcePicker
        onCancel={() => setPhase({ mode: 'list' })}
        onPickCampaign={c => {
          const draft = emptyDraft();
          draft.klaviyo_campaign_id = c.id;
          draft.subject = c.subject || c.name;
          if (c.sent_at) draft.sent_at = c.sent_at.slice(0, 16);
          if (c.metrics) {
            draft.sent_count = c.metrics.sent;
            draft.open_count = c.metrics.opened;
            draft.click_count = c.metrics.clicked;
            draft.unsubscribe_count = c.metrics.unsubscribed;
          }
          setPhase({ mode: 'attribute', draft, sourceCampaign: c });
        }}
        onPickManual={() => setPhase({ mode: 'attribute', draft: emptyDraft(), sourceCampaign: null })}
      />
    );
  }

  if (phase.mode === 'attribute') {
    return (
      <AttributionForm
        draft={phase.draft}
        sourceCampaign={phase.sourceCampaign}
        saving={saving}
        onCancel={() => setPhase({ mode: 'list' })}
        onSubmit={handleSave}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Mail className="w-5 h-5 text-purple-500" /> Newsletter events
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Log each newsletter send and attribute it to the book(s) it featured. Sends aren't pulled in automatically — click "Log a newsletter", pick a Klaviyo campaign (its subject, date, and open/click metrics fill in for you), or enter a non-Klaviyo send by hand.
          </p>
        </div>
        <button
          onClick={() => setPhase({ mode: 'pick-source' })}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 shadow-sm"
        >
          <Plus className="w-4 h-4" /> Log a newsletter
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500">
          {events.length === 0
            ? 'No newsletter events logged yet. Click "Log a newsletter" to start.'
            : 'No newsletter events attribute a book for the active pen name.'}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(ev => {
            const op = openRate(ev);
            const cl = clickRate(ev);
            return (
              <div key={ev.id} className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 truncate">{ev.subject}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      <Calendar className="w-3 h-3 inline mr-1" />
                      {new Date(ev.sent_at).toLocaleString()}
                      {ev.klaviyo_campaign_id && (
                        <span className="ml-2 px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 text-[10px]">Klaviyo</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {ev.klaviyo_campaign_id && (
                      <button
                        onClick={() => handleRefresh(ev)}
                        className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg"
                        title="Pull latest metrics from Klaviyo"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(ev.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 text-xs text-slate-600 mb-2">
                  <Metric icon={<Users className="w-3 h-3" />} label="Sent" value={ev.sent_count.toLocaleString()} />
                  <Metric icon={<Eye className="w-3 h-3" />} label="Opens" value={`${ev.open_count.toLocaleString()}${op !== null ? ` (${op.toFixed(1)}%)` : ''}`} />
                  <Metric icon={<MousePointerClick className="w-3 h-3" />} label="Clicks" value={`${ev.click_count.toLocaleString()}${cl !== null ? ` (${cl.toFixed(1)}%)` : ''}`} />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(ev.books ?? []).length === 0 && (
                    <span className="text-xs text-slate-400 italic">No book attribution</span>
                  )}
                  {(ev.books ?? []).map(b => {
                    const pn = b.pen_name_id ? penNameById.get(b.pen_name_id) : null;
                    return (
                      <span key={b.book_id} className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full">
                        {b.book_title}
                        {pn && <PenNameChip name={pn.name} color={pn.color} />}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-slate-400">{icon}</span>
      <span className="font-medium text-slate-800 tabular-nums">{value}</span>
      <span className="text-slate-400">{label}</span>
    </span>
  );
}

// Step 1: choose where the newsletter comes from. Klaviyo path pulls
// the user's sent campaigns; manual path skips straight to the form.
function SourcePicker({
  onPickCampaign, onPickManual, onCancel,
}: {
  onPickCampaign: (c: KlaviyoCampaign) => void;
  onPickManual: () => void;
  onCancel: () => void;
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [campaigns, setCampaigns] = useState<KlaviyoCampaign[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getKlaviyoKeyStatus()
      .then(s => { if (!cancelled) setHasKey(s.has_key); })
      .catch(() => { if (!cancelled) setHasKey(false); });
    return () => { cancelled = true; };
  }, []);

  async function loadCampaigns() {
    setLoading(true);
    setError(null);
    try {
      setCampaigns(await listKlaviyoCampaigns());
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Where did this newsletter come from?</h2>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="font-semibold text-slate-800 mb-1">Klaviyo</h3>
          {hasKey === false ? (
            <p className="text-sm text-slate-500">
              Add a Klaviyo API key in <a href="/settings" className="text-purple-600 hover:underline">Settings</a> to pull campaigns here.
            </p>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-3">
                Pulls your sent campaigns with subject, send time, and performance metrics in one click.
              </p>
              {!campaigns ? (
                <button
                  onClick={loadCampaigns}
                  disabled={loading || hasKey !== true}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  {loading ? 'Loading…' : 'Load my campaigns'}
                </button>
              ) : (
                <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {campaigns.length === 0 && (
                    <p className="p-3 text-sm text-slate-500">No sent campaigns found.</p>
                  )}
                  {campaigns.map(c => (
                    <button
                      key={c.id}
                      onClick={() => onPickCampaign(c)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm"
                    >
                      <div className="font-medium text-slate-800 truncate">{c.subject || c.name}</div>
                      <div className="text-xs text-slate-500">
                        {c.sent_at ? new Date(c.sent_at).toLocaleDateString() : 'never sent'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {error && (
                <div className="mt-2 text-xs text-rose-600 flex items-start gap-1.5">
                  <AlertCircle className="w-3 h-3 mt-0.5" /> {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="font-semibold text-slate-800 mb-1">Manual entry</h3>
          <p className="text-xs text-slate-500 mb-3">
            For sends from Substack, MailerLite, or anywhere else — type in subject, date, and metrics by hand.
          </p>
          <button
            onClick={onPickManual}
            className="px-3 py-1.5 text-sm bg-slate-700 text-white font-medium rounded-lg hover:bg-slate-800"
          >
            Enter manually
          </button>
        </div>
      </div>
    </div>
  );
}

// Step 2: pick the books this newsletter attributes to + confirm
// metrics. Used for both Klaviyo (pre-filled) and manual (empty) flows.
function AttributionForm({
  draft: initialDraft, sourceCampaign, saving, onSubmit, onCancel,
}: {
  draft: NewsletterDraft;
  sourceCampaign: KlaviyoCampaign | null;
  saving: boolean;
  onSubmit: (draft: NewsletterDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  // Cache the title + pen_name_id of each picked book so the chips can
  // render properly without re-fetching Catalog. Keyed by book_id.
  const [pickedBooks, setPickedBooks] = useState<Map<string, { title: string; pen_name_id: string | null }>>(new Map());
  const { penNames } = usePenNames();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.subject.trim()) return;
    onSubmit(draft);
  }

  function addBook(id: string, title: string, pen_name_id: string | null) {
    if (draft.book_ids.includes(id)) return;
    setDraft(d => ({ ...d, book_ids: [...d.book_ids, id] }));
    setPickedBooks(prev => {
      const next = new Map(prev);
      next.set(id, { title, pen_name_id });
      return next;
    });
  }

  function removeBook(id: string) {
    setDraft(d => ({ ...d, book_ids: d.book_ids.filter(b => b !== id) }));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">
          {sourceCampaign ? 'Attribute Klaviyo campaign' : 'Log a newsletter'}
        </h2>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Subject *</label>
          <input
            type="text"
            value={draft.subject}
            onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Sent at *</label>
          <input
            type="datetime-local"
            value={draft.sent_at}
            onChange={e => setDraft(d => ({ ...d, sent_at: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumberField label="Sent" value={draft.sent_count} onChange={v => setDraft(d => ({ ...d, sent_count: v }))} />
          <NumberField label="Opens" value={draft.open_count} onChange={v => setDraft(d => ({ ...d, open_count: v }))} />
          <NumberField label="Clicks" value={draft.click_count} onChange={v => setDraft(d => ({ ...d, click_count: v }))} />
          <NumberField label="Unsubscribes" value={draft.unsubscribe_count} onChange={v => setDraft(d => ({ ...d, unsubscribe_count: v }))} />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Books this newsletter featured</label>
          <p className="text-xs text-slate-500 mb-2">
            One Timeline event will be created per attributed book.
          </p>
          <CatalogBookPicker
            value={null}
            onChange={(id, book) => addBook(id, book.title, book.pen_name_id)}
            filterByPenName={false}
            placeholder="Pick a book to attribute…"
          />
          {draft.book_ids.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {draft.book_ids.map(id => {
                const meta = pickedBooks.get(id);
                const pn = meta?.pen_name_id ? penNames.find(p => p.id === meta.pen_name_id) : null;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 text-xs pl-2 pr-1 py-1 bg-purple-100 text-purple-800 border border-purple-200 rounded-full"
                  >
                    {meta?.title ?? 'Book'}
                    {pn && <PenNameChip name={pn.name} color={pn.color} />}
                    <button
                      type="button"
                      onClick={() => removeBook(id)}
                      className="p-0.5 hover:bg-purple-200 rounded-full"
                      aria-label="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
          <textarea
            rows={2}
            value={draft.notes}
            onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Optional context for this send"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!draft.subject.trim() || saving}
          className="px-4 py-2 text-sm bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save newsletter'}
        </button>
      </div>
    </form>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={e => onChange(Number(e.target.value) || 0)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
      />
    </div>
  );
}
