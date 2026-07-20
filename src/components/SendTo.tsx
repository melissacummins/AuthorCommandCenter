// "Send to Drive / Dropbox" buttons for export surfaces. Renders the
// file(s) fresh at click time via the caller's getFiles, then uploads
// browser-direct with src/lib/cloudExport.
//
// If the service isn't connected yet we don't silently open an OAuth
// popup mid-flight (popup blockers eat windows opened after long async
// work) — we surface an inline Connect button whose own click starts
// the popup, then retry the send.

import { useState } from 'react';
import { Loader2, CloudUpload, Check } from 'lucide-react';
import {
  type CloudService, SERVICE_LABELS, CLOUD_FOLDER_NAME,
  uploadToCloud, connectDrive, connectDropbox, CloudNeedsConnect,
} from '../lib/cloudExport';

export interface SendToFile {
  blob: Blob;
  filename: string;
}

interface SendToProps {
  // Called at click time so the upload always reflects the latest edits.
  getFiles: () => Promise<SendToFile[]>;
  disabled?: boolean;
}

type SendState =
  | { phase: 'idle' }
  | { phase: 'sending'; service: CloudService; done: number; total: number }
  | { phase: 'sent'; service: CloudService; total: number; link: string | null }
  | { phase: 'needs-connect'; service: CloudService }
  | { phase: 'error'; message: string };

export default function SendTo({ getFiles, disabled }: SendToProps) {
  const [state, setState] = useState<SendState>({ phase: 'idle' });

  async function send(service: CloudService) {
    setState({ phase: 'sending', service, done: 0, total: 0 });
    try {
      const files = await getFiles();
      setState({ phase: 'sending', service, done: 0, total: files.length });
      let link: string | null = null;
      for (let i = 0; i < files.length; i++) {
        const result = await uploadToCloud(service, files[i].blob, files[i].filename);
        link = link ?? result.link;
        setState({ phase: 'sending', service, done: i + 1, total: files.length });
      }
      setState({ phase: 'sent', service, total: files.length, link });
    } catch (err) {
      if (err instanceof CloudNeedsConnect) {
        setState({ phase: 'needs-connect', service: err.service });
      } else {
        setState({ phase: 'error', message: (err as Error).message });
      }
    }
  }

  async function connectThenSend(service: CloudService) {
    try {
      if (service === 'drive') await connectDrive();
      else await connectDropbox();
    } catch (err) {
      setState({ phase: 'error', message: (err as Error).message });
      return;
    }
    await send(service);
  }

  const sending = state.phase === 'sending';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(['drive', 'dropbox'] as CloudService[]).map(service => (
        <button
          key={service}
          onClick={() => send(service)}
          disabled={disabled || sending}
          title={`Send to the "${CLOUD_FOLDER_NAME}" folder in your ${SERVICE_LABELS[service]}`}
          className="px-3 py-2 rounded-control border border-edge bg-surface text-content text-xs font-medium hover:bg-surface-hover disabled:opacity-50 flex items-center gap-1.5"
        >
          {sending && state.service === service
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <CloudUpload className="w-3.5 h-3.5" />}
          {SERVICE_LABELS[service]}
        </button>
      ))}

      {state.phase === 'sending' && state.total > 1 && (
        <span className="text-[11px] text-content-muted">{state.done}/{state.total}</span>
      )}
      {state.phase === 'sent' && (
        <span className="text-[11px] text-emerald-600 flex items-center gap-1">
          <Check className="w-3.5 h-3.5" />
          Sent {state.total > 1 ? `${state.total} files ` : ''}to {SERVICE_LABELS[state.service]}
          {state.link && (
            <a href={state.link} target="_blank" rel="noreferrer" className="underline hover:text-emerald-700">open</a>
          )}
        </span>
      )}
      {state.phase === 'needs-connect' && (
        <button
          onClick={() => connectThenSend(state.service)}
          className="px-2.5 py-1.5 rounded-control bg-brand-600 text-brand-fg text-[11px] font-medium hover:bg-brand-500"
        >
          Connect {SERVICE_LABELS[state.service]} & send
        </button>
      )}
      {state.phase === 'error' && (
        <span className="text-[11px] text-rose-600 max-w-64 truncate" title={state.message}>{state.message}</span>
      )}
    </div>
  );
}
