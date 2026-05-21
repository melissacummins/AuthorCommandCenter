import { useRef, useState } from 'react';
import {
  Download,
  Upload,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import {
  createBackup,
  downloadBackup,
  restoreBackup,
  recordBackupDownloaded,
  getLastBackupAt,
  daysSinceLastBackup,
} from './backup';
import type { BackupFile } from './tables';
import KlaviyoSection from './KlaviyoSection';
import PenNamesSection from './PenNamesSection';

type Status = { kind: 'idle' } | { kind: 'busy'; msg: string } | { kind: 'ok'; msg: string } | { kind: 'error'; msg: string };

export default function SettingsModule() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [lastBackup, setLastBackup] = useState<Date | null>(getLastBackupAt());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const daysAgo = daysSinceLastBackup();

  const handleDownload = async () => {
    setStatus({ kind: 'busy', msg: 'Preparing backup…' });
    try {
      const backup = await createBackup((msg) =>
        setStatus({ kind: 'busy', msg }),
      );
      downloadBackup(backup);
      recordBackupDownloaded();
      setLastBackup(new Date());
      const total = Object.values(backup.tables).reduce(
        (n, rows) => n + rows.length,
        0,
      );
      setStatus({
        kind: 'ok',
        msg: `Downloaded backup with ${total.toLocaleString()} rows across ${Object.keys(backup.tables).length} tables.`,
      });
    } catch (err: any) {
      setStatus({ kind: 'error', msg: err.message || 'Backup failed.' });
    }
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    let backup: BackupFile;
    try {
      const text = await file.text();
      backup = JSON.parse(text) as BackupFile;
      if (!backup.schema_version || !backup.tables) {
        throw new Error('File is missing required fields.');
      }
    } catch (err: any) {
      setStatus({
        kind: 'error',
        msg: `That doesn't look like a valid backup file: ${err.message}`,
      });
      return;
    }

    const totalRows = Object.values(backup.tables).reduce(
      (n, rows) => n + (rows?.length || 0),
      0,
    );
    const exportedAt = new Date(backup.exported_at).toLocaleString();
    const ok = confirm(
      `Restore this backup?\n\nExported: ${exportedAt}\nRows: ${totalRows.toLocaleString()}\n\nThis will DELETE all your current data in the Command Center and replace it with the backup. This cannot be undone.`,
    );
    if (!ok) return;

    const ok2 = confirm(
      `Last check: this will overwrite everything. Continue?`,
    );
    if (!ok2) return;

    setStatus({ kind: 'busy', msg: 'Restoring…' });
    try {
      const { rowsRestored } = await restoreBackup(backup, (p) => {
        setStatus({
          kind: 'busy',
          msg: `${p.action === 'deleting' ? 'Clearing' : 'Restoring'} ${p.table}${p.rowsWritten ? ` (${p.rowsWritten})` : ''}…`,
        });
      });
      setStatus({
        kind: 'ok',
        msg: `Restored ${rowsRestored.toLocaleString()} rows. Refresh the page to see your restored data.`,
      });
    } catch (err: any) {
      setStatus({ kind: 'error', msg: err.message || 'Restore failed.' });
    }
  };

  const isBusy = status.kind === 'busy';

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
        <p className="text-slate-500 text-sm mt-1">
          Manage your Command Center account and data.
        </p>
      </div>

      {/* Stale-backup warning */}
      {daysAgo !== null && daysAgo > 14 && (
        <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium">
              It's been {daysAgo} days since your last backup.
            </p>
            <p className="text-amber-700 mt-0.5">
              Download a fresh copy so you can recover if anything goes wrong.
            </p>
          </div>
        </div>
      )}

      <PenNamesSection />

      <KlaviyoSection />

      <section className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <h2 className="text-lg font-semibold text-slate-800">Backup & Restore</h2>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          Download a single JSON file containing everything in your Command Center — Inventory, Profit, Book Tracker, Ad Alchemy, FinStream, KDP, and more. You can restore from this file at any time.
        </p>

        {/* Status banner */}
        {status.kind !== 'idle' && (
          <div
            className={`mb-6 flex items-start gap-3 rounded-xl p-4 text-sm ${
              status.kind === 'ok'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : status.kind === 'error'
                  ? 'bg-red-50 border border-red-200 text-red-800'
                  : 'bg-slate-50 border border-slate-200 text-slate-700'
            }`}
          >
            {status.kind === 'busy' && (
              <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" />
            )}
            {status.kind === 'ok' && (
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            )}
            {status.kind === 'error' && (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            )}
            <span>{status.msg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Backup */}
          <div className="border border-slate-200 rounded-xl p-5">
            <h3 className="font-medium text-slate-800 mb-1">Download backup</h3>
            <p className="text-xs text-slate-500 mb-4">
              {lastBackup
                ? `Last downloaded ${lastBackup.toLocaleDateString()} on this browser.`
                : 'No backup downloaded yet from this browser.'}
            </p>
            <button
              onClick={handleDownload}
              disabled={isBusy}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <Download className="w-4 h-4" />
              Download backup
            </button>
          </div>

          {/* Restore */}
          <div className="border border-slate-200 rounded-xl p-5">
            <h3 className="font-medium text-slate-800 mb-1">Restore from file</h3>
            <p className="text-xs text-red-600 mb-4">
              Overwrites all current data — there is no undo.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileChosen}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              Choose backup file…
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
