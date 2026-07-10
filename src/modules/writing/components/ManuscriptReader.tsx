import { useEffect, useMemo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft, BookOpen, Trash2, FileText, Plus, Pencil, GripVertical, History,
  Download, Loader2, ChevronDown, ArrowDownToLine, PenLine, Merge,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import CatalogBookPicker from '../../../components/CatalogBookPicker';
import {
  getManuscript, listChapters, updateManuscript, updateChapter, attachBook, deleteManuscript,
  addChapter, deleteChapter, mergeChapterWithNext, reorderChapters, splitChapter,
} from '../api';
import { getBook } from '../../catalog/api';
import { STATUS_LABELS, STATUS_COLORS } from '../types';
import { downloadChapter, downloadManuscript, type ExportFormat } from '../lib/export';
import ChapterEditor from './ChapterEditor';
import RevisionsPanel from './RevisionsPanel';
import ProgressWidget from './ProgressWidget';
import type { Book } from '../../catalog/types';
import type { Manuscript, ManuscriptChapter, ManuscriptStatus } from '../types';

const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'docx', label: 'Word (.docx)' },
  { value: 'txt', label: 'Plain text (.txt)' },
  { value: 'md', label: 'Markdown (.md)' },
  { value: 'html', label: 'HTML (.html)' },
];

// Read/edit view for a saved manuscript: a drag-reorderable chapter sidebar
// (add, rename, delete, merge-with-next) plus a pane that's either a serif
// reading view or the Phase 2 TipTap editor. Title, status, and the linked
// Catalog book are editable here; export and version history are per-chapter
// and whole-manuscript actions in the header.
export default function ManuscriptReader({
  manuscriptId,
  onBack,
  onDeleted,
}: {
  manuscriptId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const { user } = useAuth();
  const [manuscript, setManuscript] = useState<Manuscript | null>(null);
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  const [linkedBook, setLinkedBook] = useState<Book | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingTitle, setSavingTitle] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [revisionsFor, setRevisionsFor] = useState<ManuscriptChapter | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState<'manuscript' | string | null>(null);
  const [exporting, setExporting] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getManuscript(manuscriptId), listChapters(manuscriptId)])
      .then(([m, cs]) => {
        if (cancelled) return;
        setManuscript(m);
        setChapters(cs);
        setActiveChapterId(cs[0]?.id ?? null);
      })
      .catch(err => { if (!cancelled) setError(err?.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [manuscriptId]);

  useEffect(() => {
    if (!manuscript?.book_id) { setLinkedBook(null); return; }
    let cancelled = false;
    getBook(manuscript.book_id).then(b => { if (!cancelled) setLinkedBook(b); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [manuscript?.book_id]);

  const activeChapter = useMemo(
    () => chapters.find(c => c.id === activeChapterId) ?? null,
    [chapters, activeChapterId],
  );

  function refreshChapters() {
    return listChapters(manuscriptId).then(cs => { setChapters(cs); return cs; });
  }

  async function saveTitle(title: string) {
    if (!manuscript || !title.trim() || title === manuscript.title) return;
    setSavingTitle(true);
    try {
      const updated = await updateManuscript(manuscript.id, { title: title.trim() });
      setManuscript(updated);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    } finally {
      setSavingTitle(false);
    }
  }

  async function changeStatus(status: ManuscriptStatus) {
    if (!manuscript) return;
    try {
      const updated = await updateManuscript(manuscript.id, { status });
      setManuscript(updated);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    }
  }

  async function changeBook(bookId: string | null) {
    if (!manuscript || !user) return;
    try {
      const updated = await attachBook(manuscript.id, user.id, bookId);
      setManuscript(updated);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    }
  }

  async function handleDeleteManuscript() {
    if (!manuscript) return;
    if (!confirm(`Delete "${manuscript.title}"? This removes all its chapters too.`)) return;
    try {
      await deleteManuscript(manuscript.id);
      onDeleted();
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    }
  }

  async function handleAddChapter() {
    if (!user || !manuscript) return;
    try {
      const created = await addChapter(manuscript.id, user.id);
      setChapters(prev => [...prev, created]);
      setActiveChapterId(created.id);
      setIsEditing(true);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    }
  }

  async function saveRename(chapter: ManuscriptChapter, title: string) {
    setRenamingId(null);
    if (!title.trim() || title === chapter.title) return;
    try {
      const updated = await updateChapter(chapter.id, { title: title.trim() });
      setChapters(prev => prev.map(c => (c.id === updated.id ? updated : c)));
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    }
  }

  async function handleDeleteChapter(chapter: ManuscriptChapter) {
    if (!manuscript || !user) return;
    if (!confirm(`Delete "${chapter.title || 'this chapter'}"? This can't be undone.`)) return;
    try {
      await deleteChapter(chapter.id, manuscript.id, user.id);
      const remaining = chapters.filter(c => c.id !== chapter.id);
      setChapters(remaining);
      if (activeChapterId === chapter.id) setActiveChapterId(remaining[0]?.id ?? null);
      const refreshed = await getManuscript(manuscript.id);
      setManuscript(refreshed);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    }
  }

  async function handleMergeWithNext(chapter: ManuscriptChapter, next: ManuscriptChapter) {
    if (!confirm(`Merge "${next.title || 'the next chapter'}" into "${chapter.title || 'this chapter'}"?`)) return;
    try {
      await mergeChapterWithNext(chapter, next);
      await refreshChapters();
      const refreshed = await getManuscript(manuscriptId);
      setManuscript(refreshed);
      if (activeChapterId === next.id) setActiveChapterId(chapter.id);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    }
  }

  async function handleSplit(beforeHtml: string, afterHtml: string) {
    if (!user || !activeChapter) return;
    try {
      const updatedList = await splitChapter(activeChapter, user.id, beforeHtml, afterHtml);
      setChapters(updatedList);
      setIsEditing(false);
      const refreshed = await getManuscript(manuscriptId);
      setManuscript(refreshed);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    }
  }

  // Mirrors what api.ts's syncWordCount computes server-side (sum of chapter
  // word counts), so the header total stays live through every autosave
  // without an extra round trip.
  function handleChapterSaved(updated: ManuscriptChapter) {
    setChapters(prev => {
      const next = prev.map(c => (c.id === updated.id ? updated : c));
      const total = next.reduce((sum, c) => sum + (c.word_count ?? 0), 0);
      setManuscript(m => (m ? { ...m, word_count: total } : m));
      return next;
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = chapters.findIndex(c => c.id === active.id);
    const newIdx = chapters.findIndex(c => c.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(chapters, oldIdx, newIdx);
    setChapters(reordered);
    try {
      await reorderChapters(reordered.map(c => c.id));
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
      refreshChapters();
    }
  }

  async function handleExportChapter(chapter: ManuscriptChapter, format: ExportFormat) {
    setExportMenuOpen(null);
    setExporting(true);
    try {
      await downloadChapter(chapter, format);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    } finally {
      setExporting(false);
    }
  }

  async function handleExportManuscript(format: ExportFormat) {
    if (!manuscript) return;
    setExportMenuOpen(null);
    setExporting(true);
    try {
      await downloadManuscript(manuscript, chapters, linkedBook, format);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <div className="text-center py-16 text-slate-500 text-sm">Loading manuscript…</div>;
  }
  if (!manuscript) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-rose-600 mb-3">{error ?? 'Manuscript not found.'}</p>
        <button onClick={onBack} className="text-sm text-slate-500 hover:underline">Back to manuscripts</button>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to manuscripts
      </button>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="flex-1 min-w-[240px]">
          <input
            defaultValue={manuscript.title}
            onBlur={e => saveTitle(e.target.value)}
            disabled={savingTitle}
            className="text-2xl font-bold text-slate-800 w-full px-1 -mx-1 rounded-md border border-transparent hover:border-slate-200 focus:border-lime-400 outline-none bg-transparent"
          />
          <p className="text-sm text-slate-500 mt-1">{manuscript.word_count.toLocaleString()} words · {chapters.length} chapter{chapters.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={manuscript.status}
            onChange={e => changeStatus(e.target.value as ManuscriptStatus)}
            className={`text-xs px-2.5 py-1.5 rounded-full border-0 font-medium ${STATUS_COLORS[manuscript.status]}`}
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <div className="relative">
            <button
              onClick={() => setExportMenuOpen(exportMenuOpen === 'manuscript' ? null : 'manuscript')}
              disabled={exporting || chapters.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Export <ChevronDown className="w-3 h-3" />
            </button>
            {exportMenuOpen === 'manuscript' && (
              <ExportDropdown onPick={handleExportManuscript} onClose={() => setExportMenuOpen(null)} />
            )}
          </div>
          <button onClick={handleDeleteManuscript} title="Delete manuscript" className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mb-6 max-w-sm">
        <label className="block text-xs font-medium text-slate-500 mb-1">Linked book</label>
        <CatalogBookPicker value={manuscript.book_id} onChange={(id: string, _book: Book) => changeBook(id)} />
      </div>

      {manuscript.book_id && <ProgressWidget bookId={manuscript.book_id} currentWordCount={manuscript.word_count} />}

      {chapters.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300">
          <BookOpen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500 mb-4">This manuscript has no chapters yet.</p>
          <button
            onClick={handleAddChapter}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-lime-600 hover:bg-lime-700 rounded-lg"
          >
            <Plus className="w-4 h-4" /> Add a chapter
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
          <div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={chapters.map(c => c.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1">
                  {chapters.map((c, i) => (
                    <SortableChapterRow
                      key={c.id}
                      chapter={c}
                      index={i}
                      active={c.id === activeChapterId}
                      renaming={renamingId === c.id}
                      onSelect={() => { setActiveChapterId(c.id); setIsEditing(false); }}
                      onStartRename={() => setRenamingId(c.id)}
                      onSaveRename={title => saveRename(c, title)}
                      onDelete={() => handleDeleteChapter(c)}
                      onMergeNext={i < chapters.length - 1 ? () => handleMergeWithNext(c, chapters[i + 1]) : undefined}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <button
              onClick={handleAddChapter}
              className="w-full mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-500 hover:text-lime-600 border border-dashed border-slate-300 hover:border-lime-300 rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" /> Add chapter
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 lg:p-10 min-h-[50vh]">
            {activeChapter ? (
              <>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h2 className="font-serif text-2xl text-slate-800">{activeChapter.title || 'Untitled chapter'}</h2>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setRevisionsFor(activeChapter)}
                      title="Version history"
                      className="p-1.5 text-slate-400 hover:text-lime-600 rounded-md hover:bg-slate-50"
                    >
                      <History className="w-4 h-4" />
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setExportMenuOpen(exportMenuOpen === activeChapter.id ? null : activeChapter.id)}
                        title="Export this chapter"
                        className="p-1.5 text-slate-400 hover:text-lime-600 rounded-md hover:bg-slate-50"
                      >
                        <ArrowDownToLine className="w-4 h-4" />
                      </button>
                      {exportMenuOpen === activeChapter.id && (
                        <ExportDropdown onPick={format => handleExportChapter(activeChapter, format)} onClose={() => setExportMenuOpen(null)} />
                      )}
                    </div>
                    <button
                      onClick={() => setIsEditing(v => !v)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg ${
                        isEditing ? 'bg-lime-600 text-white hover:bg-lime-700' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <PenLine className="w-3.5 h-3.5" /> {isEditing ? 'Reading view' : 'Edit'}
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <ChapterEditor chapter={activeChapter} onSaved={handleChapterSaved} onSplit={handleSplit} />
                ) : activeChapter.content_html ? (
                  <div
                    className="font-serif text-[17px] leading-relaxed text-slate-700 max-w-prose [&_p]:mb-4"
                    dangerouslySetInnerHTML={{ __html: activeChapter.content_html }}
                  />
                ) : (
                  <p className="text-sm text-slate-400 flex items-center gap-1.5"><FileText className="w-4 h-4" /> This chapter is empty.</p>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-400">Select a chapter.</p>
            )}
          </div>
        </div>
      )}

      {revisionsFor && (
        <RevisionsPanel
          chapter={revisionsFor}
          onClose={() => setRevisionsFor(null)}
          onRestored={updated => { setChapters(prev => prev.map(c => (c.id === updated.id ? updated : c))); }}
        />
      )}
    </div>
  );
}

function ExportDropdown({ onPick, onClose }: { onPick: (format: ExportFormat) => void; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 w-44">
        {EXPORT_FORMATS.map(f => (
          <button
            key={f.value}
            onClick={() => onPick(f.value)}
            className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            {f.label}
          </button>
        ))}
      </div>
    </>
  );
}

function SortableChapterRow({
  chapter, index, active, renaming, onSelect, onStartRename, onSaveRename, onDelete, onMergeNext,
}: {
  chapter: ManuscriptChapter;
  index: number;
  active: boolean;
  renaming: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onSaveRename: (title: string) => void;
  onDelete: () => void;
  onMergeNext?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chapter.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-start gap-1.5 px-2 py-2 rounded-lg border text-sm ${
        active ? 'border-lime-300 bg-lime-50' : 'border-transparent hover:bg-slate-50'
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 p-1 shrink-0 mt-0.5"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <button onClick={onSelect} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 w-4 shrink-0">{index + 1}</span>
          {renaming ? (
            <input
              autoFocus
              defaultValue={chapter.title}
              onClick={e => e.stopPropagation()}
              onBlur={e => onSaveRename(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="flex-1 min-w-0 px-1 py-0.5 text-sm border border-slate-300 rounded-md"
            />
          ) : (
            <span className={`flex-1 truncate font-medium ${active ? 'text-lime-900' : 'text-slate-600'}`}>
              {chapter.title || 'Untitled chapter'}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 pl-6">{chapter.word_count.toLocaleString()} words</p>
      </button>
      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
        <button onClick={onStartRename} title="Rename" className="p-1 text-slate-300 hover:text-lime-600">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        {onMergeNext && (
          <button onClick={onMergeNext} title="Merge with next chapter" className="p-1 text-slate-300 hover:text-lime-600">
            <Merge className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={onDelete} title="Delete chapter" className="p-1 text-slate-300 hover:text-rose-600">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
