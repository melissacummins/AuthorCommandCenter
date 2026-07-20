import { useRef, useState } from 'react';
import {
  Upload,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { planImport, executeImport, type ImportPlan } from '../utils/firebaseImport';
import type { AppDataBackup } from '../types';

type Phase =
  | { kind: 'idle' }
  | { kind: 'parsed'; backup: AppDataBackup; plan: ImportPlan }
  | { kind: 'running'; msg: string }
  | { kind: 'done'; plan: ImportPlan }
  | { kind: 'error'; msg: string };

export default function FirebaseImport() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    setPhase({ kind: 'running', msg: 'Reading backup file…' });
    try {
      const text = await file.text();
      const backup = JSON.parse(text) as AppDataBackup;
      if (!backup.dailyRecords && !backup.monthlyOrders && !backup.orderSources) {
        throw new Error(
          "This doesn't look like a ProfitTrack backup (missing expected fields).",
        );
      }
      setPhase({ kind: 'running', msg: 'Planning import…' });
      const plan = await planImport(backup);
      setPhase({ kind: 'parsed', backup, plan });
    } catch (err: any) {
      setPhase({ kind: 'error', msg: err.message || 'Failed to read backup.' });
    }
  };

  const handleExecute = async () => {
    if (phase.kind !== 'parsed') return;
    setPhase({ kind: 'running', msg: 'Starting import…' });
    try {
      const result = await executeImport(phase.backup, (p) =>
        setPhase({
          kind: 'running',
          msg: `Importing ${p.table}: ${p.inserted.toLocaleString()} rows…`,
        }),
      );
      setPhase({ kind: 'done', plan: result });
    } catch (err: any) {
      setPhase({ kind: 'error', msg: err.message || 'Import failed.' });
    }
  };

  const cancel = () => setPhase({ kind: 'idle' });

  return (
    <div className="bg-surface p-6 rounded-card shadow-sm border border-edge-soft space-y-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-content">
            Import from original ProfitTrack backup
          </h3>
          <p className="text-sm text-content-secondary mt-1">
            Upload the JSON file you exported from the Firebase-era ProfitTrack
            app. This tool <strong className="text-content">only adds</strong>{' '}
            rows that are missing from your current data — it will never delete
            or overwrite anything you've entered recently.
          </p>
          <ul className="text-xs text-content-secondary mt-2 list-disc pl-5 space-y-0.5">
            <li>Daily records with dates you already have are skipped.</li>
            <li>Order sources with matching names are reused (bundles, Amazon, etc.).</li>
            <li>Monthly orders and page reads are only added for missing months.</li>
            <li>Books are matched by title + language.</li>
          </ul>
        </div>
      </div>

      {phase.kind === 'idle' && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChosen}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 border border-edge-strong text-content text-sm font-medium rounded-control hover:bg-surface-hover"
          >
            <Upload className="w-4 h-4" />
            Choose backup file…
          </button>
        </div>
      )}

      {phase.kind === 'running' && (
        <div className="flex items-center gap-3 bg-surface-hover border border-edge rounded-control p-4 text-sm text-content">
          <Loader2 className="w-4 h-4 animate-spin" />
          {phase.msg}
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-control p-4 text-sm text-red-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">{phase.msg}</div>
          <button
            onClick={cancel}
            className="text-red-800 underline text-xs"
          >
            Start over
          </button>
        </div>
      )}

      {phase.kind === 'parsed' && (
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-control p-4">
            <p className="text-sm font-medium text-emerald-800 mb-3">
              Backup parsed. Here's what will happen when you click Import:
            </p>
            <PlanTable plan={phase.plan} />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExecute}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm font-medium rounded-control hover:bg-emerald-700 shadow-sm"
            >
              <CheckCircle className="w-4 h-4" />
              Import now
            </button>
            <button
              onClick={cancel}
              className="px-4 py-2 text-sm text-content-secondary hover:text-content"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'done' && (
        <div className="space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-control p-4 flex items-start gap-3">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-800">
              <p className="font-medium mb-2">Import complete.</p>
              <PlanTable plan={phase.plan} />
              <p className="mt-3 text-emerald-700">
                Refresh the page to see the restored data.
              </p>
            </div>
          </div>
          <button
            onClick={cancel}
            className="px-4 py-2 text-sm text-content-secondary hover:text-content"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function PlanTable({ plan }: { plan: ImportPlan }) {
  const rows: Array<[string, { toInsert: number; skipped: number }]> = [
    ['Order sources (bundles, platforms)', plan.orderSources],
    ['Books & bundles', plan.bookProducts],
    ['Monthly orders', plan.monthlyOrders],
    ['Monthly page reads', plan.monthlyPageReads],
    ['Daily records', plan.dailyRecords],
    ['Weekly notes', plan.weeklyNotes],
    ['Book daily metrics', plan.bookMetrics],
  ];
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-content-secondary">
          <th className="text-left font-medium py-1">Table</th>
          <th className="text-right font-medium py-1">Will add</th>
          <th className="text-right font-medium py-1">Already present</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, r]) => (
          <tr key={label} className="border-t border-emerald-100">
            <td className="py-1">{label}</td>
            <td className="text-right font-semibold text-emerald-700">
              {r.toInsert.toLocaleString()}
            </td>
            <td className="text-right text-content-secondary">
              {r.skipped.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
