# Build Directive: Command Center MCP Connector

> **Status: DRAFT — merging this PR green-lights Phase 1.** Written for the
> product play: every Command Center customer can connect *their* account to
> *their* Claude (claude.ai custom connector, Claude Code, Cowork, mobile),
> and talk to their author business — "what's low on stock?", "log 1,200
> words on Vicious Beast", "add 'approve cover proof' to today".

**Audience:** the AI model / developer implementing each phase. Repo
discovery is done; where this directive conflicts with the codebase, the
codebase's conventions win — flag conflicts in the PR description.

---

## 0. Architecture (locked)

```
Claude (claude.ai / Code / Cowork / mobile)
   │  Streamable HTTP MCP
   ▼
https://<app-domain>/api/mcp          ← ONE Vercel function (we are near the
   │  per-request Supabase client        function-count cap — everything MCP
   ▼  with the caller's user JWT         lives in this single file)
Supabase (existing project)
   ├─ Auth: OAuth 2.1 server (built-in) — the authorization server
   └─ Postgres + RLS — every query runs AS THE CONNECTED USER
```

Key decisions, all grounded in current docs:

1. **Supabase Auth is the OAuth 2.1 authorization server.** It ships
   discovery (`https://<project-ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`),
   PKCE, dynamic client registration (dashboard toggle), and refresh
   rotation. We build **no token infrastructure** — only a consent page.
2. **Tokens are ordinary Supabase user JWTs**, so the MCP server creates a
   per-request Supabase client with the caller's bearer token and **RLS
   scopes every query to that customer automatically**. Multi-tenant by
   construction; no per-tool user filtering to get wrong.
3. **Curated tools, not raw SQL.** The connector exposes the same logic the
   dashboard uses — never generic query access.
4. **Single function file** `api/mcp.ts` (`@modelcontextprotocol/sdk`,
   Streamable HTTP transport, stateless per-request server). Protected
   Resource Metadata is a **static file** (`public/.well-known/…`) so it
   costs no function slot.
5. **Access gating:** tools check the caller is an active member (same
   `app_members` logic as `hasAccess` in AuthContext) — a churned customer's
   connector stops working even though their login still exists.

## 0.1 Melissa's dashboard steps (one-time, before Phase 1 review)

In Supabase → **Authentication → OAuth Server**:
1. Enable the OAuth 2.1 server.
2. Enable **dynamic client registration** (required for claude.ai custom
   connectors to self-register). Registration requests still require the
   user to approve on our consent page, and we validate redirect URIs.

---

## 1. Phase 1 — Auth foundation + skeleton (PR 1)

**Outcome:** a Claude client can complete the full OAuth handshake against
the deployed app and call one tool that proves identity + RLS.

1. **Consent page** (SPA route `/oauth/consent`, per Supabase's
   getting-started guide): shows the requesting client's name, the fixed
   scope description ("read your books, inventory, tasks, and finances;
   add tasks and log words on your behalf"), Approve / Deny. Uses the
   existing session (redirects to login first if signed out). Follows the
   app's theme tokens.
2. **Protected Resource Metadata**: static
   `public/.well-known/oauth-protected-resource` JSON pointing
   `authorization_servers` at the Supabase issuer. `api/mcp.ts` answers
   unauthenticated requests with `401` + `WWW-Authenticate: Bearer
   resource_metadata="…"` so clients discover the flow.
3. **`api/mcp.ts` skeleton**: Streamable HTTP endpoint (`POST /api/mcp`,
   optional `/mcp` rewrite in `vercel.json` for a cleaner connector URL).
   Per request: read bearer token → `createClient(SUPABASE_URL, ANON_KEY,
   {global:{headers:{Authorization}}})` → `auth.getUser()`; reject invalid
   tokens; reject non-active members (§0.5). New env var:
   `SUPABASE_ANON_KEY` (server-side copy of the VITE one).
4. **First tool `get_business_snapshot`**: today's needs-attention counts,
   month P&L, next 7 days — proving shared-logic reuse end to end.
5. **Shared-logic refactor that makes 4 possible:** `src/lib/dashboard.ts`
   functions currently import the browser Supabase singleton. Extract the
   query logic into functions that take a `SupabaseClient` argument
   (`src/lib/dashboardCore.ts`); the web app keeps its current API by
   passing the singleton; `api/mcp.ts` passes the per-request client. The
   pure engine (`opportunities.ts`) and inventory/profit calculators import
   unchanged. No behavior change in the app.

**Acceptance:** `npx @modelcontextprotocol/inspector` completes the OAuth
flow against the Vercel preview, lists the tool, and returns real data for
the signed-in user; a second test account sees only its own (empty) data;
tsc clean; app behavior unchanged.

## 2. Phase 2 — Read tool suite (PR 2)

| Tool | Returns |
|---|---|
| `list_books` | catalog (id, title, series, status, dates, formats); filters: status, series, search |
| `get_book` | full catalog record + checklist summary (pipeline %, open opportunities) by id or fuzzy title |
| `get_inventory_alerts` | the Home widget's reorder list (product, stock, days left, suggested qty & cost) |
| `get_month_pnl` | month-to-date revenue / ad spend / net, delta vs last month, as-of date |
| `get_open_projects` | drafting/editing/pre-order books, word counts vs targets, resume candidates |
| `list_opportunities` | scored engine output (optionally per book, incl. dismissed on request) |
| `list_tasks` | planner tasks by view (today / upcoming / inbox / list name) |
| `get_recent_activity` | the derived activity feed |

Rules: concise JSON outputs (token-frugal — no blobs, no cover URLs unless
asked); every tool description written for Claude's tool-choice (one line,
verb-first); read-only annotations set.

## 3. Phase 3 — Guarded write tools (PR 3)

| Tool | Action | Guard |
|---|---|---|
| `add_task` | planner task (title, due date, list) | none needed — cheap + reversible |
| `complete_task` | mark task done | id must belong to caller (RLS) |
| `log_words` | append a word-count log for a book/manuscript, updating the same tables the app writes | rejects negative/absurd counts |
| `set_opportunity_decision` | dismiss / plan / clear | key must be engine-valid |
| `create_purchase_order` | insert PO via the existing `createPurchaseOrder` logic | echo back a cost summary in the result; never invents products — id or exact-name match only |

No delete tools, no bulk mutations, no settings writes, no Shopify calls in
v1 — additions require a new directive section, not an inline judgment call.

## 4. Phase 4 — Customer-facing polish (PR 4)

1. Settings → **"Connect to Claude"** section: the connector URL, a themed
   step-by-step (claude.ai → Settings → Connectors → Add custom connector),
   plus Claude Code/Cowork instructions (`claude mcp add --transport http`),
   and a revoke note (Supabase Auth → connected apps / revocation story).
2. `docs/MCP_CONNECTOR.md`: customer-ready copy Melissa can lift into her
   sales/onboarding material.
3. Example prompts list (the "aha" material): "What needs me today?",
   "Order more of whatever's low", "Log 1,400 words on <book>", "Which books
   still have no audiobook?".

---

## 5. Execution & tooling

- One phase = one PR, in order; branch/push rules per session instructions.
- **Model assignment:** `claude -p` **Sonnet** per phase, as with the
  redesign. New dependency: `@modelcontextprotocol/sdk` (flag in PR 1).
- **Free verification:** MCP Inspector for the handshake + every tool;
  `npx tsx` unit tests for pure logic (tool input validation, member
  gating); `npm run lint`.
- **Security review checklist per PR:** no service-role key ever used for
  tool queries (anon + user JWT only); no tool accepts a user id parameter
  (identity comes from the token, period); write tools validate ownership
  through RLS, not application checks alone.
- Est. cost across phases: ~$15–25 API + $0 infrastructure (existing
  Vercel + Supabase).

## 6. Open questions for Melissa (answer before/at Phase 1 merge)

1. **Connector URL/name**: `<app-domain>/api/mcp` is fine functionally —
   want a branded path like `/mcp` (one rewrite) and product name
   ("Author Command Center" as the server name Claude displays)?
2. **PO creation** in v1 write tools: keep, or hold until customers ask?
   (It's the riskiest write; §3 guards it, but "read + light writes" is a
   defensible v1.)
3. **Plan gating**: should MCP access be all active members, or a
   higher-tier feature you upsell? (One line in the member check either way.)
