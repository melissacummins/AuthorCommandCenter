// Author Command Center MCP connector (MCP directive §1).
//
// ONE Vercel function hosts the whole MCP surface (we're near the function
// cap): Streamable HTTP transport, stateless — a fresh server per request.
//
// Auth: Supabase Auth is the OAuth 2.1 authorization server. Callers present
// a Supabase user JWT as a bearer token; we build a per-request Supabase
// client with that token so EVERY query runs under the caller's RLS. No
// service-role key is ever used for tool queries, and no tool accepts a user
// id — identity comes from the token, period.
//
// Routes (see vercel.json rewrites):
//   GET  /.well-known/oauth-protected-resource[/...] → ?meta=prm → RFC 9728
//        metadata pointing clients at the Supabase authorization server
//   POST /mcp (→ /api/mcp) → MCP JSON-RPC
//
// Required env vars on Vercel:
//   SUPABASE_URL       - same as VITE_SUPABASE_URL
//   SUPABASE_ANON_KEY  - same as VITE_SUPABASE_ANON_KEY (publishable key)

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
// Runtime values come from self-contained pre-bundles (scripts/bundle-mcp-core.mjs);
// importing ../src directly threw ERR_MODULE_NOT_FOUND under Node ESM on Vercel.
// Types resolve via the sibling api/_generated/*.d.ts files.
import { getBusinessSnapshot } from './_generated/dashboardCore.js';
import * as core from './_generated/connectorCore.js';

export const maxDuration = 30;

type VercelRequest = IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> };
type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  send: (body: string) => void;
};

// Strip any trailing slash: a SUPABASE_URL entered as "https://ref.supabase.co/"
// would otherwise produce "https://ref.supabase.co//auth/v1" (double slash),
// which breaks the client's discovery of the Supabase authorization server.
const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in src/lib/mcpAuth.test.ts)

/** Normalize a base URL for safe path concatenation (no trailing slash). */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function buildProtectedResourceMetadata(origin: string, supabaseUrl: string) {
  return {
    // Must equal the URL the client actually connects to (the branded /mcp,
    // per vercel.json), not the internal /api/mcp rewrite target. RFC 9728
    // clients reject metadata whose `resource` doesn't match the MCP server
    // URL they were given — which silently aborts OAuth before registration.
    resource: `${trimTrailingSlash(origin)}/mcp`,
    authorization_servers: [`${trimTrailingSlash(supabaseUrl)}/auth/v1`],
    bearer_methods_supported: ['header'],
    resource_name: 'Author Command Center',
  };
}

export function wwwAuthenticateHeader(origin: string): string {
  return `Bearer resource_metadata="${trimTrailingSlash(origin)}/.well-known/oauth-protected-resource"`;
}

/** Mirrors AuthContext's hasAccess: admins always; members only while active.
    A churned customer's connector stops working even though their login exists. */
export function memberHasAccess(
  profile: { role?: string | null } | null,
  member: { status?: string | null; plan?: string | null } | null,
): boolean {
  if (profile?.role === 'admin' || member?.plan === 'admin') return true;
  return member?.status === 'active';
}

// ---------------------------------------------------------------------------

function requestOrigin(req: VercelRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? 'https';
  const host = (req.headers['x-forwarded-host'] as string) ?? (req.headers.host as string) ?? '';
  return `${proto}://${host}`;
}

function setCors(res: VercelResponse) {
  // Browser-based MCP clients (e.g. MCP Inspector) need CORS; claude.ai
  // connects server-side and ignores it.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
}

async function authenticate(req: VercelRequest): Promise<
  | { ok: true; client: SupabaseClient; user: User }
  | { ok: false; status: 401 | 403; message: string }
> {
  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { ok: false, status: 401, message: 'Missing bearer token' };

  // Per-request client carrying the caller's JWT — RLS applies to every query.
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, message: 'Invalid or expired token' };
  const user = data.user;

  // Membership gate — both reads run as the user, so RLS limits them to
  // their own rows (the same queries AuthContext makes in the app).
  const email = (user.email ?? '').toLowerCase();
  const [profileRes, memberRes] = await Promise.all([
    client.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    client.from('app_members').select('status, plan').eq('email', email).maybeSingle(),
  ]);
  const allowed = memberHasAccess(
    profileRes.error ? null : profileRes.data,
    memberRes.error ? null : memberRes.data,
  );
  if (!allowed) {
    return { ok: false, status: 403, message: 'This Command Center account is not active.' };
  }
  return { ok: true, client, user };
}

/** Every tool returns its result as a single JSON text block. */
function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function buildServer(client: SupabaseClient, user: User): McpServer {
  const server = new McpServer({ name: 'Author Command Center', version: '1.0.0' });
  const uid = user.id;

  // --- Overview -----------------------------------------------------------
  server.tool(
    'get_business_snapshot',
    "Get today's whole picture for the connected author: open and overdue to-dos, inventory reorder alerts (with suggested quantities and cost), month-to-date revenue / ad spend / net profit, and everything dated in the next 7 days (releases, pre-orders, manuscript deadlines, tasks).",
    async () => json(await getBusinessSnapshot(client, uid)),
  );

  // --- Writing (manuscripts & chapters) -----------------------------------
  server.tool(
    'list_manuscripts',
    "List all of the author's manuscripts (title, status, word count, linked book), newest first. Use this to discover what drafts exist before drilling into one.",
    async () => json(await core.listManuscripts(client, uid)),
  );
  server.tool(
    'get_manuscript',
    "Get one manuscript's metadata plus its ordered chapter list with per-chapter word counts (without the heavy chapter text). Use this to see a manuscript's structure and pick a chapter.",
    { manuscript_id: z.string() },
    async ({ manuscript_id }) => json(await core.getManuscript(client, uid, manuscript_id)),
  );
  server.tool(
    'get_chapter',
    "Get a single chapter's full HTML content along with its title, position, and word count. Use this when you need the actual text of one specific chapter.",
    { chapter_id: z.string() },
    async ({ chapter_id }) => json(await core.getChapter(client, uid, chapter_id)),
  );
  server.tool(
    'get_manuscript_plain_text',
    "Get an entire manuscript as readable plain text (all chapters in order, HTML stripped) with a total word count. Use this to read, summarize, or analyze a whole draft.",
    { manuscript_id: z.string() },
    async ({ manuscript_id }) => json(await core.getManuscriptPlainText(client, uid, manuscript_id)),
  );

  // --- Catalog ------------------------------------------------------------
  server.tool(
    'list_books',
    "List all of the author's books with key catalog fields (title, series, status, language, release dates, format prices).",
    async () => json(await core.listBooks(client, uid)),
  );
  server.tool(
    'get_book',
    "Get the full record for a single book by its ID, including blurb, tropes, ISBNs, keywords, and metadata.",
    { book_id: z.string() },
    async ({ book_id }) => json(await core.getBook(client, uid, book_id)),
  );
  server.tool(
    'list_pen_names',
    "List the author's pen names used to attribute books.",
    async () => json(await core.listPenNames(client, uid)),
  );

  // --- ARCs ---------------------------------------------------------------
  server.tool(
    'list_arc_readers',
    "List the author's ARC (advance reader copy) readers with contact info, lifecycle status, and their per-book application/receipt/review history.",
    async () => json(await core.listArcReaders(client, uid)),
  );
  server.tool(
    'get_arc_stats',
    "Get a summary of the ARC program: total reader count and a breakdown of readers by lifecycle status.",
    async () => json(await core.getArcStats(client, uid)),
  );

  // --- Finances (Profit) --------------------------------------------------
  server.tool(
    'list_daily_records',
    "List daily profit/loss records, each with computed revenue, ad spend, and net. Defaults to the last 90 days.",
    { from_date: z.string().optional() },
    async ({ from_date }) => json(await core.listDailyRecords(client, uid, { fromDate: from_date })),
  );
  server.tool(
    'list_profit_categories',
    "List the author's custom revenue and ad-spend profit categories.",
    async () => json(await core.listProfitCategories(client, uid)),
  );
  server.tool(
    'get_pnl_summary',
    "Summarize revenue, ad spend, and net profit per month plus grand totals over the last N months (default 6).",
    { months: z.number().int().positive().optional() },
    async ({ months }) => json(await core.getPnlSummary(client, uid, { months })),
  );

  // --- Transactions -------------------------------------------------------
  server.tool(
    'list_transactions',
    "List recent financial transactions, optionally within a date window (default recent, limit 200).",
    { from_date: z.string().optional(), to_date: z.string().optional(), limit: z.number().int().positive().optional() },
    async ({ from_date, to_date, limit }) =>
      json(await core.listTransactions(client, uid, { fromDate: from_date, toDate: to_date, limit })),
  );
  server.tool(
    'get_monthly_transaction_summary',
    "Show income vs. expense totals grouped by month for the last N months (default 6).",
    { months: z.number().int().positive().optional() },
    async ({ months }) => json(await core.getMonthlyTransactionSummary(client, uid, { months })),
  );
  server.tool(
    'list_subscriptions',
    "List the author's tracked recurring subscriptions and expenses (vendor, frequency, amount).",
    async () => json(await core.listSubscriptions(client, uid)),
  );
  server.tool(
    'list_cash_flow_notes',
    "List the author's free-text monthly cash-flow notes.",
    async () => json(await core.listCashFlowNotes(client, uid)),
  );

  // --- Inventory & Orders -------------------------------------------------
  server.tool(
    'list_products',
    "List every product in the author's inventory catalog with stock, cost, reorder point, and sales-history fields.",
    async () => json(await core.listProducts(client, uid)),
  );
  server.tool(
    'list_purchase_orders',
    "List the author's purchase orders (book reorders), newest first, optionally filtered by status.",
    { status: z.enum(['pending', 'arrived']).optional() },
    async ({ status }) => json(await core.listPurchaseOrders(client, uid, { status })),
  );
  server.tool(
    'list_orders',
    "List recent Shopify orders with totals and a line-item count/quantity summary. Defaults to the last 30 days (max 200).",
    { from_date: z.string().optional(), limit: z.number().int().positive().optional() },
    async ({ from_date, limit }) => json(await core.listOrders(client, uid, { fromDate: from_date, limit })),
  );

  // --- Planner ------------------------------------------------------------
  server.tool(
    'list_tasks',
    "List the author's planner to-dos, defaulting to open tasks ordered by due date. Filter by completion, list, due-before date, or someday flag.",
    {
      done: z.boolean().optional(),
      list_id: z.string().optional(),
      due_before: z.string().optional(),
      someday: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
    },
    async ({ done, list_id, due_before, someday, limit }) =>
      json(await core.listTasks(client, uid, { done, listId: list_id, dueBefore: due_before, someday, limit })),
  );
  server.tool(
    'list_task_lists',
    "List the author's planner lists (named to-do lists / brain-dumps), pinned first.",
    async () => json(await core.listTaskLists(client, uid)),
  );
  server.tool(
    'get_task_counts',
    "Get a summary tally of the author's to-dos: open, done, overdue, and someday counts.",
    async () => json(await core.getTaskCounts(client, uid)),
  );

  // =========================================================================
  // WRITE tools — insert/append/upsert only, under the caller's RLS. No tool
  // deletes user content or does a destructive overwrite.
  // =========================================================================

  // --- Writing writes -----------------------------------------------------
  server.tool(
    'create_manuscript',
    "Create a new empty draft manuscript for the author, optionally linked to a Catalog book.",
    { title: z.string(), book_id: z.string().optional() },
    async ({ title, book_id }) => json(await core.createManuscript(client, uid, { title, bookId: book_id })),
  );
  server.tool(
    'append_manuscript_chapter',
    "Append one finished chapter to the END of an existing manuscript. Strictly additive — it never modifies or deletes existing chapters. Use this to save a chapter drafted in Cowork into the manuscript of record.",
    { manuscript_id: z.string(), title: z.string(), content: z.string() },
    async ({ manuscript_id, title, content }) =>
      json(await core.appendManuscriptChapter(client, uid, { manuscriptId: manuscript_id, title, content })),
  );

  // --- Planner writes -----------------------------------------------------
  server.tool(
    'create_task',
    "Add a single to-do to the author's planner.",
    {
      title: z.string(),
      due_date: z.string().optional(),
      list_id: z.string().optional(),
      priority: z.boolean().optional(),
      someday: z.boolean().optional(),
      estimate_minutes: z.number().int().positive().optional(),
      feel_good: z.boolean().optional(),
    },
    async ({ title, due_date, list_id, priority, someday, estimate_minutes, feel_good }) =>
      json(await core.createTask(client, uid, {
        title, dueDate: due_date, listId: list_id, priority, someday,
        estimateMinutes: estimate_minutes, feelGood: feel_good,
      })),
  );
  server.tool(
    'complete_task',
    "Mark one planner to-do as done (non-destructive — it is not deleted).",
    { task_id: z.string() },
    async ({ task_id }) => json(await core.completeTask(client, uid, { taskId: task_id })),
  );
  server.tool(
    'add_tasks',
    "Bulk-add up to 200 to-dos to the planner in one call — e.g. importing a task list from another planning app.",
    { tasks: z.array(z.object({ title: z.string(), due_date: z.string().optional(), list_id: z.string().optional() })).max(200) },
    async ({ tasks }) =>
      json(await core.addTasks(client, uid, tasks.map(t => ({ title: t.title, dueDate: t.due_date, listId: t.list_id })))),
  );

  // --- Finance writes -----------------------------------------------------
  server.tool(
    'add_transaction',
    "Record a single income or expense transaction in the finance tracker.",
    {
      date: z.string(),
      amount: z.number(),
      type: z.enum(['income', 'expense']),
      category: z.string().optional(),
      description: z.string().optional(),
      original_description: z.string().optional(),
      source: z.string().optional(),
    },
    async (args) => json(await core.addTransaction(client, uid, args)),
  );
  server.tool(
    'save_cash_flow_note',
    "Create or replace the free-text cash-flow note for a given month (YYYY-MM).",
    { month: z.string(), note: z.string() },
    async ({ month, note }) => json(await core.saveCashFlowNote(client, uid, { month, note })),
  );

  // --- Catalog writes -----------------------------------------------------
  server.tool(
    'set_opportunity_decision',
    "Mark a book's suggested opportunity as 'dismissed' or 'planned' so the dashboard stops nagging or tracks it as a to-do.",
    { book_id: z.string(), opportunity_key: z.string(), decision: z.enum(['dismissed', 'planned']) },
    async ({ book_id, opportunity_key, decision }) =>
      json(await core.setOpportunityDecision(client, uid, { bookId: book_id, opportunityKey: opportunity_key, decision })),
  );

  return server;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  const origin = requestOrigin(req);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Protected Resource Metadata (rewritten from /.well-known/…)
  const url = new URL(req.url ?? '/', origin);
  if (req.method === 'GET' && url.searchParams.get('meta') === 'prm') {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(buildProtectedResourceMetadata(origin, SUPABASE_URL));
    return;
  }

  if (req.method !== 'POST') {
    // Stateless server: no GET stream, no DELETE sessions.
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = await authenticate(req);
  if ('status' in auth) {
    if (auth.status === 401) res.setHeader('WWW-Authenticate', wwwAuthenticateHeader(origin));
    res.status(auth.status).json({
      jsonrpc: '2.0',
      error: { code: auth.status === 401 ? -32001 : -32003, message: auth.message },
      id: null,
    });
    return;
  }

  const server = buildServer(auth.client, auth.user);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — every request stands alone
    enableJsonResponse: true,
  });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
