import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  X, Copy, ExternalLink, Save, Trash2, Plus, Power, ArchiveRestore,
  Loader2, Globe, Tag, Smartphone, Clock, Bot,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { deleteLink, listClicks, updateLink } from '../api';
import { buildShortUrl, formatNumber, isValidUrl, normalizeUrl, timeAgo } from '../utils';
import type { LinkClick, ShortLink } from '../types';

interface Props {
  link: ShortLink;
  allLinks: ShortLink[];
  onClose: () => void;
  onUpdated: (link: ShortLink) => void;
  onDeleted: (id: string) => void;
  onAddVariant: (parent: ShortLink) => void;
}

export default function LinkDetailDrawer({ link, allLinks, onClose, onUpdated, onDeleted, onAddVariant }: Props) {
  const { user } = useAuth();
  const [label, setLabel] = useState(link.label);
  const [destination, setDestination] = useState(link.destination_url);
  const [channel, setChannel] = useState(link.channel);
  const [notes, setNotes] = useState(link.notes);
  const [tagsInput, setTagsInput] = useState((link.tags ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clicks, setClicks] = useState<LinkClick[]>([]);
  const [loadingClicks, setLoadingClicks] = useState(true);

  useEffect(() => {
    setLabel(link.label);
    setDestination(link.destination_url);
    setChannel(link.channel);
    setNotes(link.notes);
    setTagsInput((link.tags ?? []).join(', '));
    setError(null);
  }, [link.id]);

  useEffect(() => {
    if (!user) return;
    setLoadingClicks(true);
    listClicks(user.id, { linkId: link.id, limit: 200 })
      .then(setClicks)
      .catch(() => setClicks([]))
      .finally(() => setLoadingClicks(false));
  }, [link.id, user]);

  const variants = useMemo(
    () => allLinks.filter((l) => l.parent_id === link.id),
    [allLinks, link.id],
  );
  const parent = useMemo(
    () => (link.parent_id ? allLinks.find((l) => l.id === link.parent_id) ?? null : null),
    [allLinks, link.parent_id],
  );

  const hasChanges =
    label !== link.label ||
    destination !== link.destination_url ||
    channel !== link.channel ||
    notes !== link.notes ||
    tagsInput !== (link.tags ?? []).join(', ');

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(buildShortUrl(link.slug));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  async function handleSave() {
    setError(null);
    if (!isValidUrl(destination)) {
      setError('Destination must be a valid URL.');
      return;
    }
    setBusy(true);
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const updated = await updateLink(link.id, {
        label: label.trim(),
        destination_url: normalizeUrl(destination),
        channel: channel.trim(),
        notes: notes.trim(),
        tags,
      });
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive() {
    setBusy(true);
    try {
      const updated = await updateLink(link.id, {
        is_active: !link.is_active,
        archived_at: !link.is_active ? null : link.archived_at,
      });
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive() {
    setBusy(true);
    try {
      const updated = await updateLink(link.id, {
        archived_at: link.archived_at ? null : new Date().toISOString(),
        is_active: link.archived_at ? true : false,
      });
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete /${link.slug} permanently? This cannot be undone and removes all click analytics for this link.`)) return;
    setBusy(true);
    try {
      await deleteLink(link.id);
      onDeleted(link.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative ml-auto w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-semibold text-indigo-600">/{link.slug}</span>
              {!link.is_active && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">inactive</span>}
              {link.archived_at && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">archived</span>}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 truncate">{buildShortUrl(link.slug)}</div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <section className="grid grid-cols-3 gap-3">
            <Stat label="Total clicks" value={formatNumber(link.click_count)} />
            <Stat label="Last click" value={timeAgo(link.last_clicked_at)} />
            <Stat label="Created" value={timeAgo(link.created_at)} />
          </section>

          <section className="flex flex-wrap gap-2">
            <button
              onClick={copyUrl}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
            >
              <Copy className="w-4 h-4" />
              {copied ? 'Copied!' : 'Copy short URL'}
            </button>
            <a
              href={link.destination_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium"
            >
              <ExternalLink className="w-4 h-4" /> Open destination
            </a>
            {!link.parent_id && (
              <button
                onClick={() => onAddVariant(link)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium"
              >
                <Plus className="w-4 h-4" /> Channel variant
              </button>
            )}
            <button
              onClick={handleToggleActive}
              disabled={busy}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium"
            >
              <Power className="w-4 h-4" /> {link.is_active ? 'Deactivate' : 'Activate'}
            </button>
            <button
              onClick={handleArchive}
              disabled={busy}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium"
            >
              <ArchiveRestore className="w-4 h-4" /> {link.archived_at ? 'Unarchive' : 'Archive'}
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium ml-auto"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </section>

          {parent && (
            <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600">
              Channel variant of <span className="font-mono text-indigo-600">/{parent.slug}</span>
              {parent.label && <span> — {parent.label}</span>}
            </div>
          )}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Edit details</h3>
            <Field label="Internal label" hint="Just for you. Rename anytime — public link unaffected.">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="Book launch — main"
              />
            </Field>
            <Field label="Destination URL" hint="Change anytime. The short URL stays the same; existing audience now lands here.">
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </Field>
            <Field label="Channel" hint="Tags clicks for analytics (e.g. Pinterest, Instagram).">
              <input
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </Field>
            <Field label="Tags" hint="Comma-separated.">
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="launch, fall-2026"
              />
            </Field>
            <Field label="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </Field>

            {error && <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>}

            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={!hasChanges || busy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save changes
              </button>
            </div>
          </section>

          {variants.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <Tag className="w-4 h-4" /> Channel variants
              </h3>
              <div className="space-y-1">
                {variants.map((v) => (
                  <div key={v.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-sm">
                    <span className="font-mono text-indigo-600">/{v.slug}</span>
                    {v.channel && <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{v.channel}</span>}
                    <span className="text-slate-500 truncate flex-1">{v.label || v.destination_url}</span>
                    <span className="text-slate-400 tabular-nums">{formatNumber(v.click_count)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
              <Clock className="w-4 h-4" /> Recent clicks
            </h3>
            {loadingClicks ? (
              <div className="text-sm text-slate-400">Loading…</div>
            ) : clicks.length === 0 ? (
              <div className="text-sm text-slate-400">No clicks yet.</div>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                {clicks.slice(0, 50).map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                    <span className="text-slate-500 tabular-nums whitespace-nowrap">{timeAgo(c.clicked_at)}</span>
                    {c.is_bot ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                        <Bot className="w-3 h-3" /> bot
                      </span>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1 text-slate-600">
                          <Smartphone className="w-3 h-3" /> {c.device_type}
                        </span>
                        <span className="text-slate-600">{c.browser}</span>
                        {c.country && (
                          <span className="inline-flex items-center gap-1 text-slate-600">
                            <Globe className="w-3 h-3" /> {c.country}
                          </span>
                        )}
                      </>
                    )}
                    <span className="text-slate-500 truncate ml-auto">
                      {c.referrer ? new URL(c.referrer).hostname.replace(/^www\./, '') : '(direct)'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold text-slate-800 mt-0.5 truncate">{value}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
