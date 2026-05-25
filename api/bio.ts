// Public link-in-bio page.
//
// Renders the user's active, live, non-archived bio items — a mix of
// short_links (with show_on_bio = true) and bio_blocks rows (sections,
// image cards) ordered by their shared bio_sort_order. Designed for
// readers who land on the bare short-link domain.
//
// Required env vars on Vercel:
//   SUPABASE_URL              - same as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY - server-side only
//   BIO_USER_ID               - the auth.users.id whose links to show
// Optional:
//   BIO_TITLE                 - heading on the page (default "Links")
//   BIO_SUBTITLE              - tagline below the heading
import { createClient } from '@supabase/supabase-js';
import { createDecipheriv, scryptSync } from 'node:crypto';

type VercelRequest = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => VercelResponse;
  send: (body: string) => void;
  json: (body: unknown) => void;
  end: () => void;
};

interface BioLink {
  slug: string;
  label: string | null;
  destination_url: string;
  starts_at: string | null;
  expires_at: string | null;
  bio_title: string | null;
  bio_style: 'card' | 'icon';
  bio_featured: boolean;
  bio_sort_order: number;
  thumbnail_url: string | null;
  created_at: string;
}

interface BioButtonRow {
  label: string;
  url: string;
}

interface BioBlockRow {
  id: string;
  type: 'section' | 'image' | 'buttons' | 'email';
  title: string | null;
  body: string | null;
  image_url: string | null;
  link_url: string | null;
  buttons: BioButtonRow[] | null;
  klaviyo_list_id: string | null;
  button_label: string | null;
  bio_sort_order: number;
  created_at: string;
}

// ---------- Inlined social-platform detection ----------

type Platform =
  | 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'x' | 'threads'
  | 'pinterest' | 'patreon' | 'substack' | 'spotify' | 'applemusic'
  | 'linkedin' | 'github' | 'tumblr' | 'bluesky' | 'kofi' | 'twitch'
  | 'discord' | 'goodreads' | 'amazon' | 'shopify' | 'website' | 'email';

const HEX: Record<Platform, string> = {
  instagram: 'E4405F', tiktok: '000000', youtube: 'FF0000', facebook: '1877F2',
  x: '000000', threads: '000000', pinterest: 'BD081C', patreon: 'FF424D',
  substack: 'FF6719', spotify: '1DB954', applemusic: 'FA243C', linkedin: '0A66C2',
  github: '181717', tumblr: '36465D', bluesky: '0085FF', kofi: 'FF5E5B',
  twitch: '9146FF', discord: '5865F2', goodreads: '372213', amazon: 'FF9900',
  shopify: '7AB55C', website: '64748B', email: '64748B',
};
const NAME: Record<Platform, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook',
  x: 'X', threads: 'Threads', pinterest: 'Pinterest', patreon: 'Patreon',
  substack: 'Substack', spotify: 'Spotify', applemusic: 'Apple Music', linkedin: 'LinkedIn',
  github: 'GitHub', tumblr: 'Tumblr', bluesky: 'Bluesky', kofi: 'Ko-fi',
  twitch: 'Twitch', discord: 'Discord', goodreads: 'Goodreads', amazon: 'Amazon',
  shopify: 'Shop', website: 'Website', email: 'Email',
};
const SLUG: Record<Platform, string | null> = {
  instagram: 'instagram', tiktok: 'tiktok', youtube: 'youtube', facebook: 'facebook',
  x: 'x', threads: 'threads', pinterest: 'pinterest', patreon: 'patreon',
  substack: 'substack', spotify: 'spotify', applemusic: 'applemusic', linkedin: 'linkedin',
  github: 'github', tumblr: 'tumblr', bluesky: 'bluesky', kofi: 'kofi',
  twitch: 'twitch', discord: 'discord', goodreads: 'goodreads', amazon: 'amazon',
  shopify: 'shopify', website: null, email: null,
};

function detectPlatform(url: string): Platform {
  try {
    const u = new URL(url);
    if (u.protocol === 'mailto:') return 'email';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host.endsWith('instagram.com')) return 'instagram';
    if (host.endsWith('tiktok.com')) return 'tiktok';
    if (host.endsWith('youtube.com') || host === 'youtu.be') return 'youtube';
    if (host.endsWith('facebook.com') || host === 'fb.me' || host === 'fb.com' || host === 'm.me') return 'facebook';
    if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.twitter.com')) return 'x';
    if (host.endsWith('threads.net') || host.endsWith('threads.com')) return 'threads';
    if (host.endsWith('pinterest.com') || host === 'pin.it') return 'pinterest';
    if (host.endsWith('patreon.com')) return 'patreon';
    if (host.endsWith('substack.com') || host.endsWith('.substack.com')) return 'substack';
    if (host.endsWith('spotify.com') || host === 'open.spotify.com') return 'spotify';
    if (host === 'music.apple.com') return 'applemusic';
    if (host.endsWith('linkedin.com')) return 'linkedin';
    if (host.endsWith('github.com')) return 'github';
    if (host.endsWith('tumblr.com')) return 'tumblr';
    if (host.endsWith('bsky.app') || host.endsWith('bsky.social')) return 'bluesky';
    if (host.endsWith('ko-fi.com')) return 'kofi';
    if (host.endsWith('twitch.tv')) return 'twitch';
    if (host === 'discord.gg' || host.endsWith('discord.com')) return 'discord';
    if (host.endsWith('goodreads.com')) return 'goodreads';
    if (host.includes('amazon.')) return 'amazon';
    if (host.endsWith('myshopify.com') || host.startsWith('shop.')) return 'shopify';
    return 'website';
  } catch {
    return 'website';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// ---------- Bio page themes ----------
// Preset palettes. `accent_color` on bio_settings overrides `accent` per
// user. Keep ids in sync with src/modules/link-shortener/bioThemes.ts
// (that file only carries swatch colors for the picker; this is the source
// of truth for what actually renders).
interface Theme {
  bg: string;      // body background (may be a gradient)
  text: string;    // primary text
  muted: string;   // secondary text
  surface: string; // card background
  border: string;  // card border
  accent: string;  // links/buttons highlight
  dark: boolean;
}

const THEMES: Record<string, Theme> = {
  classic:  { bg: 'linear-gradient(180deg, #fafafc 0%, #eef2ff 60%, #f5f3ff 100%)', text: '#1e293b', muted: '#64748b', surface: '#ffffff', border: '#e2e8f0', accent: '#6366f1', dark: false },
  midnight: { bg: 'linear-gradient(180deg, #0f172a 0%, #1e1b4b 100%)',              text: '#e2e8f0', muted: '#94a3b8', surface: '#1e293b', border: '#334155', accent: '#818cf8', dark: true  },
  blush:    { bg: 'linear-gradient(180deg, #fff5f7 0%, #ffe9ef 100%)',              text: '#4a2c33', muted: '#9b6b76', surface: '#ffffff', border: '#fbd5de', accent: '#e85d75', dark: false },
  cream:    { bg: 'linear-gradient(180deg, #fdf8f0 0%, #f7ede0 100%)',              text: '#443726', muted: '#8a7a63', surface: '#fffdf8', border: '#ece0cf', accent: '#b5793f', dark: false },
  forest:   { bg: 'linear-gradient(180deg, #f3f7f3 0%, #e4efe6 100%)',              text: '#1f2e22', muted: '#5b7060', surface: '#ffffff', border: '#d3e2d5', accent: '#2f7d4f', dark: false },
  noir:     { bg: '#0a0a0a',                                                        text: '#f5f5f5', muted: '#a3a3a3', surface: '#171717', border: '#2a2a2a', accent: '#e5e5e5', dark: true  },
};

function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(v)) return `#${v.split('').map((c) => c + c).join('').toLowerCase()}`;
  return null;
}

function resolveTheme(themeId: string | null | undefined, accentOverride: string | null | undefined): Theme {
  const base = THEMES[themeId ?? 'classic'] ?? THEMES.classic;
  const accent = normalizeHex(accentOverride) ?? base.accent;
  return { ...base, accent };
}

function renderIconLink(link: BioLink): string {
  const platform = detectPlatform(link.destination_url);
  const color = HEX[platform];
  const name = NAME[platform];
  const slug = SLUG[platform];
  const inner = slug
    ? `<img src="https://cdn.simpleicons.org/${slug}/white" alt="" width="22" height="22" loading="lazy" />`
    : platform === 'email'
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  return `<a class="icon" href="/${escapeHtml(link.slug)}" aria-label="${escapeHtml(name)}" style="background:#${color}">${inner}</a>`;
}

function renderCardLink(link: BioLink, ogImageByDest: Map<string, string | null>, featured = false): string {
  const display = (link.bio_title && link.bio_title.trim())
    || (link.label && link.label.trim())
    || link.slug;
  const thumb = link.thumbnail_url || ogImageByDest.get(link.destination_url) || null;
  const thumbHtml = thumb
    ? `<img class="link-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" />`
    : '';
  const tag = featured ? `<span class="featured-tag">Featured</span>` : '';
  return `<a class="link${thumb ? ' link-with-thumb' : ''}${featured ? ' link-featured' : ''}" href="/${escapeHtml(link.slug)}">
    ${tag}
    ${thumbHtml}
    <span class="link-label">${escapeHtml(display)}</span>
    <span class="link-arrow" aria-hidden="true">→</span>
  </a>`;
}

function renderSectionBlock(block: BioBlockRow): string {
  const title = block.title?.trim();
  const body = block.body?.trim();
  if (!title && !body) return '';
  return `<div class="section">
    ${title ? `<h2 class="section-title">${escapeHtml(title)}</h2>` : ''}
    ${body ? `<p class="section-body">${escapeHtml(body)}</p>` : ''}
  </div>`;
}

function renderImageBlock(block: BioBlockRow): string {
  if (!block.image_url) return '';
  const href = (block.link_url && block.link_url.trim()) || '';
  const inner = `<img src="${escapeHtml(block.image_url)}" alt="${escapeHtml(block.title || '')}" loading="lazy" />
    ${block.title ? `<span class="hero-caption">${escapeHtml(block.title)}</span>` : ''}`;
  if (!href) {
    return `<div class="hero-card">${inner}</div>`;
  }
  return `<a class="hero-card" href="${escapeHtml(href)}">${inner}</a>`;
}

// Brand icon for a retailer button. Uses Simple Icons for stores we
// recognize, and falls back to the destination's favicon so any retailer
// still shows a real mark rather than a broken image.
function retailerIconSrc(url: string): string {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { /* invalid url */ }
  const known: [RegExp, string][] = [
    [/(^|\.)amazon\.|(^|\.)amzn\./, 'amazon'],
    [/(^|\.)audible\./, 'audible'],
    [/books\.apple\.com|itunes\.apple\.com|(^|\.)apple\.co$/, 'apple'],
    [/play\.google\.com/, 'googleplay'],
    [/(^|\.)goodreads\.com/, 'goodreads'],
    [/(^|\.)smashwords\.com/, 'smashwords'],
  ];
  for (const [re, slug] of known) {
    if (re.test(host)) return `https://cdn.simpleicons.org/${slug}`;
  }
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : '';
}

function renderButtonsBlock(block: BioBlockRow): string {
  const buttons = (Array.isArray(block.buttons) ? block.buttons : [])
    .filter((b) => b && typeof b.url === 'string' && b.url.trim() && typeof b.label === 'string' && b.label.trim());
  if (buttons.length === 0) return '';
  const title = block.title?.trim();
  const head = title ? `<h2 class="section-title">${escapeHtml(title)}</h2>` : '';
  const cells = buttons.map((b) => {
    const icon = retailerIconSrc(b.url);
    const iconHtml = icon ? `<img class="rbtn-icon" src="${escapeHtml(icon)}" alt="" loading="lazy" />` : '';
    return `<a class="rbtn" href="${escapeHtml(b.url)}" rel="noopener nofollow">
      ${iconHtml}<span class="rbtn-label">${escapeHtml(b.label)}</span>
    </a>`;
  }).join('');
  return `${head}<div class="rbtns">${cells}</div>`;
}

type CardItem =
  | { kind: 'link'; data: BioLink }
  | { kind: 'block'; data: BioBlockRow };

function renderEmailBlock(block: BioBlockRow): string {
  const listId = block.klaviyo_list_id?.trim();
  if (!listId) return '';
  const title = block.title?.trim();
  const body = block.body?.trim();
  const button = block.button_label?.trim() || 'Subscribe';
  return `<form class="signup" data-list="${escapeHtml(listId)}">
    ${title ? `<h2 class="section-title">${escapeHtml(title)}</h2>` : ''}
    ${body ? `<p class="section-body">${escapeHtml(body)}</p>` : ''}
    <div class="signup-row">
      <input class="signup-input" type="email" name="email" required placeholder="you@email.com" autocomplete="email" />
      <button class="signup-btn" type="submit">${escapeHtml(button)}</button>
    </div>
    <p class="signup-msg" hidden></p>
  </form>`;
}

function renderCardItem(item: CardItem, ogImageByDest: Map<string, string | null>): string {
  if (item.kind === 'link') return renderCardLink(item.data, ogImageByDest);
  if (item.data.type === 'section') return renderSectionBlock(item.data);
  if (item.data.type === 'image') return renderImageBlock(item.data);
  if (item.data.type === 'buttons') return renderButtonsBlock(item.data);
  if (item.data.type === 'email') return renderEmailBlock(item.data);
  return '';
}

// Meta (Facebook) Pixel base code. Pixel IDs are numeric, so we sanitize
// to digits before interpolating — no user text reaches the inline script.
function metaPixelScript(rawId: string | null | undefined): string {
  const id = (rawId ?? '').replace(/[^0-9]/g, '');
  if (!id) return '';
  return `<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${id}');fbq('track','PageView');
</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1" alt="" /></noscript>`;
}

interface RenderOptions {
  title: string;
  subtitle: string;
  logoUrl: string | null;
  iconLinks: BioLink[];
  featuredLinks?: BioLink[];
  cardItems: CardItem[];
  ogImageByDest: Map<string, string | null>;
  theme?: Theme;
  metaPixelId?: string | null;
}

function renderPage({ title, subtitle, logoUrl, iconLinks, featuredLinks, cardItems, ogImageByDest, theme, metaPixelId }: RenderOptions): string {
  const t = theme ?? resolveTheme(null, null);
  const featured = featuredLinks ?? [];
  const pixelHtml = metaPixelScript(metaPixelId);
  const initial = title.trim().charAt(0).toUpperCase() || 'M';
  const headerVisual = logoUrl
    ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(title)}" />`
    : `<div class="dot">${escapeHtml(initial)}</div>`;
  const iconsHtml = iconLinks.length
    ? `<div class="icons">${iconLinks.map(renderIconLink).join('')}</div>`
    : '';
  const featuredHtml = featured.length
    ? `<div class="links featured-group">${featured.map((l) => renderCardLink(l, ogImageByDest, true)).join('')}</div>`
    : '';
  const cardsHtml = cardItems.length
    ? `<div class="links">${cardItems.map((i) => renderCardItem(i, ogImageByDest)).join('')}</div>`
    : '';
  const empty = !iconLinks.length && !cardItems.length && !featured.length
    ? `<p class="empty">No links to show right now — check back soon.</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="${escapeHtml(subtitle || title)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(subtitle || '')}" />
${logoUrl ? `<meta property="og:image" content="${escapeHtml(logoUrl)}" />` : ''}
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary" />
<title>${escapeHtml(title)}</title>
${pixelHtml}
<style>
:root {
  color-scheme: ${t.dark ? 'dark' : 'light'};
  --bg: ${t.bg};
  --text: ${t.text};
  --muted: ${t.muted};
  --surface: ${t.surface};
  --border: ${t.border};
  --accent: ${t.accent};
  --accent-soft: ${t.accent}2e;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  display: flex; flex-direction: column; align-items: center;
  padding: 48px 20px 64px;
}
.wrap { width: 100%; max-width: 480px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.dot {
  width: 88px; height: 88px; border-radius: 24px;
  background: var(--accent);
  display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 36px;
  letter-spacing: -0.02em; box-shadow: 0 18px 40px -16px var(--accent-soft);
}
.logo {
  width: 88px; height: 88px; border-radius: 24px;
  object-fit: cover;
  background: var(--surface);
  box-shadow: 0 18px 40px -16px rgba(15, 23, 42, 0.25);
  display: block;
}
h1 { margin: 4px 0 0; font-size: 26px; letter-spacing: -0.015em; text-align: center; color: var(--text); }
.subtitle {
  margin: 0; color: var(--muted); font-size: 15px; text-align: center;
  max-width: 340px; line-height: 1.5;
}
.icons {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 10px;
  margin-top: 4px; padding: 0 4px;
}
.icon {
  width: 44px; height: 44px; border-radius: 50%;
  display: grid; place-items: center; color: #fff;
  text-decoration: none;
  transition: transform 120ms ease, box-shadow 120ms ease;
  box-shadow: 0 8px 20px -10px rgba(15, 23, 42, 0.35);
}
.icon:hover { transform: translateY(-2px); box-shadow: 0 16px 28px -14px rgba(15, 23, 42, 0.45); }
.icon:active { transform: translateY(0); }
.icon img { display: block; }
.links { width: 100%; display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
.link {
  position: relative; display: flex; align-items: center; gap: 12px;
  padding: 14px 44px 14px 16px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
  text-decoration: none; color: inherit;
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
}
.link:hover { transform: translateY(-1px); border-color: var(--accent); box-shadow: 0 12px 28px -16px var(--accent-soft); }
.link:active { transform: translateY(0); }
.featured-group { margin-top: 12px; }
.link-featured { border-color: var(--accent); border-width: 2px; box-shadow: 0 10px 28px -16px var(--accent-soft); }
.link-featured .link-label { font-weight: 700; }
.featured-tag {
  position: absolute; top: -9px; left: 14px;
  background: var(--accent); color: #fff;
  font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 2px 8px; border-radius: 999px;
}
.link-with-thumb { padding-left: 12px; }
.link-thumb {
  width: 48px; height: 48px; object-fit: cover; border-radius: 10px;
  flex-shrink: 0; background: var(--border);
}
.link-label { font-weight: 600; font-size: 15px; color: var(--text); line-height: 1.35; flex: 1; min-width: 0; }
.link-arrow {
  position: absolute; right: 18px; top: 50%; transform: translateY(-50%);
  color: var(--muted); font-size: 18px;
  transition: color 120ms ease, transform 120ms ease;
}
.link:hover .link-arrow { color: var(--accent); transform: translateY(-50%) translateX(2px); }
.section {
  width: 100%; text-align: center; padding: 8px 4px; margin: 6px 0 2px;
}
.section-title {
  font-size: 17px; font-weight: 700; color: var(--text);
  margin: 0 0 4px; letter-spacing: -0.01em;
}
.section-body {
  font-size: 14px; color: var(--muted); line-height: 1.55; margin: 0;
  white-space: pre-line;
}
.hero-card {
  display: block; width: 100%; border-radius: 16px; overflow: hidden;
  text-decoration: none; color: white; position: relative;
  background: var(--surface); box-shadow: 0 6px 20px -10px rgba(15, 23, 42, 0.18);
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.hero-card:hover { transform: translateY(-2px); box-shadow: 0 16px 32px -16px rgba(15, 23, 42, 0.3); }
.hero-card img { width: 100%; height: auto; display: block; }
.hero-caption {
  position: absolute; bottom: 0; left: 0; right: 0;
  padding: 12px 18px; font-weight: 600; font-size: 15px;
  background: linear-gradient(0deg, rgba(0,0,0,0.65), transparent);
  color: white;
}
.rbtns { width: 100%; display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 6px; }
.rbtn {
  display: flex; align-items: center; justify-content: center; gap: 9px;
  padding: 12px 14px; border-radius: 14px;
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  text-decoration: none; font-weight: 600; font-size: 14px;
  transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}
.rbtn:hover { transform: translateY(-1px); border-color: var(--accent); box-shadow: 0 12px 28px -16px var(--accent-soft); }
.rbtn-icon { width: 20px; height: 20px; object-fit: contain; flex-shrink: 0; }
.rbtn-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 360px) { .rbtns { grid-template-columns: 1fr; } }
.signup {
  width: 100%; margin-top: 6px; padding: 18px 16px; border-radius: 16px;
  background: var(--surface); border: 1px solid var(--border); text-align: center;
}
.signup .section-title, .signup .section-body { margin-top: 0; }
.signup-row { display: flex; gap: 8px; margin-top: 10px; }
.signup-input {
  flex: 1; min-width: 0; padding: 11px 13px; font-size: 14px;
  border: 1px solid var(--border); border-radius: 12px;
  background: var(--bg); color: var(--text);
}
.signup-input:focus { outline: none; border-color: var(--accent); }
.signup-btn {
  padding: 11px 16px; font-size: 14px; font-weight: 600; white-space: nowrap;
  border: 0; border-radius: 12px; cursor: pointer;
  background: var(--accent); color: #fff;
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.signup-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 28px -16px var(--accent-soft); }
.signup-btn:disabled { opacity: 0.6; cursor: default; transform: none; }
.signup-msg { margin: 10px 0 0; font-size: 13px; }
.signup-msg.ok { color: var(--accent); }
.signup-msg.err { color: #e11d48; }
@media (max-width: 360px) { .signup-row { flex-direction: column; } }
.empty { margin-top: 12px; color: var(--muted); font-size: 14px; text-align: center; }
.foot { margin-top: 24px; font-size: 11px; color: var(--muted); opacity: 0.7; letter-spacing: 0.06em; text-transform: uppercase; }
</style>
</head>
<body>
<main class="wrap">
  ${headerVisual}
  <h1>${escapeHtml(title)}</h1>
  ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
  ${iconsHtml}
  ${featuredHtml}
  ${cardsHtml || empty}
  <div class="foot">All links</div>
</main>
<img src="/api/bv" alt="" width="1" height="1" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" aria-hidden="true" />
<script>
(function () {
  var forms = document.querySelectorAll('form.signup');
  for (var i = 0; i < forms.length; i++) {
    forms[i].addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.currentTarget;
      var input = form.querySelector('.signup-input');
      var btn = form.querySelector('.signup-btn');
      var msg = form.querySelector('.signup-msg');
      var email = (input && input.value || '').trim();
      if (!email) return;
      function show(text, ok) {
        if (!msg) return;
        msg.textContent = text;
        msg.className = 'signup-msg ' + (ok ? 'ok' : 'err');
        msg.hidden = false;
      }
      if (btn) { btn.disabled = true; }
      fetch('/api/bio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, list: form.getAttribute('data-list') })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; });
      }).then(function (res) {
        if (res.ok) {
          form.querySelector('.signup-row').style.display = 'none';
          show("You're subscribed — thank you!", true);
        } else {
          show((res.d && res.d.error) || 'Something went wrong. Please try again.', false);
          if (btn) { btn.disabled = false; }
        }
      }).catch(function () {
        show('Something went wrong. Please try again.', false);
        if (btn) { btn.disabled = false; }
      });
    });
  }
})();
</script>
</body>
</html>`;
}

function sendHtml(res: VercelResponse, html: string, status: number, cacheable: boolean) {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader(
    'cache-control',
    cacheable
      // Short edge cache so admin edits surface within ~30 seconds.
      // SWR window keeps the page snappy for readers while we revalidate.
      ? 'public, max-age=15, s-maxage=30, stale-while-revalidate=300'
      : 'no-store',
  );
  res.status(status).send(html);
}

function hostHeader(req: VercelRequest): string {
  const v = req.headers['host'];
  const raw = Array.isArray(v) ? v[0] : v;
  return (raw ?? '').toLowerCase().split(':')[0];
}

// ---------- Public newsletter signup (POST to this same endpoint) ----------
// Folded in here rather than a separate /api function to stay under the
// Vercel Hobby 12-function limit. Mirrors the Klaviyo crypto in
// api/klaviyo/[action].ts (scrypt salt + AES-256-GCM).
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function decryptKlaviyoKey(
  row: { encrypted_key: string; nonce: string; auth_tag: string },
  masterSecret: string,
): string | null {
  try {
    const key = scryptSync(masterSecret, 'marketing-klaviyo-key-v1', 32);
    const iv = Buffer.from(row.nonce, 'base64');
    const ciphertext = Buffer.from(row.encrypted_key, 'base64');
    const authTag = Buffer.from(row.auth_tag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

async function handleSubscribe(req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const masterSecret = process.env.KLAVIYO_KEY_ENCRYPTION_SECRET;
  if (!supabaseUrl || !serviceKey || !masterSecret) {
    res.status(500).json({ error: 'Signup is not configured.' });
    return;
  }

  let body: { email?: unknown; list?: unknown };
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as { email?: unknown; list?: unknown };
  } catch {
    res.status(400).json({ error: 'Invalid request.' });
    return;
  }
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const listId = typeof body?.list === 'string' ? body.list.trim() : '';
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  if (!listId) {
    res.status(400).json({ error: 'This signup form is not finished being set up.' });
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const host = hostHeader(req);
  let userId: string | null = null;
  if (host) {
    const { data } = await supabase
      .from('custom_domains')
      .select('user_id')
      .eq('domain', host)
      .eq('verified', true)
      .maybeSingle();
    if (data) userId = data.user_id;
  }
  if (!userId) userId = process.env.BIO_USER_ID || null;
  if (!userId) {
    res.status(404).json({ error: 'Unknown signup form.' });
    return;
  }

  // Only allow lists the author actually wired to a bio email block.
  const { data: block } = await supabase
    .from('bio_blocks')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'email')
    .eq('klaviyo_list_id', listId)
    .limit(1)
    .maybeSingle();
  if (!block) {
    res.status(400).json({ error: 'This signup form is no longer available.' });
    return;
  }

  const { data: keyRow } = await supabase
    .from('user_klaviyo_keys')
    .select('encrypted_key, nonce, auth_tag')
    .eq('user_id', userId)
    .maybeSingle();
  if (!keyRow?.encrypted_key || !keyRow.nonce || !keyRow.auth_tag) {
    res.status(400).json({ error: 'Signups are not available right now.' });
    return;
  }
  const klaviyoKey = decryptKlaviyoKey(keyRow, masterSecret);
  if (!klaviyoKey) {
    res.status(500).json({ error: 'Signups are not available right now.' });
    return;
  }

  try {
    const kRes = await fetch('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/', {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${klaviyoKey}`,
        revision: '2024-10-15',
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          type: 'profile-subscription-bulk-create-job',
          attributes: {
            profiles: {
              data: [{
                type: 'profile',
                attributes: {
                  email,
                  subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } },
                },
              }],
            },
          },
          relationships: { list: { data: { type: 'list', id: listId } } },
        },
      }),
    });
    if (!kRes.ok && kRes.status !== 202) {
      const detail = await kRes.text().catch(() => '');
      res.status(502).json({ error: 'Could not complete signup. Please try again.', detail: detail.slice(0, 300) });
      return;
    }
  } catch {
    res.status(502).json({ error: 'Could not reach the mailing list. Please try again.' });
    return;
  }

  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ ok: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    return handleSubscribe(req, res);
  }
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const envOwner = process.env.BIO_USER_ID || null;
    let title = 'Links';
    let subtitle = '';

    if (!supabaseUrl || !serviceKey) {
      sendHtml(res, renderPage({ title, subtitle: 'Bio page is not configured yet.', logoUrl: null, iconLinks: [], cardItems: [], ogImageByDest: new Map() }), 500, false);
      return;
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Resolve which user's bio to render from the domain the page was served
    // on. Falls back to the legacy single-tenant BIO_USER_ID env var so the
    // owner's existing setup keeps working even before a domain is seeded.
    const host = hostHeader(req);
    let userId: string | null = null;
    if (host) {
      const { data: dom } = await supabase
        .from('custom_domains')
        .select('user_id')
        .eq('domain', host)
        .eq('verified', true)
        .maybeSingle();
      if (dom) userId = dom.user_id;
    }
    if (!userId) userId = envOwner;

    if (!userId) {
      sendHtml(
        res,
        renderPage({ title, subtitle: 'This domain is not connected to a bio page yet.', logoUrl: null, iconLinks: [], cardItems: [], ogImageByDest: new Map() }),
        200, false,
      );
      return;
    }

    // Title/subtitle defaults: the owner keeps their env-configured heading;
    // everyone else defaults to a generic heading. Per-user bio_settings
    // override either below.
    if (userId === envOwner) {
      title = process.env.BIO_TITLE || 'Links';
      subtitle = process.env.BIO_SUBTITLE || '';
    }

    // Fetch links + blocks + settings in parallel.
    const linksPromise = supabase
      .from('short_links')
      .select('slug, label, destination_url, starts_at, expires_at, bio_title, bio_style, bio_featured, bio_sort_order, thumbnail_url, created_at')
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('show_on_bio', true)
      .is('parent_id', null)
      .is('archived_at', null)
      .limit(200);

    const blocksPromise = supabase
      .from('bio_blocks')
      .select('id, type, title, body, image_url, link_url, buttons, klaviyo_list_id, button_label, bio_sort_order, created_at')
      .eq('user_id', userId)
      .order('bio_sort_order', { ascending: true })
      .limit(100)
      .then(
        (r) => r,
        () => ({ data: [] as BioBlockRow[], error: null }),
      );

    const settingsPromise = supabase
      .from('bio_settings')
      .select('logo_url, bio_title, bio_subtitle, theme, accent_color, meta_pixel_id')
      .eq('user_id', userId)
      .maybeSingle();

    const [linksRes, blocksRes, settingsRes] = await Promise.all([
      linksPromise,
      blocksPromise,
      settingsPromise,
    ]);

    if (linksRes.error) {
      sendHtml(res, renderPage({ title, subtitle, logoUrl: null, iconLinks: [], cardItems: [], ogImageByDest: new Map() }), 200, false);
      return;
    }

    const logoUrl = settingsRes.data?.logo_url ?? null;
    if (settingsRes.data?.bio_title?.trim()) title = settingsRes.data.bio_title.trim();
    if (settingsRes.data?.bio_subtitle?.trim()) subtitle = settingsRes.data.bio_subtitle.trim();
    const theme = resolveTheme(settingsRes.data?.theme, settingsRes.data?.accent_color);
    const metaPixelId = settingsRes.data?.meta_pixel_id ?? null;
    const blocks = ((blocksRes as { data: BioBlockRow[] | null }).data ?? []) as BioBlockRow[];

    const now = Date.now();
    const liveLinks: BioLink[] = (linksRes.data ?? []).filter((l) => {
      const startsOk = !l.starts_at || new Date(l.starts_at).getTime() <= now;
      const expiresOk = !l.expires_at || new Date(l.expires_at).getTime() > now;
      return startsOk && expiresOk;
    }) as BioLink[];

    // Pull cached OG images for any link destinations that don't have an
    // explicit thumbnail_url set, so cards get a small preview without
    // any UI work for the user. Cached entries come from the social-share
    // crawl path — once a link has been shared anywhere that previews,
    // we already have its image.
    const destinationsNeedingThumb = liveLinks
      .filter((l) => l.bio_style !== 'icon' && !l.thumbnail_url)
      .map((l) => l.destination_url);
    const ogImageByDest = new Map<string, string | null>();
    if (destinationsNeedingThumb.length > 0) {
      try {
        const { data: ogRows } = await supabase
          .from('link_og_cache')
          .select('destination_url, og_image')
          .in('destination_url', destinationsNeedingThumb);
        for (const row of ogRows ?? []) {
          if (row.og_image) ogImageByDest.set(row.destination_url, row.og_image);
        }
      } catch {
        // cache table may not exist on older schemas; skip thumbnails
      }
    }

    const iconLinks = liveLinks.filter((l) => l.bio_style === 'icon')
      .sort((a, b) => a.bio_sort_order - b.bio_sort_order);

    // Featured links render in a highlighted group at the top, ahead of the
    // normal card/section flow (and are excluded from it below).
    const featuredLinks = liveLinks
      .filter((l) => l.bio_featured && l.bio_style !== 'icon')
      .sort((a, b) => a.bio_sort_order - b.bio_sort_order);

    // Build mixed card-section list, ordered by bio_sort_order across both
    // tables. Same sort order falls back to created_at oldest-first so
    // newer items don't jump above older ones unexpectedly.
    const cardLinkItems: CardItem[] = liveLinks
      .filter((l) => l.bio_style !== 'icon' && !l.bio_featured)
      .map((l) => ({ kind: 'link', data: l }));
    const blockItems: CardItem[] = blocks.map((b) => ({ kind: 'block', data: b }));
    const cardItems = [...cardLinkItems, ...blockItems].sort((a, b) => {
      const ao = a.kind === 'link' ? a.data.bio_sort_order : a.data.bio_sort_order;
      const bo = b.kind === 'link' ? b.data.bio_sort_order : b.data.bio_sort_order;
      if (ao !== bo) return ao - bo;
      const at = a.kind === 'link' ? a.data.created_at : a.data.created_at;
      const bt = b.kind === 'link' ? b.data.created_at : b.data.created_at;
      return new Date(at).getTime() - new Date(bt).getTime();
    });

    sendHtml(res, renderPage({ title, subtitle, logoUrl, iconLinks, featuredLinks, cardItems, ogImageByDest, theme, metaPixelId }), 200, true);
  } catch (err) {
    console.error('bio handler error', err);
    try {
      sendHtml(res, renderPage({ title: 'Links', subtitle: 'Something went wrong loading this page.', logoUrl: null, iconLinks: [], cardItems: [], ogImageByDest: new Map() }), 500, false);
    } catch {
      // res may already be partially sent
    }
  }
}
