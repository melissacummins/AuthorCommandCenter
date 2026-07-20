import { useState } from 'react';
import { Upload, AlertCircle, CheckCircle2 } from 'lucide-react';
import { importJson } from '../api';
import type { ImportJson, ImportSummary } from '../types';

interface Props {
  userId: string;
  onImported: () => void;
}

interface Parsed {
  data: ImportJson;
  counts: { tropes: number; keywords: number; books: number };
}

function tryParse(raw: string): { ok: true; parsed: Parsed } | { ok: false; error: string } {
  if (!raw.trim()) return { ok: false, error: 'Paste your JSON below.' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (!json || typeof json !== 'object') return { ok: false, error: 'Expected a JSON object.' };
  const data = json as ImportJson;
  if (!Array.isArray(data.tropes)) return { ok: false, error: 'Missing "tropes" array.' };
  if (!Array.isArray(data.keywords)) return { ok: false, error: 'Missing "keywords" array.' };
  if (!Array.isArray(data.books)) return { ok: false, error: 'Missing "books" array.' };

  return {
    ok: true,
    parsed: {
      data,
      counts: {
        tropes: data.tropes.length,
        keywords: data.keywords.length,
        books: data.books.length,
      },
    },
  };
}

export default function ImportTab({ userId, onImported }: Props) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  function validate() {
    const result = tryParse(text);
    if (result.ok) {
      setParsed(result.parsed);
      setError(null);
      setSummary(null);
    } else {
      // strictNullChecks is off in this project, which defeats the usual
      // discriminated-union narrowing here — assert the error variant.
      setParsed(null);
      setError((result as { ok: false; error: string }).error);
    }
  }

  async function runImport() {
    if (!parsed) return;
    setImporting(true);
    setError(null);
    try {
      const s = await importJson(userId, parsed.data);
      setSummary(s);
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-card border border-edge p-5">
        <h3 className="font-semibold text-content mb-1">Import KDP Optimizer data</h3>
        <p className="text-sm text-content-secondary mb-4">
          Paste the JSON export from your old KDP Optimizer below. Re-imports
          dedupe on the original IDs, so it's safe to run again to refresh
          search-volume metrics. Books match to your Catalog by exact title.
        </p>

        <textarea
          rows={10}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder='{ "books": [...], "tropes": [...], "keywords": [...] }'
          className="w-full font-mono text-xs rounded-control border border-edge-strong px-3 py-2 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
        />

        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={validate}
            className="px-4 py-2 text-sm font-medium text-content bg-surface border border-edge-strong hover:bg-surface-hover rounded-control"
          >
            Validate
          </button>
          <button
            type="button"
            onClick={runImport}
            disabled={!parsed || importing}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-brand-fg bg-brand-600 hover:bg-brand-700 disabled:bg-edge-strong rounded-control"
          >
            <Upload className="w-4 h-4" />
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>

        {error && (
          <div className="mt-3 p-3 rounded-control bg-rose-50 border border-rose-200 text-sm text-rose-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {parsed && !summary && (
          <div className="mt-3 p-3 rounded-control bg-surface-hover border border-edge text-sm text-content">
            Ready to import — <strong>{parsed.counts.tropes}</strong> tropes,{' '}
            <strong>{parsed.counts.keywords}</strong> keywords,{' '}
            <strong>{parsed.counts.books}</strong> books.
          </div>
        )}

        {summary && (
          <div className="mt-3 p-3 rounded-control bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
            <div className="flex items-center gap-2 font-medium mb-1">
              <CheckCircle2 className="w-4 h-4" /> Import complete
            </div>
            <ul className="space-y-0.5 text-xs">
              <li>Tropes: {summary.tropes.inserted} added, {summary.tropes.updated} updated</li>
              <li>Keywords: {summary.keywords.inserted} added, {summary.keywords.updated} updated</li>
              <li>Books: {summary.books.inserted} added, {summary.books.updated} updated</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
