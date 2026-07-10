import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Heading1, Heading2, Heading3, Quote, List, ListOrdered, Undo2, Redo2, Scissors, Camera } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { updateChapter, listRevisions, createRevision } from '../api';
import { blockIndexAtSelection, splitHtmlAtBlockIndex } from '../lib/chapterOps';
import type { ManuscriptChapter } from '../types';

const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;

// Rich-text editor for one chapter: TipTap with a minimal toolbar, 2s
// debounced autosave, an hourly autosnapshot (plus a manual "Snapshot"
// button) into manuscript_revisions, and "Split chapter here" which hands the
// two halves up to the parent rather than writing to the DB itself.
export default function ChapterEditor({
  chapter,
  onSaved,
  onSplit,
}: {
  chapter: ManuscriptChapter;
  onSaved: (updated: ManuscriptChapter) => void;
  onSplit: (beforeHtml: string, afterHtml: string) => void;
}) {
  const { user } = useAuth();
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [splitHint, setSplitHint] = useState<string | null>(null);
  const lastSnapshotAtRef = useRef<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Holds the debounced save call itself (not just the html) so cleanup can
  // flush it immediately — clearing the timer alone would silently drop the
  // last <2s of edits when the user switches chapters mid-debounce.
  const pendingSaveRef = useRef<(() => void) | null>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: chapter.content_html,
    onUpdate: ({ editor }) => scheduleSave(editor.getHTML()),
  }, [chapter.id]);

  useEffect(() => {
    let cancelled = false;
    listRevisions(chapter.id)
      .then(revs => { if (!cancelled) lastSnapshotAtRef.current = revs[0] ? new Date(revs[0].created_at).getTime() : null; })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [chapter.id]);

  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      pendingSaveRef.current?.();
      pendingSaveRef.current = null;
    }
  }, [chapter.id]);

  function scheduleSave(html: string) {
    setSaveState('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const run = () => { saveTimerRef.current = null; pendingSaveRef.current = null; save(html); };
    pendingSaveRef.current = run;
    saveTimerRef.current = setTimeout(run, 2000);
  }

  async function save(html: string) {
    if (!user) return;
    try {
      const updated = await updateChapter(chapter.id, { content_html: html });
      onSaved(updated);
      setSaveState('saved');
      const now = Date.now();
      const due = lastSnapshotAtRef.current === null || now - lastSnapshotAtRef.current > SNAPSHOT_INTERVAL_MS;
      if (due) {
        createRevision(chapter.id, user.id, html, 'Autosave').catch(() => undefined);
        lastSnapshotAtRef.current = now;
      }
    } catch {
      setSaveState('idle');
    }
  }

  async function manualSnapshot() {
    if (!user || !editor) return;
    const label = window.prompt('Label this snapshot (optional):', '') ?? '';
    await createRevision(chapter.id, user.id, editor.getHTML(), label.trim() || null).catch(() => undefined);
    lastSnapshotAtRef.current = Date.now();
  }

  function requestSplit() {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const index = blockIndexAtSelection(dom);
    if (index === null) {
      setSplitHint('Click inside a paragraph (not the very first one) to split the chapter there.');
      return;
    }
    setSplitHint(null);
    const [before, after] = splitHtmlAtBlockIndex(editor.getHTML(), index);
    onSplit(before, after);
  }

  if (!editor) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 mb-3 pb-3 border-b border-slate-100">
        <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} label="Bold">
          <Bold className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} label="Italic">
          <Italic className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} label="Heading 1">
          <Heading1 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="Heading 2">
          <Heading2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} label="Heading 3">
          <Heading3 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="Quote">
          <Quote className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} label="Bullet list">
          <List className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="Numbered list">
          <ListOrdered className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} label="Undo">
          <Undo2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} label="Redo">
          <Redo2 className="w-4 h-4" />
        </ToolbarButton>

        <div className="flex-1" />

        <button onClick={manualSnapshot} title="Save a labeled snapshot" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-lime-600 px-2 py-1.5 rounded-md hover:bg-slate-50">
          <Camera className="w-3.5 h-3.5" /> Snapshot
        </button>
        <button onClick={requestSplit} title="Split into a new chapter at the cursor" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-lime-600 px-2 py-1.5 rounded-md hover:bg-slate-50">
          <Scissors className="w-3.5 h-3.5" /> Split here
        </button>
        <span className="text-xs text-slate-400 w-14 text-right">
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}
        </span>
      </div>

      {splitHint && <p className="text-xs text-amber-600 mb-3">{splitHint}</p>}

      <EditorContent
        editor={editor}
        className="font-serif text-[17px] leading-relaxed text-slate-700 max-w-prose [&_.ProseMirror]:min-h-[45vh] [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:mb-4"
      />
    </div>
  );
}

function ToolbarButton({
  active, onClick, label, children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`p-1.5 rounded-md ${active ? 'bg-lime-100 text-lime-700' : 'text-slate-500 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );
}
