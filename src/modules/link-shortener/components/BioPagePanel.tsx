import { useEffect, useMemo, useState } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical, ExternalLink, EyeOff, ArrowLeftRight, Layout,
} from 'lucide-react';
import type { ShortLink } from '../types';
import { reorderBioLinks, updateLink } from '../api';
import {
  detectSocialPlatform, SOCIAL_HEX, SOCIAL_NAMES, SIMPLEICONS_SLUG,
} from '../socialIcons';

interface Props {
  links: ShortLink[];
  onUpdated: (link: ShortLink) => void;
}

function byBioOrder(a: ShortLink, b: ShortLink): number {
  if (a.bio_sort_order !== b.bio_sort_order) return a.bio_sort_order - b.bio_sort_order;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

// Defensively coerce to absolute URL — the env var sometimes gets set without
// a protocol, in which case <a href="read.melissacummins.com"> is treated as
// a relative path and routes to /read.melissacummins.com on the current host.
function absoluteUrl(raw: string): string {
  if (!raw) return '';
  return raw.startsWith('http://') || raw.startsWith('https://')
    ? raw
    : `https://${raw}`;
}

export default function BioPagePanel({ links, onUpdated }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const bioLinks = useMemo(
    () => links.filter((l) => l.show_on_bio && l.is_active && !l.archived_at && !l.parent_id),
    [links],
  );
  const iconLinks = useMemo(
    () => bioLinks.filter((l) => l.bio_style === 'icon').sort(byBioOrder),
    [bioLinks],
  );
  const cardLinks = useMemo(
    () => bioLinks.filter((l) => l.bio_style !== 'icon').sort(byBioOrder),
    [bioLinks],
  );

  const publicBioUrl = absoluteUrl(
    (import.meta.env.VITE_SHORT_LINK_BASE_URL as string | undefined) || '',
  );

  async function handleDragEnd(event: DragEndEvent, list: ShortLink[]) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = list.findIndex((l) => l.id === active.id);
    const newIdx = list.findIndex((l) => l.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(list, oldIdx, newIdx);
    reordered.forEach((l, idx) => {
      if (l.bio_sort_order !== idx) onUpdated({ ...l, bio_sort_order: idx });
    });
    try {
      await reorderBioLinks(reordered.map((l) => l.id));
    } catch (err) {
      console.error('reorder failed', err);
    }
  }

  async function toggleStyle(link: ShortLink) {
    const next: 'card' | 'icon' = link.bio_style === 'icon' ? 'card' : 'icon';
    try {
      const updated = await updateLink(link.id, { bio_style: next });
      onUpdated(updated);
    } catch (err) {
      console.error('toggle style failed', err);
    }
  }

  async function hideFromBio(link: ShortLink) {
    try {
      const updated = await updateLink(link.id, { show_on_bio: false });
      onUpdated(updated);
    } catch (err) {
      console.error('hide failed', err);
    }
  }

  async function saveBioTitle(link: ShortLink, title: string) {
    if (title === link.bio_title) return;
    try {
      const updated = await updateLink(link.id, { bio_title: title });
      onUpdated(updated);
    } catch (err) {
      console.error('save title failed', err);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Layout className="w-5 h-5" /> Bio page
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Reorder links, set the public title, and choose how each one appears on your bio page.
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

      <Section
        title="Social icons"
        hint="Compact circles displayed at the top of your bio page. Platform is auto-detected from the destination URL."
      >
        {iconLinks.length === 0 ? (
          <EmptyHint message="No social icons yet. Use the swap button on a card below to convert it." />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEnd(e, iconLinks)}>
            <SortableContext items={iconLinks.map((l) => l.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {iconLinks.map((l) => (
                  <SortableRow
                    key={l.id}
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

      <Section title="Link cards" hint="Full-width cards displayed below the social icons row.">
        {cardLinks.length === 0 ? (
          <EmptyHint message="No link cards yet. Create a short link with 'Show on bio page' enabled." />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEnd(e, cardLinks)}>
            <SortableContext items={cardLinks.map((l) => l.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {cardLinks.map((l) => (
                  <SortableRow
                    key={l.id}
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
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section>
      <header className="mb-2">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
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

interface RowProps {
  link: ShortLink;
  onSaveTitle: (link: ShortLink, title: string) => void;
  onToggleStyle: (link: ShortLink) => void;
  onHide: (link: ShortLink) => void;
}

function SortableRow({ link, onSaveTitle, onToggleStyle, onHide }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: link.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

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
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-700 p-1"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>

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
