import { useEffect, useState } from 'react';
import { Dice5, Loader2 } from 'lucide-react';
import Modal from '../../../components/Modal';
import { useAuth } from '../../../contexts/AuthContext';
import { createLink, generateUniqueSlug, isSlugAvailable } from '../api';
import { isValidSlug, isValidUrl, normalizeUrl } from '../utils';
import type { LinkFolder, ShortLink } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (link: ShortLink) => void;
  parent?: ShortLink | null;
  folders: LinkFolder[];
  defaultFolderId?: string | null;
}

export default function CreateLinkModal({ open, onClose, onCreated, parent, folders, defaultFolderId }: Props) {
  const { user } = useAuth();
  const [slug, setSlug] = useState('');
  const [destination, setDestination] = useState('');
  const [label, setLabel] = useState('');
  const [channel, setChannel] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'taken' | 'invalid' | 'ok'>('idle');

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    setLabel(parent ? `${parent.label || parent.slug} — ` : '');
    setDestination(parent?.destination_url ?? '');
    setChannel('');
    setFolderId(parent?.folder_id ?? defaultFolderId ?? null);
    setSlugStatus('idle');
    void rollSlug();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parent?.id]);

  async function rollSlug() {
    setBusy(true);
    try {
      const fresh = await generateUniqueSlug();
      setSlug(fresh);
      setSlugStatus('ok');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate slug');
    } finally {
      setBusy(false);
    }
  }

  async function checkSlug(value: string) {
    if (!isValidSlug(value)) {
      setSlugStatus('invalid');
      return;
    }
    setSlugStatus('checking');
    try {
      const available = await isSlugAvailable(value);
      setSlugStatus(available ? 'ok' : 'taken');
    } catch {
      setSlugStatus('invalid');
    }
  }

  async function handleCreate() {
    if (!user) return;
    setError(null);
    if (!isValidSlug(slug)) {
      setError('Slug must be 3–40 letters, numbers, hyphens or underscores.');
      return;
    }
    if (!isValidUrl(destination)) {
      setError('Destination must be a valid URL.');
      return;
    }
    setBusy(true);
    try {
      const link = await createLink(user.id, {
        slug,
        destination_url: normalizeUrl(destination),
        label: label.trim(),
        channel: channel.trim(),
        notes: '',
        tags: [],
        is_active: true,
        parent_id: parent?.id ?? null,
        folder_id: folderId,
      });
      onCreated(link);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create link';
      setError(msg.includes('duplicate') ? 'That slug is already taken.' : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={parent ? `Add channel variant under "${parent.label || parent.slug}"` : 'New short link'} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-content mb-1">Short slug</label>
          <div className="flex items-center gap-2">
            <input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugStatus('idle');
              }}
              onBlur={(e) => checkSlug(e.target.value)}
              className="flex-1 px-3 py-2 rounded-control border border-edge-strong font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="abc123"
            />
            <button
              type="button"
              onClick={rollSlug}
              disabled={busy}
              className="px-3 py-2 rounded-control bg-surface-sunken hover:bg-edge text-content text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              title="Generate a new random slug"
            >
              <Dice5 className="w-4 h-4" /> Roll
            </button>
          </div>
          <div className="mt-1 text-xs h-4">
            {slugStatus === 'checking' && <span className="text-content-secondary">Checking availability…</span>}
            {slugStatus === 'ok' && <span className="text-emerald-600">Slug available</span>}
            {slugStatus === 'taken' && <span className="text-red-600">Slug already taken</span>}
            {slugStatus === 'invalid' && <span className="text-red-600">3–40 chars: letters, numbers, - or _</span>}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-content mb-1">Destination URL</label>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="w-full px-3 py-2 rounded-control border border-edge-strong text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="https://your-book-page.com"
          />
          <p className="mt-1 text-xs text-content-secondary">You can change this later — the short URL stays the same.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-content mb-1">Internal label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full px-3 py-2 rounded-control border border-edge-strong text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-content mb-1">Folder</label>
            <select
              value={folderId ?? ''}
              onChange={(e) => setFolderId(e.target.value || null)}
              className="w-full px-3 py-2 rounded-control border border-edge-strong bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        </div>

        {parent && (
          <div>
            <label className="block text-sm font-medium text-content mb-1">Channel</label>
            <input
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="w-full px-3 py-2 rounded-control border border-edge-strong text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="Pinterest, Instagram, Facebook…"
            />
            <p className="mt-1 text-xs text-content-secondary">Click data for this slug will be tagged with this channel.</p>
          </div>
        )}

        {error && (
          <div className="px-3 py-2 rounded-control bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-control text-content-secondary hover:bg-surface-sunken text-sm font-medium">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={busy || slugStatus === 'taken' || slugStatus === 'invalid'}
            className="px-4 py-2 rounded-control bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Create link
          </button>
        </div>
      </div>
    </Modal>
  );
}
