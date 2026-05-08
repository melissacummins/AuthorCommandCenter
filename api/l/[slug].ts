// Public link redirect endpoint.
//
// Resolves a slug, enforces schedule/expire rules (showing branded pages
// when the link is not active), generates a click_id, appends it as a URL
// query param to the destination so downstream sites (e.g. Shopify) can
// pass it back through to conversion webhooks, and logs a click row.
//
// Required env vars on Vercel:
//   SUPABASE_URL                 - same as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY    - server-side only
//   IP_HASH_SALT                 - any random string
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import {
  comingSoonPage, deactivatedPage, expiredPage, htmlResponse, notFoundPage,
} from '../_lib/branded-pages';

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

function sendHtml(res: VercelResponse, html: string, status: number) {
  const r = htmlResponse(html, status);
  for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  res.status(r.status).send(r.body);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slugParam = req.query.slug;
  const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam;

  if (!slug || typeof slug !== 'string') {
    return sendHtml(res, notFoundPage('No link provided.'), 404);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    res.status(500).setHeader('content-type', 'text/plain').send('Link service not configured.');
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
    return sendHtml(res, notFoundPage('This short link does not exist or was removed.'), 404);
  }

  // Look up the user's preferred attribution param name (defaults to 'click_id').
  const { data: settings } = await supabase
    .from('link_attribution_settings')
    .select('click_id_param')
    .eq('user_id', link.user_id)
    .maybeSingle();
  const clickIdParam = settings?.click_id_param || 'click_id';

  if (!link.is_active || link.archived_at) {
    return sendHtml(res, deactivatedPage(), 410);
  }

  const now = Date.now();
  if (link.starts_at && new Date(link.starts_at).getTime() > now) {
    return sendHtml(res, comingSoonPage(link.starts_at), 200);
  }
  if (link.expires_at && new Date(link.expires_at).getTime() <= now) {
    if (link.expired_redirect_url) {
      res.setHeader('cache-control', 'no-store');
      res.setHeader('location', link.expired_redirect_url);
      res.status(302).end();
      return;
    }
    return sendHtml(res, expiredPage(), 410);
  }

  const ua = header(req, 'user-agent');
  const referrer = header(req, 'referer') || header(req, 'referrer');
  const language = (header(req, 'accept-language').split(',')[0] || '').trim();

  const country = header(req, 'x-vercel-ip-country');
  const region = header(req, 'x-vercel-ip-country-region');
  const city = decodeURIComponent(header(req, 'x-vercel-ip-city') || '');

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

  // Fire-and-forget click logging; never block the redirect.
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
    .then(() => undefined);

  res.setHeader('cache-control', 'no-store');
  res.setHeader('location', destination);
  res.status(302).end();
}
