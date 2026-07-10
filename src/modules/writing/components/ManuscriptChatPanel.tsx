import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, X, Send, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { listManuscriptChatMessages, addManuscriptChatMessage, clearManuscriptChat, getManuscriptPlainText } from '../api';
import { getAiSettings, writingComplete } from '../lib/ai';
import AiModelPicker from './AiModelPicker';
import type { ManuscriptChapter, ManuscriptChatMessage } from '../types';

const CONTEXT_WORD_BUDGET = 30_000;

// Manuscript-aware chat: one thread per manuscript, context built from
// whichever chapters the author checks (default: all), replicating the old
// apps' "enabled materials" context toggle. The whole conversation is folded
// into a single prompt string (see api/writing/ai.ts's single-turn shape —
// every Phase 3 feature "formats a prompt and reads back text").
export default function ManuscriptChatPanel({
  manuscriptId,
  chapters,
  onClose,
}: {
  manuscriptId: string;
  chapters: ManuscriptChapter[];
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ManuscriptChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(() => new Set(chapters.map(c => c.id)));
  const [truncated, setTruncated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    listManuscriptChatMessages(manuscriptId)
      .then(rows => { if (!cancelled) setMessages(rows); })
      .catch(err => { if (!cancelled) setError(err?.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [manuscriptId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  function toggleChapter(id: string) {
    setSelectedChapterIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function send() {
    const question = input.trim();
    if (!question || !user || sending) return;
    setSending(true);
    setError(null);
    setInput('');
    try {
      const userMsg = await addManuscriptChatMessage(manuscriptId, user.id, 'user', question);
      setMessages(prev => [...prev, userMsg]);

      const context = await getManuscriptPlainText(user.id, manuscriptId, { chapterIds: Array.from(selectedChapterIds) });
      const words = context.split(/\s+/).filter(Boolean);
      const wasTruncated = words.length > CONTEXT_WORD_BUDGET;
      setTruncated(wasTruncated);
      const boundedContext = wasTruncated ? words.slice(0, CONTEXT_WORD_BUDGET).join(' ') : context;

      const transcript = [...messages, userMsg]
        .map(m => `${m.role === 'user' ? 'Author' : 'Assistant'}: ${m.content}`)
        .join('\n\n');
      const settings = getAiSettings();
      const text = await writingComplete({
        provider: settings.provider,
        model: settings.model,
        system: `You are a helpful assistant embedded in an author's manuscript workspace. Use the manuscript excerpts below to answer questions, brainstorm, and give feedback — stay grounded in what's actually written.\n\nMANUSCRIPT EXCERPTS:\n${boundedContext || '(no chapters selected for context)'}`,
        prompt: `${transcript}\n\nAssistant:`,
        maxTokens: 1500,
      });
      const assistantMsg = await addManuscriptChatMessage(manuscriptId, user.id, 'assistant', text);
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    } finally {
      setSending(false);
    }
  }

  async function handleClear() {
    if (!confirm('Clear this manuscript\'s chat history? This can\'t be undone.')) return;
    try {
      await clearManuscriptChat(manuscriptId);
      setMessages([]);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    }
  }

  const contextLabel = useMemo(() => {
    if (selectedChapterIds.size === chapters.length) return 'All chapters';
    if (selectedChapterIds.size === 0) return 'No chapters selected';
    return `${selectedChapterIds.size} of ${chapters.length} chapters`;
  }, [selectedChapterIds, chapters.length]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-lime-500" /> Manuscript chat
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={handleClear} title="Clear chat history" className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-slate-50">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 shrink-0">
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer select-none font-medium text-slate-600">Context: {contextLabel}</summary>
            <div className="mt-2 max-h-28 overflow-y-auto space-y-1">
              {chapters.map(c => (
                <label key={c.id} className="flex items-center gap-2 py-0.5">
                  <input type="checkbox" checked={selectedChapterIds.has(c.id)} onChange={() => toggleChapter(c.id)} />
                  {c.title || 'Untitled chapter'}
                </label>
              ))}
            </div>
          </details>
          {truncated && (
            <p className="mt-1.5 text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Context was truncated to the first {CONTEXT_WORD_BUDGET.toLocaleString()} words.
            </p>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-slate-400">Ask about your manuscript — plot holes, continuity, brainstorming, whatever you need.</p>
          ) : (
            messages.map(m => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-lime-600 text-white' : 'bg-slate-100 text-slate-700'
                }`}>
                  {m.content}
                </div>
              </div>
            ))
          )}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-slate-100 text-slate-500 rounded-xl px-3.5 py-2.5 text-sm inline-flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
              </div>
            </div>
          )}
        </div>

        {error && <p className="px-5 text-sm text-rose-600 mb-2">{error}</p>}

        <div className="px-5 py-3 border-t border-slate-100 shrink-0 space-y-2">
          <AiModelPicker />
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask about your manuscript…"
              disabled={sending}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-lime-600 hover:bg-lime-700 rounded-lg disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
