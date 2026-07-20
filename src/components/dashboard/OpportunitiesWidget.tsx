import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Lightbulb, X } from 'lucide-react';
import { WidgetCard, useWidgetData } from './WidgetCard';
import { getOpportunities, setOpportunityDecision } from '../../lib/dashboard';
import type { Opportunity } from '../../lib/opportunities';

// Top opportunities across the catalog (directive §4 widget 4): translation /
// audiobook / format / keyword / ARC gaps the engine derives. Start deep-links
// into the right module; Dismiss records a decision so it never nags again.

const KIND_LABEL: Record<Opportunity['kind'], string> = {
  translation: 'Translation',
  audiobook: 'Audiobook',
  format: 'Format',
  kdp: 'Keywords',
  arc: 'ARCs',
};

export default function OpportunitiesWidget() {
  const { user } = useAuth();
  const { data, loading, error, setData } = useWidgetData(
    () => (user ? getOpportunities(user.id, 5) : Promise.resolve([])),
    [user?.id],
  );
  const opportunities = data ?? [];

  async function dismiss(o: Opportunity) {
    if (!user) return;
    setData(prev => (prev ?? []).filter(x => !(x.bookId === o.bookId && x.key === o.key)));
    try {
      await setOpportunityDecision(user.id, o.bookId, o.key, 'dismissed');
    } catch {
      // Most likely migration 106 hasn't been run yet — restore the row so
      // the dismissal isn't silently lost.
      setData(prev => [...(prev ?? []), o].sort((a, b) => b.score - a.score));
    }
  }

  return (
    <WidgetCard title="Opportunities" icon={Lightbulb} count={opportunities.length} loading={loading} error={error}>
      {opportunities.length === 0 ? (
        <p className="text-sm text-content-muted py-1">No open opportunities — the catalog is fully built out. 🎉</p>
      ) : (
        <ul className="space-y-2">
          {opportunities.map(o => (
            <li key={`${o.bookId}|${o.key}`} className="flex items-center gap-2 text-sm min-w-0">
              <span className="shrink-0 px-1.5 py-0.5 rounded-control bg-surface-sunken text-[10px] font-semibold text-content-secondary uppercase tracking-wide">
                {KIND_LABEL[o.kind]}
              </span>
              <span className="flex-1 min-w-0 truncate text-content" title={o.label}>{o.label}</span>
              <Link
                to={o.href}
                className="shrink-0 px-2 py-0.5 rounded-control text-xs font-medium text-brand-600 hover:bg-brand-50 transition-colors"
              >
                Start
              </Link>
              <button
                onClick={() => dismiss(o)}
                className="shrink-0 p-1 rounded-control text-content-faint hover:text-rose-500 hover:bg-rose-50 transition-colors"
                title="Not planned — don't suggest this again"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
