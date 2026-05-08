// Branded HTML pages used by the public link redirect.
// Inline styles only — these are served as standalone responses.

interface PageOpts {
  title: string;
  heading: string;
  body: string;
  status?: number;
  brandName?: string;
}

function brandShell({ title, heading, body, brandName }: PageOpts): string {
  const brand = brandName ?? 'Author Command Center';
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
body {
  margin: 0; min-height: 100vh;
  display: grid; place-items: center;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: linear-gradient(180deg, #fafafc 0%, #f1f5f9 100%);
  color: #1e293b;
}
.card {
  max-width: 480px;
  margin: 24px;
  padding: 40px 36px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  box-shadow: 0 24px 60px -20px rgba(15, 23, 42, 0.18);
  text-align: center;
}
.dot {
  width: 56px; height: 56px;
  margin: 0 auto 20px;
  border-radius: 18px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  display: grid; place-items: center;
  color: #fff; font-weight: 700; font-size: 22px;
  box-shadow: 0 12px 24px -10px rgba(99, 102, 241, 0.5);
}
h1 { margin: 0 0 8px; font-size: 22px; letter-spacing: -0.01em; }
p { margin: 0; color: #64748b; line-height: 1.55; font-size: 15px; }
.brand { margin-top: 28px; font-size: 12px; color: #94a3b8; letter-spacing: 0.04em; text-transform: uppercase; }
</style>
</head>
<body>
<div class="card">
  <div class="dot">${escapeHtml(brand.charAt(0))}</div>
  <h1>${escapeHtml(heading)}</h1>
  <div>${body}</div>
  <div class="brand">${escapeHtml(brand)}</div>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function notFoundPage(message: string, brandName?: string): string {
  return brandShell({
    title: 'Link not found',
    heading: 'Link not found',
    body: `<p>${escapeHtml(message)}</p>`,
    brandName,
  });
}

export function expiredPage(brandName?: string): string {
  return brandShell({
    title: 'This link has expired',
    heading: 'This link has expired',
    body: `<p>The page you're looking for is no longer available. Check back soon or follow along on the author's main site.</p>`,
    brandName,
  });
}

export function comingSoonPage(startsAtISO: string, brandName?: string): string {
  const when = new Date(startsAtISO);
  const formatted = when.toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  return brandShell({
    title: 'Coming soon',
    heading: 'Coming soon',
    body: `<p>This link goes live <strong>${escapeHtml(formatted)}</strong>. Bookmark this page and check back then.</p>`,
    brandName,
  });
}

export function deactivatedPage(brandName?: string): string {
  return brandShell({
    title: 'Link unavailable',
    heading: 'Link unavailable',
    body: `<p>This short link has been deactivated.</p>`,
    brandName,
  });
}

export function htmlResponse(html: string, status = 200): { body: string; headers: Record<string, string>; status: number } {
  return {
    body: html,
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  };
}
