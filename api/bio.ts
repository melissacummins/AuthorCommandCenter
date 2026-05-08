// Public link-in-bio page.
//
// Reads the user's active, live, non-archived links with show_on_bio = true
// and renders a branded list of clickable cards. Designed for readers who
// land on the bare short-link domain (e.g. read.melissacummins.com).
//
// Required env vars:
//   SUPABASE_URL              - same as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY - server-side only
//   BIO_USER_ID               - the auth.users.id whose links to show
// Optional:
//   BIO_TITLE                 - heading on the page (default "Links")
//   BIO_SUBTITLE              - optional tagline below the heading
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
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function destinationLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function renderPage(title: string, subtitle: string, links: BioLink[]): string {
  const initial = title.trim().charAt(0).toUpperCase() || 'M';
  const cards = links
    .map((l) => {
      const label = (l.label && l.label.trim()) || l.slug;
      const sub = destinationLabel(l.destination_url);
      return `<a class="link" href="/${escapeHtml(l.slug)}">
        <span class="link-label">${escapeHtml(label)}</span>
        ${sub ? `<span class="link-sub">${escapeHtml(sub)}</span>` : ''}
        <span class="link-arrow" aria-hidden="true">→</span>
      </a>`;
    })
    .join('\n');

  const empty = `<p class="empty">No links to show right now — check back soon.</p>`;

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
.wrap {
  width: 100%;
  max-width: 480px;
  display: flex; flex-direction: column; align-items: center;
  gap: 18px;
}
.dot {
  width: 72px; height: 72px;
  border-radius: 22px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  display: grid; place-items: center;
  color: #fff; font-weight: 700; font-size: 30px;
  letter-spacing: -0.02em;
  box-shadow: 0 18px 40px -16px rgba(99, 102, 241, 0.55);
}
h1 {
  margin: 4px 0 0;
  font-size: 26px;
  letter-spacing: -0.015em;
  text-align: center;
}
.subtitle {
  margin: 0;
  color: #64748b;
  font-size: 15px;
  text-align: center;
  max-width: 340px;
  line-height: 1.5;
}
.links {
  width: 100%;
  display: flex; flex-direction: column; gap: 10px;
  margin-top: 12px;
}
.link {
  position: relative;
  display: flex; flex-direction: column;
  padding: 16px 44px 16px 18px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  text-decoration: none;
  color: inherit;
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
}
.link:hover {
  transform: translateY(-1px);
  border-color: #c7d2fe;
  box-shadow: 0 12px 28px -16px rgba(99, 102, 241, 0.35);
}
.link:active { transform: translateY(0); }
.link-label {
  font-weight: 600;
  font-size: 15px;
  color: #0f172a;
  line-height: 1.3;
}
.link-sub {
  margin-top: 3px;
  font-size: 12px;
  color: #94a3b8;
  letter-spacing: 0.01em;
}
.link-arrow {
  position: absolute;
  right: 18px;
  top: 50%;
  transform: translateY(-50%);
  color: #cbd5e1;
  font-size: 18px;
  transition: color 120ms ease, transform 120ms ease;
}
.link:hover .link-arrow {
  color: #6366f1;
  transform: translateY(-50%) translateX(2px);
}
.empty {
  margin-top: 12px;
  color: #94a3b8;
  font-size: 14px;
  text-align: center;
}
.foot {
  margin-top: 24px;
  font-size: 11px;
  color: #cbd5e1;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
@media (prefers-color-scheme: dark) {
  /* keep light styling for now — readable, brand-consistent */
}
</style>
</head>
<body>
<main class="wrap">
  <div class="dot">${escapeHtml(initial)}</div>
  <h1>${escapeHtml(title)}</h1>
  ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
  <div class="links">
    ${links.length ? cards : empty}
  </div>
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

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const userId = process.env.BIO_USER_ID;
    const title = process.env.BIO_TITLE || 'Links';
    const subtitle = process.env.BIO_SUBTITLE || '';

    if (!supabaseUrl || !serviceKey) {
      sendHtml(res, renderPage(title, 'Bio page is not configured yet.', []), 500, false);
      return;
    }
    if (!userId) {
      sendHtml(
        res,
        renderPage(
          title,
          'Set the BIO_USER_ID environment variable in Vercel to display links here.',
          [],
        ),
        200,
        false,
      );
      return;
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .from('short_links')
      .select('slug, label, destination_url, starts_at, expires_at')
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('show_on_bio', true)
      .is('parent_id', null)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      sendHtml(res, renderPage(title, subtitle, []), 200, false);
      return;
    }

    const now = Date.now();
    const live: BioLink[] = (data ?? []).filter((l) => {
      const startsOk = !l.starts_at || new Date(l.starts_at).getTime() <= now;
      const expiresOk = !l.expires_at || new Date(l.expires_at).getTime() > now;
      return startsOk && expiresOk;
    });

    sendHtml(res, renderPage(title, subtitle, live), 200, true);
  } catch (err) {
    console.error('bio handler error', err);
    try {
      sendHtml(res, renderPage('Links', 'Something went wrong loading this page.', []), 500, false);
    } catch {
      // res may already be partially sent
    }
  }
}
