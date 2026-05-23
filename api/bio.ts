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
  thumbnail_url: string | null;
  created_at: string;
}

interface BioBlockRow {
  id: string;
  type: 'section' | 'image';
  title: string | null;
  body: string | null;
  image_url: string | null;
  link_url: string | null;
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

function renderCardLink(link: BioLink, ogImageByDest: Map<string, string | null>): string {
  const display = (link.bio_title && link.bio_title.trim())
    || (link.label && link.label.trim())
    || link.slug;
  const thumb = link.thumbnail_url || ogImageByDest.get(link.destination_url) || null;
  const thumbHtml = thumb
    ? `<img class="link-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" />`
    : '';
  return `<a class="link${thumb ? ' link-with-thumb' : ''}" href="/${escapeHtml(link.slug)}">
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

type CardItem =
  | { kind: 'link'; data: BioLink }
  | { kind: 'block'; data: BioBlockRow };

function renderCardItem(item: CardItem, ogImageByDest: Map<string, string | null>): string {
  if (item.kind === 'link') return renderCardLink(item.data, ogImageByDest);
  if (item.data.type === 'section') return renderSectionBlock(item.data);
  if (item.data.type === 'image') return renderImageBlock(item.data);
  return '';
}

interface RenderOptions {
  title: string;
  subtitle: string;
  logoUrl: string | null;
  iconLinks: BioLink[];
  cardItems: CardItem[];
  ogImageByDest: Map<string, string | null>;
}

function renderPage({ title, subtitle, logoUrl, iconLinks, cardItems, ogImageByDest }: RenderOptions): string {
  const initial = title.trim().charAt(0).toUpperCase() || 'M';
  const headerVisual = logoUrl
    ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(title)}" />`
    : `<div class="dot">${escapeHtml(initial)}</div>`;
  const iconsHtml = iconLinks.length
    ? `<div class="icons">${iconLinks.map(renderIconLink).join('')}</div>`
    : '';
  const cardsHtml = cardItems.length
    ? `<div class="links">${cardItems.map((i) => renderCardItem(i, ogImageByDest)).join('')}</div>`
    : '';
  const empty = !iconLinks.length && !cardItems.length
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
.wrap { width: 100%; max-width: 480px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.dot {
  width: 88px; height: 88px; border-radius: 24px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 36px;
  letter-spacing: -0.02em; box-shadow: 0 18px 40px -16px rgba(99, 102, 241, 0.55);
}
.logo {
  width: 88px; height: 88px; border-radius: 24px;
  object-fit: cover;
  background: #fff;
  box-shadow: 0 18px 40px -16px rgba(15, 23, 42, 0.25);
  display: block;
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
.links { width: 100%; display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
.link {
  position: relative; display: flex; align-items: center; gap: 12px;
  padding: 14px 44px 14px 16px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 16px;
  text-decoration: none; color: inherit;
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
}
.link:hover { transform: translateY(-1px); border-color: #c7d2fe; box-shadow: 0 12px 28px -16px rgba(99, 102, 241, 0.35); }
.link:active { transform: translateY(0); }
.link-with-thumb { padding-left: 12px; }
.link-thumb {
  width: 48px; height: 48px; object-fit: cover; border-radius: 10px;
  flex-shrink: 0; background: #f1f5f9;
}
.link-label { font-weight: 600; font-size: 15px; color: #0f172a; line-height: 1.35; flex: 1; min-width: 0; }
.link-arrow {
  position: absolute; right: 18px; top: 50%; transform: translateY(-50%);
  color: #cbd5e1; font-size: 18px;
  transition: color 120ms ease, transform 120ms ease;
}
.link:hover .link-arrow { color: #6366f1; transform: translateY(-50%) translateX(2px); }
.section {
  width: 100%; text-align: center; padding: 8px 4px; margin: 6px 0 2px;
}
.section-title {
  font-size: 17px; font-weight: 700; color: #1e293b;
  margin: 0 0 4px; letter-spacing: -0.01em;
}
.section-body {
  font-size: 14px; color: #475569; line-height: 1.55; margin: 0;
  white-space: pre-line;
}
.hero-card {
  display: block; width: 100%; border-radius: 16px; overflow: hidden;
  text-decoration: none; color: white; position: relative;
  background: #f1f5f9; box-shadow: 0 6px 20px -10px rgba(15, 23, 42, 0.18);
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
.empty { margin-top: 12px; color: #94a3b8; font-size: 14px; text-align: center; }
.foot { margin-top: 24px; font-size: 11px; color: #cbd5e1; letter-spacing: 0.06em; text-transform: uppercase; }
</style>
</head>
<body>
<main class="wrap">
  ${headerVisual}
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
      .select('slug, label, destination_url, starts_at, expires_at, bio_title, bio_style, bio_sort_order, thumbnail_url, created_at')
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('show_on_bio', true)
      .is('parent_id', null)
      .is('archived_at', null)
      .limit(200);

    const blocksPromise = supabase
      .from('bio_blocks')
      .select('id, type, title, body, image_url, link_url, bio_sort_order, created_at')
      .eq('user_id', userId)
      .order('bio_sort_order', { ascending: true })
      .limit(100)
      .then(
        (r) => r,
        () => ({ data: [] as BioBlockRow[], error: null }),
      );

    const settingsPromise = supabase
      .from('bio_settings')
      .select('logo_url, bio_title, bio_subtitle')
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

    // Build mixed card-section list, ordered by bio_sort_order across both
    // tables. Same sort order falls back to created_at oldest-first so
    // newer items don't jump above older ones unexpectedly.
    const cardLinkItems: CardItem[] = liveLinks
      .filter((l) => l.bio_style !== 'icon')
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

    sendHtml(res, renderPage({ title, subtitle, logoUrl, iconLinks, cardItems, ogImageByDest }), 200, true);
  } catch (err) {
    console.error('bio handler error', err);
    try {
      sendHtml(res, renderPage({ title: 'Links', subtitle: 'Something went wrong loading this page.', logoUrl: null, iconLinks: [], cardItems: [], ogImageByDest: new Map() }), 500, false);
    } catch {
      // res may already be partially sent
    }
  }
}
