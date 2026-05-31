import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, Cell } from 'recharts';
import { completionsByDay, type PlannerTask } from './types';

const RANGES = [14, 30, 90] as const;

// A standalone "how am I doing" view: how many to-dos you complete per day over
// a chosen window, plus a few headline numbers. Kept separate from My Day so
// the day view stays focused on planning rather than reviewing.
export default function StatsView({ tasks, today }: { tasks: PlannerTask[]; today: string }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const data = useMemo(() => completionsByDay(tasks, today, days), [tasks, today, days]);

  const total = data.reduce((s, d) => s + d.done, 0);
  const avg = data.length ? total / data.length : 0;
  const best = data.reduce((m, d) => Math.max(m, d.done), 0);
  const activeDays = data.filter(d => d.done > 0).length;
  const openCount = tasks.filter(t => t.kind === 'task' && !t.done).length;

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 className="w-6 h-6 text-indigo-500" />
        <h2 className="text-2xl font-bold text-slate-800">Stats</h2>
        <div className="ml-auto inline-flex rounded-lg border border-slate-200 overflow-hidden">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${days === r ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Completed" value={total} />
        <StatCard label="Per day" value={avg.toFixed(1)} />
        <StatCard label="Best day" value={best} />
        <StatCard label="Open now" value={openCount} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
          To-dos completed per day · last {days} days · {activeDays} active {activeDays === 1 ? 'day' : 'days'}
        </p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickFormatter={d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              />
              <Tooltip
                cursor={{ fill: 'rgba(20,184,166,0.08)' }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                labelFormatter={d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                formatter={(v: number) => [`${v} done`, '']}
              />
              <Bar dataKey="done" radius={[3, 3, 0, 0]}>
                {data.map(d => <Cell key={d.day} fill={d.day === today ? '#0d9488' : '#5eead4'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-2xl font-bold text-slate-800 leading-none">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mt-1">{label}</div>
    </div>
  );
}
