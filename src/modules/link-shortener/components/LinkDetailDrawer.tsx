import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  X, Copy, ExternalLink, Save, Trash2, Plus, Power, ArchiveRestore,
  Loader2, Globe, Tag, Smartphone, Clock, Bot, QrCode, DollarSign, Calendar, FolderIcon,
  Layout, CircleDot,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { deleteLink, listClicks, updateLink } from '../api';
import {
  buildShortUrl, formatNumber, inputLocalToIso, isoToInputLocal, isValidUrl,
  normalizeUrl, timeAgo,
} from '../utils';
import { detectSocialPlatform, SOCIAL_NAMES } from '../socialIcons';
import type { LinkClick, LinkFolder, ShortLink } from '../types';
import QRCodeBlock from './QRCodeBlock';
import ConversionsList from './ConversionsList';

interface Props {
  link: ShortLink;
  allLinks: ShortLink[];
  folders: LinkFolder[];
  onClose: () => void;
  onUpdated: (link: ShortLink) => void;
  onDeleted: (id: string) => void;
  onAddVariant: (parent: ShortLink) => void;
}

type Tab = 'edit' | 'qr' | 'conversions' | 'clicks';

export default function LinkDetailDrawer({
  link, allLinks, folders, onClose, onUpdated, onDeleted, onAddVariant,
}: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('edit');

  const [label, setLabel] = useState(link.label);
  const [destination, setDestination] = useState(link.destination_url);
  const [channel, setChannel] = useState(link.channel);
  const [notes, setNotes] = useState(link.notes);
  const [tagsInput, setTagsInput] = useState((link.tags ?? []).join(', '));
  const [folderId, setFolderId] = useState<string | null>(link.folder_id);
  const [startsAt, setStartsAt] = useState(isoToInputLocal(link.starts_at));
  const [expiresAt, setExpiresAt] = useState(isoToInputLocal(link.expires_at));
  const [expiredRedirect, setExpiredRedirect] = useState(link.expired_redirect_url ?? '');
  const [showOnBio, setShowOnBio] = useState<boolean>(link.show_on_bio ?? true);
  const [bioTitle, setBioTitle] = useState<string>(link.bio_title ?? '');
  const [bioStyle, setBioStyle] = useState<'card' | 'icon'>(link.bio_style ?? 'card');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clicks, setClicks] = useState<LinkClick[]>([]);
  const [loadingClicks, setLoadingClicks] = useState(true);

  useEffect(() => {
    setTab('edit');
    setLabel(link.label);
    setDestination(link.destination_url);
    setChannel(link.channel);
    setNotes(link.notes);
    setTagsInput((link.tags ?? []).join(', '));
    setFolderId(link.folder_id);
    setStartsAt(isoToInputLocal(link.starts_at));
    setExpiresAt(isoToInputLocal(link.expires_at));
    setExpiredRedirect(link.expired_redirect_url ?? '');
    setShowOnBio(link.show_on_bio ?? true);
    setBioTitle(link.bio_title ?? '');
    setBioStyle(link.bio_style ?? 'card');
    setError(null);
  }, [link.id]);

  useEffect(() => {
    if (!user || tab !== 'clicks') return;
    setLoadingClicks(true);
    listClicks(user.id, { linkId: link.id, limit: 200 })
      .then(setClicks)
      .catch(() => setClicks([]))
      .finally(() => setLoadingClicks(false));
  }, [link.id, user, tab]);

  const variants = useMemo(
    () => allLinks.filter((l) => l.parent_id === link.id),
    [allLinks, link.id],
  );
  const parent = useMemo(
    () => (link.parent_id ? allLinks.find((l) => l.id === link.parent_id) ?? null : null),
    [allLinks, link.parent_id],
  );

  const detectedPlatform = useMemo(
    () => detectSocialPlatform(destination || link.destination_url),
    [destination, link.destination_url],
  );
  const detectedPlatformName = SOCIAL_NAMES[detectedPlatform];

  const hasChanges =
    label !== link.label ||
    destination !== link.destination_url ||
    channel !== link.channel ||
    notes !== link.notes ||
    tagsInput !== (link.tags ?? []).join(', ') ||
    folderId !== link.folder_id ||
    startsAt !== isoToInputLocal(link.starts_at) ||
    expiresAt !== isoToInputLocal(link.expires_at) ||
    expiredRedirect !== (link.expired_redirect_url ?? '') ||
    showOnBio !== (link.show_on_bio ?? true) ||
    bioTitle !== (link.bio_title ?? '') ||
    bioStyle !== (link.bio_style ?? 'card');

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
    if (expiredRedirect && !isValidUrl(expiredRedirect)) {
      setError('Expired-fallback URL must be a valid URL.');
      return;
    }
    setBusy(true);
    try {
      const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
      const updated = await updateLink(link.id, {
        label: label.trim(),
        destination_url: normalizeUrl(destination),
        channel: channel.trim(),
        notes: notes.trim(),
        tags,
        folder_id: folderId,
        starts_at: inputLocalToIso(startsAt),
        expires_at: inputLocalToIso(expiresAt),
        expired_redirect_url: expiredRedirect.trim() ? normalizeUrl(expiredRedirect) : null,
        show_on_bio: showOnBio,
        bio_title: bioTitle.trim(),
        bio_style: bioStyle,
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
    if (!confirm(`Delete /${link.slug} permanently? This cannot be undone and removes all click and conversion data for this link.`)) return;
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

        <section className="px-6 py-3 border-b border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Clicks" value={formatNumber(link.click_count)} />
          <Stat label="Conversions" value={formatNumber(link.conversion_count)} />
          <Stat label="Revenue" value={`$${(link.conversion_value ?? 0).toFixed(2)}`} />
          <Stat label="Last click" value={timeAgo(link.last_clicked_at)} />
        </section>

        <section className="px-6 py-3 flex flex-wrap gap-2 border-b border-slate-100">
          <button onClick={copyUrl} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
            <Copy className="w-4 h-4" />
            {copied ? 'Copied!' : 'Copy URL'}
          </button>
          <a
            href={link.destination_url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium"
          >
            <ExternalLink className="w-4 h-4" /> Open
          </a>
          {!link.parent_id && (
            <button
              onClick={() => onAddVariant(link)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium"
            >
              <Plus className="w-4 h-4" /> Variant
            </button>
          )}
          <button onClick={handleToggleActive} disabled={busy} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium">
            <Power className="w-4 h-4" /> {link.is_active ? 'Deactivate' : 'Activate'}
          </button>
          <button onClick={handleArchive} disabled={busy} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium">
            <ArchiveRestore className="w-4 h-4" /> {link.archived_at ? 'Unarchive' : 'Archive'}
          </button>
          <button
            onClick={handleDelete}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium ml-auto"
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </section>

        <nav className="px-6 pt-3 flex gap-1 border-b border-slate-100">
          <TabBtn active={tab === 'edit'} onClick={() => setTab('edit')}>Edit</TabBtn>
          <TabBtn active={tab === 'qr'} onClick={() => setTab('qr')} icon={<QrCode className="w-3.5 h-3.5" />}>QR code</TabBtn>
          <TabBtn active={tab === 'conversions'} onClick={() => setTab('conversions')} icon={<DollarSign className="w-3.5 h-3.5" />}>Conversions</TabBtn>
          <TabBtn active={tab === 'clicks'} onClick={() => setTab('clicks')} icon={<Clock className="w-3.5 h-3.5" />}>Clicks</TabBtn>
        </nav>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {parent && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600">
              Channel variant of <span className="font-mono text-indigo-600">/{parent.slug}</span>
              {parent.label && <span> {parent.label}</span>}
            </div>
          )}

          {tab === 'edit' && (
            <div className="space-y-4">
              <Field label="Internal label" hint="Only you see this. Used in the dashboard.">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </Field>

              <Field label="Destination URL" hint="Change anytime — the short URL stays the same.">
                <input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Channel">
                  <input
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </Field>
                <Field label="Folder" icon={<FolderIcon className="w-3.5 h-3.5" />}>
                  <select
                    value={folderId ?? ''}
                    onChange={(e) => setFolderId(e.target.value || null)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">No folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-indigo-50/30">
                <button
                  type="button"
                  onClick={() => setShowOnBio((v) => !v)}
                  className="w-full flex items-center justify-between"
                >
                  <div className="flex items-center gap-2 min-w-0 text-left">
                    <Layout className={`w-4 h-4 ${showOnBio ? 'text-indigo-600' : 'text-slate-400'}`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-700">Show on bio page</div>
                      <div className="text-xs text-slate-500">Visible to readers on your link-in-bio page.</div>
                    </div>
                  </div>
                  <span
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                      showOnBio ? 'bg-indigo-600' : 'bg-slate-300'
                    }`}
                    aria-hidden="true"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        showOnBio ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </span>
                </button>

                {showOnBio && (
                  <div className="space-y-3 pt-3 border-t border-indigo-100">
                    <Field label="Public title" hint="What readers see on the bio page. Falls back to the internal label if blank.">
                      <input
                        value={bioTitle}
                        onChange={(e) => setBioTitle(e.target.value)}
                        placeholder={label || `/${link.slug}`}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </Field>

                    <div>
                      <label className="text-sm font-medium text-slate-700 mb-1 flex items-center gap-1.5">
                        Display style
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <StyleOption
                          selected={bioStyle === 'card'}
                          onClick={() => setBioStyle('card')}
                          icon={<Layout className="w-4 h-4" />}
                          label="Card"
                          hint="Full-width clickable button."
                        />
                        <StyleOption
                          selected={bioStyle === 'icon'}
                          onClick={() => setBioStyle('icon')}
                          icon={<CircleDot className="w-4 h-4" />}
                          label="Social icon"
                          hint={`Compact circle (${detectedPlatformName})`}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 p-4 space-y-3 bg-slate-50/50">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Calendar className="w-4 h-4" /> Schedule
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Goes live (optional)" hint="Before this time, visitors see a 'Coming soon' page.">
                    <input
                      type="datetime-local"
                      value={startsAt}
                      onChange={(e) => setStartsAt(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </Field>
                  <Field label="Expires (optional)" hint="After this time, visitors see an 'Expired' page or your fallback URL.">
                    <input
                      type="datetime-local"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </Field>
                </div>
                <Field label="Expired fallback URL (optional)" hint="If set, expired links redirect here instead of showing the branded page.">
                  <input
                    value={expiredRedirect}
                    onChange={(e) => setExpiredRedirect(e.target.value)}
                    placeholder="https://your-main-site.com"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </Field>
              </div>

              <Field label="Tags" hint="Comma-separated.">
                <input
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
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

              {variants.length > 0 && (
                <div>
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
                </div>
              )}
            </div>
          )}

          {tab === 'qr' && (
            <QRCodeBlock url={buildShortUrl(link.slug)} filename={`qr-${link.slug}`} />
          )}

          {tab === 'conversions' && (
            <ConversionsList link={link} onTotalsChanged={onUpdated} />
          )}

          {tab === 'clicks' && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4" /> Recent clicks
              </h3>
              {loadingClicks ? (
                <div className="text-sm text-slate-400">Loading…</div>
              ) : clicks.length === 0 ? (
                <div className="text-sm text-slate-400">No clicks yet.</div>
              ) : (
                <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
                  {clicks.map((c) => (
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
                        {c.referrer ? safeHostname(c.referrer) : '(direct)'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-base font-semibold text-slate-800 mt-0.5 truncate">{value}</div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon?: ReactNode; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-t-lg border-b-2 -mb-px ${
        active ? 'border-indigo-500 text-indigo-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Field({ label, hint, icon, children }: { label: string; hint?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-700 mb-1 flex items-center gap-1.5">
        {icon}
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function StyleOption({
  selected, onClick, icon, label, hint,
}: { selected: boolean; onClick: () => void; icon: ReactNode; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1 px-3 py-2.5 rounded-lg border text-left transition ${
        selected
          ? 'border-indigo-500 bg-white ring-2 ring-indigo-200'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {icon}
        {label}
      </div>
      <span className="text-xs text-slate-500 truncate w-full">{hint}</span>
    </button>
  );
}
