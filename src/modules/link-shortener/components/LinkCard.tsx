import { useState, type ReactNode } from 'react';
import {
  Copy, ExternalLink, MoreHorizontal, Tag, MousePointerClick,
  DollarSign, Calendar, ChevronDown, ChevronRight, Globe, Check,
  Pencil, Trash2, QrCode, Power, Plus,
} from 'lucide-react';
import type { LinkFolder, ShortLink } from '../types';
import {
  buildShortUrl, destinationHostname, formatCurrency, formatNumber,
  getFaviconUrl, linkStatus, shortDate, timeAgo,
} from '../utils';

interface Props {
  link: ShortLink;
  variants: ShortLink[];
  folders: LinkFolder[];
  expanded: boolean;
  onToggleExpand: () => void;
  onSelect: (l: ShortLink) => void;
  onCopy: (slug: string) => void;
  onAddVariant: (parent: ShortLink) => void;
  onShowQr: (link: ShortLink) => void;
  onToggleActive: (link: ShortLink) => void;
  onDelete: (link: ShortLink) => void;
}

const STATUS_TONES: Record<string, string> = {
  live: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  scheduled: 'bg-amber-50 text-amber-700 border-amber-200',
  expired: 'bg-surface-sunken text-content-secondary border-edge',
  inactive: 'bg-surface-sunken text-content-secondary border-edge',
  archived: 'bg-surface-sunken text-content-secondary border-edge',
};

export default function LinkCard({
  link, variants, folders, expanded, onToggleExpand,
  onSelect, onCopy, onAddVariant, onShowQr, onToggleActive, onDelete,
}: Props) {
  const folder = folders.find((f) => f.id === link.folder_id) ?? null;
  const status = linkStatus(link);
  const favicon = getFaviconUrl(link.destination_url);
  const host = destinationHostname(link.destination_url);
  const hasVariants = variants.length > 0;

  // Roll up clicks and conversion value across the parent + all its variants
  // so the parent row shows the whole campaign's footprint, not just the
  // bare-slug clicks (which is often zero when readers always come through
  // a tagged channel variant).
  const directNonBotClicks = link.non_bot_click_count ?? 0;
  const variantNonBotClicks = variants.reduce(
    (sum, v) => sum + (v.non_bot_click_count ?? 0),
    0,
  );
  const totalNonBotClicks = directNonBotClicks + variantNonBotClicks;
  const totalConversionValue =
    (link.conversion_value ?? 0) +
    variants.reduce((sum, v) => sum + (v.conversion_value ?? 0), 0);
  const rollupTitle = hasVariants
    ? `${formatNumber(directNonBotClicks)} direct + ${formatNumber(variantNonBotClicks)} from ${variants.length} ${variants.length === 1 ? 'variant' : 'variants'}`
    : `Bots filtered out${(link.click_count - directNonBotClicks) > 0 ? ` (${formatNumber(link.click_count - directNonBotClicks)} bot clicks ignored)` : ''}`;

  return (
    <div className="rounded-card border border-edge bg-surface shadow-sm hover:shadow-md hover:border-edge-strong transition">
      <div className="flex items-center gap-3 px-4 py-3 group">
        {hasVariants ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="p-1 -ml-1 text-content-muted hover:text-content rounded"
            title={expanded ? 'Collapse variants' : 'Expand variants'}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        ) : (
          <div className="w-6" />
        )}

        <Avatar src={favicon} alt={host} />

        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelect(link)}>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="text-content font-medium hover:text-indigo-600 truncate"
              onClick={(e) => {
                e.stopPropagation();
                onCopy(link.slug);
              }}
              title="Click to copy"
            >
              {buildShortUrl(link.slug).replace(/^https?:\/\//, '')}
            </button>
            <CopyButton slug={link.slug} onCopy={onCopy} />
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${STATUS_TONES[status.tone]}`}>
              {status.label}
            </span>
            {hasVariants && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                {variants.length} {variants.length === 1 ? 'variant' : 'variants'}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-content-secondary truncate">
            <span className="text-content-muted">↳</span>
            <Globe className="w-3 h-3 shrink-0 text-content-faint" />
            <span className="truncate">{link.destination_url.replace(/^https?:\/\//, '')}</span>
          </div>
          {(link.label || folder || link.channel) && (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              {folder && (
                <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-control bg-surface-hover text-content-secondary border border-edge">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: folder.color }} />
                  {folder.name}
                </span>
              )}
              {link.channel && (
                <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-control bg-pink-50 text-pink-700 border border-pink-100">
                  <Tag className="w-2.5 h-2.5" />
                  {link.channel}
                </span>
              )}
              {link.label && <span className="text-xs text-content-secondary truncate">{link.label}</span>}
            </div>
          )}
        </div>

        <div className="hidden md:flex items-center gap-3 text-xs text-content-secondary shrink-0">
          {link.starts_at && new Date(link.starts_at).getTime() > Date.now() && (
            <span className="inline-flex items-center gap-1" title={`Goes live ${shortDate(link.starts_at)}`}>
              <Calendar className="w-3.5 h-3.5" /> {shortDate(link.starts_at)}
            </span>
          )}
          <span className="text-content-muted tabular-nums" title={`Created ${shortDate(link.created_at)}`}>
            {timeAgo(link.created_at)}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {totalConversionValue > 0 && (
            <Pill icon={<DollarSign className="w-3.5 h-3.5" />} value={formatCurrency(totalConversionValue)} tone="emerald" />
          )}
          <Pill
            icon={<MousePointerClick className="w-3.5 h-3.5" />}
            value={formatNumber(totalNonBotClicks)}
            label="clicks"
            tone="indigo"
            onClick={() => onSelect(link)}
            title={rollupTitle}
          />
          <KebabMenu
            link={link}
            onSelect={onSelect}
            onCopy={onCopy}
            onAddVariant={() => onAddVariant(link)}
            onShowQr={() => onShowQr(link)}
            onToggleActive={() => onToggleActive(link)}
            onDelete={() => onDelete(link)}
          />
        </div>
      </div>

      {expanded && hasVariants && (
        <div className="border-t border-edge-soft bg-surface-hover/40 rounded-b-card px-3 py-2 space-y-1">
          {variants.map((v) => {
            const variantNonBot = v.non_bot_click_count ?? 0;
            const variantBots = v.click_count - variantNonBot;
            return (
              <div
                key={v.id}
                onClick={() => onSelect(v)}
                className="flex items-center gap-3 px-3 py-2 rounded-control hover:bg-surface cursor-pointer group"
              >
                <Avatar src={getFaviconUrl(v.destination_url)} alt={destinationHostname(v.destination_url)} small />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-content font-medium truncate">
                      {buildShortUrl(v.slug).replace(/^https?:\/\//, '')}
                    </span>
                    {v.channel && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-control bg-pink-50 text-pink-700 border border-pink-100">
                        {v.channel}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-content-secondary truncate">{v.destination_url.replace(/^https?:\/\//, '')}</div>
                </div>
                <div
                  className="flex items-center gap-2 text-xs text-content-secondary tabular-nums shrink-0"
                  title={variantBots > 0 ? `${formatNumber(variantBots)} bot clicks ignored` : 'Bots filtered out'}
                >
                  <MousePointerClick className="w-3 h-3" /> {formatNumber(variantNonBot)}
                </div>
                <CopyButton slug={v.slug} onCopy={onCopy} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Avatar({ src, alt, small }: { src: string | null; alt: string; small?: boolean }) {
  const [errored, setErrored] = useState(false);
  const sizeClass = small ? 'w-7 h-7' : 'w-9 h-9';
  if (!src || errored) {
    return (
      <div className={`${sizeClass} rounded-full bg-gradient-to-br from-slate-100 to-slate-200 grid place-items-center shrink-0`}>
        <Globe className={small ? 'w-3.5 h-3.5 text-content-muted' : 'w-4 h-4 text-content-muted'} />
      </div>
    );
  }
  return (
    <div className={`${sizeClass} rounded-full bg-surface border border-edge grid place-items-center shrink-0 overflow-hidden`}>
      <img src={src} alt={alt} className={small ? 'w-4 h-4' : 'w-5 h-5'} onError={() => setErrored(true)} />
    </div>
  );
}

interface PillProps {
  icon: ReactNode;
  value: string;
  label?: string;
  tone?: 'indigo' | 'emerald';
  onClick?: () => void;
  title?: string;
}

function Pill({ icon, value, label, tone = 'indigo', onClick, title }: PillProps) {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100',
  };
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-control border text-xs font-medium tabular-nums ${tones[tone]} ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {icon}
      <span>{value}</span>
      {label && <span className="text-content-muted hidden sm:inline">{label}</span>}
    </button>
  );
}

function CopyButton({ slug, onCopy }: { slug: string; onCopy: (slug: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onCopy(slug);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="p-1 text-content-muted hover:text-indigo-600 rounded transition-opacity opacity-0 group-hover:opacity-100"
      title="Copy short URL"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function KebabMenu({
  link, onSelect, onCopy, onAddVariant, onShowQr, onToggleActive, onDelete,
}: {
  link: ShortLink;
  onSelect: (l: ShortLink) => void;
  onCopy: (slug: string) => void;
  onAddVariant: () => void;
  onShowQr: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="p-1.5 text-content-muted hover:text-content hover:bg-surface-sunken rounded-control"
        title="Actions"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-40 w-44 bg-surface rounded-card border border-edge shadow-lg py-1 text-sm">
            <MenuItem icon={<Pencil className="w-3.5 h-3.5" />} label="Edit" onClick={() => { setOpen(false); onSelect(link); }} />
            <MenuItem icon={<Copy className="w-3.5 h-3.5" />} label="Copy short URL" onClick={() => { setOpen(false); onCopy(link.slug); }} />
            <MenuItem icon={<QrCode className="w-3.5 h-3.5" />} label="QR code" onClick={() => { setOpen(false); onShowQr(); }} />
            <a
              href={link.destination_url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
              className="flex items-center gap-2 px-3 py-1.5 text-content hover:bg-surface-hover"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open destination
            </a>
            {!link.parent_id && (
              <MenuItem icon={<Plus className="w-3.5 h-3.5" />} label="Channel variant" onClick={() => { setOpen(false); onAddVariant(); }} />
            )}
            <div className="my-1 border-t border-edge-soft" />
            <MenuItem icon={<Power className="w-3.5 h-3.5" />} label={link.is_active ? 'Deactivate' : 'Activate'} onClick={() => { setOpen(false); onToggleActive(); }} />
            <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} label="Delete" tone="red" onClick={() => { setOpen(false); onDelete(); }} />
          </div>
        </>
      )}
    </div>
  );
}

interface MenuItemProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'red';
}

function MenuItem({ icon, label, onClick, tone = 'default' }: MenuItemProps) {
  const cls = tone === 'red' ? 'text-red-600 hover:bg-red-50' : 'text-content hover:bg-surface-hover';
  return (
    <button onClick={onClick} className={`w-full text-left flex items-center gap-2 px-3 py-1.5 ${cls}`}>
      {icon} <span>{label}</span>
    </button>
  );
}
