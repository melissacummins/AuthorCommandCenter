// Public link redirect endpoint.
// Looks up the slug in Supabase, logs a click with detailed UA + geo info,
// and 302s to the destination URL.
//
// Required env vars on Vercel:
//   SUPABASE_URL                 - same as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY    - server-side only, never expose to client
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

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

function notFound(res: VercelResponse, message: string) {
  res.status(404).setHeader('content-type', 'text/html; charset=utf-8').send(
    `<!doctype html><meta charset="utf-8"><title>Link not found</title>
     <style>body{font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 24px;color:#1e293b}
     h1{font-size:24px;margin:0 0 12px}p{color:#64748b;line-height:1.5}</style>
     <h1>Link not found</h1><p>${message}</p>`
  );
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

function header(req: VercelRequest, name: string): string {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

function appendUtmIfMissing(url: string, channel: string): string {
  if (!channel) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has('utm_source')) {
      u.searchParams.set('utm_source', channel.toLowerCase().replace(/\s+/g, '_'));
    }
    return u.toString();
  } catch {
    return url;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slugParam = req.query.slug;
  const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam;

  if (!slug || typeof slug !== 'string') {
    return notFound(res, 'No link provided.');
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
    .select('id, user_id, destination_url, channel, is_active, archived_at')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !link) {
    return notFound(res, 'This short link does not exist or was removed.');
  }
  if (!link.is_active || link.archived_at) {
    return notFound(res, 'This link has been deactivated.');
  }

  const ua = header(req, 'user-agent');
  const referrer = header(req, 'referer') || header(req, 'referrer');
  const language = (header(req, 'accept-language').split(',')[0] || '').trim();

  // Vercel sets these geolocation headers on every request.
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

  const destination = appendUtmIfMissing(link.destination_url, link.channel || '');

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
    })
    .then(() => undefined);

  res.setHeader('cache-control', 'no-store');
  res.setHeader('location', destination);
  res.status(302).end();
}
