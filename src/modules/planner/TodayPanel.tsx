import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { NotebookPen, Plus, Check, ArrowRight, Circle } from 'lucide-react';
import { listTasks, createTask, updateTask } from './api';
import { isDueToday, formatDue, todayISO, type PlannerTask } from './types';

// Compact "Today" card for the Home page: shows what's scheduled for today
// (plus anything overdue), lets you tick items off, and quick-captures a new
// to-do for today without leaving the dashboard.
export default function TodayPanel() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const today = todayISO();

  useEffect(() => {
    if (!user) return;
    let active = true;
    listTasks(user.id)
      .then(rows => { if (active) setTasks(rows.filter(t => isDueToday(t, today))); })
      .catch(() => { /* surfaced as an empty state; planner page shows real errors */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, today]);

  async function add() {
    const title = draft.trim();
    if (!title || !user || adding) return;
    setAdding(true);
    setDraft('');
    try {
      const task = await createTask(user.id, { title, due_date: today });
      setTasks(prev => [...prev, task]);
    } catch {
      setDraft(title); // restore so the capture isn't lost
    } finally {
      setAdding(false);
    }
  }

  async function complete(task: PlannerTask) {
    setTasks(prev => prev.filter(t => t.id !== task.id)); // optimistic: leaves Today
    try {
      await updateTask(task.id, { done: true });
    } catch {
      setTasks(prev => [...prev, task]); // put it back on failure
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-8 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center justify-center w-10 h-10 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-xl shadow-lg shadow-teal-500/25">
            <NotebookPen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-800 leading-tight">Today</h2>
            <p className="text-xs text-slate-500">
              {new Date(today + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>
        <Link
          to="/planner"
          className="inline-flex items-center gap-1 text-sm font-medium text-teal-600 hover:text-teal-700"
        >
          Open planner <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Quick capture */}
      <div className="flex items-center gap-2 mb-3">
        <Plus className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); }}
          placeholder="Add something for today…"
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400 text-slate-700"
        />
      </div>

      {/* List */}
      {loading ? (
        <p className="text-sm text-slate-400 py-2">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-slate-400 py-2">Nothing scheduled for today. Capture an idea above. 🌱</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tasks.map(task => {
            const overdue = !!task.due_date && task.due_date < today;
            return (
              <li key={task.id} className="flex items-center gap-3 py-2 group">
                <button
                  onClick={() => complete(task)}
                  className="text-slate-300 hover:text-teal-600 transition-colors shrink-0"
                  title="Mark done"
                >
                  <span className="relative inline-flex items-center justify-center">
                    <Circle className="w-5 h-5" />
                    <Check className="w-3 h-3 absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                </button>
                <span className="flex-1 text-sm text-slate-700">{task.title}</span>
                {overdue && (
                  <span className="text-xs font-medium text-rose-500 shrink-0">{formatDue(task.due_date!, today)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
