// Barrel for the MCP connector's read data-core. Bundled by
// scripts/bundle-mcp-core.mjs into api/_generated/connectorCore.js (a single
// self-contained ES module with no relative imports), so api/mcp.ts can call
// these under Node's ESM loader on Vercel. Every function is client-injected
// (takes a per-request, RLS-scoped SupabaseClient) — never the browser
// singleton — exactly like src/lib/dashboardCore.ts.
export * from './writing';
export * from './catalog';
export * from './arcs';
export * from './finance';
export * from './transactions';
export * from './inventory';
export * from './planner';
