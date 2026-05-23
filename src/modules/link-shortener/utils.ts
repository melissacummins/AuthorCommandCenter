const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateSlug(length = 7): string {
  const out: string[] = [];
  const rand = globalThis.crypto?.getRandomValues
    ? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(length)))
    : Array.from({ length }, () => Math.floor(Math.random() * 0xffffffff));
  for (let i = 0; i < length; i++) {
    out.push(ALPHABET[rand[i] % ALPHABET.length]);
  }
  return out.join('');
}

// Set at runtime to the signed-in user's verified custom domain so copied
// short URLs reflect THEIR domain rather than a global env default. Null
// clears the override and falls back to the env / app-domain behavior.
let baseOverride: string | null = null;

export function setShortLinkBase(base: string | null): void {
  baseOverride = base ? base.replace(/\/$/, '') : null;
}

export function getShortLinkBase(): string {
  if (baseOverride) return baseOverride;
  const fromEnv = (import.meta.env.VITE_SHORT_LINK_BASE_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined') return `${window.location.origin}/l`;
  return '/l';
}

export function buildShortUrl(slug: string): string {
  return `${getShortLinkBase()}/${slug}`;
}

export function shortHostname(): string {
  try {
    return new URL(getShortLinkBase()).host;
  } catch {
    return getShortLinkBase();
  }
}

export function shortDisplayPath(slug: string): string {
  // Display "go.example.com/abc" without protocol or /l prefix.
  try {
    const u = new URL(buildShortUrl(slug));
    return `${u.host}${u.pathname.replace(/\/l\//, '/')}`;
  } catch {
    return buildShortUrl(slug);
  }
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function isValidUrl(input: string): boolean {
  try {
    const u = new URL(normalizeUrl(input));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidSlug(slug: string): boolean {
  return /^[A-Za-z0-9_-]{3,40}$/.test(slug);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

export function formatCurrency(value: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value || 0);
  } catch {
    return `${currency} ${(value || 0).toFixed(2)}`;
  }
}

export function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function shortDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Convert ISO datetime → "YYYY-MM-DDTHH:MM" for <input type="datetime-local">
export function isoToInputLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function inputLocalToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function getFaviconUrl(destinationUrl: string): string | null {
  try {
    const u = new URL(destinationUrl);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=64`;
  } catch {
    return null;
  }
}

export function destinationHostname(destinationUrl: string): string {
  try {
    return new URL(destinationUrl).hostname.replace(/^www\./, '');
  } catch {
    return destinationUrl;
  }
}

export function linkStatus(link: {
  is_active: boolean;
  archived_at: string | null;
  starts_at: string | null;
  expires_at: string | null;
}): { label: string; tone: 'live' | 'scheduled' | 'expired' | 'inactive' | 'archived' } {
  if (link.archived_at) return { label: 'Archived', tone: 'archived' };
  if (!link.is_active) return { label: 'Inactive', tone: 'inactive' };
  const now = Date.now();
  if (link.starts_at && new Date(link.starts_at).getTime() > now) return { label: 'Scheduled', tone: 'scheduled' };
  if (link.expires_at && new Date(link.expires_at).getTime() <= now) return { label: 'Expired', tone: 'expired' };
  return { label: 'Live', tone: 'live' };
}
