import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { NotebookPen, Plus, Check, ArrowRight, Circle, CalendarClock, Clock } from 'lucide-react';
import { listTasks, createTask, updateTask } from './api';
import { isDueToday, bucketForTask, formatDue, formatMinutes, sumEstimate, todayISO, type PlannerTask } from './types';

// The Home dashboard's planner hero: quick-capture for today, today's + overdue
// to-dos you can tick off inline, and a short peek at what's coming up so the
// day's reminders are the first thing you see on login.
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
      .then(rows => { if (active) setTasks(rows.filter(t => t.kind === 'task')); })
      .catch(() => { /* the full planner page surfaces real errors */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

  const todayTasks = useMemo(() => tasks.filter(t => isDueToday(t, today)), [tasks, today]);
  const upcoming = useMemo(
    () => tasks
      .filter(t => !t.done && bucketForTask(t, today) === 'upcoming')
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
      .slice(0, 4),
    [tasks, today],
  );

  async function add() {
    const title = draft.trim();
    if (!title || !user || adding) return;
    setAdding(true);
    setDraft('');
    try {
      const task = await createTask(user.id, { title, due_date: today });
      setTasks(prev => [...prev, task]);
    } catch {
      setDraft(title);
    } finally {
      setAdding(false);
    }
  }

  async function complete(task: PlannerTask) {
    setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, done: true } : t)));
    try {
      await updateTask(task.id, { done: true });
    } catch {
      setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, done: false } : t)));
    }
  }

  return (
    <div className="bg-surface rounded-card border border-edge shadow-sm mb-8 overflow-hidden">
      <div className="p-6 lg:p-7">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center justify-center w-11 h-11 bg-gradient-to-br from-brand-500 to-emerald-600 rounded-card shadow-lg shadow-brand-500/25">
              <NotebookPen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-content leading-tight">Today</h2>
              <p className="text-xs text-content-secondary">
                {new Date(today + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {sumEstimate(todayTasks) > 0 && (
              <span className="hidden sm:inline-flex items-center gap-1 text-sm font-medium text-content-secondary">
                <Clock className="w-4 h-4" /> {formatMinutes(sumEstimate(todayTasks))} planned
              </span>
            )}
            <Link to="/planner" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
              Open planner <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Quick capture */}
        <div className="flex items-center gap-2 bg-surface-hover border border-edge rounded-card px-3 py-2.5 mb-4">
          <Plus className="w-4 h-4 text-content-muted shrink-0" />
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); }}
            placeholder="Add something for today…"
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-content-muted text-content"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-x-8 gap-y-2">
          {/* Today list */}
          <div>
            {loading ? (
              <p className="text-sm text-content-muted py-2">Loading…</p>
            ) : todayTasks.length === 0 ? (
              <p className="text-sm text-content-muted py-2">Nothing scheduled for today. Capture an idea above. 🌱</p>
            ) : (
              <ul className="divide-y divide-edge-soft">
                {todayTasks.map(task => {
                  const overdue = !!task.due_date && task.due_date < today;
                  return (
                    <li key={task.id} className="flex items-center gap-3 py-2 group">
                      <button onClick={() => complete(task)} className="text-content-faint hover:text-brand-600 transition-colors shrink-0" title="Mark done">
                        <span className="relative inline-flex items-center justify-center">
                          <Circle className="w-5 h-5" />
                          <Check className="w-3 h-3 absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                      </button>
                      <span className="flex-1 text-sm text-content">{task.title}</span>
                      {overdue && <span className="text-xs font-medium text-rose-500 shrink-0">{formatDue(task.due_date!, today)}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Upcoming peek */}
          {upcoming.length > 0 && (
            <div className="md:border-l md:border-edge-soft md:pl-8">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted mb-1 flex items-center gap-1">
                <CalendarClock className="w-3.5 h-3.5" /> Coming up
              </p>
              <ul className="space-y-1.5">
                {upcoming.map(task => (
                  <li key={task.id} className="flex items-center gap-2 text-sm">
                    <span className="text-xs font-medium text-content-muted w-16 shrink-0">{formatDue(task.due_date!, today)}</span>
                    <span className="flex-1 text-content-secondary truncate">{task.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
