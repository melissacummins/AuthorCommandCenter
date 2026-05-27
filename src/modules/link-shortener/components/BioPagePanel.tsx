import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical, ExternalLink, EyeOff, ArrowLeftRight, Layout, Upload, Trash2, Loader2,
  Heading, Image as ImageIcon, Plus, Type, Check, ShoppingBag, X as XIcon, Mail, BookOpen,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import type { BioBlock, BioButton, BioSettings, LandingPage, ShortLink } from '../types';
import {
  createBioBlock, deleteBioBlock, getBioSettings, listBioBlocks, listLandingPages, removeBioLogo,
  reorderBioItems, updateBioBlock, updateLink, uploadBioImage, uploadBioLogo, upsertBioSettings,
} from '../api';
import { BIO_THEMES, DEFAULT_BIO_THEME, bioThemeById } from '../bioThemes';
import KlaviyoListPicker from '../../book-tracker/components/KlaviyoListPicker';
import {
  detectSocialPlatform, SOCIAL_HEX, SOCIAL_NAMES, SIMPLEICONS_SLUG,
} from '../socialIcons';

interface Props {
  links: ShortLink[];
  onUpdated: (link: ShortLink) => void;
}

type CardItem =
  | { id: string; kind: 'link'; sortOrder: number; link: ShortLink }
  | { id: string; kind: 'block'; sortOrder: number; block: BioBlock };

function absoluteUrl(raw: string): string {
  if (!raw) return '';
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
}

export default function BioPagePanel({ links, onUpdated }: Props) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [bioSettings, setBioSettings] = useState<BioSettings | null>(null);
  const [blocks, setBlocks] = useState<BioBlock[]>([]);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [themeBusy, setThemeBusy] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [pixelDraft, setPixelDraft] = useState('');
  const [adding, setAdding] = useState<'section' | 'image' | 'buttons' | 'email' | 'book' | null>(null);
  const [landingPages, setLandingPages] = useState<LandingPage[]>([]);

  useEffect(() => {
    if (!user) return;
    getBioSettings(user.id).then(setBioSettings).catch(() => setBioSettings(null));
    listBioBlocks(user.id).then(setBlocks).catch(() => setBlocks([]));
    listLandingPages(user.id).then(setLandingPages).catch(() => setLandingPages([]));
  }, [user]);

  useEffect(() => {
    setPixelDraft(bioSettings?.meta_pixel_id ?? '');
  }, [bioSettings?.meta_pixel_id]);

  const bioLinks = useMemo(
    () => links.filter((l) => l.show_on_bio && l.is_active && !l.archived_at && !l.parent_id),
    [links],
  );
  const iconLinks = useMemo(
    () => bioLinks
      .filter((l) => l.bio_style === 'icon')
      .sort((a, b) =>
        a.bio_sort_order - b.bio_sort_order ||
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      ),
    [bioLinks],
  );
  const cardItems = useMemo<CardItem[]>(() => {
    const linkRows: CardItem[] = bioLinks
      .filter((l) => l.bio_style !== 'icon')
      .map((l) => ({ id: `link:${l.id}`, kind: 'link', sortOrder: l.bio_sort_order, link: l }));
    const blockRows: CardItem[] = blocks.map((b) => ({
      id: `block:${b.id}`, kind: 'block', sortOrder: b.bio_sort_order, block: b,
    }));
    return [...linkRows, ...blockRows].sort((a, b) =>
      a.sortOrder - b.sortOrder ||
      (
        (a.kind === 'link' ? new Date(a.link.created_at).getTime() : new Date(a.block.created_at).getTime())
        - (b.kind === 'link' ? new Date(b.link.created_at).getTime() : new Date(b.block.created_at).getTime())
      ),
    );
  }, [bioLinks, blocks]);

  const publicBioUrl = absoluteUrl(
    (import.meta.env.VITE_SHORT_LINK_BASE_URL as string | undefined) || '',
  );

  async function handleLogoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    e.target.value = '';
    if (file.size > 2 * 1024 * 1024) { setLogoError('Logo must be 2MB or smaller.'); return; }
    if (!file.type.startsWith('image/')) { setLogoError('Please select an image file.'); return; }
    setLogoError(null); setLogoBusy(true);
    try {
      const publicUrl = await uploadBioLogo(user.id, file);
      const updated = await upsertBioSettings(user.id, { logo_url: publicUrl });
      setBioSettings(updated);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Failed to upload logo');
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleRemoveLogo() {
    if (!user) return;
    if (!confirm('Remove the bio page logo?')) return;
    setLogoBusy(true); setLogoError(null);
    try {
      await removeBioLogo(user.id);
      setBioSettings((s) => (s ? { ...s, logo_url: null } : s));
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Failed to remove logo');
    } finally {
      setLogoBusy(false);
    }
  }

  async function saveAppearance(patch: { theme?: string; accent_color?: string | null; meta_pixel_id?: string | null }) {
    if (!user) return;
    setThemeBusy(true); setThemeError(null);
    try {
      const updated = await upsertBioSettings(user.id, patch);
      setBioSettings(updated);
    } catch (err) {
      setThemeError(err instanceof Error ? err.message : 'Failed to save appearance');
    } finally {
      setThemeBusy(false);
    }
  }

  async function handleDragEnd(
    event: DragEndEvent,
    list: { id: string; kind: 'link' | 'block'; rawId: string }[],
  ) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = list.findIndex((l) => l.id === active.id);
    const newIdx = list.findIndex((l) => l.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(list, oldIdx, newIdx);
    try {
      await reorderBioItems(reordered.map((r) => ({ kind: r.kind, id: r.rawId })));
      // Refresh blocks so their sort orders are picked up; links update via
      // parent state when callers re-list. For now, optimistically apply.
      if (user) listBioBlocks(user.id).then(setBlocks).catch(() => undefined);
      // Patch links in parent state so the UI reflects the new order
      // without a full re-fetch.
      reordered.forEach((r, idx) => {
        if (r.kind === 'link') {
          const link = bioLinks.find((l) => l.id === r.rawId);
          if (link && link.bio_sort_order !== idx) onUpdated({ ...link, bio_sort_order: idx });
        }
      });
    } catch (err) {
      console.error('reorder failed', err);
    }
  }

  async function toggleStyle(link: ShortLink) {
    const next: 'card' | 'icon' = link.bio_style === 'icon' ? 'card' : 'icon';
    try {
      const updated = await updateLink(link.id, { bio_style: next });
      onUpdated(updated);
    } catch (err) { console.error('toggle style failed', err); }
  }

  async function hideFromBio(link: ShortLink) {
    try {
      const updated = await updateLink(link.id, { show_on_bio: false });
      onUpdated(updated);
    } catch (err) { console.error('hide failed', err); }
  }

  async function saveBioTitle(link: ShortLink, title: string) {
    if (title === link.bio_title) return;
    try {
      const updated = await updateLink(link.id, { bio_title: title });
      onUpdated(updated);
    } catch (err) { console.error('save title failed', err); }
  }

  async function handleAddSection() {
    if (!user) return;
    setAdding('section');
    try {
      const created = await createBioBlock(user.id, { type: 'section', title: 'New section', body: '' });
      setBlocks((bs) => [...bs, created]);
    } catch (err) {
      console.error('add section failed', err);
    } finally {
      setAdding(null);
    }
  }

  async function handleAddImageCard() {
    if (!user) return;
    setAdding('image');
    try {
      const created = await createBioBlock(user.id, { type: 'image', title: '', link_url: '', image_url: null });
      setBlocks((bs) => [...bs, created]);
    } catch (err) {
      console.error('add image card failed', err);
    } finally {
      setAdding(null);
    }
  }

  async function handleAddEmail() {
    if (!user) return;
    setAdding('email');
    try {
      const created = await createBioBlock(user.id, {
        type: 'email', title: 'Join my newsletter', body: '', button_label: 'Subscribe',
      });
      setBlocks((bs) => [...bs, created]);
    } catch (err) {
      console.error('add email block failed', err);
    } finally {
      setAdding(null);
    }
  }

  async function handleAddBook() {
    if (!user) return;
    setAdding('book');
    try {
      const created = await createBioBlock(user.id, { type: 'book', landing_page_id: null });
      setBlocks((bs) => [...bs, created]);
    } catch (err) {
      console.error('add book block failed', err);
    } finally {
      setAdding(null);
    }
  }

  async function handleSaveBlock(blockId: string, patch: Partial<BioBlock>) {
    try {
      const updated = await updateBioBlock(blockId, patch);
      setBlocks((bs) => bs.map((b) => (b.id === blockId ? updated : b)));
    } catch (err) {
      console.error('save block failed', err);
    }
  }

  async function handleDeleteBlock(blockId: string) {
    if (!confirm('Remove this block from your bio page?')) return;
    try {
      await deleteBioBlock(blockId);
      setBlocks((bs) => bs.filter((b) => b.id !== blockId));
    } catch (err) {
      console.error('delete block failed', err);
    }
  }

  async function handleUploadBlockImage(block: BioBlock, file: File) {
    if (!user) return;
    if (file.size > 5 * 1024 * 1024) { alert('Image must be 5MB or smaller.'); return; }
    if (!file.type.startsWith('image/')) { alert('Please select an image file.'); return; }
    try {
      const url = await uploadBioImage(user.id, file);
      await handleSaveBlock(block.id, { image_url: url });
    } catch (err) {
      console.error('upload block image failed', err);
      alert(err instanceof Error ? err.message : 'Failed to upload image');
    }
  }

  // Mirror cardItems but with raw ids for reorder API calls.
  const cardItemsForReorder = useMemo(
    () => cardItems.map((i) => ({
      id: i.id,
      kind: i.kind,
      rawId: i.kind === 'link' ? i.link.id : i.block.id,
    })),
    [cardItems],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Layout className="w-5 h-5" /> Bio page
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Customize how your bio page looks and what readers see.
          </p>
        </div>
        {publicBioUrl && (
          <a
            href={publicBioUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium"
          >
            <ExternalLink className="w-4 h-4" /> View public page
          </a>
        )}
      </div>

      <Section title="Page logo" hint="Square images work best. PNG, JPG, WEBP, or SVG up to 2MB.">
        <div className="flex items-center gap-4 p-4 rounded-xl bg-white border border-slate-200">
          <div
            className="w-16 h-16 rounded-2xl overflow-hidden grid place-items-center shrink-0 border border-slate-200"
            style={{
              background: bioSettings?.logo_url
                ? '#fff'
                : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            }}
          >
            {bioSettings?.logo_url ? (
              <img src={bioSettings.logo_url} alt="Bio logo" className="w-full h-full object-cover" />
            ) : (
              <span className="text-white font-bold text-2xl">M</span>
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
              onChange={handleLogoSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={logoBusy}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {logoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {bioSettings?.logo_url ? 'Replace logo' : 'Upload logo'}
            </button>
            {bioSettings?.logo_url && (
              <button
                type="button"
                onClick={handleRemoveLogo}
                disabled={logoBusy}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-sm font-medium disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            )}
          </div>
        </div>
        {logoError && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            {logoError}
          </div>
        )}
      </Section>

      <Section title="Theme" hint="Pick a look for your public bio page. The accent color tints links and buttons.">
        <div className="flex flex-wrap gap-2">
          {BIO_THEMES.map((th) => {
            const active = (bioSettings?.theme ?? DEFAULT_BIO_THEME) === th.id;
            return (
              <button
                key={th.id}
                type="button"
                onClick={() => saveAppearance({ theme: th.id })}
                disabled={themeBusy}
                aria-label={th.name}
                className={`relative w-[88px] rounded-xl overflow-hidden border-2 transition disabled:opacity-60 ${
                  active ? 'border-indigo-500' : 'border-transparent hover:border-slate-300'
                }`}
              >
                <div style={{ background: th.bg }} className="h-12 flex items-end justify-center px-2 pb-1.5">
                  <span style={{ background: th.surface }} className="block w-full h-3 rounded-sm shadow-sm" />
                </div>
                <div className="flex items-center justify-between px-2 py-1 bg-white">
                  <span className="text-[11px] font-medium text-slate-700">{th.name}</span>
                  <span style={{ background: th.accent }} className="w-2.5 h-2.5 rounded-full" />
                </div>
                {active && (
                  <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-indigo-500 text-white grid place-items-center">
                    <Check className="w-3 h-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <label className="text-xs font-medium text-slate-600">Accent color</label>
          <input
            type="color"
            value={bioSettings?.accent_color || bioThemeById(bioSettings?.theme).accent}
            onChange={(e) => saveAppearance({ accent_color: e.target.value })}
            disabled={themeBusy}
            className="w-9 h-9 rounded-lg border border-slate-200 bg-white cursor-pointer p-0.5"
            title="Accent color"
          />
          {bioSettings?.accent_color && (
            <button
              type="button"
              onClick={() => saveAppearance({ accent_color: null })}
              disabled={themeBusy}
              className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
            >
              Use theme default
            </button>
          )}
          {themeBusy && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        </div>
        {themeError && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            {themeError}
          </div>
        )}
      </Section>

      <Section title="Tracking" hint="Add your Meta (Facebook) Pixel ID to retarget people who visit your bio page with ads.">
        <div className="flex items-center gap-2 max-w-md">
          <input
            value={pixelDraft}
            onChange={(e) => setPixelDraft(e.target.value)}
            onBlur={() => {
              const cleaned = pixelDraft.replace(/[^0-9]/g, '');
              if (cleaned !== (bioSettings?.meta_pixel_id ?? '')) {
                saveAppearance({ meta_pixel_id: cleaned || null });
              }
            }}
            inputMode="numeric"
            placeholder="Meta Pixel ID (e.g. 1234567890123456)"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 font-mono"
          />
          {themeBusy && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Find it in Meta Events Manager → Data sources. Leave blank to turn tracking off.</p>
      </Section>

      <Section
        title="Social icons"
        hint="Compact circles displayed at the top of your bio page. Platform is auto-detected from the destination URL."
      >
        {iconLinks.length === 0 ? (
          <EmptyHint message="No social icons yet. Use the swap button on a card below to convert it." />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => {
              // Icon-only reorder: keep the existing API.
              const list = iconLinks.map((l) => ({
                id: `link:${l.id}`,
                kind: 'link' as const,
                rawId: l.id,
              }));
              return handleDragEnd(e, list);
            }}
          >
            <SortableContext items={iconLinks.map((l) => `link:${l.id}`)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {iconLinks.map((l) => (
                  <SortableLinkRow
                    key={l.id}
                    sortableId={`link:${l.id}`}
                    link={l}
                    onSaveTitle={saveBioTitle}
                    onToggleStyle={toggleStyle}
                    onHide={hideFromBio}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </Section>

      <Section
        title="Cards & sections"
        hint="Drag to reorder. New links land at the bottom by default — add sections or image cards to organize between groups."
        action={(
          <div className="flex gap-2">
            <button
              onClick={handleAddSection}
              disabled={adding !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium disabled:opacity-50"
            >
              <Heading className="w-3.5 h-3.5" /> Section
            </button>
            <button
              onClick={handleAddImageCard}
              disabled={adding !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium disabled:opacity-50"
            >
              <ImageIcon className="w-3.5 h-3.5" /> Image card
            </button>
            <button
              onClick={handleAddEmail}
              disabled={adding !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium disabled:opacity-50"
            >
              <Mail className="w-3.5 h-3.5" /> Email signup
            </button>
            <button
              onClick={handleAddBook}
              disabled={adding !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium disabled:opacity-50"
            >
              <BookOpen className="w-3.5 h-3.5" /> Book
            </button>
          </div>
        )}
      >
        {cardItems.length === 0 ? (
          <EmptyHint message="Nothing here yet. Create a short link with 'Show on bio page' enabled, or click + Section / + Image card above." />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => handleDragEnd(e, cardItemsForReorder)}
          >
            <SortableContext items={cardItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {cardItems.map((item) => {
                  if (item.kind === 'link') {
                    return (
                      <SortableLinkRow
                        key={item.id}
                        sortableId={item.id}
                        link={item.link}
                        onSaveTitle={saveBioTitle}
                        onToggleStyle={toggleStyle}
                        onHide={hideFromBio}
                      />
                    );
                  }
                  if (item.block.type === 'section') {
                    return (
                      <SortableSectionRow
                        key={item.id}
                        sortableId={item.id}
                        block={item.block}
                        onSave={(patch) => handleSaveBlock(item.block.id, patch)}
                        onDelete={() => handleDeleteBlock(item.block.id)}
                      />
                    );
                  }
                  if (item.block.type === 'buttons') {
                    return (
                      <SortableButtonsRow
                        key={item.id}
                        sortableId={item.id}
                        block={item.block}
                        onSave={(patch) => handleSaveBlock(item.block.id, patch)}
                        onDelete={() => handleDeleteBlock(item.block.id)}
                      />
                    );
                  }
                  if (item.block.type === 'email') {
                    return (
                      <SortableEmailRow
                        key={item.id}
                        sortableId={item.id}
                        block={item.block}
                        onSave={(patch) => handleSaveBlock(item.block.id, patch)}
                        onDelete={() => handleDeleteBlock(item.block.id)}
                      />
                    );
                  }
                  if (item.block.type === 'book') {
                    return (
                      <SortableBookRow
                        key={item.id}
                        sortableId={item.id}
                        block={item.block}
                        landingPages={landingPages}
                        onSave={(patch) => handleSaveBlock(item.block.id, patch)}
                        onDelete={() => handleDeleteBlock(item.block.id)}
                      />
                    );
                  }
                  return (
                    <SortableImageRow
                      key={item.id}
                      sortableId={item.id}
                      block={item.block}
                      onSave={(patch) => handleSaveBlock(item.block.id, patch)}
                      onDelete={() => handleDeleteBlock(item.block.id)}
                      onUploadImage={(file) => handleUploadBlockImage(item.block, file)}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </Section>
    </div>
  );
}

function Section({ title, hint, action, children }: { title: string; hint: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <header className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function EmptyHint({ message }: { message: string }) {
  return (
    <div className="px-4 py-6 rounded-lg bg-slate-50 border border-dashed border-slate-200 text-sm text-slate-500 text-center">
      {message}
    </div>
  );
}

function useSortableStyle(id: string) {
  const sortable = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
  };
  return { ...sortable, style };
}

function DragHandle({ attributes, listeners }: { attributes: Record<string, unknown>; listeners: Record<string, unknown> | undefined }) {
  return (
    <button
      {...(attributes as React.HTMLAttributes<HTMLButtonElement>)}
      {...(listeners as React.HTMLAttributes<HTMLButtonElement>)}
      className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-700 p-1 shrink-0"
      aria-label="Drag to reorder"
    >
      <GripVertical className="w-4 h-4" />
    </button>
  );
}

interface LinkRowProps {
  sortableId: string;
  link: ShortLink;
  onSaveTitle: (link: ShortLink, title: string) => void;
  onToggleStyle: (link: ShortLink) => void;
  onHide: (link: ShortLink) => void;
}

function SortableLinkRow({ sortableId, link, onSaveTitle, onToggleStyle, onHide }: LinkRowProps) {
  const { attributes, listeners, setNodeRef, style } = useSortableStyle(sortableId);
  const platform = useMemo(() => detectSocialPlatform(link.destination_url), [link.destination_url]);
  const platformColor = '#' + SOCIAL_HEX[platform];
  const platformName = SOCIAL_NAMES[platform];
  const slug = SIMPLEICONS_SLUG[platform];
  const iconUrl = slug ? `https://cdn.simpleicons.org/${slug}/white` : '';

  const [titleDraft, setTitleDraft] = useState(link.bio_title);
  useEffect(() => { setTitleDraft(link.bio_title); }, [link.bio_title]);

  const isIcon = link.bio_style === 'icon';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-3 rounded-xl bg-white border border-slate-200 hover:border-slate-300 transition"
    >
      <DragHandle attributes={attributes} listeners={listeners} />
      <div
        className="w-9 h-9 rounded-lg flex-shrink-0 grid place-items-center text-white"
        style={{ background: platformColor }}
      >
        {iconUrl ? (
          <img src={iconUrl} alt="" width={20} height={20} loading="lazy" />
        ) : (
          <span className="text-xs font-semibold">{platformName.charAt(0)}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        {isIcon ? (
          <div>
            <div className="text-sm font-medium text-slate-700 truncate">{platformName}</div>
            <div className="text-xs text-slate-500 truncate">{link.destination_url}</div>
          </div>
        ) : (
          <div>
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => onSaveTitle(link, titleDraft)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              placeholder={link.label || `/${link.slug}`}
              className="w-full text-sm font-medium text-slate-800 bg-transparent border-0 focus:outline-none focus:ring-0 p-0 placeholder-slate-400"
            />
            <div className="text-xs text-slate-500 truncate mt-0.5">
              <span className="font-mono">/{link.slug}</span>
              <span className="mx-1.5 text-slate-300">·</span>
              <span>{platformName}</span>
            </div>
          </div>
        )}
      </div>
      <button
        onClick={() => onToggleStyle(link)}
        className="p-1.5 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
        title={isIcon ? 'Show as card' : 'Show as social icon'}
      >
        <ArrowLeftRight className="w-4 h-4" />
      </button>
      <button
        onClick={() => onHide(link)}
        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
        title="Hide from bio page"
      >
        <EyeOff className="w-4 h-4" />
      </button>
    </div>
  );
}

interface SectionRowProps {
  sortableId: string;
  block: BioBlock;
  onSave: (patch: Partial<BioBlock>) => void;
  onDelete: () => void;
}

function SortableSectionRow({ sortableId, block, onSave, onDelete }: SectionRowProps) {
  const { attributes, listeners, setNodeRef, style } = useSortableStyle(sortableId);
  const [title, setTitle] = useState(block.title ?? '');
  const [body, setBody] = useState(block.body ?? '');
  useEffect(() => { setTitle(block.title ?? ''); setBody(block.body ?? ''); }, [block.id, block.title, block.body]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-3 px-3 py-3 rounded-xl bg-amber-50/40 border border-amber-200/60"
    >
      <DragHandle attributes={attributes} listeners={listeners} />
      <div className="w-9 h-9 rounded-lg flex-shrink-0 grid place-items-center bg-amber-100 text-amber-700">
        <Type className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => onSave({ title })}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="Section heading"
          className="w-full text-sm font-semibold text-slate-800 bg-transparent border-0 focus:outline-none focus:ring-0 p-0 placeholder-slate-400"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => onSave({ body })}
          rows={2}
          placeholder="Optional body text — supports line breaks."
          className="w-full text-xs text-slate-600 bg-transparent border-0 focus:outline-none focus:ring-0 p-0 resize-none placeholder-slate-400"
        />
      </div>
      <button
        onClick={onDelete}
        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
        title="Delete section"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function SortableButtonsRow({ sortableId, block, onSave, onDelete }: SectionRowProps) {
  const { attributes, listeners, setNodeRef, style } = useSortableStyle(sortableId);
  const [title, setTitle] = useState(block.title ?? '');
  const [buttons, setButtons] = useState<BioButton[]>(block.buttons ?? []);
  useEffect(() => {
    setTitle(block.title ?? '');
    setButtons(block.buttons ?? []);
  }, [block.id]);

  function commit(next: BioButton[]) {
    setButtons(next);
    onSave({ buttons: next.filter((b) => b.label.trim() || b.url.trim()) });
  }
  function updateBtn(i: number, patch: Partial<BioButton>) {
    setButtons((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-3 px-3 py-3 rounded-xl bg-emerald-50/40 border border-emerald-200/60"
    >
      <DragHandle attributes={attributes} listeners={listeners} />
      <div className="w-9 h-9 rounded-lg flex-shrink-0 grid place-items-center bg-emerald-100 text-emerald-700">
        <ShoppingBag className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => onSave({ title })}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="Heading (optional, e.g. Get the book)"
          className="w-full text-sm font-semibold text-slate-800 bg-transparent border-0 focus:outline-none focus:ring-0 p-0 placeholder-slate-400"
        />
        <div className="space-y-1.5">
          {buttons.map((b, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={b.label}
                onChange={(e) => updateBtn(i, { label: e.target.value })}
                onBlur={() => commit(buttons)}
                placeholder="Amazon"
                className="w-28 px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />
              <input
                value={b.url}
                onChange={(e) => updateBtn(i, { url: e.target.value })}
                onBlur={() => commit(buttons)}
                placeholder="https://amazon.com/dp/…"
                className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />
              <button
                onClick={() => commit(buttons.filter((_, idx) => idx !== i))}
                className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
                title="Remove"
              >
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => commit([...buttons, { label: '', url: '' }])}
          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
        >
          <Plus className="w-3 h-3" /> Add retailer
        </button>
      </div>
      <button
        onClick={onDelete}
        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
        title="Delete block"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function SortableEmailRow({ sortableId, block, onSave, onDelete }: SectionRowProps) {
  const { attributes, listeners, setNodeRef, style } = useSortableStyle(sortableId);
  const [title, setTitle] = useState(block.title ?? '');
  const [body, setBody] = useState(block.body ?? '');
  const [buttonLabel, setButtonLabel] = useState(block.button_label ?? '');
  useEffect(() => {
    setTitle(block.title ?? '');
    setBody(block.body ?? '');
    setButtonLabel(block.button_label ?? '');
  }, [block.id]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-3 px-3 py-3 rounded-xl bg-sky-50/40 border border-sky-200/60"
    >
      <DragHandle attributes={attributes} listeners={listeners} />
      <div className="w-9 h-9 rounded-lg flex-shrink-0 grid place-items-center bg-sky-100 text-sky-700">
        <Mail className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => onSave({ title })}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="Heading (e.g. Join my newsletter)"
          className="w-full text-sm font-semibold text-slate-800 bg-transparent border-0 focus:outline-none focus:ring-0 p-0 placeholder-slate-400"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => onSave({ body })}
          rows={2}
          placeholder="Optional text under the heading."
          className="w-full text-xs text-slate-600 bg-transparent border-0 focus:outline-none focus:ring-0 p-0 resize-none placeholder-slate-400"
        />
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-medium text-slate-500 shrink-0">Button</label>
          <input
            value={buttonLabel}
            onChange={(e) => setButtonLabel(e.target.value)}
            onBlur={() => onSave({ button_label: buttonLabel })}
            placeholder="Subscribe"
            className="w-40 px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-sky-400"
          />
        </div>
        <KlaviyoListPicker
          value={block.klaviyo_list_id ?? null}
          onChange={(listId) => onSave({ klaviyo_list_id: listId })}
        />
        {!block.klaviyo_list_id && (
          <p className="text-[11px] text-amber-700">Pick a Klaviyo list above — the form stays hidden on your bio page until one is set.</p>
        )}
      </div>
      <button
        onClick={onDelete}
        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
        title="Delete block"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function SortableBookRow({ sortableId, block, landingPages, onSave, onDelete }: SectionRowProps & { landingPages: LandingPage[] }) {
  const { attributes, listeners, setNodeRef, style } = useSortableStyle(sortableId);
  const selected = landingPages.find((p) => p.id === block.landing_page_id) ?? null;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-3 rounded-xl bg-amber-50/40 border border-amber-200/60"
    >
      <DragHandle attributes={attributes} listeners={listeners} />
      {selected?.cover_image_url ? (
        <img src={selected.cover_image_url} alt="" className="w-9 h-12 object-cover rounded shrink-0 bg-slate-100" />
      ) : (
        <div className="w-9 h-12 rounded shrink-0 bg-amber-100 grid place-items-center text-amber-600"><BookOpen className="w-4 h-4" /></div>
      )}
      <div className="flex-1 min-w-0">
        {landingPages.length === 0 ? (
          <p className="text-xs text-amber-700">Create a Book page first (Pages tab), then pick it here.</p>
        ) : (
          <select
            value={block.landing_page_id ?? ''}
            onChange={(e) => onSave({ landing_page_id: e.target.value || null })}
            className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            <option value="">— Pick a book page —</option>
            {landingPages.map((p) => (
              <option key={p.id} value={p.id}>{p.title || `/${p.slug}`}</option>
            ))}
          </select>
        )}
        <p className="text-[11px] text-slate-400 mt-1">Shows as a card that expands to the blurb + retailer buttons, right on your bio page.</p>
      </div>
      <button
        onClick={onDelete}
        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
        title="Delete block"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

interface ImageRowProps {
  sortableId: string;
  block: BioBlock;
  onSave: (patch: Partial<BioBlock>) => void;
  onDelete: () => void;
  onUploadImage: (file: File) => Promise<void> | void;
}

function SortableImageRow({ sortableId, block, onSave, onDelete, onUploadImage }: ImageRowProps) {
  const { attributes, listeners, setNodeRef, style } = useSortableStyle(sortableId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(block.title ?? '');
  const [linkUrl, setLinkUrl] = useState(block.link_url ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTitle(block.title ?? '');
    setLinkUrl(block.link_url ?? '');
  }, [block.id, block.title, block.link_url]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      await onUploadImage(file);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-3 px-3 py-3 rounded-xl bg-violet-50/40 border border-violet-200/60"
    >
      <DragHandle attributes={attributes} listeners={listeners} />
      <div className="w-16 h-16 rounded-lg flex-shrink-0 overflow-hidden bg-white border border-slate-200 grid place-items-center">
        {block.image_url ? (
          <img src={block.image_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <ImageIcon className="w-5 h-5 text-slate-300" />
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => onSave({ title })}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="Caption (optional)"
          className="w-full text-sm font-medium text-slate-800 bg-transparent border-0 focus:outline-none focus:ring-0 p-0 placeholder-slate-400"
        />
        <input
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          onBlur={() => onSave({ link_url: linkUrl.trim() || null })}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="Where this image links to (e.g. /my-vicious-beast or https://...)"
          className="w-full text-xs text-slate-600 bg-transparent border-0 focus:outline-none focus:ring-0 p-0 placeholder-slate-400"
        />
        <div className="flex items-center gap-2 pt-1">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
            onChange={handleFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-violet-200 bg-white text-violet-700 hover:bg-violet-50 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {block.image_url ? 'Replace image' : 'Upload image'}
          </button>
        </div>
      </div>
      <button
        onClick={onDelete}
        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
        title="Delete image card"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
