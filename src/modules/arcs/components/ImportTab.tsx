import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, FileType2, Upload } from 'lucide-react';
import {
  backfillNotesByName, importNotionJson, parseNotionCsv,
  type ImportSummary, type NotesBackfillEntry, type NotesBackfillSummary, type NotionArcRow,
} from '../api';
import { parseNotionMarkdown } from '../notion-md';

interface Props {
  userId: string;
  onImported: () => void;
}

export default function ImportTab({ userId, onImported }: Props) {
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  async function runJson() {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const parsed = JSON.parse(json) as NotionArcRow[] | { rows: NotionArcRow[] };
      const rows = Array.isArray(parsed) ? parsed : parsed.rows ?? [];
      if (!Array.isArray(rows) || rows.length === 0) {
        setError('JSON should be an array of reader rows (or { "rows": [...] }).');
        return;
      }
      const s = await importNotionJson(userId, rows);
      setSummary(s);
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onCsv(file: File) {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const text = await file.text();
      const rows = parseNotionCsv(text);
      if (rows.length === 0) {
        setError('No data rows found in CSV.');
        return;
      }
      const s = await importNotionJson(userId, rows);
      setSummary(s);
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (csvRef.current) csvRef.current.value = '';
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-800 mb-1">Import from Notion</h3>
        <p className="text-sm text-slate-500 mb-4">
          Two paths — pick whichever's easier. Both upsert by Notion page ID, then by email, then
          by name, so re-imports refresh fields without duplicating rows.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* JSON */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Paste JSON
            </h4>
            <textarea
              rows={8}
              value={json}
              onChange={e => setJson(e.target.value)}
              placeholder={'[\n  { "Name": "Crystal Henderson", "Email Address": "...", "Status": "Current ARC Member", "Application for": ["My Vicious Beast"] }\n]'}
              className="w-full font-mono text-xs rounded-lg border border-slate-300 px-3 py-2 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
            />
            <button
              type="button"
              onClick={runJson}
              disabled={busy || !json.trim()}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded-lg"
            >
              <Upload className="w-4 h-4" /> Import JSON
            </button>
          </div>

          {/* CSV */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Upload Notion CSV
            </h4>
            <p className="text-xs text-slate-500">
              In Notion: click the database "..." menu → Export → CSV. Drop the file here.
            </p>
            <input
              ref={csvRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onCsv(f); }}
            />
            <button
              type="button"
              onClick={() => csvRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
            >
              <Upload className="w-4 h-4" /> Choose CSV file
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}
        {summary && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
            <div className="flex items-center gap-2 font-medium mb-1">
              <CheckCircle2 className="w-4 h-4" /> Import complete
            </div>
            <ul className="space-y-0.5 text-xs">
              <li>Inserted: <strong>{summary.inserted}</strong></li>
              <li>Updated: <strong>{summary.updated}</strong></li>
              {summary.skipped > 0 && <li>Skipped (missing name): {summary.skipped}</li>}
              {summary.errors.length > 0 && (
                <li className="text-rose-700">
                  Errors ({summary.errors.length}):
                  <ul className="list-disc ml-5">{summary.errors.slice(0, 5).map((m, i) => <li key={i}>{m}</li>)}</ul>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      <BackfillNotesPanel userId={userId} onImported={onImported} />
    </div>
  );
}

function BackfillNotesPanel({ userId, onImported }: { userId: string; onImported: () => void }) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<NotesBackfillSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const mdRef = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList) {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const entries: NotesBackfillEntry[] = [];
      for (const file of Array.from(files)) {
        const text = await file.text();
        const parsed = parseNotionMarkdown(text);
        if (parsed) entries.push(parsed);
      }
      setFileCount(entries.length);
      if (entries.length === 0) {
        setError('No parseable markdown files found.');
        return;
      }
      const s = await backfillNotesByName(userId, entries);
      setSummary(s);
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (mdRef.current) mdRef.current.value = '';
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <h3 className="font-semibold text-slate-800 mb-1 flex items-center gap-2">
        <FileType2 className="w-4 h-4" /> Backfill notes from Notion Markdown export
      </h3>
      <p className="text-sm text-slate-500 mb-4">
        In Notion: export the ARC database as <strong>"Markdown &amp; CSV"</strong> and unzip
        the result. Then select <strong>every <code>.md</code> file</strong> from the export folder
        below (shift-click to multi-select). Each file becomes one reader's notes; rows are matched
        by exact name. Notes only — your other fields stay untouched.
      </p>

      <input
        ref={mdRef}
        type="file"
        multiple
        accept=".md,text/markdown"
        className="hidden"
        onChange={e => { if (e.target.files?.length) onFiles(e.target.files); }}
      />
      <button
        type="button"
        onClick={() => mdRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg"
      >
        <Upload className="w-4 h-4" /> Select .md files
      </button>

      {busy && <p className="mt-3 text-xs text-slate-500">Parsing files and writing notes — this can take a moment for hundreds of files.</p>}

      {error && (
        <div className="mt-3 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {summary && (
        <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          <div className="flex items-center gap-2 font-medium mb-1">
            <CheckCircle2 className="w-4 h-4" /> Backfill complete
          </div>
          <ul className="space-y-0.5 text-xs">
            <li>Files parsed: <strong>{fileCount}</strong></li>
            <li>Notes written: <strong>{summary.matched}</strong></li>
            {summary.skippedEmpty > 0 && (
              <li>Skipped (no body content): <strong>{summary.skippedEmpty}</strong></li>
            )}
            {summary.unmatched.length > 0 && (
              <li className="text-amber-700">
                Unmatched names ({summary.unmatched.length}) — these readers exist in your export but
                no row in your ARCs table has that exact name:
                <ul className="list-disc ml-5 max-h-40 overflow-auto">
                  {summary.unmatched.slice(0, 25).map((n, i) => <li key={i}>{n}</li>)}
                  {summary.unmatched.length > 25 && <li className="italic">…and {summary.unmatched.length - 25} more</li>}
                </ul>
              </li>
            )}
            {summary.errors.length > 0 && (
              <li className="text-rose-700">
                Errors ({summary.errors.length}):
                <ul className="list-disc ml-5">
                  {summary.errors.slice(0, 5).map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
