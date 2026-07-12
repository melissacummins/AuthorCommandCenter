import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpenText, Loader2, Plus, Trash2, Download, ArrowLeft,
  Highlighter, Strikethrough, Heart, Circle, MousePointer2,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import type { Book } from '../../catalog/types';
import type { Manuscript } from '../../writing/types';
import { listChapters } from '../../writing/api';
import { listHooks, listCreatives, insertCreative, updateCreative, deleteCreative, type ContentCreative } from '../api';
import type { ContentHook } from '../types';
import { downloadBlob } from '../lib/slides';
import SendTo from '../../../components/SendTo';
import {
  detectDialogue, wordRangeAt, rangesOverlap, segmentText, renderScreenshotToPng,
  PAGE_BGS, HIGHLIGHT_FILLS, FONT_SIZES, PAGE_WIDTH, PAGE_PADDING,
  type ScreenshotPayload, type Highlight, type HighlightColor, type StampKind, type PageBg, type CharRange,
} from '../lib/screenshot';
import { stampSvg } from '../lib/screenshot';

// Kindle Screenshots: a scene rendered as a generic e-reader page with
// annotations — highlights on auto-detected dialogue, strike-through on the
// naughty words, and hand-drawn stamps. 100% deterministic; no AI calls.

type Tool = 'highlight' | 'strike' | StampKind | 'select';

export default function ScreenshotsTab({ book, manuscript }: { book: Book; manuscript: Manuscript | null }) {
  const { user } = useAuth();
  const [creatives, setCreatives] = useState<ContentCreative[]>([]);
  const [hooks, setHooks] = useState<ContentHook[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([listCreatives(user.id, book.id, 'screenshot'), listHooks(user.id, book.id)])
      .then(([c, h]) => { if (!cancelled) { setCreatives(c); setHooks(h); } })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, book.id]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (!user) return null;

  const open = openId ? creatives.find(c => c.id === openId) : null;
  if (open) {
    return (
      <ScreenshotEditor
        key={open.id}
        creative={open}
        onBack={() => setOpenId(null)}
        onChanged={next => setCreatives(prev => prev.map(c => c.id === next.id ? next : c))}
      />
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {creating ? (
        <NewScreenshotForm
          userId={user.id}
          book={book}
          manuscript={manuscript}
          hooks={hooks}
          onCancel={() => setCreating(false)}
          onCreated={c => { setCreatives(prev => [c, ...prev]); setCreating(false); setOpenId(c.id); }}
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <BookOpenText className="w-4 h-4 text-slate-400" /> Kindle Screenshots
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Render a scene as an annotated e-reader page — highlight dialogue, strike out the naughty words, stamp hearts.
            </p>
          </div>
          <button onClick={() => setCreating(true)}
            className="px-4 py-2 rounded-lg bg-pink-600 text-white text-sm font-medium hover:bg-pink-700 flex items-center gap-2">
            <Plus className="w-4 h-4" /> New screenshot
          </button>
        </div>
      )}

      {creatives.length === 0 && !creating ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center">
          <p className="text-slate-500 text-sm">No screenshots yet for this book.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {creatives.map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start justify-between gap-2">
              <button className="text-left min-w-0 flex-1" onClick={() => setOpenId(c.id)}>
                <p className="text-sm font-medium text-slate-800 truncate">{c.title || 'Untitled screenshot'}</p>
                <p className="text-xs text-slate-400 mt-0.5">{new Date(c.updated_at).toLocaleDateString()}</p>
              </button>
              <button
                onClick={async () => { if (!confirm('Delete this screenshot?')) return; await deleteCreative(c.id); setCreatives(prev => prev.filter(x => x.id !== c.id)); }}
                className="p-1.5 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Creation ----------------

function NewScreenshotForm({ userId, book, manuscript, hooks, onCancel, onCreated }: {
  userId: string;
  book: Book;
  manuscript: Manuscript | null;
  hooks: ContentHook[];
  onCancel: () => void;
  onCreated: (c: ContentCreative) => void;
}) {
  const [text, setText] = useState('');
  const [chapters, setChapters] = useState<Array<{ id: string; title: string; content_html: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hooksWithScenes = hooks.filter(h => h.scene_excerpt.trim());

  async function loadChapter(chapterId: string) {
    const ch = chapters?.find(c => c.id === chapterId);
    if (!ch) return;
    const doc = new DOMParser().parseFromString(ch.content_html, 'text/html');
    setText((doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim());
  }

  async function create() {
    if (!text.trim()) return;
    setBusy(true); setError(null);
    try {
      const authorName = ''; // pen name display handled via header text below
      const payload: ScreenshotPayload = {
        source_text: text.trim().slice(0, 4000),
        page: {
          bg: 'paper', fontSize: 'md', showHeader: true, showFooter: true,
          headerText: `${book.title}${authorName ? ` · ${authorName}` : ''}`,
          footerText: `${Math.floor(20 + Math.random() * 60)}%`,
        },
        highlights: [], strikes: [], stamps: [],
      };
      const created = await insertCreative(userId, {
        book_id: book.id, hook_id: null, type: 'screenshot',
        title: text.trim().slice(0, 60),
        payload: payload as unknown as Record<string, unknown>,
      });
      onCreated(created);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <h3 className="text-sm font-semibold text-slate-800">New screenshot</h3>
      <div className="flex flex-wrap gap-2">
        {hooksWithScenes.length > 0 && (
          <select
            defaultValue=""
            onChange={e => { const h = hooksWithScenes.find(x => x.id === e.target.value); if (h) setText(h.scene_excerpt); }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white max-w-72"
          >
            <option value="" disabled>Use a hook's scene…</option>
            {hooksWithScenes.map(h => <option key={h.id} value={h.id}>{h.hook_text.slice(0, 70)}</option>)}
          </select>
        )}
        {manuscript && (
          <select
            defaultValue=""
            onFocus={async () => { if (!chapters) setChapters(await listChapters(manuscript.id)); }}
            onChange={e => loadChapter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white max-w-72"
          >
            <option value="" disabled>Pull a chapter…</option>
            {(chapters ?? []).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
      </div>
      <textarea
        rows={8}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste or pull the scene text, then trim it down to the part you want on the page…"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-pink-500 outline-none font-serif"
      />
      <p className="text-[11px] text-slate-400">{text.length} characters — a page reads best under ~1,200.</p>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
        <button onClick={create} disabled={busy || !text.trim()}
          className="px-4 py-2 rounded-lg bg-pink-600 text-white text-sm font-medium hover:bg-pink-700 disabled:opacity-50">
          Create page
        </button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

// ---------------- Editor ----------------

function ScreenshotEditor({ creative, onBack, onChanged }: {
  creative: ContentCreative;
  onBack: () => void;
  onChanged: (c: ContentCreative) => void;
}) {
  const initial = creative.payload as unknown as ScreenshotPayload;
  const [payload, setPayload] = useState<ScreenshotPayload>(initial);
  const [tool, setTool] = useState<Tool>('highlight');
  const [hlColor, setHlColor] = useState<HighlightColor>('yellow');
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const dialogue = useMemo(() => detectDialogue(payload.source_text), [payload.source_text]);
  const paragraphs = useMemo(() => segmentText(payload), [payload]);

  function commit(next: ScreenshotPayload) {
    setPayload(next);
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const updated = await updateCreative(creative.id, { payload: next as unknown as Record<string, unknown> });
        onChanged(updated);
        setSaveState('saved');
      } catch (err) {
        setError((err as Error).message);
      }
    }, 1200);
  }

  // A click on a character offset applies the active tool.
  function handleTextClick(offset: number) {
    if (tool === 'highlight') {
      const span = dialogue.find(d => offset >= d.start && offset < d.end);
      const target: CharRange = span ?? wordRangeAt(payload.source_text, offset) ?? { start: offset, end: offset + 1 };
      const existing = payload.highlights.find(h => rangesOverlap(h, target));
      if (existing) {
        commit({ ...payload, highlights: payload.highlights.filter(h => h !== existing) });
      } else {
        const hl: Highlight = { ...target, color: hlColor };
        commit({ ...payload, highlights: [...payload.highlights, hl] });
      }
    } else if (tool === 'strike') {
      const word = wordRangeAt(payload.source_text, offset);
      if (!word) return;
      const existing = payload.strikes.find(s => rangesOverlap(s, word));
      commit({
        ...payload,
        strikes: existing ? payload.strikes.filter(s => s !== existing) : [...payload.strikes, word],
      });
    }
  }

  function handlePageClick(e: React.MouseEvent) {
    if (tool === 'highlight' || tool === 'strike' || tool === 'select') return;
    const rect = pageRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    commit({ ...payload, stamps: [...payload.stamps, { kind: tool, x, y, scale: 1 }] });
  }

  const fileBase = (creative.title || 'screenshot').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  async function exportPng() {
    setExporting(true); setError(null);
    try {
      const pageHeight = pageRef.current?.offsetHeight ?? 640;
      const blob = await renderScreenshotToPng(payload, pageHeight);
      downloadBlob(blob, `${fileBase}.png`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  // Same render as exportPng, but as a blob for the cloud-export buttons.
  async function renderForCloud() {
    const pageHeight = pageRef.current?.offsetHeight ?? 640;
    const blob = await renderScreenshotToPng(payload, pageHeight);
    return [{ blob, filename: `${fileBase}.png` }];
  }

  const bg = PAGE_BGS[payload.page.bg];
  const fontSize = FONT_SIZES[payload.page.fontSize];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center gap-2 text-xs">
        <button onClick={onBack} className="p-1.5 rounded-md text-slate-400 hover:text-slate-700"><ArrowLeft className="w-4 h-4" /></button>
        <ToolButton active={tool === 'highlight'} onClick={() => setTool('highlight')} label="Highlight (click dialogue)"><Highlighter className="w-4 h-4" /></ToolButton>
        {tool === 'highlight' && (
          <span className="flex gap-1">
            {(Object.keys(HIGHLIGHT_FILLS) as HighlightColor[]).map(c => (
              <button key={c} onClick={() => setHlColor(c)}
                className={`w-5 h-5 rounded-full border ${hlColor === c ? 'ring-2 ring-slate-500' : 'border-slate-200'}`}
                style={{ background: HIGHLIGHT_FILLS[c] }} />
            ))}
          </span>
        )}
        <ToolButton active={tool === 'strike'} onClick={() => setTool('strike')} label="Strike a word"><Strikethrough className="w-4 h-4" /></ToolButton>
        <ToolButton active={tool === 'heart'} onClick={() => setTool('heart')} label="Stamp: heart"><Heart className="w-4 h-4" /></ToolButton>
        <ToolButton active={tool === 'circle'} onClick={() => setTool('circle')} label="Stamp: circle"><Circle className="w-4 h-4" /></ToolButton>
        <ToolButton active={tool === 'exclamation'} onClick={() => setTool('exclamation')} label="Stamp: exclamation"><span className="font-bold text-sm w-4 text-center">!</span></ToolButton>
        <ToolButton active={tool === 'underline'} onClick={() => setTool('underline')} label="Stamp: underline"><span className="font-bold text-sm w-4 text-center underline">U</span></ToolButton>
        <ToolButton active={tool === 'select'} onClick={() => setTool('select')} label="Move stamps"><MousePointer2 className="w-4 h-4" /></ToolButton>

        <span className="text-slate-300">|</span>
        <select value={payload.page.bg} onChange={e => commit({ ...payload, page: { ...payload.page, bg: e.target.value as PageBg } })}
          className="rounded border border-slate-200 px-1.5 py-1 bg-white">
          {(Object.keys(PAGE_BGS) as PageBg[]).map(b => <option key={b} value={b}>{PAGE_BGS[b].label}</option>)}
        </select>
        <select value={payload.page.fontSize} onChange={e => commit({ ...payload, page: { ...payload.page, fontSize: e.target.value as 'sm' | 'md' | 'lg' } })}
          className="rounded border border-slate-200 px-1.5 py-1 bg-white">
          <option value="sm">A-</option><option value="md">A</option><option value="lg">A+</option>
        </select>
        <label className="flex items-center gap-1 text-slate-500">
          <input type="checkbox" checked={payload.page.showHeader} onChange={e => commit({ ...payload, page: { ...payload.page, showHeader: e.target.checked } })} /> header
        </label>
        <label className="flex items-center gap-1 text-slate-500">
          <input type="checkbox" checked={payload.page.showFooter} onChange={e => commit({ ...payload, page: { ...payload.page, showFooter: e.target.checked } })} /> footer
        </label>

        <span className="text-[11px] text-slate-400 ml-auto">{saveState === 'saving' ? 'Saving…' : 'Saved'}</span>
        <button onClick={exportPng} disabled={exporting}
          className="px-3 py-2 rounded-lg bg-slate-800 text-white font-medium hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1.5">
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Export PNG
        </button>
        <SendTo getFiles={renderForCloud} disabled={exporting} />
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <p className="text-[11px] text-slate-400">
        Highlight tool: quoted dialogue is auto-detected — click it to highlight, click again to remove. Strike tool: click any word. Stamps: click the page to place; in Move mode drag them, double-click to delete.
      </p>

      {/* Page */}
      <div className="flex justify-center">
        <div
          ref={pageRef}
          onClick={handlePageClick}
          className="relative shadow-lg rounded-sm select-none"
          style={{
            width: PAGE_WIDTH,
            background: payload.page.bg === 'transparent'
              ? 'repeating-conic-gradient(#e2e8f0 0% 25%, #f8fafc 0% 50%) 0 0/16px 16px'
              : bg.fill,
            color: bg.text,
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize,
            lineHeight: 1.65,
            padding: PAGE_PADDING,
            cursor: tool === 'highlight' || tool === 'strike' ? 'text' : tool === 'select' ? 'default' : 'crosshair',
          }}
        >
          {payload.page.showHeader && (
            <div className="absolute left-0 right-0 text-center" style={{ top: 14, fontSize: 11, letterSpacing: '0.08em', opacity: 0.45 }}>
              {payload.page.headerText}
            </div>
          )}
          <div className="relative">
            {paragraphs.map((segs, pi) => (
              <p key={pi} style={{ margin: `0 0 ${Math.round(fontSize * 0.8)}px 0`, textIndent: '1.4em' }}>
                {segs.map((seg, si) => {
                  const isDialogue = dialogue.some(d => seg.start >= d.start && seg.start < d.end);
                  return (
                    <span
                      key={si}
                      onClick={e => { e.stopPropagation(); if (tool === 'highlight' || tool === 'strike') handleTextClick(seg.start); }}
                      style={{
                        background: seg.highlight ? HIGHLIGHT_FILLS[seg.highlight] : undefined,
                        borderRadius: seg.highlight ? 2 : undefined,
                        textDecoration: seg.struck ? 'line-through' : undefined,
                        textDecorationThickness: seg.struck ? 2 : undefined,
                        textDecorationColor: seg.struck ? '#dc2626' : undefined,
                        outline: tool === 'highlight' && isDialogue && !seg.highlight ? '1px dashed rgba(217,119,6,0.4)' : undefined,
                        cursor: tool === 'highlight' || tool === 'strike' ? 'pointer' : undefined,
                      }}
                    >
                      {seg.text}
                    </span>
                  );
                })}
              </p>
            ))}
          </div>
          {payload.page.showFooter && (
            <div className="absolute" style={{ bottom: 12, right: PAGE_PADDING, fontSize: 11, opacity: 0.45 }}>
              {payload.page.footerText}
            </div>
          )}
          {payload.stamps.map((st, i) => (
            <StampView
              key={i}
              stamp={st}
              movable={tool === 'select'}
              containerRef={pageRef}
              onMove={(x, y) => commit({ ...payload, stamps: payload.stamps.map((s, j) => j === i ? { ...s, x, y } : s) })}
              onDelete={() => commit({ ...payload, stamps: payload.stamps.filter((_, j) => j !== i) })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolButton({ active, onClick, label, children }: {
  active: boolean; onClick: () => void; label: string; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={label}
      className={`p-1.5 rounded-md ${active ? 'bg-pink-100 text-pink-700' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>
      {children}
    </button>
  );
}

function StampView({ stamp, movable, containerRef, onMove, onDelete }: {
  stamp: { kind: StampKind; x: number; y: number; scale: number };
  movable: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onMove: (x: number, y: number) => void;
  onDelete: () => void;
}) {
  const size = Math.round(64 * stamp.scale);

  function onPointerDown(e: React.PointerEvent) {
    if (!movable) return;
    e.preventDefault();
    e.stopPropagation();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    function move(ev: PointerEvent) {
      onMove(
        Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)),
        Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height)),
      );
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={e => { e.stopPropagation(); if (movable) onDelete(); }}
      onClick={e => e.stopPropagation()}
      className="absolute"
      style={{
        left: `${stamp.x * 100}%`, top: `${stamp.y * 100}%`,
        width: size, height: size,
        transform: 'translate(-50%,-50%)',
        cursor: movable ? 'grab' : 'default',
      }}
      dangerouslySetInnerHTML={{ __html: stampSvg(stamp.kind) }}
    />
  );
}
