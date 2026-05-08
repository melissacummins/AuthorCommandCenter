// Vercel Edge Middleware
//
// Runs before the filesystem check, which is the only way to intercept the
// bare `/` path on the bio host — Vercel's rewrites in vercel.json fire AFTER
// static-file matching, so the Vite build's index.html wins for `/` before
// rewrites get a chance.
import { rewrite, next } from '@vercel/edge';

export const config = {
  matcher: '/',
};

export default function middleware(request: Request) {
  const url = new URL(request.url);
  if (url.hostname === 'read.melissacummins.com') {
    return rewrite(new URL('/api/bio', url.origin));
  }
  return next();
}
