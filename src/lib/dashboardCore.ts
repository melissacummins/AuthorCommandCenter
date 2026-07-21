// Client-injected data core (MCP directive §1.5).
//
// These functions power both the Home dashboard AND the MCP connector
// (api/mcp.ts), so they MUST NOT import the browser Supabase singleton
// (src/lib/supabase.ts uses import.meta.env, which doesn't exist server-side).
// The browser wrappers in dashboard.ts bind the singleton; the MCP server
// passes a per-request client built from the caller's OAuth token, which
// means every query here runs under that user's RLS.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Product } from './types';
import { calculateProductMetrics, aggregateSalesRates } from '../modules/inventory/utils';
import { calculateMetrics } from '../modules/profit-track/utils/calculations';
import { dailyRecordFromDb, profitCategoryFromDb } from '../modules/profit-track/utils/mappers';

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Inventory alerts

export interface InventoryAlert {
  productId: string;
  name: string;
  sku: string;
  bookInventory: number;
  daysRemaining: number;
  reorderQty: number;
  reorderCost: number;
  status: 'REORDER NOW' | 'OUT OF STOCK';
}

/** Products at/below their reorder point, excluding do-not-reorder products
    and those already fully covered by a pending purchase order. Sorted most
    urgent first. */
export async function getInventoryAlertsCore(client: SupabaseClient): Promise<InventoryAlert[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 180);

  const [productsRes, ordersRes, pendingRes] = await Promise.all([
    client.from('products').select('*'),
    client
      .from('shopify_orders')
      .select('order_date, line_items, refunds, cancelled_at')
      .gte('order_date', cutoff.toISOString()),
    client.from('purchase_orders').select('product_id, quantity').eq('status', 'pending'),
  ]);
  if (productsRes.error) throw productsRes.error;
  // Sales rates and pending POs are enrichments — an error in either
  // degrades the estimate, it shouldn't kill the alert list.
  const products = (productsRes.data ?? []) as Product[];
  const salesRates = aggregateSalesRates(ordersRes.error ? [] : (ordersRes.data ?? []), 180);
  const pendingByProduct = new Map<string, number>();
  if (!pendingRes.error) {
    for (const po of pendingRes.data ?? []) {
      pendingByProduct.set(po.product_id, (pendingByProduct.get(po.product_id) ?? 0) + (Number(po.quantity) || 0));
    }
  }

  const alerts: InventoryAlert[] = [];
  for (const p of products) {
    if (p.do_not_reorder) continue;
    const sku = (p.sku || '').trim().toUpperCase();
    const shopifyDaily = sku ? salesRates.get(sku)?.avgDaily : undefined;
    const m = calculateProductMetrics(p, products, shopifyDaily);
    if (m.status !== 'REORDER NOW' && m.status !== 'OUT OF STOCK') continue;
    const pending = pendingByProduct.get(p.id) ?? 0;
    if (m.reorderQty > 0 && pending >= m.reorderQty) continue; // already on order
    alerts.push({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      bookInventory: m.bookInventory,
      daysRemaining: m.daysRemaining,
      reorderQty: Math.max(0, m.reorderQty - pending),
      reorderCost: m.reorderCost,
      status: m.status,
    });
  }
  return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

// ---------------------------------------------------------------------------
// Month P&L

export interface MonthPnl {
  monthRevenue: number;
  monthAdSpend: number;
  monthNet: number;
  prevMonthNet: number;
  /** Latest daily-record date in range — Profit is manually entered, so
      consumers must surface this "as of" date. Null when nothing entered. */
  lastEntryDate: string | null;
}

/** Current + previous month only — never the full history. */
export async function getMonthPnlCore(client: SupabaseClient, now: Date = new Date()): Promise<MonthPnl> {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [recordsRes, categoriesRes] = await Promise.all([
    client.from('daily_records').select('*').gte('date', isoDay(prevFirst)).order('date'),
    client.from('profit_categories').select('*'),
  ]);
  if (recordsRes.error) throw recordsRes.error;
  if (categoriesRes.error) throw categoriesRes.error;

  const categories = (categoriesRes.data ?? []).map(profitCategoryFromDb);
  const records = (recordsRes.data ?? []).map(dailyRecordFromDb);
  const firstIso = isoDay(first);

  let monthRevenue = 0;
  let monthAdSpend = 0;
  let prevMonthNet = 0;
  let lastEntryDate: string | null = null;
  for (const r of records) {
    const m = calculateMetrics(r, categories);
    if (r.date >= firstIso) {
      monthRevenue += m.totalRevenue;
      monthAdSpend += m.totalAdSpend;
      if (!lastEntryDate || r.date > lastEntryDate) lastEntryDate = r.date;
    } else {
      prevMonthNet += m.totalRevenue - m.totalAdSpend;
    }
  }
  return { monthRevenue, monthAdSpend, monthNet: monthRevenue - monthAdSpend, prevMonthNet, lastEntryDate };
}

// ---------------------------------------------------------------------------
// Upcoming dates

export type UpcomingKind = 'release' | 'pre_order' | 'manuscript_due' | 'task';

export interface UpcomingItem {
  date: string; // YYYY-MM-DD
  label: string;
  kind: UpcomingKind;
  href: string;
}

export async function getUpcomingDatesCore(
  client: SupabaseClient,
  userId: string,
  days = 14,
  now: Date = new Date(),
): Promise<UpcomingItem[]> {
  const todayIso = isoDay(now);
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  const endIso = isoDay(end);

  const [booksRes, tasksRes] = await Promise.all([
    client
      .from('books')
      .select('id, title, publish_date, pre_order_date, manuscript_due_date')
      .eq('user_id', userId)
      .or(
        `and(publish_date.gte.${todayIso},publish_date.lte.${endIso}),` +
        `and(pre_order_date.gte.${todayIso},pre_order_date.lte.${endIso}),` +
        `and(manuscript_due_date.gte.${todayIso},manuscript_due_date.lte.${endIso})`,
      ),
    client
      .from('planner_tasks')
      .select('id, title, due_date')
      .eq('user_id', userId)
      .eq('done', false)
      .eq('kind', 'task')
      .eq('someday', false)
      .gte('due_date', todayIso)
      .lte('due_date', endIso)
      .order('due_date')
      .limit(30),
  ]);
  if (booksRes.error) throw booksRes.error;
  if (tasksRes.error) throw tasksRes.error;

  const items: UpcomingItem[] = [];
  const inRange = (d: string | null): d is string => !!d && d >= todayIso && d <= endIso;
  for (const b of booksRes.data ?? []) {
    if (inRange(b.publish_date)) {
      items.push({ date: b.publish_date, label: `“${b.title}” releases`, kind: 'release', href: '/catalog' });
    }
    if (inRange(b.pre_order_date)) {
      items.push({ date: b.pre_order_date, label: `“${b.title}” pre-order goes live`, kind: 'pre_order', href: '/catalog' });
    }
    if (inRange(b.manuscript_due_date)) {
      items.push({ date: b.manuscript_due_date, label: `“${b.title}” manuscript due`, kind: 'manuscript_due', href: '/writing' });
    }
  }
  for (const t of tasksRes.data ?? []) {
    items.push({ date: t.due_date as string, label: t.title, kind: 'task', href: '/planner' });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Today's open tasks (count + titles — the MCP snapshot's to-do slice)

export interface TodayTasks {
  count: number;
  titles: string[];
  overdueCount: number;
}

export async function getTodayTasksCore(
  client: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<TodayTasks> {
  const todayIso = isoDay(now);
  const { data, error } = await client
    .from('planner_tasks')
    .select('title, due_date')
    .eq('user_id', userId)
    .eq('done', false)
    .eq('kind', 'task')
    .eq('someday', false)
    .lte('due_date', todayIso)
    .order('due_date')
    .limit(50);
  if (error) throw error;
  const rows = data ?? [];
  return {
    count: rows.length,
    titles: rows.map(r => r.title),
    overdueCount: rows.filter(r => (r.due_date as string) < todayIso).length,
  };
}

// ---------------------------------------------------------------------------
// The MCP connector's first tool: one call, the day's whole picture.

export interface BusinessSnapshot {
  today: string;
  tasks: TodayTasks;
  inventoryAlerts: InventoryAlert[];
  monthPnl: MonthPnl;
  upcoming: UpcomingItem[];
}

export async function getBusinessSnapshot(
  client: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<BusinessSnapshot> {
  const [tasks, inventoryAlerts, monthPnl, upcoming] = await Promise.all([
    getTodayTasksCore(client, userId, now),
    getInventoryAlertsCore(client),
    getMonthPnlCore(client, now),
    getUpcomingDatesCore(client, userId, 7, now),
  ]);
  return { today: isoDay(now), tasks, inventoryAlerts, monthPnl, upcoming };
}
