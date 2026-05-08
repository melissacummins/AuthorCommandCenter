// Public link-in-bio page.
//
// Renders the user's active, live, non-archived links with show_on_bio = true,
// split into a row of social-icon circles (bio_style='icon') and a list of
// full-width cards (bio_style='card'). Designed for readers who land on the
// bare short-link domain (e.g. read.melissacummins.com).
//
// Required env vars on Vercel:
//   SUPABASE_URL              - same as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY - server-side only
//   BIO_USER_ID               - the auth.users.id whose links to show
// Optional:
//   BIO_TITLE                 - heading on the page (default "Links")
//   BIO_SUBTITLE              - tagline below the heading
import { createClient } from '@supabase/supabase-js';

type VercelRequest = {
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => VercelResponse;
  send: (body: string) => void;
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
  bio_sort_order: number;
  created_at: string;
}

// ---------- Inlined social-platform detection (mirror of
// src/modules/link-shortener/socialIcons.ts so the function stays
// self-contained for Vercel's bundler). ----------

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

function renderCardLink(link: BioLink): string {
  const display = (link.bio_title && link.bio_title.trim())
    || (link.label && link.label.trim())
    || link.slug;
  return `<a class="link" href="/${escapeHtml(link.slug)}">
    <span class="link-label">${escapeHtml(display)}</span>
    <span class="link-arrow" aria-hidden="true">→</span>
  </a>`;
}

function renderPage(title: string, subtitle: string, iconLinks: BioLink[], cardLinks: BioLink[]): string {
  const initial = title.trim().charAt(0).toUpperCase() || 'M';
  const iconsHtml = iconLinks.length
    ? `<div class="icons">${iconLinks.map(renderIconLink).join('')}</div>`
    : '';
  const cardsHtml = cardLinks.length
    ? `<div class="links">${cardLinks.map(renderCardLink).join('')}</div>`
    : '';
  const empty = !iconLinks.length && !cardLinks.length
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
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary" />
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: linear-gradient(180deg, #fafafc 0%, #eef2ff 60%, #f5f3ff 100%);
  color: #1e293b;
  display: flex; flex-direction: column; align-items: center;
  padding: 48px 20px 64px;
}
.wrap { width: 100%; max-width: 480px; display: flex; flex-direction: column; align-items: center; gap: 18px; }
.dot {
  width: 72px; height: 72px; border-radius: 22px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 30px;
  letter-spacing: -0.02em; box-shadow: 0 18px 40px -16px rgba(99, 102, 241, 0.55);
}
h1 { margin: 4px 0 0; font-size: 26px; letter-spacing: -0.015em; text-align: center; }
.subtitle {
  margin: 0; color: #64748b; font-size: 15px; text-align: center;
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
.links { width: 100%; display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.link {
  position: relative; display: flex; align-items: center;
  padding: 16px 44px 16px 18px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 16px;
  text-decoration: none; color: inherit;
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
}
.link:hover { transform: translateY(-1px); border-color: #c7d2fe; box-shadow: 0 12px 28px -16px rgba(99, 102, 241, 0.35); }
.link:active { transform: translateY(0); }
.link-label { font-weight: 600; font-size: 15px; color: #0f172a; line-height: 1.3; flex: 1; }
.link-arrow {
  position: absolute; right: 18px; top: 50%; transform: translateY(-50%);
  color: #cbd5e1; font-size: 18px;
  transition: color 120ms ease, transform 120ms ease;
}
.link:hover .link-arrow { color: #6366f1; transform: translateY(-50%) translateX(2px); }
.empty { margin-top: 12px; color: #94a3b8; font-size: 14px; text-align: center; }
.foot { margin-top: 28px; font-size: 11px; color: #cbd5e1; letter-spacing: 0.06em; text-transform: uppercase; }
</style>
</head>
<body>
<main class="wrap">
  <div class="dot">${escapeHtml(initial)}</div>
  <h1>${escapeHtml(title)}</h1>
  ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
  ${iconsHtml}
  ${cardsHtml || empty}
  <div class="foot">All links</div>
</main>
</body>
</html>`;
}

function sendHtml(res: VercelResponse, html: string, status: number, cacheable: boolean) {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader(
    'cache-control',
    cacheable
      ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400'
      : 'no-store',
  );
  res.status(status).send(html);
}

function byBioOrder(a: BioLink, b: BioLink): number {
  if (a.bio_sort_order !== b.bio_sort_order) return a.bio_sort_order - b.bio_sort_order;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const userId = process.env.BIO_USER_ID;
    const title = process.env.BIO_TITLE || 'Links';
    const subtitle = process.env.BIO_SUBTITLE || '';

    if (!supabaseUrl || !serviceKey) {
      sendHtml(res, renderPage(title, 'Bio page is not configured yet.', [], []), 500, false);
      return;
    }
    if (!userId) {
      sendHtml(
        res,
        renderPage(title, 'Set the BIO_USER_ID environment variable in Vercel to display links here.', [], []),
        200, false,
      );
      return;
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .from('short_links')
      .select('slug, label, destination_url, starts_at, expires_at, bio_title, bio_style, bio_sort_order, created_at')
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('show_on_bio', true)
      .is('parent_id', null)
      .is('archived_at', null)
      .limit(200);

    if (error) {
      sendHtml(res, renderPage(title, subtitle, [], []), 200, false);
      return;
    }

    const now = Date.now();
    const live: BioLink[] = (data ?? []).filter((l) => {
      const startsOk = !l.starts_at || new Date(l.starts_at).getTime() <= now;
      const expiresOk = !l.expires_at || new Date(l.expires_at).getTime() > now;
      return startsOk && expiresOk;
    }) as BioLink[];

    const iconLinks = live.filter((l) => l.bio_style === 'icon').sort(byBioOrder);
    const cardLinks = live.filter((l) => l.bio_style !== 'icon').sort(byBioOrder);

    sendHtml(res, renderPage(title, subtitle, iconLinks, cardLinks), 200, true);
  } catch (err) {
    console.error('bio handler error', err);
    try {
      sendHtml(res, renderPage('Links', 'Something went wrong loading this page.', [], []), 500, false);
    } catch {
      // res may already be partially sent
    }
  }
}
