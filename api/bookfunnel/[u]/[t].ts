// Path-based webhook URL:  …/api/bookfunnel/<user_id>/<secret>
//
// BookFunnel drops the query string when it POSTs a webhook (so the old
// ?u=&t= form never delivered the auth), so we carry the user id + secret in
// the URL PATH instead — exactly like the short URLs other ESPs use. Vercel
// exposes the [u] and [t] path segments as req.query.u / req.query.t, so the
// shared handler in ../webhook.ts works unchanged (it already reads u/t and a
// ?debug=1 flag from req.query).
export { config, default } from '../webhook';
