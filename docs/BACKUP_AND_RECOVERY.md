# Backup & Recovery

This app protects two different things, in two different ways: your **app data**
(everything in Supabase) and your **code** (this GitHub repo). Here's what runs
automatically, what you can trigger by hand, and the one-time setup that turns
the automatic pieces on.

---

## 1. App data (Supabase → Dropbox / Google Drive)

Everything you type into the Command Center lives in Supabase. There are now
three layers of backup for it, all writing to the same place — an
**`Author Command Center/Backups/backup_<date>/`** folder in your connected
cloud, one folder per run:

| Layer | What it captures | When it runs | Where |
|---|---|---|---|
| **Manual "Back up to cloud"** button (Settings → Backup & Restore) | **Everything** — all tables **plus** Storage files (book covers, audiobook audio, generated media, logos) | When you click it | Browser → Dropbox/Drive |
| **Auto-on-open** | Database rows only (light, silent) | First app open after 7+ days since the last cloud backup | Browser → Dropbox/Drive |
| **Daily cron** | Database rows only | Every day, ~08:00 UTC, whether or not you open the app | Server → Dropbox/Drive |

Layout in the cloud:
- `Backups/backup_<date>/data.json` — every user-scoped table (see
  `src/modules/settings/tables.ts`), a fresh full snapshot each run.
- `Backups/backup_<date>/manifest.json` — counts, timestamp, and which files
  were uploaded / unchanged / skipped this run.
- `Backups/files/<bucket>/…` — a single **shared, incremental mirror** of your
  Storage files (manual backups only). Each run lists what's already there and
  only uploads files that are new or whose size changed, so media uploads once
  and a re-run resumes cleanly instead of re-hauling everything.

> Trade-off of the incremental mirror: it keeps the **latest** version of each
> file, not a separate copy inside every dated snapshot. That's the right call
> for append-mostly assets (covers, audio, generated media) and is what keeps
> cloud storage from ballooning.

**Why the cron is database-only:** a scheduled serverless function has a short
execution limit. Table rows serialize in a fraction of a second, but pulling
hundreds of MB of audiobook audio and media through it would time out. So the
cron guarantees a fresh daily copy of the irreplaceable *typed* data, and the
**manual button** is the one that also sweeps up the binary files. A good habit:
**click "Back up to cloud" before any big batch or risky change** (e.g. before
generating a new audiobook, or before a large import) — that's exactly the
"snapshot before I might break something" instinct, made one click.

### Restoring app data

Settings → Backup & Restore → **Choose backup file…**, and pick the `data.json`
from the backup folder you want. Restore **replaces** all current data for your
account (double-confirmed), inserting tables parent-first so foreign keys never
break. Backups from the old 35-table format (schema v1) still restore fine.

> Storage-file restore (re-uploading the `files/…` tree) is not yet a one-click
> action — the files are safely stored in the cloud; ask and we'll add a restore
> path when you actually need it.

### One-time setup for the daily cron

The cron is already scheduled in `vercel.json`. It needs one secret so only
Vercel can trigger it:

1. Vercel → your project → **Settings → Environment Variables**.
2. Add **`CRON_SECRET`** = a long random string (e.g. `openssl rand -hex 32`).
   Vercel automatically sends this back to the cron as a bearer token; the
   endpoint rejects anything else.
3. Confirm these already exist (they power the existing Dropbox/Drive export, so
   they should): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `GOOGLE_TOKEN_ENCRYPTION_SECRET`, `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
4. Redeploy. The cron shows up under Vercel → **Settings → Cron Jobs**.

**Cost:** a single daily cron is included on Vercel's free Hobby plan (up to 2
daily crons). No upgrade needed unless you want it running more often than once
a day.

---

## 2. Code (this repo)

GitHub is already a distributed copy of the code, but a bad force-push, an
accidental branch delete, or a destructive command can still hurt. Two
mitigations:

### a) Branch protection on `main` (do this — 5 minutes, no code)

GitHub → repo **Settings → Branches → Add branch ruleset** (or "Add rule") for
`main`, and enable:

- **Require a pull request before merging** (block direct pushes).
- **Block force pushes.**
- **Restrict deletions** (nobody can delete `main`).
- Optional: **Require status checks to pass** before merging.

This alone kills almost every "one command nuked it" scenario. A bad *merged* PR
is still fully recoverable with `git revert` — history is never lost.

### b) Weekly off-GitHub mirror (already added)

`.github/workflows/repo-backup.yml` runs every Sunday (and on-demand via
**Actions → Repo backup → Run workflow**). It builds a `git bundle` — a single
file with the **complete history of every branch** — and:

1. **Always** uploads it as a GitHub Actions artifact (kept 90 days).
2. **Also** uploads it to Dropbox at `Author Command Center/Code Backups/`, *if*
   the Dropbox secrets are set.

To restore from a bundle: `git clone authorcommandcenter_<date>.bundle restored/`.

**Optional — enable the Dropbox mirror** (so code sits next to your app data):

1. Create a long-lived Dropbox **refresh token** for the app. Easiest path:
   - Dropbox App Console → your app → **Permissions**: `files.content.write`.
   - Generate an authorization code with `token_access_type=offline`, then
     exchange it for a refresh token (same flow the app's `api/dropbox` uses).
     If you want, we can add a tiny `npm run dropbox:token` helper to spit one
     out.
2. GitHub → repo **Settings → Secrets and variables → Actions** → add:
   `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`.

Without those secrets the workflow still runs and keeps the GitHub artifact — so
you're covered either way.

---

## Quick checklist

- [ ] Set `CRON_SECRET` in Vercel and redeploy → daily data backups run.
- [ ] Turn on branch protection for `main` → code can't be force-pushed/deleted.
- [ ] (Optional) Add `DROPBOX_*` Action secrets → weekly code mirror lands in Dropbox.
- [ ] Habit: click **Back up to cloud** before big/risky batches for a full rows + files snapshot.
