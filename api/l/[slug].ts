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

function parseOg(html: string, baseUrl: string): OGData | null {
  const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const titleTag = titleTagMatch ? titleTagMatch[1].trim() : null;
  const title = metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title') ?? titleTag;
  const description = metaContent(html, 'og:description') ?? metaContent(html, 'twitter:description') ?? metaContent(html, 'description');
  const imageRaw = metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image');
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

function isBot(ua: string): boolean {
  return /bot|crawler|spider|crawling|facebookexternalhit|slackbot|twitterbot|linkedinbot|discordbot|telegrambot|whatsapp|preview/i.test(ua);
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

    const { data: link, error } = await supabase
      .from('short_links')
      .select('id, user_id, destination_url, channel, is_active, archived_at, starts_at, expires_at, expired_redirect_url')
      .eq('slug', slug)
      .maybeSingle();

    if (error || !link) {
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

    void supabase
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
        is_bot: isBot(ua),
        click_id: clickId,
      })
      .then(() => undefined, () => undefined);

    // Social-platform crawler? Serve OG-tagged HTML so shared short links
    // show a real preview card. Real users hit the redirect path below.
    if (isSocialCrawler(ua)) {
      const og = await getOg(supabase, link.destination_url);
      if (og) {
        const proto = header(req, 'x-forwarded-proto') || 'https';
        const host = header(req, 'host') || 'read.melissacummins.com';
        const shortUrl = `${proto}://${host}/${slug}`;
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
