import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BookOpen, Copy, Check, Pencil, Flame, Loader2, Wand2, Sparkles,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import type { Book, BookUpdate } from '../types';
import { STATUS_COLORS, STATUS_LABELS } from '../types';
import type { PenNameColor } from '../../../lib/penNames';
import PenNameChip from '../../../components/PenNameChip';
import BookChecklist from './BookChecklist';
import { getManuscriptForBook, getManuscriptChapters } from '../../writing/api';
import type { Manuscript } from '../../writing/types';
import { runTask, runJsonTask } from '../../content-creator/lib/ai';
import {
  buildCatalogChapterPrompt, buildCatalogSynthesisPrompt, parseJsonResponse,
  type CatalogProposals,
} from '../../content-creator/lib/prompts';

// The catalog READ view — Melissa's Notion workflow restored: open a book,
// see everything cleanly in collapsible sections, grab what you need with a
// copy button, and leave. Editing is an explicit mode, not the default.
// Also hosts the manuscript -> catalog autofill (Phase 5).

interface Props {
  book: Book;
  penName: { name: string; color: PenNameColor } | null;
  onBack: () => void;
  onEdit: () => void;
  onBookUpdated: (patch: BookUpdate) => Promise<void>;
}

export default function BookView({ book, penName, onBack, onEdit, onBookUpdated }: Props) {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-control text-content-muted hover:text-content hover:bg-surface">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-content truncate">{book.title}</h2>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_COLORS[book.status]}`}>{STATUS_LABELS[book.status]}</span>
            {penName && <PenNameChip name={penName.name} color={penName.color} size="sm" />}
            {book.series && <span className="text-xs text-content-secondary">{book.series}{book.series_position ? ` #${book.series_position}` : ''}</span>}
          </div>
        </div>
        <button onClick={onEdit}
          className="px-3 py-2 rounded-control bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 flex items-center gap-1.5">
          <Pencil className="w-3.5 h-3.5" /> Edit
        </button>
      </div>

      <div className="flex gap-4">
        <div className="w-28 h-40 rounded-control bg-gradient-to-br from-brand-100 to-brand-100 grid place-items-center shrink-0 overflow-hidden border border-edge">
          {book.cover_url ? <img src={book.cover_url} alt="" className="w-full h-full object-cover" /> : <BookOpen className="w-8 h-8 text-brand-400" />}
        </div>
        <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm content-start">
          <Fact label="Subgenre" value={book.subgenre} />
          <HeatFact level={book.heat_level} />
          <Fact label="Publish date" value={book.publish_date} />
          <Fact label="Word count" value={book.word_count?.toLocaleString() ?? null} />
          <Fact label="ASIN" value={book.asin} mono />
          <Fact label="Language" value={book.language} />
        </div>
      </div>

      <AutofillPanel book={book} onApply={onBookUpdated} />

      {/* What this book could still become — pipeline ring + the full
          opportunity engine output with Start / Plan / Dismiss (directive §6). */}
      <Section title="Checklist" defaultOpen>
        <BookChecklist book={book} />
      </Section>

      <Section title="Marketing copy" defaultOpen>
        <Field label="Blurb" value={book.blurb} multiline copyable />
        <Field label="Content & trigger warnings" value={book.content_warnings} multiline copyable />
        <Field label="Kinks / spice notes" value={book.kinks} multiline copyable />
        <Field label="Tropes" value={book.tropes.join('\n')} multiline copyable />
      </Section>

      <Section title="Pricing & identifiers">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          <Fact label="Ebook" value={book.ebook_price != null ? `$${book.ebook_price}` : null} />
          <Fact label="Paperback" value={book.paperback_price != null ? `$${book.paperback_price}` : null} />
          <Fact label="Hardcover" value={book.hardcover_price != null ? `$${book.hardcover_price}` : null} />
          <Fact label="Audiobook" value={book.audiobook_price != null ? `$${book.audiobook_price}` : null} />
          <Fact label="ISBN ebook" value={book.isbn_ebook} mono />
          <Fact label="ISBN paperback" value={book.isbn_paperback} mono />
          <Fact label="ISBN hardcover" value={book.isbn_hardcover} mono />
          <Fact label="ISBN audiobook" value={book.isbn_audiobook} mono />
        </div>
      </Section>

      <Section title="Discovery">
        <Field label="Amazon keywords" value={book.amazon_keywords.join('\n')} multiline copyable />
        <Field label="Also-boughts / keywords" value={book.keywords.join('\n')} multiline copyable />
        <Field label="BISAC categories" value={book.bisac_categories.join('\n')} multiline copyable />
      </Section>

      {book.reviews.length > 0 && (
        <Section title={`Review excerpts (${book.reviews.length})`}>
          <div className="space-y-2">
            {book.reviews.map((r, i) => (
              <blockquote key={i} className="text-sm text-content-secondary border-l-2 border-amber-300 pl-3">
                “{r.quote}” <span className="text-xs text-content-muted">— {r.source}{r.rating ? ` (${r.rating}★)` : ''}</span>
              </blockquote>
            ))}
          </div>
        </Section>
      )}

      {book.notes && (
        <Section title="Notes">
          <Field label="" value={book.notes} multiline copyable />
        </Section>
      )}
    </div>
  );
}

// ---------------- Pieces ----------------

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="bg-surface rounded-card border border-edge group">
      <summary className="px-5 py-3.5 cursor-pointer select-none text-sm font-semibold text-content uppercase tracking-wide list-none flex items-center justify-between">
        {title}
        <span className="text-content-faint group-open:rotate-90 transition-transform">›</span>
      </summary>
      <div className="px-5 pb-5 space-y-3">{children}</div>
    </details>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <p className="min-w-0">
      <span className="text-content-muted">{label}:</span>{' '}
      <span className={`text-content ${mono ? 'font-mono text-xs' : ''}`}>{value || '—'}</span>
    </p>
  );
}

function HeatFact({ level }: { level: number | null }) {
  return (
    <p className="flex items-center gap-1">
      <span className="text-content-muted text-sm">Heat:</span>
      {level
        ? Array.from({ length: level }, (_, i) => <Flame key={i} className="w-3.5 h-3.5 text-orange-500 fill-orange-400" />)
        : <span className="text-content text-sm">—</span>}
    </p>
  );
}

function Field({ label, value, multiline, copyable }: { label: string; value: string | null; multiline?: boolean; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) {
    return label ? <p className="text-sm"><span className="text-content-muted">{label}:</span> <span className="text-content-faint">—</span></p> : null;
  }
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        {label && <span className="text-xs font-medium text-content-muted uppercase tracking-wide">{label}</span>}
        {copyable && (
          <button
            onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="p-1 rounded text-content-faint hover:text-content-secondary"
            title="Copy"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      <p className={`text-sm text-content ${multiline ? 'whitespace-pre-wrap' : ''}`}>{value}</p>
    </div>
  );
}

// ---------------- Manuscript -> catalog autofill ----------------

type FieldKey = 'subgenre' | 'heat_level' | 'tropes' | 'kinks' | 'content_warnings' | 'amazon_keywords' | 'blurb_draft';

function AutofillPanel({ book, onApply }: { book: Book; onApply: (patch: BookUpdate) => Promise<void> }) {
  const { user } = useAuth();
  const [manuscript, setManuscript] = useState<Manuscript | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [proposals, setProposals] = useState<CatalogProposals | null>(null);
  const [accepted, setAccepted] = useState<Set<FieldKey>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getManuscriptForBook(user.id, book.id)
      .then(m => { if (!cancelled) setManuscript(m); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [user, book.id]);

  const rows = useMemo(() => {
    if (!proposals) return [];
    const def: Array<{ key: FieldKey; label: string; current: string; proposed: string; skip?: boolean }> = [
      { key: 'subgenre', label: 'Subgenre', current: book.subgenre ?? '—', proposed: proposals.subgenre },
      { key: 'heat_level', label: 'Heat level', current: book.heat_level ? `${book.heat_level}/5` : '—', proposed: `${proposals.heat_level}/5` },
      { key: 'tropes', label: 'Tropes', current: book.tropes.join(', ') || '—', proposed: (proposals.tropes ?? []).join(', ') },
      { key: 'kinks', label: 'Kinks / spice', current: book.kinks ?? '—', proposed: proposals.kinks },
      { key: 'content_warnings', label: 'Content warnings', current: book.content_warnings ?? '—', proposed: proposals.content_warnings },
      { key: 'amazon_keywords', label: 'Amazon keywords', current: book.amazon_keywords.join(', ') || '—', proposed: (proposals.amazon_keywords ?? []).join(', ') },
      { key: 'blurb_draft', label: book.blurb ? 'Blurb (kept — you already have one)' : 'Blurb DRAFT', current: book.blurb ? '(existing blurb kept)' : '—', proposed: proposals.blurb_draft, skip: !!book.blurb },
    ];
    return def.filter(r => r.proposed && r.proposed !== '—');
  }, [proposals, book]);

  if (!user || !manuscript) return null;

  async function analyze() {
    setError(null);
    setProposals(null);
    try {
      const chapters = await getManuscriptChapters(user!.id, manuscript!.id);
      if (!chapters.length) throw new Error('The linked manuscript has no chapters.');
      const notes: string[] = [];
      for (let i = 0; i < chapters.length; i++) {
        setProgress(`Reading chapter ${i + 1} of ${chapters.length}…`);
        const doc = new DOMParser().parseFromString(chapters[i].content_html, 'text/html');
        const text = (doc.body.textContent ?? '').trim();
        if (text.length < 200) continue;
        const raw = await runTask({
          userId: user!.id, task: 'catalog',
          prompt: buildCatalogChapterPrompt(chapters[i].title, i, text.slice(0, 50000)),
          maxTokens: 512,
        });
        try { notes.push(parseJsonResponse<{ notes: string }>(raw).notes); }
        catch { notes.push(raw.slice(0, 400)); }
      }
      setProgress('Synthesizing catalog facts…');
      const out = await runJsonTask<CatalogProposals>({
        userId: user!.id, task: 'catalog',
        prompt: buildCatalogSynthesisPrompt(book.title, notes),
        maxTokens: 2048,
      });
      setProposals(out);
      setAccepted(new Set());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
    }
  }

  async function applyAccepted() {
    if (!proposals) return;
    setApplying(true);
    setError(null);
    try {
      const patch: BookUpdate = {};
      if (accepted.has('subgenre')) patch.subgenre = proposals.subgenre;
      if (accepted.has('heat_level')) patch.heat_level = Math.min(5, Math.max(1, Math.round(proposals.heat_level)));
      if (accepted.has('tropes')) patch.tropes = [...new Set([...book.tropes, ...(proposals.tropes ?? [])])];
      if (accepted.has('kinks')) patch.kinks = proposals.kinks;
      if (accepted.has('content_warnings')) patch.content_warnings = proposals.content_warnings;
      if (accepted.has('amazon_keywords')) patch.amazon_keywords = [...new Set([...book.amazon_keywords, ...(proposals.amazon_keywords ?? [])])];
      if (accepted.has('blurb_draft') && !book.blurb) patch.blurb = proposals.blurb_draft;
      await onApply(patch);
      setProposals(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="bg-surface rounded-card border border-edge p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-content flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-500" /> Fill from manuscript
          </h3>
          <p className="text-xs text-content-secondary mt-0.5">
            Scans "{manuscript.title}" and proposes tropes, heat, subgenre, warnings, keywords, and a draft blurb. Nothing is written until you accept it.
          </p>
        </div>
        {!progress && !proposals && (
          <button onClick={analyze}
            className="px-4 py-2 rounded-control bg-brand-600 text-brand-fg text-sm font-medium hover:bg-brand-700 flex items-center gap-2">
            <Wand2 className="w-4 h-4" /> Analyze manuscript
          </button>
        )}
      </div>

      {progress && <p className="text-xs text-content-secondary mt-3 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {progress}</p>}
      {error && <p className="text-xs text-rose-600 mt-3">{error}</p>}

      {proposals && (
        <div className="mt-4 space-y-2">
          {(proposals.comp_authors ?? []).length > 0 && (
            <p className="text-xs text-content-secondary">
              <span className="font-medium">Comp authors (for your ads/notes):</span> {(proposals.comp_authors ?? []).join(', ')}
            </p>
          )}
          {rows.map(r => (
            <label key={r.key} className={`flex items-start gap-3 p-3 rounded-control border cursor-pointer ${r.skip ? 'opacity-50 pointer-events-none border-edge-soft' : accepted.has(r.key) ? 'border-brand-300 bg-brand-50/40' : 'border-edge'}`}>
              <input
                type="checkbox"
                className="mt-1"
                disabled={r.skip}
                checked={accepted.has(r.key)}
                onChange={() => setAccepted(prev => { const s = new Set(prev); if (s.has(r.key)) s.delete(r.key); else s.add(r.key); return s; })}
              />
              <span className="min-w-0 text-xs">
                <span className="block font-medium text-content">{r.label}</span>
                <span className="block text-content-muted mt-0.5">Current: {r.current.slice(0, 140)}</span>
                <span className="block text-content mt-0.5 whitespace-pre-wrap">Proposed: {r.proposed.slice(0, 600)}</span>
              </span>
            </label>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <button onClick={applyAccepted} disabled={applying || accepted.size === 0}
              className="px-4 py-2 rounded-control bg-brand-600 text-brand-fg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2">
              {applying && <Loader2 className="w-4 h-4 animate-spin" />} Apply {accepted.size} accepted
            </button>
            <button onClick={() => setProposals(null)} className="text-sm text-content-secondary hover:text-content">Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
