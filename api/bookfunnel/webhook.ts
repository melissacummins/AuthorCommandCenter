// Legacy query-string webhook route (…/api/bookfunnel/webhook?u=&t=).
// Kept for back-compat; the page now uses the path-based route ([u]/[t].ts),
// because BookFunnel drops query strings when it POSTs. Shared logic lives in
// ../_lib/bookfunnel-webhook.ts. `config` must be declared in the route file so
// Vercel disables the body parser (we read the raw body ourselves).
import { handleWebhook, type VercelRequest, type VercelResponse } from '../_lib/bookfunnel-webhook';

export const config = { api: { bodyParser: false } };

export default function handler(req: VercelRequest, res: VercelResponse) {
  return handleWebhook(req, res);
}
