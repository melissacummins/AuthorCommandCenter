// Vercel Edge Middleware
//
// Runs before the filesystem check, which is the only way to intercept the
// bare `/` path on a link/bio host — Vercel's rewrites in vercel.json fire
// AFTER static-file matching, so the Vite build's index.html wins for `/`
// before rewrites get a chance.
//
// Host routing:
//   - App hosts (the Vite SPA): *.vercel.app, localhost, and anything listed
//     in the APP_HOSTS env var. These pass through untouched.
//   - Any other host is treated as a member's link/bio domain: `/` renders
//     their bio page and `/:slug` resolves a short link. The bio/redirect API
//     handlers look the host up in custom_domains to find the owning user.
import { rewrite, next } from '@vercel/edge';

export const config = {
  // Run on everything except API routes and built assets.
  matcher: ['/((?!api/|assets/).*)'],
};

const APP_HOST_SUFFIXES = ['.vercel.app'];
const SLUG_RE = /^\/[A-Za-z0-9_-]{3,40}$/;

function isAppHost(host: string): boolean {
  const h = host.toLowerCase().split(':')[0];
  if (h === 'localhost' || h === '127.0.0.1') return true;
  const extra = (process.env.APP_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (extra.includes(h)) return true;
  return APP_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

export default function middleware(request: Request) {
  const url = new URL(request.url);

  // App host → serve the SPA as normal.
  if (isAppHost(url.hostname)) return next();

  // Link/bio host.
  if (url.pathname === '/') {
    return rewrite(new URL('/api/bio', url.origin));
  }
  if (SLUG_RE.test(url.pathname)) {
    return rewrite(new URL(`/api/l${url.pathname}`, url.origin));
  }
  return next();
}
