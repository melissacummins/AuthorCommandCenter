import { useEffect, useState } from 'react';
import { History, RotateCcw, X } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { listRevisions, restoreRevision } from '../api';
import type { ManuscriptChapter, ManuscriptRevision } from '../types';

// Version history modal for one chapter: a list of snapshots (hourly
// autosaves + manual "Snapshot" clicks) on the left, a read-only preview on
// the right, and a restore button. No diffing — restoring snapshots the
// current content first, so it's reversible from this same list.
export default function RevisionsPanel({
  chapter,
  onClose,
  onRestored,
}: {
  chapter: ManuscriptChapter;
  onClose: () => void;
  onRestored: (updated: ManuscriptChapter) => void;
}) {
  const { user } = useAuth();
  const [revisions, setRevisions] = useState<ManuscriptRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listRevisions(chapter.id)
      .then(rows => { if (!cancelled) { setRevisions(rows); setPreviewId(rows[0]?.id ?? null); } })
      .catch(err => { if (!cancelled) setError(err?.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [chapter.id]);

  const preview = revisions.find(r => r.id === previewId) ?? null;

  async function restore(revision: ManuscriptRevision) {
    if (!user) return;
    if (!confirm("Restore this version? The chapter's current text will be snapshotted first, so you can undo.")) return;
    setRestoring(true);
    try {
      const updated = await restoreRevision(chapter, user.id, revision);
      onRestored(updated);
      onClose();
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-card shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge-soft shrink-0">
          <h3 className="font-semibold text-content flex items-center gap-2">
            <History className="w-4 h-4 text-brand-500" /> Version history — {chapter.title || 'Untitled chapter'}
          </h3>
          <button onClick={onClose} className="text-content-muted hover:text-content-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-hidden grid grid-cols-1 sm:grid-cols-[220px_1fr]">
          <div className="border-r border-edge-soft overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-content-muted">Loading…</p>
            ) : revisions.length === 0 ? (
              <p className="p-4 text-sm text-content-muted">No snapshots yet — they're taken automatically as you edit.</p>
            ) : (
              revisions.map(r => (
                <button
                  key={r.id}
                  onClick={() => setPreviewId(r.id)}
                  className={`w-full text-left px-4 py-2.5 border-b border-edge-soft text-sm ${previewId === r.id ? 'bg-brand-50' : 'hover:bg-surface-hover'}`}
                >
                  <p className="font-medium text-content">{r.label || 'Snapshot'}</p>
                  <p className="text-xs text-content-muted">{new Date(r.created_at).toLocaleString()} · {r.word_count.toLocaleString()} words</p>
                </button>
              ))
            )}
          </div>
          <div className="p-5 overflow-y-auto">
            {error && <p className="text-sm text-rose-600 mb-3">{error}</p>}
            {preview ? (
              <>
                <div
                  className="font-serif text-[15px] leading-relaxed text-content mb-4 [&_p]:mb-3"
                  dangerouslySetInnerHTML={{ __html: preview.content_html }}
                />
                <button
                  onClick={() => restore(preview)}
                  disabled={restoring}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 rounded-control disabled:opacity-50"
                >
                  <RotateCcw className="w-4 h-4" /> {restoring ? 'Restoring…' : 'Restore this version'}
                </button>
              </>
            ) : (
              <p className="text-sm text-content-muted">Select a snapshot to preview.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
