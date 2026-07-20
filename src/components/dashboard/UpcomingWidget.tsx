import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { CalendarClock } from 'lucide-react';
import { WidgetCard, useWidgetData } from './WidgetCard';
import { getUpcomingDates, type UpcomingKind } from '../../lib/dashboard';

// The next 14 days across the business (directive §4 widget 5): releases,
// pre-orders going live, manuscript due dates, and dated planner to-dos.

const KIND_DOT: Record<UpcomingKind, string> = {
  release: 'bg-emerald-500',
  pre_order: 'bg-purple-500',
  manuscript_due: 'bg-amber-500',
  task: 'bg-sky-500',
};

export default function UpcomingWidget() {
  const { user } = useAuth();
  const { data, loading, error } = useWidgetData(
    () => (user ? getUpcomingDates(user.id, 14) : Promise.resolve([])),
    [user?.id],
  );
  const items = data ?? [];

  function dayLabel(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  return (
    <WidgetCard title="Upcoming" icon={CalendarClock} count={items.length} href="/planner" loading={loading} error={error}>
      {items.length === 0 ? (
        <p className="text-sm text-content-muted py-1">Nothing dated in the next two weeks.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 8).map((item, i) => (
            <li key={`${item.date}-${i}`} className="flex items-center gap-2 text-sm min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${KIND_DOT[item.kind]}`} />
              <span className="text-xs font-medium text-content-muted w-20 shrink-0 tabular-nums">{dayLabel(item.date)}</span>
              <Link to={item.href} className="flex-1 min-w-0 truncate text-content hover:text-brand-600 transition-colors">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
