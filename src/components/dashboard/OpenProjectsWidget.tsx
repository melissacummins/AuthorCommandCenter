import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { BookOpenCheck, Play } from 'lucide-react';
import { WidgetCard, useWidgetData, timeAgo } from './WidgetCard';
import { getOpenProjects } from '../../lib/dashboard';
import { STATUS_COLORS, STATUS_LABELS } from '../../modules/catalog/types';

// Open books (drafting / editing / pre-order) with their pipeline percent,
// plus "resume writing" shortcuts into the most recently touched manuscripts
// (directive §4 widget 2). Continue deep-links into the Writing editor.

export default function OpenProjectsWidget() {
  const { user } = useAuth();
  const { data, loading, error } = useWidgetData(
    () => (user ? getOpenProjects(user.id) : Promise.resolve({ projects: [], resume: [] })),
    [user?.id],
  );

  const projects = data?.projects ?? [];
  const resume = data?.resume ?? [];
  const shown = projects.slice(0, 5);

  return (
    <WidgetCard title="Open projects" icon={BookOpenCheck} count={projects.length} href="/catalog" loading={loading} error={error}>
      {shown.length === 0 && resume.length === 0 ? (
        <p className="text-sm text-content-muted py-1">No books in progress — the catalog is all published or ideas.</p>
      ) : (
        <>
          <ul className="space-y-3">
            {shown.map(p => {
              const words = p.wordCount;
              const target = p.targetWordCount;
              return (
                <li key={p.book.id} className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="flex-1 min-w-0 truncate text-sm font-medium text-content">{p.book.title}</span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded-control text-[10px] font-semibold ${STATUS_COLORS[p.book.status]}`}>
                      {STATUS_LABELS[p.book.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                      <div className="h-full bg-brand-500 rounded-full" style={{ width: `${p.pipelinePercent}%` }} />
                    </div>
                    <span className="text-[11px] tabular-nums text-content-secondary w-8 text-right shrink-0">{p.pipelinePercent}%</span>
                  </div>
                  {target != null && target > 0 && (
                    <p className="text-[11px] text-content-muted mt-0.5">
                      {words.toLocaleString()} / {target.toLocaleString()} words
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {resume.length > 0 && (
            <div className="mt-4 pt-3 border-t border-edge-soft">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted mb-1.5">Resume writing</p>
              <ul className="space-y-1.5">
                {resume.map(r => (
                  <li key={r.manuscriptId} className="flex items-center gap-2 text-sm min-w-0">
                    <span className="flex-1 min-w-0 truncate text-content-secondary">{r.title}</span>
                    <span className="text-[11px] text-content-muted shrink-0">{timeAgo(r.updatedAt)}</span>
                    <Link
                      to={`/writing?manuscript=${encodeURIComponent(r.manuscriptId)}`}
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-control text-xs font-medium text-brand-600 hover:bg-brand-50 transition-colors"
                    >
                      <Play className="w-3 h-3" /> Continue
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </WidgetCard>
  );
}
