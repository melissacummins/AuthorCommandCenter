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
import { getBusinessSnapshot } from '../src/lib/dashboardCore';

export const maxDuration = 30;

type VercelRequest = IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> };
type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  send: (body: string) => void;
};

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in src/lib/mcpAuth.test.ts)

export function buildProtectedResourceMetadata(origin: string, supabaseUrl: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    bearer_methods_supported: ['header'],
    resource_name: 'Author Command Center',
  };
}

export function wwwAuthenticateHeader(origin: string): string {
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
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

function buildServer(client: SupabaseClient, user: User): McpServer {
  const server = new McpServer({ name: 'Author Command Center', version: '1.0.0' });

  server.tool(
    'get_business_snapshot',
    "Get today's whole picture for the connected author: open and overdue to-dos, inventory reorder alerts (with suggested quantities and cost), month-to-date revenue / ad spend / net profit, and everything dated in the next 7 days (releases, pre-orders, manuscript deadlines, tasks).",
    async () => {
      const snapshot = await getBusinessSnapshot(client, user.id);
      return { content: [{ type: 'text', text: JSON.stringify(snapshot) }] };
    },
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
