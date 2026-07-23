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

  // --- Link Shortener & Bio Page reads ------------------------------------
  server.tool(
    'list_short_links',
    "List the author's short links (bio-page cards, ARC signup URLs, channel variants, etc.), newest first. Filter by parent (pass null for top-level only), folder, active/archived state, or a search query that matches slug/label/destination/channel/bio_title.",
    {
      parent_id: z.string().nullable().optional().describe('Uuid of a parent link, or null to list only top-level links, or omit to include everything.'),
      folder_id: z.string().nullable().optional(),
      is_active: z.boolean().optional(),
      include_archived: z.boolean().optional(),
      show_on_bio_only: z.boolean().optional(),
      search: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
    },
    async ({ parent_id, folder_id, is_active, include_archived, show_on_bio_only, search, limit }) =>
      json(await core.listShortLinks(client, uid, {
        parentId: parent_id,
        folderId: folder_id,
        isActive: is_active,
        includeArchived: include_archived,
        showOnBioOnly: show_on_bio_only,
        search,
        limit,
      })),
  );
  server.tool(
    'get_short_link',
    "Get a single short link (with click_count / conversion totals / bio settings) by its id or its slug. Provide exactly one.",
    { id: z.string().optional(), slug: z.string().optional() },
    async ({ id, slug }) => json(await core.getShortLink(client, uid, { id, slug })),
  );
  server.tool(
    'list_link_folders',
    "List the author's link folders (for organizing short links), alphabetical.",
    async () => json(await core.listLinkFolders(client, uid)),
  );
  server.tool(
    'list_bio_blocks',
    "List the author's bio-page blocks — section headers (title + body text) and image cards (clickable hero images) — ordered by bio_sort_order. These are the non-link items that interleave with short-link cards on the public bio page.",
    async () => json(await core.listBioBlocks(client, uid)),
  );
  server.tool(
    'get_bio_settings',
    "Get the author's bio-page settings (currently: logo url). Returns null if the user hasn't customized anything yet.",
    async () => json(await core.getBioSettings(client, uid)),
  );

  // --- Landing Pages & Series Pages reads ---------------------------------
  server.tool(
    'list_landing_pages',
    "List the author's book landing pages — branded /slug pages with a cover image, description, retailer buy buttons, reviews, optional sample-chapter link, and cross-sell row to other books in the same series. Optionally filter with a search that matches slug/title/headline/description.",
    {
      search: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
    },
    async ({ search, limit }) =>
      json(await core.listLandingPages(client, uid, { search, limit })),
  );
  server.tool(
    'get_landing_page',
    "Get a single landing page by its id or slug — returns every field including buttons, reviews, cover_image_url, sample URL, series/cross-sell settings, theme, and accent color.",
    { id: z.string().optional(), slug: z.string().optional() },
    async ({ id, slug }) => json(await core.getLandingPage(client, uid, { id, slug })),
  );
  server.tool(
    'list_series_pages',
    "List the author's series pages — branded collection pages that group multiple book landing pages under a single /slug URL. Optionally search across slug/title/description.",
    {
      search: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
    },
    async ({ search, limit }) =>
      json(await core.listSeriesPages(client, uid, { search, limit })),
  );
  server.tool(
    'get_series_page',
    "Get a single series page by its id or slug. page_ids is the ordered array of landing_pages.id values shown on the rendered series page.",
    { id: z.string().optional(), slug: z.string().optional() },
    async ({ id, slug }) => json(await core.getSeriesPage(client, uid, { id, slug })),
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
    'create_list',
    "Create a new named planner list (a to-do list / brain-dump) for the author. Additive — never deletes or overwrites. Returns the created list, whose id can be passed as list_id to create_task/add_tasks.",
    { title: z.string(), pinned: z.boolean().optional() },
    async ({ title, pinned }) => json(await core.createList(client, uid, { title, pinned })),
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

  // --- Transactions: bulk import ------------------------------------------
  server.tool(
    'import_transactions',
    "Bulk-import a bank CSV's worth of transactions into the finance tracker in one call. Duplicates are detected and skipped, so re-importing overlapping CSVs is safe. Returns how many were inserted vs. skipped.",
    {
      rows: z.array(z.object({
        date: z.string(),
        amount: z.number(),
        type: z.enum(['income', 'expense']),
        category: z.string().optional(),
        description: z.string().optional(),
        original_description: z.string().optional(),
        source: z.string().optional(),
      })).max(1000),
    },
    async ({ rows }) => json(await core.importTransactions(client, uid, rows)),
  );

  // --- Cash flow (weekly forecast, reconciled from transactions) -----------
  server.tool(
    'get_cash_flow',
    "Get the author's weekly cash-flow: each week with its income and bill line items plus computed income/bill subtotals, worst-case ending (opening minus bills), and projected ending. Filter to a month (YYYY-MM) or a single week.",
    { month: z.string().optional(), week_start: z.string().optional() },
    async ({ month, week_start }) => json(await core.getCashFlow(client, uid, { month, weekStart: week_start })),
  );
  server.tool(
    'upsert_cash_flow_week',
    "Create or update a cash-flow week (keyed on its start date): set the opening balance, the actual ending balance, and a note.",
    {
      week_start: z.string(),
      week_end: z.string(),
      opening_balance: z.number().optional(),
      actual_ending_balance: z.number().optional(),
      note: z.string().optional(),
    },
    async ({ week_start, week_end, opening_balance, actual_ending_balance, note }) =>
      json(await core.upsertCashFlowWeek(client, uid, {
        weekStart: week_start, weekEnd: week_end,
        openingBalance: opening_balance, actualEndingBalance: actual_ending_balance, note,
      })),
  );
  server.tool(
    'add_cash_flow_line',
    "Add one planned income or bill line item to an existing cash-flow week (the week must already exist — create it with upsert_cash_flow_week first).",
    {
      week_start: z.string(),
      kind: z.enum(['income', 'bill']),
      source: z.string(),
      amount: z.number(),
      date: z.string().optional(),
      settled: z.boolean().optional(),
      notes: z.string().optional(),
    },
    async ({ week_start, kind, source, amount, date, settled, notes }) =>
      json(await core.addCashFlowLine(client, uid, { weekStart: week_start, kind, source, amount, date, settled, notes })),
  );
  server.tool(
    'update_cash_flow_line',
    "Update a single cash-flow line item — e.g. mark a bill paid or income received (settled), or replace an estimate with the actual amount.",
    {
      line_id: z.string(),
      source: z.string().optional(),
      amount: z.number().optional(),
      settled: z.boolean().optional(),
      date: z.string().optional(),
      notes: z.string().optional(),
    },
    async ({ line_id, source, amount, settled, date, notes }) =>
      json(await core.updateCashFlowLine(client, uid, { lineId: line_id, source, amount, settled, date, notes })),
  );
  server.tool(
    'delete_cash_flow_line',
    "Delete a single cash-flow income or bill line item.",
    { line_id: z.string() },
    async ({ line_id }) => json(await core.deleteCashFlowLine(client, uid, { lineId: line_id })),
  );

  // --- Link Shortener & Bio Page writes -----------------------------------
  server.tool(
    'create_short_link',
    "Create a new short link. The slug must be unique across this account's short_links, landing_pages, and series_pages. If show_on_bio is true (default) and this isn't a channel variant (no parent_id), the link is placed at the bottom of the bio order so existing arrangements aren't disrupted.",
    {
      slug: z.string(),
      destination_url: z.string(),
      label: z.string().optional().describe('Internal label — only the author sees this, not readers.'),
      channel: z.string().optional().describe("Marketing channel tag, e.g. 'Facebook', 'Threads', 'Newsletter'."),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
      is_active: z.boolean().optional(),
      parent_id: z.string().nullable().optional().describe('Set to an existing short_link id to make this a channel variant of that link.'),
      folder_id: z.string().nullable().optional(),
      starts_at: z.string().nullable().optional().describe("ISO timestamp. Before this, readers see a 'Coming soon' branded page."),
      expires_at: z.string().nullable().optional().describe("ISO timestamp. After this, readers see an 'Expired' page or the expired_redirect_url."),
      expired_redirect_url: z.string().nullable().optional(),
      show_on_bio: z.boolean().optional().describe('Include this link on the public bio page. Defaults to true.'),
      bio_title: z.string().optional().describe("Public-facing card title on the bio page. Falls back to label if blank."),
      bio_style: z.enum(['card', 'icon']).optional().describe("'card' = full-width card. 'icon' = compact social icon at top of bio page."),
      thumbnail_url: z.string().nullable().optional().describe('Explicit thumbnail image URL for the bio card. Falls back to cached og:image otherwise.'),
    },
    async (args) => json(await core.createShortLink(client, uid, args)),
  );
  server.tool(
    'update_short_link',
    "Edit an existing short link. Any field left undefined is not touched. Common uses: swap destination_url when migrating a service (e.g. Klaviyo to a different newsletter host), change the public bio_title, move the link to a different folder, adjust bio_sort_order.",
    {
      id: z.string(),
      label: z.string().optional(),
      destination_url: z.string().optional(),
      channel: z.string().optional(),
      notes: z.string().optional(),
      tags: z.array(z.string()).optional(),
      is_active: z.boolean().optional(),
      folder_id: z.string().nullable().optional(),
      starts_at: z.string().nullable().optional(),
      expires_at: z.string().nullable().optional(),
      expired_redirect_url: z.string().nullable().optional(),
      show_on_bio: z.boolean().optional(),
      bio_title: z.string().optional(),
      bio_style: z.enum(['card', 'icon']).optional(),
      thumbnail_url: z.string().nullable().optional(),
      bio_sort_order: z.number().int().nonnegative().optional(),
    },
    async (args) => json(await core.updateShortLink(client, uid, args)),
  );
  server.tool(
    'archive_short_link',
    "Soft-delete a short link: readers get the branded 'unavailable' page but click and conversion history is preserved. Pass unarchive: true to restore.",
    { id: z.string(), unarchive: z.boolean().optional() },
    async ({ id, unarchive }) => json(await core.archiveShortLink(client, uid, { id, unarchive })),
  );
  server.tool(
    'create_link_folder',
    "Create a new folder for organizing short links.",
    { name: z.string(), color: z.string().optional().describe("Hex color like '#6366f1'.") },
    async ({ name, color }) => json(await core.createLinkFolder(client, uid, { name, color })),
  );
  server.tool(
    'update_link_folder',
    "Rename a link folder or change its color / manual sort order.",
    {
      id: z.string(),
      name: z.string().optional(),
      color: z.string().optional(),
      sort_order: z.number().int().optional(),
    },
    async (args) => json(await core.updateLinkFolder(client, uid, args)),
  );
  server.tool(
    'delete_link_folder',
    "Delete a link folder. The folder is organizational only — its links are preserved (their folder_id becomes null).",
    { id: z.string() },
    async ({ id }) => json(await core.deleteLinkFolder(client, uid, { id })),
  );
  server.tool(
    'create_bio_block',
    "Add a section header or image card to the public bio page. Sections show as a centered heading + body text between link cards. Image cards show as a full-width clickable hero image with an optional caption. New blocks land at the bottom of the bio order by default.",
    {
      type: z.enum(['section', 'image']),
      title: z.string().optional().describe('Section heading or image caption.'),
      body: z.string().optional().describe('Body text for a section block. Supports line breaks (rendered with white-space: pre-line).'),
      image_url: z.string().optional().describe('Public image URL for an image card.'),
      link_url: z.string().optional().describe('Where an image card clicks through to (a short slug like "/my-vicious-beast" or an absolute URL).'),
      bio_sort_order: z.number().int().nonnegative().optional(),
    },
    async (args) => json(await core.createBioBlock(client, uid, args)),
  );
  server.tool(
    'update_bio_block',
    "Edit an existing bio-page block (section header or image card). Only pass the fields you want to change; unspecified fields are left alone. Pass null to explicitly clear an optional string field.",
    {
      id: z.string(),
      title: z.string().nullable().optional(),
      body: z.string().nullable().optional(),
      image_url: z.string().nullable().optional(),
      link_url: z.string().nullable().optional(),
      bio_sort_order: z.number().int().nonnegative().optional(),
    },
    async (args) => json(await core.updateBioBlock(client, uid, args)),
  );
  server.tool(
    'delete_bio_block',
    "Remove a section or image card from the bio page. Bio blocks are display-only config — no click / conversion history is attached, so this is safe.",
    { id: z.string() },
    async ({ id }) => json(await core.deleteBioBlock(client, uid, { id })),
  );
  server.tool(
    'upsert_bio_settings',
    "Update the author's bio-page settings. Currently supports setting or clearing the logo URL (which replaces the gradient initial at the top of the bio page). Pass null to clear.",
    { logo_url: z.string().nullable().optional() },
    async (args) => json(await core.upsertBioSettings(client, uid, args)),
  );

  // --- Landing Pages writes -----------------------------------------------
  server.tool(
    'create_landing_page',
    "Create a new book landing page. The slug becomes read.<domain>/<slug> and must be unique across this account's short_links, landing_pages, and series_pages. Every field except slug is optional — buttons, reviews, cover, sample link, cross-sell, and theme can all be added later via update_landing_page.",
    {
      slug: z.string().describe('URL slug, 3-40 chars, [A-Za-z0-9_-].'),
      title: z.string().optional(),
      headline: z.string().optional().describe('One-line hook, shown large above description when page_text_mode = "headline".'),
      description: z.string().optional(),
      page_text_mode: z.enum(['headline', 'description', 'custom', 'none']).optional().describe(
        "'description' (default): show description. 'headline': show headline instead. 'custom': show page_text_custom. 'none': hide all book text.",
      ),
      page_text_custom: z.string().optional(),
      cover_image_url: z.string().nullable().optional().describe('Public image URL. Uploads happen in-app; this field accepts any absolute URL.'),
      source_url: z.string().optional().describe("Private note — usually the retailer URL you originally scraped fields from. Not rendered publicly."),
      buttons: z.array(z.object({ label: z.string(), url: z.string() })).optional().describe('Retailer buy buttons, e.g. [{ label: "Amazon", url: "https://..." }].'),
      reviews: z.array(z.object({
        stars: z.number().int().min(1).max(5),
        quote: z.string(),
        attribution: z.string(),
      })).optional(),
      series_page_id: z.string().nullable().optional().describe("If set, this book belongs to that series and shows a cross-sell row of its siblings."),
      cross_sell_label: z.enum(['series', 'world', 'more', 'none']).optional().describe("Section heading for the cross-sell row. Default 'series'. 'none' hides the row entirely."),
      sample_url: z.string().nullable().optional(),
      sample_label: z.string().optional().describe("Default: 'Read a sample'."),
      theme: z.string().optional().describe("One of: 'classic', 'midnight', 'blush', 'cream', 'forest', 'noir'."),
      accent_color: z.string().nullable().optional().describe('Hex color to override the theme accent, or null to use the theme default.'),
    },
    async (args) => json(await core.createLandingPage(client, uid, args)),
  );
  server.tool(
    'update_landing_page',
    "Edit an existing landing page. Any field left undefined is not touched. Common uses: swap retailer buy-button URLs when links change, add or remove reviews, replace the cover image, attach to a series, change the theme.",
    {
      id: z.string(),
      slug: z.string().optional(),
      title: z.string().optional(),
      headline: z.string().optional(),
      description: z.string().optional(),
      page_text_mode: z.enum(['headline', 'description', 'custom', 'none']).optional(),
      page_text_custom: z.string().optional(),
      cover_image_url: z.string().nullable().optional(),
      source_url: z.string().optional(),
      buttons: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
      reviews: z.array(z.object({
        stars: z.number().int().min(1).max(5),
        quote: z.string(),
        attribution: z.string(),
      })).optional(),
      series_page_id: z.string().nullable().optional(),
      cross_sell_label: z.enum(['series', 'world', 'more', 'none']).optional(),
      sample_url: z.string().nullable().optional(),
      sample_label: z.string().optional(),
      theme: z.string().optional(),
      accent_color: z.string().nullable().optional(),
    },
    async (args) => json(await core.updateLandingPage(client, uid, args)),
  );
  server.tool(
    'delete_landing_page',
    "Permanently delete a book landing page (matches the Delete button in the Command Center UI — landing pages have no archive state). Cascade: bio_blocks that referenced this page (book blocks on the bio page) are ALSO removed. Series pages that included it keep the id in their page_ids array; the resolved book card just disappears. Not reversible.",
    { id: z.string() },
    async ({ id }) => json(await core.deleteLandingPage(client, uid, { id })),
  );

  // --- Series Pages writes ------------------------------------------------
  server.tool(
    'create_series_page',
    "Create a new series page — an ordered collection of book landing pages under a single branded /slug URL. page_ids must all reference landing_pages that belong to this account; the array order IS the display order on the rendered page.",
    {
      slug: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      page_ids: z.array(z.string()).optional().describe('Ordered array of landing_pages.id values. Show the books in this order on the series page.'),
      theme: z.string().optional(),
      accent_color: z.string().nullable().optional(),
      card_text_mode: z.enum(['headline', 'description', 'none']).optional().describe("Which text field to show under each book card in the series. Default 'description'."),
    },
    async (args) => json(await core.createSeriesPage(client, uid, args)),
  );
  server.tool(
    'update_series_page',
    "Edit a series page. To reorder books, pass a full new page_ids array in the desired order. To add or remove books, mutate page_ids accordingly (pass the complete new list). Every id in page_ids is verified to belong to this account before saving.",
    {
      id: z.string(),
      slug: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      page_ids: z.array(z.string()).optional(),
      theme: z.string().optional(),
      accent_color: z.string().nullable().optional(),
      card_text_mode: z.enum(['headline', 'description', 'none']).optional(),
    },
    async (args) => json(await core.updateSeriesPage(client, uid, args)),
  );
  server.tool(
    'delete_series_page',
    "Permanently delete a series page. Any landing_pages that referenced this series (via series_page_id) have that field cleared — their cross-sell row goes empty but the landing pages themselves are untouched. Not reversible.",
    { id: z.string() },
    async ({ id }) => json(await core.deleteSeriesPage(client, uid, { id })),
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
