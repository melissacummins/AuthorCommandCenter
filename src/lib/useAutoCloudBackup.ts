import { useEffect } from 'react';
import {
  connectedBackupServices,
  runCloudBackup,
  daysSinceCloudBackup,
} from './cloudBackup';

// How stale the last cloud backup must be before we auto-run one on app open.
const AUTO_INTERVAL_DAYS = 7;
// Let the app settle before kicking off background work.
const START_DELAY_MS = 8000;

// Only attempt once per tab load, even across route changes / re-renders.
let attemptedThisLoad = false;

// Opportunistic backup: when the app opens and it's been a while since the
// last successful cloud backup, quietly snapshot the DATABASE to whichever
// cloud is connected. Storage FILES are intentionally excluded here — they're
// captured by the manual "Back up now" button and the daily server cron, so
// re-downloading every asset on each app open would waste bandwidth for no
// gain. This is best-effort: any failure is swallowed, and the Settings
// stale-backup banner + manual button remain as the visible safety net.
export function useAutoCloudBackup(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || attemptedThisLoad) return;
    attemptedThisLoad = true;

    const days = daysSinceCloudBackup();
    if (days !== null && days < AUTO_INTERVAL_DAYS) return;

    const timer = window.setTimeout(async () => {
      try {
        const services = await connectedBackupServices();
        if (services.length === 0) return; // nothing connected — nothing to do
        await runCloudBackup({ service: services[0], includeFiles: false });
      } catch {
        /* best-effort — never surface an error for a background backup */
      }
    }, START_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [enabled]);
}
