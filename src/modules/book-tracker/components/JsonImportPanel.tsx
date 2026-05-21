import { useRef, useState, type ChangeEvent } from 'react';
import { Upload, ArrowLeft, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { usePenNames } from '../../../contexts/PenNameContext';
import { penNameClasses } from '../../../components/PenNameChip';
import { parseLegacyExport, type ParseResult } from '../import';
import { importLegacyBooks } from '../api';

interface Props {
  onBack: () => void;
  onComplete: () => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'previewed'; rawText: string; result: ParseResult }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'done'; msg: string }
  | { kind: 'error'; msg: string };

export default function JsonImportPanel({ onBack, onComplete }: Props) {
  const { user } = useAuth();
  const { penNames, selectedPenNameId } = usePenNames();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // Pen name to assign to any *new* Catalog books created during import.
  // Defaults to the active header selection so it matches the user's
  // current working context. Books matched by legacy_id or by Catalog
  // title keep their existing pen name.
  const [importPenNameId, setImportPenNameId] = useState<string | null>(selectedPenNameId);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    try {
      const rawText = await file.text();
      const raw = JSON.parse(rawText);
      const result = parseLegacyExport(raw);
      setPhase({ kind: 'previewed', rawText, result });
    } catch (err: any) {
      setPhase({ kind: 'error', msg: `Couldn't read that file: ${err?.message ?? err}` });
    }
  }

  async function handleImport() {
    if (phase.kind !== 'previewed' || !user) return;
    const { result } = phase;
    setPhase({ kind: 'importing', done: 0, total: result.parsed.length });
    try {
      const r = await importLegacyBooks(user.id, result.parsed, importPenNameId, (done, total) => {
        setPhase({ kind: 'importing', done, total });
      });
      const catalogNote = r.catalogCreated > 0 ? ` Created ${r.catalogCreated} new Catalog entries.` : '';
      setPhase({
        kind: 'done',
        msg: `Imported ${r.booksWritten} books (${r.booksInserted} new, ${r.booksUpdated} updated) with ${r.updatesWritten} quarterly entries.${catalogNote}`,
      });
      onComplete();
    } catch (err: any) {
      setPhase({ kind: 'error', msg: err?.message ?? String(err) });
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Book Tracker
      </button>

      <h1 className="text-2xl font-bold text-slate-800 mb-2">Import legacy export</h1>
      <p className="text-sm text-slate-500 mb-6">
        Upload the JSON file from your old book tracker. We'll preview the records before writing
        anything, and re-importing the same file updates existing books rather than duplicating them.
      </p>

      {phase.kind === 'idle' && (
        <div className="bg-white rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center">
          <Upload className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-600 mb-4">Choose your legacy JSON export</p>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFile}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700"
          >
            Choose file…
          </button>
        </div>
      )}

      {phase.kind === 'previewed' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h2 className="font-semibold text-slate-800 mb-3">Preview</h2>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <Stat label="Active" value={phase.result.summary.active} />
              <Stat label="Paid off" value={phase.result.summary.paidOff} />
              <Stat label="Quarterly updates" value={phase.result.summary.totalUpdates} />
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Pen name for new books
              </label>
              <p className="text-xs text-slate-500 mb-2">
                Any imported title that isn't already in Catalog will be created and attached to this pen name. Books that already exist by title or legacy id keep their current attribution.
              </p>
              {penNames.length === 0 ? (
                <p className="text-sm text-slate-500 italic">
                  No pen names yet — imported books will be unassigned. Add pen names in{' '}
                  <a href="/settings" className="text-purple-600 hover:underline">Settings</a>{' '}
                  and re-run the import to attribute them.
                </p>
              ) : (
                <select
                  value={importPenNameId ?? ''}
                  onChange={e => setImportPenNameId(e.target.value || null)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="">— Unassigned —</option>
                  {penNames.map(pn => (
                    <option key={pn.id} value={pn.id}>{pn.name}</option>
                  ))}
                </select>
              )}
              {importPenNameId && (() => {
                const pn = penNames.find(p => p.id === importPenNameId);
                if (!pn) return null;
                const c = penNameClasses(pn.color);
                return (
                  <span className={`mt-2 inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} /> New books → {pn.name}
                  </span>
                );
              })()}
            </div>

            {phase.result.summary.warnings.length > 0 && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-800">
                  <p className="font-medium mb-1">{phase.result.summary.warnings.length} warning(s):</p>
                  <ul className="space-y-0.5 list-disc list-inside">
                    {phase.result.summary.warnings.slice(0, 8).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                    {phase.result.summary.warnings.length > 8 && <li>… and more</li>}
                  </ul>
                </div>
              </div>
            )}

            <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Dev cost</th>
                    <th className="px-3 py-2 text-right">Updates</th>
                  </tr>
                </thead>
                <tbody>
                  {phase.result.parsed.map((p, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">{p.book.title}</td>
                      <td className="px-3 py-1.5">{p.book.status === 'paid_off' ? 'Paid off' : 'Active'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">${(p.book.dev_cost ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right">{p.updates.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setPhase({ kind: 'idle' })}
              className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Choose a different file
            </button>
            <button
              onClick={handleImport}
              disabled={phase.result.parsed.length === 0}
              className="px-4 py-2 text-sm bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              Import {phase.result.parsed.length} books
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'importing' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-purple-600" />
          <span className="text-sm text-slate-700">
            Importing {phase.done} of {phase.total}…
          </span>
        </div>
      )}

      {phase.kind === 'done' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5" />
          <div>
            <p className="text-sm text-emerald-800">{phase.msg}</p>
            <button
              onClick={onBack}
              className="mt-3 px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
            >
              Back to Book Tracker
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5" />
          <div>
            <p className="text-sm text-rose-800">{phase.msg}</p>
            <button
              onClick={() => setPhase({ kind: 'idle' })}
              className="mt-3 px-3 py-1.5 text-sm border border-rose-300 text-rose-700 rounded-lg hover:bg-rose-100"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3 text-center">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-xl font-bold text-slate-800 mt-0.5">{value}</div>
    </div>
  );
}
