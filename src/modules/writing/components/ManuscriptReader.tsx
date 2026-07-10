import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft, BookOpen, Trash2, FileText, Plus, Pencil, GripVertical, History,
  Download, Loader2, ArrowDownToLine, ChevronsLeft, ChevronsRight, PenLine, Merge, MessageSquare, Sparkles,
} from 'lucide-react';
import {
  getManuscript, listChapters, updateManuscript, updateChapter, attachBook, deleteManuscript,
  addChapter, deleteChapter, mergeChapterWithNext, reorderChapters, splitChapter,
} from '../api';
import { getBook } from '../../catalog/api';
import { STATUS_LABELS, STATUS_COLORS } from '../types';
import { downloadChapter, downloadManuscript, type ExportFormat } from '../lib/export';
import ChapterEditor, { type ChapterEditorHandle } from './ChapterEditor';
import RevisionsPanel from './RevisionsPanel';
import ManuscriptChatPanel from './ManuscriptChatPanel';
import SyncToCatalogPanel from './SyncToCatalogPanel';
import AnalyticsTab from './AnalyticsTab';
import type { Book } from '../../catalog/types';
import type { Manuscript, ManuscriptChapter, ManuscriptStatus } from '../types';

const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'docx', label: 'Word (.docx)' },
  { value: 'txt', label: 'Plain text (.txt)' },
  { value: 'md', label: 'Markdown (.md)' },
  { value: 'html', label: 'HTML (.html)' },
];

const SIDEBAR_COLLAPSED_KEY = 'writing-sidebar-collapsed';
const CHAT_OPEN_KEY = 'writing-chat-open';

function readBoolPref(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function writeBoolPref(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* best-effort */ }
}

type Tab = 'write' | 'analytics';

// Phase 3.5 layout (§8.1-§8.4): the manuscript view escapes the app's usual
// max-w-6xl container so the draft gets the full viewport width, collapses
// the header to one compact row, splits Write vs Analytics into house-style
// tabs, and docks chat beside the draft instead of a modal over it. Edit mode
// is the default the moment a chapter opens — this is a writing app.
export default function ManuscriptReader({
  manuscriptId,
  onBack,
  onDeleted,
}: {
  manuscriptId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [manuscript, setManuscript] = useState<Manuscript | null>(null);
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  const [linkedBook, setLinkedBook] = useState<Book | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingTitle, setSavingTitle] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [revisionsFor, setRevisionsFor] = useState<ManuscriptChapter | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState<'manuscript' | string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [chatOpen, setChatOpen] = useState(() => readBoolPref(CHAT_OPEN_KEY));
  const [syncOpen, setSyncOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('write');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readBoolPref(SIDEBAR_COLLAPSED_KEY));

  const editorRef = useRef<ChapterEditorHandle>(null);

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

  function toggleSidebar() {
    setSidebarCollapsed(v => { const next = !v; writeBoolPref(SIDEBAR_COLLAPSED_KEY, next); return next; });
  }
  function toggleChat() {
    setChatOpen(v => { const next = !v; writeBoolPref(CHAT_OPEN_KEY, next); return next; });
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
    if (!manuscript) return;
    try {
      const updated = await attachBook(manuscript.id, manuscript.user_id, bookId);
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
    if (!manuscript) return;
    try {
      const created = await addChapter(manuscript.id, manuscript.user_id);
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
    if (!manuscript) return;
    if (!confirm(`Delete "${chapter.title || 'this chapter'}"? This can't be undone.`)) return;
    try {
      await deleteChapter(chapter.id, manuscript.id, manuscript.user_id);
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
    if (!manuscript || !activeChapter) return;
    try {
      const updatedList = await splitChapter(activeChapter, manuscript.user_id, beforeHtml, afterHtml);
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

  function insertChatReplyIntoDraft(html: string) {
    editorRef.current?.insertContentAtCursor(html);
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

  const canInsert = tab === 'write' && isEditing && !!activeChapter;

  return (
    <div className="px-4 lg:px-6 py-4">
      {error && (
        <div className="mb-3 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      {/* Compact header row (§8.1) */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onBack} title="Back to manuscripts" className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <input
          defaultValue={manuscript.title}
          onBlur={e => saveTitle(e.target.value)}
          disabled={savingTitle}
          className="text-lg font-bold text-slate-800 flex-1 min-w-0 px-1 -mx-1 rounded-md border border-transparent hover:border-slate-200 focus:border-lime-400 outline-none bg-transparent"
        />
        <span className="text-xs text-slate-400 shrink-0 hidden sm:inline">{manuscript.word_count.toLocaleString()} words</span>
        <select
          value={manuscript.status}
          onChange={e => changeStatus(e.target.value as ManuscriptStatus)}
          className={`text-xs px-2.5 py-1.5 rounded-full border-0 font-medium shrink-0 ${STATUS_COLORS[manuscript.status]}`}
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <div className="relative shrink-0">
          <button
            onClick={() => setExportMenuOpen(exportMenuOpen === 'manuscript' ? null : 'manuscript')}
            disabled={exporting || chapters.length === 0}
            title="Export manuscript"
            className="p-1.5 text-slate-400 hover:text-lime-600 rounded-lg hover:bg-slate-100 disabled:opacity-40"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          </button>
          {exportMenuOpen === 'manuscript' && (
            <ExportDropdown onPick={handleExportManuscript} onClose={() => setExportMenuOpen(null)} />
          )}
        </div>
        <button
          onClick={toggleChat}
          title="Manuscript chat"
          className={`p-1.5 rounded-lg hover:bg-slate-100 shrink-0 ${chatOpen ? 'text-lime-600 bg-slate-100' : 'text-slate-400 hover:text-lime-600'}`}
        >
          <MessageSquare className="w-4 h-4" />
        </button>
        {manuscript.book_id && (
          <button
            onClick={() => setSyncOpen(true)}
            title="Analyze manuscript for Catalog"
            className="p-1.5 text-slate-400 hover:text-lime-600 rounded-lg hover:bg-slate-100 shrink-0"
          >
            <Sparkles className="w-4 h-4" />
          </button>
        )}
        <button onClick={handleDeleteManuscript} title="Delete manuscript" className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 shrink-0">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Write | Analytics tabs (§8.1) */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-4">
        <TabButton active={tab === 'write'} onClick={() => setTab('write')}>Write</TabButton>
        <TabButton active={tab === 'analytics'} onClick={() => setTab('analytics')}>Analytics</TabButton>
      </div>

      {tab === 'analytics' ? (
        <AnalyticsTab
          manuscript={manuscript}
          chapters={chapters}
          onManuscriptUpdate={setManuscript}
          onChangeBook={changeBook}
        />
      ) : chapters.length === 0 ? (
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
        <div className="flex gap-4 items-start h-[75vh]">
          {/* Collapsible chapter sidebar (§8.1) */}
          {sidebarCollapsed ? (
            <div className="w-10 shrink-0 h-full flex flex-col items-center gap-2 bg-white rounded-2xl border border-slate-200 py-3">
              <button onClick={toggleSidebar} title="Expand chapter list" className="p-1.5 text-slate-400 hover:text-lime-600 rounded-md hover:bg-slate-50">
                <ChevronsRight className="w-4 h-4" />
              </button>
              <div className="flex-1 overflow-y-auto w-full flex flex-col items-center gap-1">
                {chapters.map((c, i) => (
                  <button
                    key={c.id}
                    onClick={() => { setActiveChapterId(c.id); setIsEditing(true); }}
                    title={c.title || `Chapter ${i + 1}`}
                    className={`w-6 h-6 text-[10px] rounded-md font-medium shrink-0 ${
                      c.id === activeChapterId ? 'bg-lime-600 text-white' : 'text-slate-400 hover:bg-slate-100'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="w-[260px] shrink-0 h-full flex flex-col bg-white rounded-2xl border border-slate-200 p-2">
              <button
                onClick={toggleSidebar}
                title="Collapse chapter list"
                className="self-end p-1 text-slate-300 hover:text-lime-600 mb-1"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={chapters.map(c => c.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1 flex-1 overflow-y-auto">
                    {chapters.map((c, i) => (
                      <SortableChapterRow
                        key={c.id}
                        chapter={c}
                        index={i}
                        active={c.id === activeChapterId}
                        renaming={renamingId === c.id}
                        onSelect={() => { setActiveChapterId(c.id); setIsEditing(true); }}
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
                className="w-full mt-2 shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-500 hover:text-lime-600 border border-dashed border-slate-300 hover:border-lime-300 rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" /> Add chapter
              </button>
            </div>
          )}

          <div className="flex-1 min-w-0 h-full bg-white rounded-2xl border border-slate-200 p-6 lg:p-10 overflow-y-auto">
            {activeChapter ? (
              <div className="min-h-[70vh]">
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
                  <ChapterEditor ref={editorRef} chapter={activeChapter} onSaved={handleChapterSaved} onSplit={handleSplit} />
                ) : activeChapter.content_html ? (
                  <div
                    className="font-serif text-[17px] leading-relaxed text-slate-700 [&_p]:mb-4"
                    dangerouslySetInnerHTML={{ __html: activeChapter.content_html }}
                  />
                ) : (
                  <p className="text-sm text-slate-400 flex items-center gap-1.5"><FileText className="w-4 h-4" /> This chapter is empty.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-400">Select a chapter.</p>
            )}
          </div>

          {chatOpen && (
            <ManuscriptChatPanel
              manuscriptId={manuscript.id}
              chapters={chapters}
              canInsert={canInsert}
              onInsert={insertChatReplyIntoDraft}
              onClose={toggleChat}
            />
          )}
        </div>
      )}

      {revisionsFor && (
        <RevisionsPanel
          chapter={revisionsFor}
          onClose={() => setRevisionsFor(null)}
          onRestored={updated => { setChapters(prev => prev.map(c => (c.id === updated.id ? updated : c))); }}
        />
      )}

      {syncOpen && (
        <SyncToCatalogPanel
          manuscript={manuscript}
          onClose={() => setSyncOpen(false)}
          onApplied={() => undefined}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? 'border-lime-500 text-lime-700' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
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
