// Logic tests for the MCP connector's pure pieces. Run via:
//   npx tsx src/lib/mcpAuth.test.ts
// No Supabase, no network.

import assert from 'node:assert';
import {
  buildProtectedResourceMetadata,
  wwwAuthenticateHeader,
  memberHasAccess,
} from '../../api/mcp';
import { getBusinessSnapshot } from './dashboardCore';

console.log('Test 1: protected resource metadata points at the Supabase auth server');
{
  const prm = buildProtectedResourceMetadata('https://app.example.com', 'https://ref.supabase.co');
  assert(prm.resource === 'https://app.example.com/api/mcp');
  assert.deepEqual(prm.authorization_servers, ['https://ref.supabase.co/auth/v1']);
  assert(prm.bearer_methods_supported.includes('header'));
}

console.log('Test 2: WWW-Authenticate advertises the metadata URL');
{
  const h = wwwAuthenticateHeader('https://app.example.com');
  assert(h.includes('resource_metadata="https://app.example.com/.well-known/oauth-protected-resource"'));
}

console.log('Test 3: membership gate mirrors AuthContext hasAccess');
{
  assert(memberHasAccess({ role: 'admin' }, null) === true, 'profile admin');
  assert(memberHasAccess(null, { plan: 'admin', status: 'churned' }) === true, 'member-plan admin');
  assert(memberHasAccess(null, { status: 'active', plan: 'starter' }) === true, 'active member');
  assert(memberHasAccess(null, { status: 'paused', plan: 'starter' }) === false, 'paused member');
  assert(memberHasAccess(null, null) === false, 'no membership row');
  assert(memberHasAccess({ role: 'member' }, { status: 'invited' }) === false, 'invited only');
}

console.log('Test 4: getBusinessSnapshot assembles all four slices from a mocked client');
{
  // Minimal chainable mock: every table query resolves to a canned row set.
  const rows: Record<string, any[]> = {
    products: [],
    shopify_orders: [],
    purchase_orders: [],
    daily_records: [
      { id: 'r1', date: '2026-07-02', pnr_ads: 10, contemp_ads: 0, traffic_ads: 0, misc_ads: 0, shopify_rev: 100, amazon_rev: 50, d2d_rev: 0, google_rev: 0, kobo_rev: 0, kobo_plus_rev: 0, custom_amounts: null },
      { id: 'r0', date: '2026-06-15', pnr_ads: 20, contemp_ads: 0, traffic_ads: 0, misc_ads: 0, shopify_rev: 10, amazon_rev: 0, d2d_rev: 0, google_rev: 0, kobo_rev: 0, kobo_plus_rev: 0, custom_amounts: null },
    ],
    profit_categories: [],
    books: [{ id: 'b1', title: 'Vicious Beast', publish_date: '2026-07-08', pre_order_date: null, manuscript_due_date: null }],
    planner_tasks: [{ id: 't1', title: 'Approve cover proof', due_date: '2026-07-05' }],
  };
  function chain(table: string) {
    const promise = Promise.resolve({ data: rows[table] ?? [], error: null });
    const api: any = { then: promise.then.bind(promise), catch: promise.catch.bind(promise) };
    for (const m of ['select', 'eq', 'gte', 'lte', 'or', 'order', 'limit', 'in']) {
      api[m] = () => api;
    }
    api.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return api;
  }
  const mockClient: any = { from: (table: string) => chain(table) };

  const now = new Date('2026-07-05T12:00:00');
  getBusinessSnapshot(mockClient, 'u1', now).then(snap => {
    assert(snap.today === '2026-07-05', 'today stamped');
    assert(snap.tasks.count === 1 && snap.tasks.titles[0] === 'Approve cover proof', 'tasks slice');
    assert(snap.inventoryAlerts.length === 0, 'no products, no alerts');
    assert(snap.monthPnl.monthRevenue === 150 && snap.monthPnl.monthAdSpend === 10, 'month P&L sums July only');
    assert(snap.monthPnl.prevMonthNet === -10, 'June net folded into prevMonthNet');
    assert(snap.monthPnl.lastEntryDate === '2026-07-02', 'as-of date');
    assert(snap.upcoming.some(u => u.kind === 'release' && u.label.includes('Vicious Beast')), 'release surfaced');
    assert(snap.upcoming.some(u => u.kind === 'task'), 'task surfaced');
    console.log('\nAll MCP connector tests passed.');
  }).catch(e => { console.error(e); process.exit(1); });
}
