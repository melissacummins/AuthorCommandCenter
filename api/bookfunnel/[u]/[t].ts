// Path-based webhook route: …/api/bookfunnel/<user_id>/<secret>
//
// BookFunnel drops the query string when it POSTs a webhook, so the auth params
// live in the URL PATH instead (like other ESPs' short webhook URLs). Vercel
// exposes the [u] and [t] path segments as req.query.u / req.query.t, so the
// shared handler in ../../_lib/bookfunnel-webhook.ts works unchanged.
import { handleWebhook, type VercelRequest, type VercelResponse } from '../../_lib/bookfunnel-webhook';

export const config = { api: { bodyParser: false } };

export default function handler(req: VercelRequest, res: VercelResponse) {
  return handleWebhook(req, res);
}
