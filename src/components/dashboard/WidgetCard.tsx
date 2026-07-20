import { Link } from 'react-router-dom';
import { ArrowRight, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

// Shared shell + data hook for Home dashboard widgets (directive §4).
// Each widget fetches through its own useWidgetData call so one slow or
// failing source never blocks the others — the grid renders skeletons per
// card, then each card resolves independently.

export function useWidgetData<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetcher()
      .then(d => { if (active) setData(d); })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Failed to load'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, setData };
}

export function WidgetCard({
  title,
  icon: Icon,
  count,
  href,
  loading,
  error,
  children,
}: {
  title: string;
  icon: LucideIcon;
  count?: number;
  href?: string;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <section className="bg-surface border border-edge rounded-card shadow-card flex flex-col min-w-0">
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-edge-soft">
        <Icon className="w-4 h-4 text-brand-600 shrink-0" />
        <h2 className="text-sm font-semibold text-content flex-1 truncate">{title}</h2>
        {typeof count === 'number' && count > 0 && (
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-brand-100 text-brand-700 text-[11px] font-semibold">
            {count}
          </span>
        )}
        {href && (
          <Link to={href} className="text-content-faint hover:text-content-secondary transition-colors" title={`Open ${title}`}>
            <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </header>
      <div className="p-4 flex-1 min-h-0">
        {loading ? (
          <WidgetSkeleton />
        ) : error ? (
          <p className="flex items-start gap-2 text-xs text-content-secondary py-1">
            <TriangleAlert className="w-4 h-4 text-amber-500 shrink-0" />
            <span>Couldn't load: {error}</span>
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function WidgetSkeleton() {
  return (
    <div className="animate-pulse space-y-2.5 py-1">
      <div className="h-3.5 bg-edge-soft rounded-control w-3/4" />
      <div className="h-3.5 bg-edge-soft rounded-control w-1/2" />
      <div className="h-3.5 bg-edge-soft rounded-control w-2/3" />
    </div>
  );
}

/** Relative "2d ago" style timestamps for feeds. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.floor((now.getTime() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
