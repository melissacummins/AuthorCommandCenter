import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Bold, Italic, Heading1, Heading2, Heading3, Quote, List, ListOrdered, Undo2, Redo2, Scissors, Camera,
  Wand2, Loader2, Check, RotateCcw, X, ArrowDownToLine, MousePointerClick,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { updateChapter, listRevisions, createRevision } from '../api';
import { blockIndexAtSelection, splitHtmlAtBlockIndex } from '../lib/chapterOps';
import { getAiSettings, aiSettingsToRequest, writingComplete, plainTextToHtml } from '../lib/ai';
import { htmlToPlainText } from '../types';
import AiSettingsPanel from './AiSettingsPanel';
import type { ManuscriptChapter } from '../types';

const EDITOR_DEFAULT_MAX_TOKENS = 1024;

// Imperative handle so a sibling (the docked chat panel) can insert text at
// the live cursor position without lifting the whole TipTap editor instance
// up into the parent (directive §8.4 — chat's "Insert into draft" action).
export interface ChapterEditorHandle {
  insertContentAtCursor: (html: string) => void;
}

const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;
const CONTINUE_TAIL_WORDS = 2000;

type SelectionAction = 'rewrite' | 'tighten' | 'expand' | 'describe';
type AiAction = 'continue' | SelectionAction;

const SELECTION_LABELS: Record<SelectionAction, string> = {
  rewrite: 'Rewrite', tighten: 'Tighten', expand: 'Expand', describe: 'Describe more',
};
const SELECTION_INSTRUCTIONS: Record<SelectionAction, string> = {
  rewrite: 'Rewrite the following passage for clarity and flow, preserving its meaning, voice, and tense.',
  tighten: 'Tighten the following passage — cut wordiness and filler while preserving its meaning and voice.',
  expand: 'Expand the following passage with more sensory and emotional detail, preserving its voice and tense.',
  describe: 'Add more vivid descriptive detail to the following passage, preserving its voice and tense.',
};

interface AiPanelState {
  action: AiAction;
  response: string;
  loading: boolean;
  error: string | null;
  selectionRange: { from: number; to: number } | null;
}

// Rich-text editor for one chapter: TipTap with a minimal toolbar, 2s
// debounced autosave, an hourly autosnapshot (plus a manual "Snapshot"
// button) into manuscript_revisions, "Split chapter here" which hands the
// two halves up to the parent rather than writing to the DB itself, and the
// two review-before-apply AI actions (continue writing / selection rewrite).
function ChapterEditor({
  chapter,
  onSaved,
  onSplit,
}: {
  chapter: ManuscriptChapter;
  onSaved: (updated: ManuscriptChapter) => void;
  onSplit: (beforeHtml: string, afterHtml: string) => void;
}, ref: React.Ref<ChapterEditorHandle>) {
  const { user } = useAuth();
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [splitHint, setSplitHint] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [aiPanel, setAiPanel] = useState<AiPanelState | null>(null);
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
    onSelectionUpdate: ({ editor }) => setHasSelection(!editor.state.selection.empty),
  }, [chapter.id]);

  useImperativeHandle(ref, () => ({
    insertContentAtCursor: (html: string) => {
      editor?.chain().focus().insertContent(html).run();
    },
  }), [editor]);

  useEffect(() => {
    let cancelled = false;
    listRevisions(chapter.id)
      .then(revs => { if (!cancelled) lastSnapshotAtRef.current = revs[0] ? new Date(revs[0].created_at).getTime() : null; })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [chapter.id]);

  useEffect(() => {
    setAiPanel(null);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        pendingSaveRef.current?.();
        pendingSaveRef.current = null;
      }
    };
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

  // ---- AI: continue writing ----

  async function runContinue() {
    if (!editor) return;
    setAiPanel({ action: 'continue', response: '', loading: true, error: null, selectionRange: null });
    const words = htmlToPlainText(editor.getHTML()).split(/\s+/).filter(Boolean);
    const tail = words.slice(-CONTINUE_TAIL_WORDS).join(' ');
    const settings = getAiSettings();
    try {
      const text = await writingComplete({
        ...aiSettingsToRequest(settings, EDITOR_DEFAULT_MAX_TOKENS),
        system: "You are a skilled fiction ghostwriter. Continue the author's manuscript in their exact voice, tense, and style. Write only prose — no headers, no commentary.",
        prompt: `Continue writing from where this excerpt leaves off:\n\n"""${tail || '(the chapter is empty — begin it)'}"""\n\nWrite the next 200-400 words. Return ONLY the continuation text, with no quotation marks and without repeating any of the text above.`,
      });
      setAiPanel(p => (p && p.action === 'continue' ? { ...p, response: text, loading: false } : p));
    } catch (e) {
      setAiPanel(p => (p && p.action === 'continue' ? { ...p, loading: false, error: (e as Error)?.message ?? 'AI request failed.' } : p));
    }
  }

  // ---- AI: selection actions ----

  async function runSelectionAction(action: SelectionAction) {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const selectedText = editor.state.doc.textBetween(from, to, ' ');
    setAiPanel({ action, response: '', loading: true, error: null, selectionRange: { from, to } });
    const settings = getAiSettings();
    try {
      const text = await writingComplete({
        ...aiSettingsToRequest(settings, EDITOR_DEFAULT_MAX_TOKENS),
        system: "You help an author revise their own fiction manuscript. Preserve meaning, voice, and tense unless asked otherwise.",
        prompt: `${SELECTION_INSTRUCTIONS[action]}\n\n"""${selectedText}"""\n\nReturn ONLY the replacement text, with no quotation marks and no commentary.`,
      });
      setAiPanel(p => (p && p.action === action ? { ...p, response: text, loading: false } : p));
    } catch (e) {
      setAiPanel(p => (p && p.action === action ? { ...p, loading: false, error: (e as Error)?.message ?? 'AI request failed.' } : p));
    }
  }

  function retry() {
    if (!aiPanel) return;
    if (aiPanel.action === 'continue') runContinue();
    else runSelectionAction(aiPanel.action);
  }

  function appendToEnd() {
    if (!editor || !aiPanel) return;
    editor.chain().focus('end').insertContent(plainTextToHtml(aiPanel.response)).run();
    setAiPanel(null);
  }

  function insertAtCursor() {
    if (!editor || !aiPanel) return;
    editor.chain().focus().insertContent(plainTextToHtml(aiPanel.response)).run();
    setAiPanel(null);
  }

  function replaceSelection() {
    if (!editor || !aiPanel?.selectionRange) return;
    editor.chain().focus().setTextSelection(aiPanel.selectionRange).insertContent(plainTextToHtml(aiPanel.response)).run();
    setAiPanel(null);
  }

  if (!editor) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 mb-2 pb-2 border-b border-edge-soft">
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

        <button onClick={manualSnapshot} title="Save a labeled snapshot" className="inline-flex items-center gap-1 text-xs text-content-secondary hover:text-lime-600 px-2 py-1.5 rounded-control hover:bg-surface-hover">
          <Camera className="w-3.5 h-3.5" /> Snapshot
        </button>
        <button onClick={requestSplit} title="Split into a new chapter at the cursor" className="inline-flex items-center gap-1 text-xs text-content-secondary hover:text-lime-600 px-2 py-1.5 rounded-control hover:bg-surface-hover">
          <Scissors className="w-3.5 h-3.5" /> Split here
        </button>
        <span className="text-xs text-content-muted w-14 text-right">
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-edge-soft">
        <button
          onClick={runContinue}
          disabled={!!aiPanel?.loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white bg-lime-600 hover:bg-lime-700 rounded-control disabled:opacity-50"
        >
          <Wand2 className="w-3.5 h-3.5" /> Continue writing
        </button>
        <select
          disabled={!hasSelection || !!aiPanel?.loading}
          value=""
          onChange={e => { const v = e.target.value as SelectionAction | ''; if (v) runSelectionAction(v); }}
          title={hasSelection ? 'AI actions for the selected text' : 'Select some text first'}
          className="px-2 py-1.5 text-xs border border-edge-strong rounded-control text-content-secondary bg-surface disabled:opacity-50"
        >
          <option value="" disabled>
            {hasSelection ? 'AI: rewrite selection…' : 'Select text for AI'}
          </option>
          {(Object.keys(SELECTION_LABELS) as SelectionAction[]).map(k => (
            <option key={k} value={k}>{SELECTION_LABELS[k]}</option>
          ))}
        </select>
        {!hasSelection && <MousePointerClick className="w-3.5 h-3.5 text-content-faint" />}
        <div className="flex-1" />
        <AiSettingsPanel />
      </div>

      {splitHint && <p className="text-xs text-amber-600 mb-3">{splitHint}</p>}

      {aiPanel && (
        <div className="mb-4 rounded-card border border-lime-200 bg-lime-50/50 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-lime-800 flex items-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5" />
              {aiPanel.action === 'continue' ? 'AI continuation' : `AI: ${SELECTION_LABELS[aiPanel.action]}`}
            </p>
            <button onClick={() => setAiPanel(null)} className="text-content-muted hover:text-content-secondary">
              <X className="w-4 h-4" />
            </button>
          </div>

          {aiPanel.loading ? (
            <div className="flex items-center gap-2 text-sm text-content-secondary py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
            </div>
          ) : aiPanel.error ? (
            <p className="text-sm text-rose-600">{aiPanel.error}</p>
          ) : (
            <p className="font-serif text-[15px] leading-relaxed text-content whitespace-pre-wrap mb-3">{aiPanel.response}</p>
          )}

          {!aiPanel.loading && (
            <div className="flex flex-wrap items-center gap-2">
              {aiPanel.action === 'continue' ? (
                <>
                  <ActionButton onClick={appendToEnd} disabled={!!aiPanel.error} icon={<ArrowDownToLine className="w-3.5 h-3.5" />}>
                    Append to end
                  </ActionButton>
                  <ActionButton onClick={insertAtCursor} disabled={!!aiPanel.error} icon={<MousePointerClick className="w-3.5 h-3.5" />}>
                    Insert at cursor
                  </ActionButton>
                </>
              ) : (
                <ActionButton onClick={replaceSelection} disabled={!!aiPanel.error} icon={<Check className="w-3.5 h-3.5" />}>
                  Replace selection
                </ActionButton>
              )}
              <ActionButton onClick={retry} secondary icon={<RotateCcw className="w-3.5 h-3.5" />}>
                Retry
              </ActionButton>
              <button onClick={() => setAiPanel(null)} className="text-xs text-content-secondary hover:text-content px-2 py-1.5">
                Discard
              </button>
            </div>
          )}
        </div>
      )}

      <EditorContent
        editor={editor}
        onClick={() => editor.chain().focus('end').run()}
        className="font-serif text-[17px] leading-relaxed text-content [&_.ProseMirror]:min-h-[65vh] [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:mb-4 [&_.ProseMirror]:cursor-text"
      />
    </div>
  );
}

export default forwardRef(ChapterEditor);

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
      className={`p-1.5 rounded-control ${active ? 'bg-lime-100 text-lime-700' : 'text-content-secondary hover:bg-surface-sunken'}`}
    >
      {children}
    </button>
  );
}

function ActionButton({
  onClick, disabled, secondary, icon, children,
}: {
  onClick: () => void;
  disabled?: boolean;
  secondary?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-control disabled:opacity-50 ${
        secondary ? 'border border-edge-strong text-content-secondary hover:bg-surface' : 'bg-lime-600 text-white hover:bg-lime-700'
      }`}
    >
      {icon} {children}
    </button>
  );
}
