// Bio page view tracker. The public bio page embeds a 1x1 no-cache pixel
// pointing here, so each page load registers a view even when the bio HTML
// itself is served from the edge cache. Resolves which user's bio was
// viewed from the request host (same lookup as api/bio.ts), records a row,
// and always returns the pixel — tracking failures never break the page.
import { createClient } from '@supabase/supabase-js';

type VercelRequest = {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => VercelResponse;
  send: (body: Buffer | string) => void;
  end: () => void;
};

// 1x1 transparent GIF.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function header(req: VercelRequest, name: string): string {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

function isBotUA(ua: string): boolean {
  return /bot|crawl|spider|preview|fetch|monitor|slurp|facebookexternalhit|embedly|curl|wget|headless|lighthouse/i.test(ua);
}

function deviceType(ua: string): string {
  if (!ua) return 'unknown';
  if (/ipad|tablet|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|windows phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && serviceKey) {
      const ua = header(req, 'user-agent');
      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const host = header(req, 'host').toLowerCase().split(':')[0];
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
      if (userId) {
        await supabase.from('bio_views').insert({
          user_id: userId,
          referrer: header(req, 'referer') || header(req, 'referrer') || '',
          device_type: deviceType(ua),
          country: header(req, 'x-vercel-ip-country') || '',
          is_bot: isBotUA(ua),
        });
      }
    }
  } catch {
    // Never let a tracking failure break the page — fall through to the pixel.
  }
  res.setHeader('content-type', 'image/gif');
  res.setHeader('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.status(200).send(PIXEL);
}
