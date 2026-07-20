import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { History } from 'lucide-react';
import { WidgetCard, useWidgetData, timeAgo } from './WidgetCard';
import { getRecentActivity } from '../../lib/dashboard';

// Derived recent-activity feed (directive §4 widget 6): what changed lately,
// phrased as current state — "Ringmaster's Game Prologue — manuscript marked
// Final · 2d ago". A true event log is Phase 5, deliberately deferred.

export default function RecentActivityWidget() {
  const { user } = useAuth();
  const { data, loading, error } = useWidgetData(
    () => (user ? getRecentActivity(user.id, 8) : Promise.resolve([])),
    [user?.id],
  );
  const items = data ?? [];

  return (
    <WidgetCard title="Recent activity" icon={History} loading={loading} error={error}>
      {items.length === 0 ? (
        <p className="text-sm text-content-muted py-1">Nothing recorded yet — activity shows up as you work.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={`${item.at}-${i}`} className="flex items-center gap-2 text-sm min-w-0">
              <Link to={item.href} className="flex-1 min-w-0 truncate text-content-secondary hover:text-content transition-colors" title={item.label}>
                {item.label}
              </Link>
              <span className="text-[11px] text-content-muted shrink-0 tabular-nums">{timeAgo(item.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
