import { useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Upload, UserPlus, Users } from 'lucide-react';
import type { Book } from '../../catalog/types';
import {
  applyApplicantDecisions, computeApplicantMatches, parseApplicantCsv,
  type ApplicantRow, type ApplySummary, type Decision, type MatchPreview,
  REASON_LABELS,
} from '../applicant-import';
import type { ArcReader, ArcStatus } from '../types';
import { STATUS_LABELS, STATUS_ORDER } from '../types';

type Stage = 'upload' | 'review' | 'done';

interface Props {
  userId: string;
  catalogBooks: Book[];
  onImported: () => void;
}

export default function AddApplicantsPanel({ userId, catalogBooks, onImported }: Props) {
  const [stage, setStage] = useState<Stage>('upload');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [book, setBook] = useState('');
  const [customBook, setCustomBook] = useState('');
  const [batchStatus, setBatchStatus] = useState<ArcStatus>('new');
  const [csvRows, setCsvRows] = useState<ApplicantRow[]>([]);
  const [detected, setDetected] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<MatchPreview[]>([]);
  const [existingReaders, setExistingReaders] = useState<ArcReader[]>([]);
  const [decisions, setDecisions] = useState<Map<number, Decision>>(new Map());
  const [summary, setSummary] = useState<ApplySummary | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const effectiveBook = customBook.trim() || book.trim() || '';

  function reset() {
    setStage('upload');
    setBusy(false);
    setError(null);
    setBook('');
    setCustomBook('');
    setBatchStatus('new');
    setCsvRows([]);
    setDetected({});
    setPreviews([]);
    setExistingReaders([]);
    setDecisions(new Map());
    setSummary(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function onCsv(file: File) {
    if (!effectiveBook) {
      setError('Pick (or type) the book applicants are applying for before uploading.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      const { rows, detectedColumns, missingNameColumn } = parseApplicantCsv(text);
      if (missingNameColumn) {
        setError('Could not find a name column in the CSV. Expected headers like "Name", "Full Name", or similar.');
        return;
      }
      if (rows.length === 0) {
        setError('CSV had a name column but no data rows.');
        return;
      }
      setCsvRows(rows);
      setDetected(detectedColumns as Record<string, string>);
      const { previews, readers } = await computeApplicantMatches(userId, rows);
      setExistingReaders(readers);
      setPreviews(previews);

      // Seed decisions from suggestions.
      const seed = new Map<number, Decision>();
      for (const p of previews) {
        if (p.suggestedDecision === 'merge' && p.suggestedReaderId) {
          seed.set(p.applicant.rowIndex, {
            kind: 'merge',
            rowIndex: p.applicant.rowIndex,
            readerId: p.suggestedReaderId,
          });
        } else {
          seed.set(p.applicant.rowIndex, { kind: 'create', rowIndex: p.applicant.rowIndex });
        }
      }
      setDecisions(seed);
      setStage('review');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function setDecision(rowIndex: number, value: string) {
    setDecisions(prev => {
      const next = new Map(prev);
      if (value === 'skip') next.set(rowIndex, { kind: 'skip', rowIndex });
      else if (value === 'create') next.set(rowIndex, { kind: 'create', rowIndex });
      else next.set(rowIndex, { kind: 'merge', rowIndex, readerId: value });
      return next;
    });
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const result = await applyApplicantDecisions(
        userId,
        Array.from(decisions.values()),
        csvRows,
        existingReaders,
        effectiveBook,
        batchStatus,
      );
      setSummary(result);
      setStage('done');
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    let create = 0;
    let merge = 0;
    let skip = 0;
    for (const d of decisions.values()) {
      if (d.kind === 'create') create++;
      else if (d.kind === 'merge') merge++;
      else skip++;
    }
    return { create, merge, skip };
  }, [decisions]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <UserPlus className="w-4 h-4" /> Add new applicants
        </h3>
        {stage !== 'upload' && (
          <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-800">
            Start over
          </button>
        )}
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Upload a CSV from your applicant form (Tally, Google Form, Notion, etc.). Each row
        becomes either a new reader, or a merge into an existing one — you'll review every
        decision before anything is written.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {stage === 'upload' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Book they're applying for
              </label>
              <select
                value={book}
                onChange={e => { setBook(e.target.value); setCustomBook(''); }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">— Pick from Catalog —</option>
                {catalogBooks.map(b => (
                  <option key={b.id} value={b.title}>{b.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                …or type a title
              </label>
              <input
                value={customBook}
                onChange={e => { setCustomBook(e.target.value); if (e.target.value) setBook(''); }}
                placeholder="e.g. My Vicious Beast"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Status for everyone in this CSV
            </label>
            <select
              value={batchStatus}
              onChange={e => setBatchStatus(e.target.value as ArcStatus)}
              className="w-full md:w-1/2 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              {STATUS_ORDER.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Default <strong>New</strong> — auto-advances to Awaiting ARC once the book is on
              their record. Pick <strong>Didn't download</strong>, <strong>Didn't review</strong>,
              etc. to tag the whole batch. Existing readers already tagged with one of those
              decisions won't get overwritten.
            </p>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onCsv(f); }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy || !effectiveBook}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded-lg"
          >
            <Upload className="w-4 h-4" /> {busy ? 'Parsing…' : 'Choose applicant CSV'}
          </button>
          <p className="text-xs text-slate-500">
            We'll look for headers like <code>Name</code>, <code>Email</code>, <code>Instagram</code>,
            etc. (case-insensitive). Other columns are ignored.
          </p>
        </div>
      )}

      {stage === 'review' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div>
              <strong>{previews.length}</strong> applicants for{' '}
              <span className="text-indigo-700 font-medium">{effectiveBook}</span>
            </div>
            <div className="text-xs text-slate-500">
              {counts.create} new · {counts.merge} merging · {counts.skip} skipping
            </div>
            <button
              onClick={apply}
              disabled={busy}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded-lg"
            >
              {busy ? 'Applying…' : 'Apply decisions'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {Object.keys(detected).length > 0 && (
            <p className="text-xs text-slate-500">
              Mapped columns:{' '}
              {Object.entries(detected).map(([k, v]) => (
                <span key={k} className="inline-block mr-2">
                  <code>{v}</code> → <em>{k}</em>
                </span>
              ))}
            </p>
          )}

          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-auto max-h-[640px]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Applicant</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Match candidates</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600 w-56">Decision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {previews.map(p => {
                    const decision = decisions.get(p.applicant.rowIndex);
                    const value =
                      decision?.kind === 'skip' ? 'skip'
                        : decision?.kind === 'merge' ? decision.readerId
                          : 'create';
                    return (
                      <tr key={p.applicant.rowIndex}>
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium text-slate-800">{p.applicant.name}</div>
                          {p.applicant.email && <div className="text-xs text-slate-500">{p.applicant.email}</div>}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {p.candidates.length === 0 ? (
                            <span className="text-xs text-slate-400">No matches — looks new</span>
                          ) : (
                            <ul className="space-y-1">
                              {p.candidates.map(c => (
                                <li key={c.readerId} className="text-xs">
                                  <span className="font-medium text-slate-800">{c.readerName}</span>
                                  {c.readerEmail && <span className="text-slate-500"> · {c.readerEmail}</span>}
                                  <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                    {REASON_LABELS[c.reason]} · {Math.round(c.confidence * 100)}%
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <select
                            value={value}
                            onChange={e => setDecision(p.applicant.rowIndex, e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs bg-white"
                          >
                            <option value="create">Create new reader</option>
                            {p.candidates.map(c => (
                              <option key={c.readerId} value={c.readerId}>
                                Merge with {c.readerName}
                              </option>
                            ))}
                            <option value="skip">Skip</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {stage === 'done' && summary && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          <div className="flex items-center gap-2 font-medium mb-1">
            <CheckCircle2 className="w-4 h-4" /> Applied
          </div>
          <ul className="space-y-0.5 text-xs">
            <li>Created: <strong>{summary.created}</strong></li>
            <li>Merged: <strong>{summary.merged}</strong></li>
            {summary.skipped > 0 && <li>Skipped: {summary.skipped}</li>}
            {summary.errors.length > 0 && (
              <li className="text-rose-700">
                Errors ({summary.errors.length}):
                <ul className="list-disc ml-5">
                  {summary.errors.slice(0, 10).map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              </li>
            )}
          </ul>
          <button
            onClick={reset}
            className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-50 rounded-lg"
          >
            <Users className="w-4 h-4" /> Import another batch
          </button>
        </div>
      )}
    </div>
  );
}
