// Path-based webhook route: …/api/bookfunnel/<user_id>_<secret>
//
// Two reasons this lives in one path segment rather than a query string or a
// nested [u]/[t] route:
//   1. BookFunnel drops the query string when it POSTs (so ?u=&t= never arrived).
//   2. This Vercel setup only serves single-segment dynamic routes (like
//      api/l/[slug]); a nested [u]/[t] route crashed with FUNCTION_INVOCATION_FAILED.
//
// So the user id + secret are joined with "_" into one segment. A UUID has no
// underscore and the hex secret has none either, so we split on the first "_".
// `config` is declared here because Vercel reads the body-parser setting from
// the route file; the shared handler lives in ../_lib/bookfunnel-webhook.ts.
import { handleWebhook, type VercelRequest, type VercelResponse } from '../_lib/bookfunnel-webhook';

export const config = { api: { bodyParser: false } };

export default function handler(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.token;
  const token = (Array.isArray(raw) ? raw[0] : raw) ?? '';
  const i = token.indexOf('_');
  if (i > 0) {
    req.query.u = token.slice(0, i);
    req.query.t = token.slice(i + 1);
  }
  return handleWebhook(req, res);
}
