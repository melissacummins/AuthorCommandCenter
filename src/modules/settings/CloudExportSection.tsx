import { useEffect, useState } from 'react';
import { CloudUpload, Loader2 } from 'lucide-react';
import {
  type CloudService, type CloudStatus, SERVICE_LABELS, CLOUD_FOLDER_NAME,
  getDriveStatus, getDropboxStatus, connectDrive, connectDropbox,
  disconnectGoogle, disconnectDropbox,
} from '../../lib/cloudExport';

// Connect/disconnect for the Content Creator's "Send to Drive/Dropbox"
// export buttons. The tokens live server-side (encrypted refresh tokens);
// this section only shows status and runs the consent popups.
export default function CloudExportSection() {
  return (
    <section className="bg-surface rounded-card border border-edge p-6 mb-6">
      <div className="flex items-center gap-3 mb-2">
        <CloudUpload className="w-5 h-5 text-sky-600" />
        <h2 className="text-lg font-semibold text-content">Cloud Export</h2>
      </div>
      <p className="text-sm text-content-secondary mb-6">
        Connect Google Drive or Dropbox and the Content Creator's export buttons can send
        finished slides, screenshots, and videos straight to a{' '}
        <strong>"{CLOUD_FOLDER_NAME}"</strong> folder in your account. Google Drive access is
        limited to files this app creates — it can't see anything else in your Drive.
      </p>

      <div className="space-y-3">
        <ServiceRow
          service="drive"
          fetchStatus={getDriveStatus}
          onConnect={connectDrive}
          onDisconnect={disconnectGoogle}
          disconnectNote="Google Drive and Google Calendar share one Google connection — disconnecting here disconnects both. Continue?"
        />
        <ServiceRow
          service="dropbox"
          fetchStatus={getDropboxStatus}
          onConnect={connectDropbox}
          onDisconnect={disconnectDropbox}
        />
      </div>
    </section>
  );
}

function ServiceRow({ service, fetchStatus, onConnect, onDisconnect, disconnectNote }: {
  service: CloudService;
  fetchStatus: () => Promise<CloudStatus>;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  disconnectNote?: string;
}) {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setStatus(await fetchStatus());
    } catch (err) {
      // A missing server config (env vars not set yet) lands here — show
      // it instead of pretending to be disconnected.
      setError((err as Error).message);
      setStatus({ connected: false, email: null });
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConnect() {
    setBusy(true); setError(null);
    try {
      await onConnect();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (disconnectNote && !window.confirm(disconnectNote)) return;
    setBusy(true); setError(null);
    try {
      await onDisconnect();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-edge px-4 py-3">
      <div className="flex-1 min-w-40">
        <p className="text-sm font-medium text-content">{SERVICE_LABELS[service]}</p>
        {status === null ? (
          <p className="text-xs text-content-muted">Checking…</p>
        ) : status.connected ? (
          <p className="text-xs text-emerald-600">Connected{status.email ? ` as ${status.email}` : ''}</p>
        ) : (
          <p className="text-xs text-content-muted">Not connected</p>
        )}
        {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
      </div>
      {status?.connected ? (
        <button onClick={handleDisconnect} disabled={busy}
          className="px-3 py-2 rounded-control border border-edge-strong text-content-secondary text-xs font-medium hover:bg-surface-hover disabled:opacity-50 flex items-center gap-1.5">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Disconnect
        </button>
      ) : (
        <button onClick={handleConnect} disabled={busy || status === null}
          className="px-3 py-2 rounded-control bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-1.5">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Connect
        </button>
      )}
    </div>
  );
}
