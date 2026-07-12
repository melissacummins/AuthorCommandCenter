# Cloud Export setup (Google Drive + Dropbox)

The Content Creator's export surfaces (Slideshows, Kindle Screenshots, Video
Composer) have **Send to Google Drive** and **Send to Dropbox** buttons, and
Settings has a **Cloud Export** section for connecting/disconnecting. All the
code is in place — the only things that can't be automated are the two OAuth
app registrations, because they live in *your* Google and Dropbox developer
accounts. Here is exactly what to click.

Everything a user exports lands in a folder called **Author Command Center**
in their own Drive or Dropbox.

---

## 1. Google Drive (~5 minutes — extends the OAuth client you already have)

Drive reuses the Google OAuth client you created for the Calendar
integration, so there are **no new env vars** and **no new redirect URIs**.
The big difference from Calendar: we only ask for the `drive.file` scope,
which lets the app touch **only files it created itself**. Google classifies
that scope as *non-sensitive*, so it does **not** trigger the app-verification
review that blocked the Calendar scope when the app went public.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and select
   the same project that holds your existing OAuth client (the one whose
   Client ID is in Vercel as `GOOGLE_CLIENT_ID`).
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.
3. **APIs & Services → OAuth consent screen → Data access** (called *Scopes*
   in older consoles) → **Add or remove scopes** → search for and tick
   `.../auth/drive.file` ("See, edit, create and delete only the specific
   Google Drive files that you use with this app") → **Update** → **Save**.
4. That's it. No Vercel changes, no redeploy needed for Google.

> **Publishing status note:** if the consent screen is still in *Testing*
> mode, only your listed test users can connect. You can set it to
> *In production* — with only non-sensitive scopes like `drive.file`
> requested at runtime, Google publishes it without a verification review.
> (The Calendar scope stays declared but unverified; Calendar connects will
> show Google's "unverified app" interstitial until/unless the app is
> verified, exactly as today. Drive is unaffected.)

## 2. Dropbox (~10 minutes — new app + 3 env vars)

1. Go to the [Dropbox App Console](https://www.dropbox.com/developers/apps)
   → **Create app**.
2. Choose:
   - **Scoped access**
   - **App folder** — least privilege: Dropbox gives the app its own folder
     (`Apps/Author Command Center/`) and it can't see anything else.
   - Name: `Author Command Center` (names are globally unique; add a suffix
     if taken — the name is what users see on the consent screen).
3. On the app's **Permissions** tab, tick:
   - `files.content.write`
   (`account_info.read` is already on by default — leave it.)
   Click **Submit** at the bottom.
4. On the **Settings** tab:
   - Under **OAuth 2 → Redirect URIs**, add your production callback:
     `https://YOUR-DOMAIN/api/dropbox/callback`
     (same domain as your existing `GOOGLE_OAUTH_REDIRECT_URI`, just with
     the Dropbox path). Click **Add**.
   - Copy the **App key** and **App secret** (click *Show* for the secret).
5. In **Vercel → your project → Settings → Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `DROPBOX_APP_KEY` | the App key from step 4 |
   | `DROPBOX_APP_SECRET` | the App secret from step 4 |
   | `DROPBOX_OAUTH_REDIRECT_URI` | `https://YOUR-DOMAIN/api/dropbox/callback` — must match step 4 exactly |

6. **Redeploy** so the functions pick up the new env vars.

> Dropbox apps start in *Development* status, which allows up to 500
> connected users without any review — plenty. If you ever need more, the
> **Apply for production** button is on the app's Settings tab.

## 3. Try it

1. **Settings → Cloud Export** → Connect each service (consent popup, one
   click each).
2. Open **Content Creator → Slideshows** (or Screenshots / Video), open a
   creative, and use the **Google Drive** / **Dropbox** buttons next to the
   download button.
3. Files appear in **Drive → Author Command Center** and
   **Dropbox → Apps → Author Command Center → Author Command Center**.

## How it works (for future reference)

- Same architecture as the Calendar integration: the browser never sees a
  refresh token or client secret. OAuth callbacks store an AES-256-GCM
  encrypted refresh token (`user_google_tokens` / `user_dropbox_tokens`,
  migration 101), and `/api/google/token` + `/api/dropbox/token` mint
  short-lived access tokens on demand.
- Uploads go **directly from the browser** to Drive/Dropbox with that
  short-lived token. That's deliberate: Vercel functions cap request bodies
  at ~4.5 MB, and a WebM video export blows past that. Browser-direct
  uploads have no such limit (Dropbox single-call cap is 150 MB, Drive
  multipart cap is 5 GB — both far above anything we produce).
- One Google connection is shared by Calendar and Drive
  (`include_granted_scopes` merges the grants), so disconnecting Google in
  Settings disconnects both — the UI warns about this.
- Dropbox encryption reuses `GOOGLE_TOKEN_ENCRYPTION_SECRET` as the master
  secret with a Dropbox-specific key-derivation salt, so there's no new
  secret to generate or store.
