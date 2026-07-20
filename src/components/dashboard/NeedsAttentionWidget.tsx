import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { BellRing, Check, Circle, Package, Plus } from 'lucide-react';
import { WidgetCard, useWidgetData } from './WidgetCard';
import { getInventoryAlerts, type InventoryAlert } from '../../lib/dashboard';
import { listTasks, createTask, updateTask } from '../../modules/planner/api';
import { isDueToday, formatDue, todayISO, type PlannerTask } from '../../modules/planner/types';
import { formatCurrency } from '../../modules/inventory/utils';

// "What needs me today?" — the merge of the old TodayPanel (today's +
// overdue to-dos with quick capture) and inventory reorder alerts, per
// directive §0.2/§4. Inline actions stay one-field (tick a task, quick-add);
// ordering routes into Inventory's existing PO form pre-filled (§0.3).

export default function NeedsAttentionWidget() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = todayISO();
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);

  const tasksState = useWidgetData(
    async () => {
      if (!user) return [] as PlannerTask[];
      const rows = await listTasks(user.id);
      return rows.filter(t => t.kind === 'task');
    },
    [user?.id],
  );
  const alertsState = useWidgetData(getInventoryAlerts, []);

  const todayTasks = useMemo(
    () => (tasksState.data ?? []).filter(t => isDueToday(t, today)),
    [tasksState.data, today],
  );
  const alerts = alertsState.data ?? [];

  async function add() {
    const title = draft.trim();
    if (!title || !user || adding) return;
    setAdding(true);
    setDraft('');
    try {
      const task = await createTask(user.id, { title, due_date: today });
      tasksState.setData(prev => [...(prev ?? []), task]);
    } catch {
      setDraft(title);
    } finally {
      setAdding(false);
    }
  }

  async function complete(task: PlannerTask) {
    tasksState.setData(prev => (prev ?? []).map(t => (t.id === task.id ? { ...t, done: true } : t)));
    try {
      await updateTask(task.id, { done: true });
    } catch {
      tasksState.setData(prev => (prev ?? []).map(t => (t.id === task.id ? { ...t, done: false } : t)));
    }
  }

  function order(a: InventoryAlert) {
    navigate(`/inventory?po=${encodeURIComponent(a.productId)}&qty=${a.reorderQty}`);
  }

  const loading = tasksState.loading && alertsState.loading;
  const empty = !loading && todayTasks.length === 0 && alerts.length === 0
    && !tasksState.error && !alertsState.error;

  return (
    <WidgetCard
      title="Needs attention"
      icon={BellRing}
      count={todayTasks.length + alerts.length}
      href="/planner"
      loading={loading}
    >
      {/* Inventory alerts first — they cost money when missed. */}
      {alerts.length > 0 && (
        <ul className="mb-3 space-y-2">
          {alerts.map(a => (
            <li key={a.productId} className="flex items-center gap-2.5 text-sm">
              <Package className={`w-4 h-4 shrink-0 ${a.status === 'OUT OF STOCK' ? 'text-rose-500' : 'text-amber-500'}`} />
              <span className="flex-1 min-w-0 truncate text-content">
                {a.name}
                <span className="text-content-secondary">
                  {' — '}
                  {a.status === 'OUT OF STOCK'
                    ? 'out of stock'
                    : `${a.bookInventory} left, ~${Number.isFinite(a.daysRemaining) ? `${a.daysRemaining}d` : '—'}`}
                </span>
              </span>
              <button
                onClick={() => order(a)}
                className="shrink-0 px-2.5 py-1 rounded-control bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 transition-colors"
                title={`Pre-fill a PO for ${a.reorderQty} (~${formatCurrency(a.reorderCost)})`}
              >
                Order {a.reorderQty > 0 ? a.reorderQty : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      {alertsState.error && (
        <p className="mb-3 text-xs text-content-muted">Inventory alerts unavailable right now.</p>
      )}

      {/* Today's + overdue to-dos (ported from TodayPanel). */}
      {tasksState.error ? (
        <p className="text-xs text-content-muted">To-dos unavailable right now.</p>
      ) : todayTasks.length > 0 ? (
        <ul className="divide-y divide-edge-soft">
          {todayTasks.map(task => {
            const overdue = !!task.due_date && task.due_date < today;
            return (
              <li key={task.id} className="flex items-center gap-2.5 py-1.5 group">
                <button onClick={() => complete(task)} className="text-content-faint hover:text-teal-600 transition-colors shrink-0" title="Mark done">
                  <span className="relative inline-flex items-center justify-center">
                    <Circle className="w-4.5 h-4.5" />
                    <Check className="w-3 h-3 absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                </button>
                <span className="flex-1 text-sm text-content truncate">{task.title}</span>
                {overdue && <span className="text-xs font-medium text-rose-500 shrink-0">{formatDue(task.due_date!, today)}</span>}
              </li>
            );
          })}
        </ul>
      ) : empty ? (
        <p className="text-sm text-content-muted py-1">Nothing needs you — go write. 🌱</p>
      ) : null}

      {/* One-field quick capture — the only inline "create" on Home. */}
      <div className="flex items-center gap-2 bg-surface-hover border border-edge rounded-control px-2.5 py-1.5 mt-3">
        <Plus className="w-3.5 h-3.5 text-content-muted shrink-0" />
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); }}
          placeholder="Add something for today…"
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-content-muted text-content"
        />
      </div>
    </WidgetCard>
  );
}
