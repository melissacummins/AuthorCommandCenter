// Public link redirect endpoint.
//
// Resolves a slug, enforces schedule/expire rules (showing branded pages
// when the link is not active), generates a click_id, appends it as a URL
// query param to the destination so downstream sites can pass it back
// through to conversion webhooks, and logs a click row.
//
// For known social-platform crawlers (Twitterbot, Facebookexternalhit,
// Slackbot, Discordbot, etc.), instead of redirecting we serve an HTML
// page with Open Graph metadata copied from the destination so shared
// short links show a real preview card. OG metadata is cached in
// link_og_cache for 7 days, keyed by destination_url.
//
// Branded HTML helpers are inlined here on purpose: Vercel's bundler does
// not reliably pick up files from api/_lib/* subdirectories, and a missing
// import shows up as FUNCTION_INVOCATION_FAILED before the handler runs.
//
// Required env vars on Vercel:
//   SUPABASE_URL                 - same as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY    - server-side only
//   IP_HASH_SALT                 - any random string
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';

type VercelRequest = {
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  url?: string;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => VercelResponse;
  send: (body: string) => void;
  json: (body: unknown) => void;
  end: () => void;
};

function header(req: VercelRequest, name: string): string {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

// ---- Branded HTML helpers (inlined) ----

const BRAND = 'Author Command Center';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// Lightweight inline formatting for author-written text: **bold**, *italic*,
// and newlines. HTML is escaped first so the markdown tokens are the only
// markup that survives.
function formatText(s: string): string {
  let h = escapeHtml(s);
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  h = h.replace(/\r?\n/g, '<br />');
  return h;
}

// Which block of text a book spot shows. Defaults to the full description.
function pickBookText(
  mode: string | null | undefined,
  headline: string | null,
  description: string | null,
  custom: string | null,
): string {
  switch (mode) {
    case 'headline': return (headline ?? '').trim();
    case 'custom': return (custom ?? '').trim();
    case 'none': return '';
    default: return (description ?? '').trim();
  }
}

function brandShell(title: string, heading: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: linear-gradient(180deg, #fafafc 0%, #f1f5f9 100%); color: #1e293b; }
.card { max-width: 480px; margin: 24px; padding: 40px 36px; background: #fff; border: 1px solid #e2e8f0; border-radius: 20px; box-shadow: 0 24px 60px -20px rgba(15, 23, 42, 0.18); text-align: center; }
.dot { width: 56px; height: 56px; margin: 0 auto 20px; border-radius: 18px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 22px; box-shadow: 0 12px 24px -10px rgba(99, 102, 241, 0.5); }
h1 { margin: 0 0 8px; font-size: 22px; letter-spacing: -0.01em; }
p { margin: 0; color: #64748b; line-height: 1.55; font-size: 15px; }
.brand { margin-top: 28px; font-size: 12px; color: #94a3b8; letter-spacing: 0.04em; text-transform: uppercase; }
</style>
</head>
<body>
<div class="card">
  <div class="dot">${escapeHtml(BRAND.charAt(0))}</div>
  <h1>${escapeHtml(heading)}</h1>
  <div>${body}</div>
  <div class="brand">${escapeHtml(BRAND)}</div>
</div>
</body>
</html>`;
}

function notFoundPage(message: string): string {
  return brandShell('Link not found', 'Link not found', `<p>${escapeHtml(message)}</p>`);
}

function expiredPage(): string {
  return brandShell('This link has expired', 'This link has expired', `<p>The page you're looking for is no longer available. Check back soon or follow along on the author's main site.</p>`);
}

function comingSoonPage(startsAtISO: string): string {
  const when = new Date(startsAtISO);
  const formatted = when.toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  return brandShell('Coming soon', 'Coming soon', `<p>This link goes live <strong>${escapeHtml(formatted)}</strong>. Bookmark this page and check back then.</p>`);
}

function deactivatedPage(): string {
  return brandShell('Link unavailable', 'Link unavailable', `<p>This short link has been deactivated.</p>`);
}

function sendHtml(res: VercelResponse, html: string, status: number) {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.status(status).send(html);
}

// ---- OG preview helpers ----

interface OGData {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

function isSocialCrawler(ua: string): boolean {
  return /facebookexternalhit|twitterbot|slackbot|linkedinbot|discordbot|telegrambot|whatsapp|redditbot|pinterest|skypeuripreview|bingbot|googlebot/i.test(ua);
}

function metaContent(html: string, prop: string): string | null {
  const tagRe = /<meta\s+([^>]+?)\/?>/gi;
  const propLower = prop.toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const attrs = m[1];
    const propM = attrs.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i);
    if (propM && propM[1].toLowerCase() === propLower) {
      const cM = attrs.match(/content\s*=\s*["']([^"']*)["']/i);
      if (cM) return cM[1];
    }
  }
  return null;
}

// Amazon product pages don't expose og:image — the cover lives in the main
// product image's data-a-dynamic-image (a JSON map of {url: [w,h]}), with
// data-old-hires / #landingImage as backups. Harmless on non-Amazon pages
// (the patterns just won't match).
function fallbackImage(html: string): string | null {
  const dyn = html.match(/data-a-dynamic-image\s*=\s*"([^"]+)"/i);
  if (dyn) {
    try {
      const map = JSON.parse(dyn[1].replace(/&quot;/g, '"')) as Record<string, unknown>;
      const first = Object.keys(map)[0];
      if (first) return first;
    } catch { /* ignore malformed JSON */ }
  }
  const hires = html.match(/\bdata-old-hires\s*=\s*"([^"']+)"/i);
  if (hires?.[1]) return hires[1];
  const landing = html.match(/id="landingImage"[^>]*\bsrc\s*=\s*"([^"']+)"/i);
  if (landing?.[1]) return landing[1];
  const imgBlock = html.match(/id="imgTagWrapperId"[\s\S]{0,400}?<img[^>]*\bsrc\s*=\s*"([^"']+)"/i);
  if (imgBlock?.[1]) return imgBlock[1];
  return null;
}

function parseOg(html: string, baseUrl: string): OGData | null {
  const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const titleTag = titleTagMatch ? titleTagMatch[1].trim() : null;
  let title = metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title') ?? titleTag;
  // Strip Amazon's storefront prefix so titles aren't "Amazon.com: <title>".
  if (title) title = title.replace(/^Amazon\.com\s*:?\s*/i, '').trim();
  const description = metaContent(html, 'og:description') ?? metaContent(html, 'twitter:description') ?? metaContent(html, 'description');
  const imageRaw = metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image') ?? fallbackImage(html);
  const siteName = metaContent(html, 'og:site_name');
  let image: string | null = null;
  if (imageRaw) {
    try { image = new URL(imageRaw, baseUrl).toString(); } catch { /* ignore */ }
  }
  if (!title && !description && !image) return null;
  return { title, description, image, siteName };
}

async function fetchOg(url: string): Promise<OGData | null> {
  // Use a realistic browser UA — many destinations (Shopify, Cloudflare-fronted
  // sites, etc.) reject anything with "Bot" in the User-Agent, which leaves the
  // OG cache empty and breaks share previews.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const html = await r.text();
    return parseOg(html, r.url || url);
  } catch {
    return null;
  }
}

async function getOg(supabase: SupabaseClient, destinationUrl: string): Promise<OGData | null> {
  try {
    const { data: cached } = await supabase
      .from('link_og_cache')
      .select('og_title, og_description, og_image, og_site_name, expires_at')
      .eq('destination_url', destinationUrl)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (cached) {
      return {
        title: cached.og_title,
        description: cached.og_description,
        image: cached.og_image,
        siteName: cached.og_site_name,
      };
    }
  } catch {
    // table may not exist yet pre-migration; fall through to fetch
  }
  const og = await fetchOg(destinationUrl);
  if (og) {
    void supabase
      .from('link_og_cache')
      .upsert({
        destination_url: destinationUrl,
        og_title: og.title,
        og_description: og.description,
        og_image: og.image,
        og_site_name: og.siteName,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
      }, { onConflict: 'destination_url' })
      .then(() => undefined, () => undefined);
  }
  return og;
}

function ogPreviewHtml(shortUrl: string, destination: string, og: OGData): string {
  const e = escapeHtml;
  const title = og.title || 'Link';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${e(title)}</title>
${og.title ? `<meta property="og:title" content="${e(og.title)}" />` : ''}
${og.description ? `<meta property="og:description" content="${e(og.description)}" />` : ''}
${og.image ? `<meta property="og:image" content="${e(og.image)}" />` : ''}
<meta property="og:url" content="${e(shortUrl)}" />
<meta property="og:type" content="website" />
${og.siteName ? `<meta property="og:site_name" content="${e(og.siteName)}" />` : ''}
<meta name="twitter:card" content="${og.image ? 'summary_large_image' : 'summary'}" />
${og.title ? `<meta name="twitter:title" content="${e(og.title)}" />` : ''}
${og.description ? `<meta name="twitter:description" content="${e(og.description)}" />` : ''}
${og.image ? `<meta name="twitter:image" content="${e(og.image)}" />` : ''}
<meta http-equiv="refresh" content="0;url=${e(destination)}" />
<link rel="canonical" href="${e(destination)}" />
</head>
<body>
<p>Redirecting to <a href="${e(destination)}">${e(title)}</a>...</p>
</body>
</html>`;
}

// ---- UA / device helpers ----

function detectDevice(ua: string): string {
  const s = ua.toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(s)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|blackberry|iemobile|opera mini/.test(s)) return 'mobile';
  if (/bot|crawler|spider|crawling|facebookexternalhit|slackbot|twitterbot|linkedinbot|discordbot|telegrambot/.test(s)) return 'bot';
  return 'desktop';
}

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  if (/MSIE|Trident\//.test(ua)) return 'Internet Explorer';
  return 'Other';
}

function detectOS(ua: string): string {
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua) && !/Mobile/.test(ua)) return 'macOS';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Linux/.test(ua)) return 'Linux';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  return 'Other';
}

// Small-population cities that are essentially 100% data-center traffic.
// Conservative list — deliberately excludes large cities like Fort Worth,
// Mountain View, or Ashburn where real residents could plausibly visit.
const DC_CITIES = new Set([
  'prineville', 'boardman', 'the dalles', 'forest city',
  'lenoir', 'quincy', 'altoona', 'lulea', 'eemshaven',
  'clonee', 'henderson',
]);

function isBot(ua: string, city: string): boolean {
  if (!ua) return false;
  // Self-identifying bots
  if (/bot|crawler|spider|crawling|facebookexternalhit|slackbot|twitterbot|linkedinbot|discordbot|telegrambot|whatsapp|preview|scanner/i.test(ua)) {
    return true;
  }
  // Outdated Chrome (<100) is overwhelmingly automated scanners; real users
  // keep up to date and Chrome is on 130+ in 2026.
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  if (chromeMatch && parseInt(chromeMatch[1], 10) < 100) return true;
  // Known small-town data center cities
  if (city && DC_CITIES.has(city.toLowerCase())) return true;
  return false;
}

function appendParams(url: string, params: Record<string, string>): string {
  try {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      if (!u.searchParams.has(k)) u.searchParams.set(k, v);
    }
    return u.toString();
  } catch {
    return url;
  }
}

// The page owner's uploaded bio logo, used as the favicon on their public
// Book / series pages.
async function ownerLogo(supabase: SupabaseClient, ownerId: string | null): Promise<string | null> {
  if (!ownerId) return null;
  try {
    const { data } = await supabase.from('bio_settings').select('logo_url').eq('user_id', ownerId).maybeSingle();
    return (data?.logo_url as string | null) ?? null;
  } catch {
    return null;
  }
}

function bearer(req: VercelRequest): string | null {
  const raw = req.headers['authorization'] ?? req.headers['Authorization'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !v.toLowerCase().startsWith('bearer ')) return null;
  return v.slice(7);
}

// ---- Landing pages ----
// Theme palette is duplicated from api/bio.ts on purpose: api/_lib/* does
// not bundle reliably on Vercel (see header note), so a shared module risks
// FUNCTION_INVOCATION_FAILED. Keep these in sync with bio.ts THEMES.
interface LpTheme { bg: string; text: string; muted: string; surface: string; border: string; accent: string; dark: boolean; }
const LP_THEMES: Record<string, LpTheme> = {
  classic:  { bg: 'linear-gradient(180deg, #fafafc 0%, #eef2ff 60%, #f5f3ff 100%)', text: '#1e293b', muted: '#64748b', surface: '#ffffff', border: '#e2e8f0', accent: '#6366f1', dark: false },
  midnight: { bg: 'linear-gradient(180deg, #0f172a 0%, #1e1b4b 100%)',              text: '#e2e8f0', muted: '#94a3b8', surface: '#1e293b', border: '#334155', accent: '#818cf8', dark: true  },
  blush:    { bg: 'linear-gradient(180deg, #fff5f7 0%, #ffe9ef 100%)',              text: '#4a2c33', muted: '#9b6b76', surface: '#ffffff', border: '#fbd5de', accent: '#e85d75', dark: false },
  cream:    { bg: 'linear-gradient(180deg, #fdf8f0 0%, #f7ede0 100%)',              text: '#443726', muted: '#8a7a63', surface: '#fffdf8', border: '#ece0cf', accent: '#b5793f', dark: false },
  forest:   { bg: 'linear-gradient(180deg, #f3f7f3 0%, #e4efe6 100%)',              text: '#1f2e22', muted: '#5b7060', surface: '#ffffff', border: '#d3e2d5', accent: '#2f7d4f', dark: false },
  noir:     { bg: '#0a0a0a',                                                        text: '#f5f5f5', muted: '#a3a3a3', surface: '#171717', border: '#2a2a2a', accent: '#e5e5e5', dark: true  },
};
function lpHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(v)) return `#${v.split('').map((c) => c + c).join('').toLowerCase()}`;
  return null;
}
function lpTheme(themeId: string | null | undefined, accent: string | null | undefined): LpTheme {
  const base = LP_THEMES[themeId ?? 'classic'] ?? LP_THEMES.classic;
  return { ...base, accent: lpHex(accent) ?? base.accent };
}

interface LpButton { label: string; url: string }
interface LandingPageRow {
  slug: string;
  title: string | null;
  headline: string | null;
  description: string | null;
  page_text_mode: string | null;
  page_text_custom: string | null;
  cover_image_url: string | null;
  buttons: LpButton[] | null;
  theme: string | null;
  accent_color: string | null;
}

function renderLandingPage(page: LandingPageRow, faviconUrl: string | null = null): string {
  const t = lpTheme(page.theme, page.accent_color);
  const title = (page.title || '').trim() || 'Get the book';
  const desc = pickBookText(page.page_text_mode, page.headline, page.description, page.page_text_custom);
  const cover = page.cover_image_url && page.cover_image_url.trim() ? page.cover_image_url.trim() : null;
  const buttons = (Array.isArray(page.buttons) ? page.buttons : [])
    .filter((b) => b && typeof b.url === 'string' && b.url.trim() && typeof b.label === 'string' && b.label.trim());
  const storeHtml = buttons.map((b) =>
    `<a class="store" href="${escapeHtml(b.url)}" rel="noopener nofollow"><img src="${escapeHtml(lpRetailerIcon(b.url))}" alt="" loading="lazy" /><span>${escapeHtml(b.label)}</span></a>`,
  ).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="${escapeHtml(desc || title)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(desc || '')}" />
${cover ? `<meta property="og:image" content="${escapeHtml(cover)}" />` : ''}
${faviconUrl ? `<link rel="icon" href="${escapeHtml(faviconUrl)}" />` : ''}
<meta property="og:type" content="book" />
<meta name="twitter:card" content="summary_large_image" />
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:${t.dark ? 'dark' : 'light'};--bg:${t.bg};--text:${t.text};--muted:${t.muted};--surface:${t.surface};--border:${t.border};--accent:${t.accent};--accent-soft:${t.accent}2e;}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:flex-start;justify-content:center;padding:56px 20px 64px}
.wrap{width:100%;max-width:720px}
.book{display:flex;gap:28px;align-items:flex-start;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:28px;box-shadow:0 20px 50px -28px rgba(15,23,42,.35)}
.cover{flex:0 0 auto;width:210px;max-width:42%;border-radius:12px;box-shadow:0 18px 40px -20px rgba(15,23,42,.5);display:block}
.info{flex:1;min-width:0;display:flex;flex-direction:column}
h1{margin:0 0 12px;font-size:27px;letter-spacing:-.015em;color:var(--text);line-height:1.2}
.desc{margin:0;color:var(--muted);font-size:15px;line-height:1.6}
.stores{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.store{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;border:1px solid var(--border);background:var(--bg);color:var(--text);text-decoration:none;font-size:14px;font-weight:600;transition:border-color 120ms ease,transform 120ms ease}
.store:hover{border-color:var(--accent);transform:translateY(-1px)}
.store img{width:18px;height:18px;display:block}
@media(max-width:560px){.book{flex-direction:column;align-items:center;text-align:center;padding:22px}.cover{width:190px;max-width:70%}h1{font-size:24px}.stores{justify-content:center}}
</style>
</head>
<body>
<main class="wrap">
  <div class="book">
    ${cover ? `<img class="cover" src="${escapeHtml(cover)}" alt="${escapeHtml(title)}" />` : ''}
    <div class="info">
      <h1>${escapeHtml(title)}</h1>
      ${desc ? `<p class="desc">${formatText(desc)}</p>` : ''}
      ${storeHtml ? `<div class="stores">${storeHtml}</div>` : ''}
    </div>
  </div>
</main>
</body>
</html>`;
}

// Brand icon for a retailer link. Uses each store's own favicon, which
// always resolves (Simple Icons has dropped logos like Amazon's, which then
// showed as broken images).
function lpRetailerIcon(url: string): string {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { /* invalid */ }
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : '';
}

interface SeriesBookRow {
  slug: string;
  title: string | null;
  headline: string | null;
  description: string | null;
  cover_image_url: string | null;
  buttons: LpButton[] | null;
}
interface SeriesRow {
  title: string | null;
  description: string | null;
  theme: string | null;
  accent_color: string | null;
  card_text_mode: string | null;
}

function renderSeriesPage(series: SeriesRow, books: SeriesBookRow[], faviconUrl: string | null = null): string {
  const t = lpTheme(series.theme, series.accent_color);
  const title = (series.title || '').trim() || 'The series';
  const desc = (series.description || '').trim();
  const cardMode = series.card_text_mode ?? 'description';
  const cards = books.map((b) => {
    const bookTitle = (b.title || '').trim() || `/${b.slug}`;
    const bookDesc = pickBookText(cardMode, b.headline, b.description, null);
    const cover = b.cover_image_url && b.cover_image_url.trim() ? b.cover_image_url.trim() : null;
    const stores = (Array.isArray(b.buttons) ? b.buttons : [])
      .filter((x) => x && typeof x.url === 'string' && x.url.trim() && typeof x.label === 'string' && x.label.trim())
      .map((x) => `<a class="store" href="${escapeHtml(x.url)}" rel="noopener nofollow"><img src="${escapeHtml(lpRetailerIcon(x.url))}" alt="" loading="lazy" /><span>${escapeHtml(x.label)}</span></a>`)
      .join('');
    const coverHtml = cover
      ? `<a class="book-cover" href="/${escapeHtml(b.slug)}"><img src="${escapeHtml(cover)}" alt="${escapeHtml(bookTitle)}" loading="lazy" /></a>`
      : `<a class="book-cover book-cover-empty" href="/${escapeHtml(b.slug)}"></a>`;
    return `<div class="book">
      ${coverHtml}
      <div class="book-main">
        <a class="book-title" href="/${escapeHtml(b.slug)}">${escapeHtml(bookTitle)}</a>
        ${bookDesc ? `<p class="book-desc">${formatText(bookDesc)}</p>` : ''}
        ${stores ? `<div class="stores">${stores}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="${escapeHtml(desc || title)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(desc || '')}" />
${books[0]?.cover_image_url ? `<meta property="og:image" content="${escapeHtml(books[0].cover_image_url)}" />` : ''}
${faviconUrl ? `<link rel="icon" href="${escapeHtml(faviconUrl)}" />` : ''}
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary" />
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:${t.dark ? 'dark' : 'light'};--bg:${t.bg};--text:${t.text};--muted:${t.muted};--surface:${t.surface};--border:${t.border};--accent:${t.accent};--accent-soft:${t.accent}2e;}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--text);display:flex;flex-direction:column;align-items:center;padding:48px 18px 64px}
.wrap{width:100%;max-width:540px;display:flex;flex-direction:column;align-items:center;gap:8px}
h1{margin:0;font-size:26px;letter-spacing:-.015em;text-align:center;color:var(--text)}
.lede{margin:0 0 8px;color:var(--muted);font-size:15px;line-height:1.55;text-align:center;white-space:pre-line}
.books{width:100%;display:flex;flex-direction:column;gap:14px;margin-top:8px}
.book{display:flex;gap:14px;align-items:flex-start;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:14px}
.book-cover{flex:0 0 auto;width:84px;display:block;border-radius:8px;overflow:hidden;background:var(--border)}
.book-cover img{width:100%;height:auto;display:block}
.book-cover-empty{height:118px}
.book-main{flex:1;min-width:0}
.book-title{display:block;font-weight:700;font-size:16px;color:var(--text);text-decoration:none;line-height:1.3}
.book-title:hover{color:var(--accent)}
.book-desc{margin:6px 0 0;color:var(--muted);font-size:13px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.stores{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.store{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text);text-decoration:none;font-size:12px;font-weight:600;transition:border-color 120ms ease}
.store:hover{border-color:var(--accent)}
.store img{width:15px;height:15px;display:block}
.foot{margin-top:26px;font-size:11px;color:var(--muted);opacity:.65;letter-spacing:.06em;text-transform:uppercase}
@media(max-width:420px){.book-cover{width:68px}}
</style>
</head>
<body>
<main class="wrap">
  <h1>${escapeHtml(title)}</h1>
  ${desc ? `<p class="lede">${escapeHtml(desc)}</p>` : ''}
  <div class="books">${cards}</div>
</main>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const slugParam = req.query.slug;
    const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam;

    if (!slug || typeof slug !== 'string') {
      sendHtml(res, notFoundPage('No link provided.'), 404);
      return;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      res.setHeader('content-type', 'text/plain');
      res.status(500).send('Link service not configured.');
      return;
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Authenticated helper for the landing-page editor: fetch OpenGraph
    // cover/title/description for a URL the author is adding. Requires a
    // valid bearer token so this can't be used as an open SSRF fetcher.
    const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
    if (action === 'fetch_og') {
      const token = bearer(req);
      const userRes = token ? await supabase.auth.getUser(token) : null;
      if (!userRes?.data?.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      let target = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
      if (!target || typeof target !== 'string') {
        res.status(400).json({ error: 'Missing url' });
        return;
      }
      target = target.trim();
      if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
      // Fetch fresh (not getOg) so the editor never serves a previously
      // cached miss and doesn't pollute the share-preview cache.
      const og = await fetchOg(target);
      res.setHeader('cache-control', 'no-store');
      res.status(200).json({ og: og ?? null });
      return;
    }

    // Slugs are unique per user, so resolve which user owns this domain
    // before looking up the slug. Falls back to the legacy single-tenant
    // BIO_USER_ID env var (so path-based /l/:slug on the app domain still
    // resolves the owner's links).
    const host = (header(req, 'host') || '').toLowerCase().split(':')[0];
    let ownerId: string | null = null;
    if (host) {
      const { data: dom } = await supabase
        .from('custom_domains')
        .select('user_id')
        .eq('domain', host)
        .eq('verified', true)
        .maybeSingle();
      if (dom) ownerId = dom.user_id;
    }
    if (!ownerId) ownerId = process.env.BIO_USER_ID || null;

    let linkQuery = supabase
      .from('short_links')
      .select('id, user_id, destination_url, channel, is_active, archived_at, starts_at, expires_at, expired_redirect_url')
      .eq('slug', slug);
    if (ownerId) linkQuery = linkQuery.eq('user_id', ownerId);
    const { data: link, error } = await linkQuery.maybeSingle();

    if (error || !link) {
      // Not a short link — it might be a landing page (shared slug namespace).
      let pageQuery = supabase
        .from('landing_pages')
        .select('slug, title, headline, description, page_text_mode, page_text_custom, cover_image_url, buttons, theme, accent_color')
        .eq('slug', slug);
      if (ownerId) pageQuery = pageQuery.eq('user_id', ownerId);
      const { data: page } = await pageQuery.maybeSingle();
      if (page) {
        const favicon = await ownerLogo(supabase, ownerId);
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('cache-control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=300');
        res.status(200).send(renderLandingPage(page as LandingPageRow, favicon));
        return;
      }

      // Or a series page — a bundle of landing pages at one slug.
      let seriesQuery = supabase
        .from('series_pages')
        .select('title, description, page_ids, theme, accent_color, card_text_mode')
        .eq('slug', slug);
      if (ownerId) seriesQuery = seriesQuery.eq('user_id', ownerId);
      const { data: series } = await seriesQuery.maybeSingle();
      if (series) {
        const ids = Array.isArray(series.page_ids) ? (series.page_ids as string[]) : [];
        let books: SeriesBookRow[] = [];
        if (ids.length > 0) {
          let booksQuery = supabase
            .from('landing_pages')
            .select('id, slug, title, headline, description, cover_image_url, buttons')
            .in('id', ids);
          if (ownerId) booksQuery = booksQuery.eq('user_id', ownerId);
          const { data: rows } = await booksQuery;
          const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));
          books = ids
            .map((id) => byId.get(id))
            .filter((r): r is NonNullable<typeof r> => Boolean(r))
            .map((r) => ({
              slug: r.slug, title: r.title, headline: r.headline, description: r.description,
              cover_image_url: r.cover_image_url, buttons: r.buttons as LpButton[] | null,
            }));
        }
        const favicon = await ownerLogo(supabase, ownerId);
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('cache-control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=300');
        res.status(200).send(renderSeriesPage(series as SeriesRow, books, favicon));
        return;
      }

      sendHtml(res, notFoundPage('This short link does not exist or was removed.'), 404);
      return;
    }

    let clickIdParam = 'click_id';
    try {
      const { data: settings } = await supabase
        .from('link_attribution_settings')
        .select('click_id_param')
        .eq('user_id', link.user_id)
        .maybeSingle();
      if (settings?.click_id_param) clickIdParam = settings.click_id_param;
    } catch {
      // table may not exist yet pre-migration; fall back
    }

    if (!link.is_active || link.archived_at) {
      sendHtml(res, deactivatedPage(), 410);
      return;
    }

    const now = Date.now();
    if (link.starts_at && new Date(link.starts_at).getTime() > now) {
      sendHtml(res, comingSoonPage(link.starts_at), 200);
      return;
    }
    if (link.expires_at && new Date(link.expires_at).getTime() <= now) {
      if (link.expired_redirect_url) {
        res.setHeader('cache-control', 'no-store');
        res.setHeader('location', link.expired_redirect_url);
        res.status(302).end();
        return;
      }
      sendHtml(res, expiredPage(), 410);
      return;
    }

    const ua = header(req, 'user-agent');
    const referrer = header(req, 'referer') || header(req, 'referrer');
    const language = (header(req, 'accept-language').split(',')[0] || '').trim();

    const country = header(req, 'x-vercel-ip-country');
    const region = header(req, 'x-vercel-ip-country-region');
    const city = safeDecode(header(req, 'x-vercel-ip-city') || '');

    const ip =
      header(req, 'x-forwarded-for').split(',')[0].trim() ||
      header(req, 'x-real-ip') ||
      '';
    const ipHash = ip
      ? createHash('sha256').update(ip + (process.env.IP_HASH_SALT || 'inventorypro')).digest('hex').slice(0, 16)
      : '';

    const clickId = randomUUID();
    const destination = appendParams(link.destination_url, {
      [clickIdParam]: clickId,
      ...(link.channel ? { utm_source: link.channel.toLowerCase().replace(/\s+/g, '_') } : {}),
    });

    // Click insert MUST be awaited — fire-and-forget loses the row when the
    // function terminates after res.end(). We pay ~50-150ms for reliable
    // attribution; without it conversion tracking is unusable.
    const { error: clickInsertError } = await supabase
      .from('link_clicks')
      .insert({
        link_id: link.id,
        user_id: link.user_id,
        slug,
        channel: link.channel || '',
        destination_url: destination,
        referrer,
        user_agent: ua,
        device_type: detectDevice(ua),
        browser: detectBrowser(ua),
        os: detectOS(ua),
        country,
        region,
        city,
        ip_hash: ipHash,
        language,
        is_bot: isBot(ua, city),
        click_id: clickId,
      });

    if (clickInsertError) {
      console.error('click insert failed:', clickInsertError);
    }

    // Social-platform crawler? Serve OG-tagged HTML so shared short links
    // show a real preview card. Real users hit the redirect path below.
    if (isSocialCrawler(ua)) {
      const og = await getOg(supabase, link.destination_url);
      if (og) {
        const proto = header(req, 'x-forwarded-proto') || 'https';
        const host = header(req, 'host');
        const shortUrl = host ? `${proto}://${host}/${slug}` : destination;
        sendHtml(res, ogPreviewHtml(shortUrl, destination, og), 200);
        return;
      }
      // Fall through to redirect if OG unavailable.
    }

    res.setHeader('cache-control', 'no-store');
    res.setHeader('location', destination);
    res.status(302).end();
  } catch (err) {
    console.error('redirect handler error', err);
    try {
      sendHtml(res, notFoundPage('Something went wrong loading this link.'), 500);
    } catch {
      // res may already be partially sent
    }
  }
}
