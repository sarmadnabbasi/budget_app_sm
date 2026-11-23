# Hosting it for free — PC and phone

Yes, there is genuinely free hosting with no caveats for an app like this. It is
a **static site** (plain HTML/CSS/JS, no server, no database), which is the one
category of web app that free hosts still give away for real.

## The recommendation: GitHub Pages

It is the safest "never costs anything" option because **there is no billing
account attached at all**. You cannot accidentally exceed a limit and get
charged, because there is nothing to charge.

| | GitHub Pages | Cloudflare Pages | Netlify |
| --- | --- | --- | --- |
| Cost | Free, no card ever | Free, no card | Free tier |
| Bandwidth | 100 GB/month (you'll use <1 MB) | Unlimited | 100 GB/month |
| HTTPS | Yes | Yes | Yes |
| Sleeps / pauses when idle | No | No | No |
| Repo must be public | **Yes on free plan** | No | No |
| Can be charged by accident | No billing at all | No | Optional card |

**The only caveat:** on GitHub's free plan the repository must be **public**, so
your *code* is visible. That is fine here — your budget data is never in the
repo. It lives in your browser's storage, so publishing the code exposes
nothing personal. If you'd rather the code be private too, use **Cloudflare
Pages** instead, which allows a private repo and has no bandwidth cap.

## Step-by-step (GitHub Pages, ~5 minutes)

No git command line needed — you can do this entirely in the browser.

1. Create a free account at **github.com**.
2. Click **+ → New repository**. Name it `budget`. Set it to **Public**. Do not
   add a README (you already have one). Click **Create repository**.
3. On the empty repo page click **uploading an existing file**.
4. Drag in **everything in this folder**, keeping the structure:
   ```
   index.html
   manifest.json
   sw.js
   .nojekyll
   README.md
   HOSTING.md
   server.js
   start-budget.bat
   start-budget.sh
   css/style.css
   js/store.js
   js/app.js
   js/vendor/chart.umd.min.js
   icons/icon.svg
   icons/icon-maskable.svg
   ```
   Dragging the `css`, `js` and `icons` **folders** keeps their contents in the
   right place. Click **Commit changes**.
5. Go to **Settings → Pages**. Under *Source* choose
   **Deploy from a branch**, branch **main**, folder **/ (root)**. Click **Save**.
6. Wait about a minute, then open:
   **`https://YOUR-USERNAME.github.io/budget/`**

That URL is permanent and free.

### On your phone

1. Open the same URL in Chrome.
2. Menu (⋮) → **Add to Home screen**.
3. It now launches full-screen with its own icon, and works with no connection.

## Why it just works when hosted

These details were already prepared for a subfolder deployment like
`/budget/`:

- Every path in the app is **relative** (`css/style.css`, `js/app.js`, `sw.js`),
  so it works under a subpath, not just at a domain root.
- `manifest.json` (not `.webmanifest`) uses a MIME type every free host serves
  correctly.
- `start_url` and `scope` in the manifest are `./` — relative, correct for a
  subfolder.
- `.nojekyll` stops GitHub from running Jekyll over the files.
- Chart.js is bundled locally, so **no request ever leaves your origin**. The
  app needs no internet once loaded and installed.
- The service worker caches the shell, giving offline use on both devices.

## The one real limitation: your data does not sync

This is the honest part, and it is **inherent to any free static host** — it has
nothing to do with which host you pick.

A static host only serves files. It has no server to store data. So the app
saves into **each browser's own storage**, which means:

- Your PC and your phone are **two separate budgets**. Adding an expense on your
  phone does *not* appear on your PC.
- Clearing browser data on one device wipes that device's copy only.

You have three ways to handle this:

### Option A — Accept two local copies (free, works today, zero setup)

Use the app on both, and move data between them with
**Settings → Download backup (.json)** and **Restore from backup**. Restore
offers *replace* or *merge*, so you can merge your phone's entries into your PC.

Good if: you mostly enter expenses on one device and just want the app available
on both.

### Option B — Free cloud sync, one shared budget — **now built in**

Sync lives in `js/sync.js`. It is **optional and off by default**: if you never
configure it, the app behaves exactly as before (local-only, offline-first).

**Firebase (Google) — Spark plan**
- Free, **no credit card required**
- Realtime Database free tier: 1 GB stored, 10 GB/month transfer — a personal
  budget uses a tiny fraction of that
- Does **not** pause or expire for inactivity
- Protected by sign-in plus per-user database rules

#### Step-by-step (~10 minutes, all in the browser)

1. Open **console.firebase.google.com** and sign in with a Google account.
2. **Add project** → name it (e.g. `household-budget`) → you can turn
   **Google Analytics off** → **Create project**.
3. Left sidebar → **Build → Realtime Database** → **Create Database**.
   - Pick a location near you.
   - Choose **Start in locked mode** (correct — rules come next).
4. Open the **Rules** tab, replace the contents with the block below, **Publish**:

   ```json
   {
     "rules": {
       "budgets": {
         "$uid": {
           ".read": "auth != null && auth.uid === $uid",
           ".write": "auth != null && auth.uid === $uid"
         }
       }
     }
   }
   ```

   Each signed-in user can read and write **only their own** budget. Nobody
   else, including other users of the same app, can see your data.

5. **Build → Authentication → Get started** → **Sign-in method** tab → enable
   **Email/Password** → save.
6. **You need only two values**, and you do not need the `</>` register-app dialog:
   - **Web API Key** — Project settings (gear) → **General** → the *Web API Key* row
     (starts with `AIza...`)
   - **Database URL** — Build → **Realtime Database** → the URL shown at the top of
     that page. Copy it exactly; newer projects end in `.firebasedatabase.app`.
7. In the app: **Settings → Sync across devices** → paste both values → **Save config**.
8. Enter an email and password → **Create account**. This is a private account
   inside *your own* Firebase project, not a Google account.
9. On your phone: open the same URL, **paste the same config**, then **Sign in**
   with the same email and password.

Both devices now converge on one budget.

#### So you never paste the config again

By default the config lives only in each browser's storage, so every new browser
would need it pasted again. To avoid that, embed it once in the app's code:

1. Open **`js/firebase-config.js`** and fill in the two values:

   ```js
   window.BUDGET_FIREBASE_CONFIG = {
     apiKey: "AIza...your key...",
     databaseURL: "https://your-project-default-rtdb.firebaseio.com",
     projectId: ""
   };
   ```

2. Commit it to the repo (and to your local folder if you run it locally).

From then on, **any new browser or device only asks for your email and password.**
A fresh browser lands straight on the sign-in form.

**Is committing the API key safe?** Yes. A Firebase *web* API key identifies your
project; it does not grant access to your data. Access is controlled by the
Realtime Database rules from step 4 — a signed-in user can only read and write
their own `uid`. Someone with your key still cannot read your budget without your
password. This is exactly how every Firebase web app works.

> Precedence: a config saved in Settings wins over the embedded one, so any device
> already set up keeps working. "Use a different Firebase project" opts that device
> out and is remembered, so the built-in config does not silently re-enable itself.

#### How the sync behaves

- **Offline-first.** Local storage stays the source of truth for the UI; the
  cloud is a mirror. With no signal the app works normally and catches up later.
- **Merge, not overwrite.** Conflicts resolve **per record** by timestamp
  (latest edit wins), so an expense added on your phone and a different one added
  on your PC both survive.
- **Deletes propagate.** Deleting a record leaves a marker so another device's
  stale copy cannot resurrect it. An edit made *after* the delete does revive the
  record, deliberately — losing an edit is worse than keeping a record.
- **Timing.** It syncs a few seconds after a change, every 15 seconds while the
  tab is open, and whenever you return to the tab or regain signal. There is also
  a **Sync now** button.

#### Two honest caveats

- **The `apiKey` is not a secret.** That is normal for Firebase web apps, and it
  is exactly why the database **rules** in step 4 matter. The app never stores
  your config in the repo — you paste it at runtime and it lives in your browser.
- **Free tiers can change.** Spark has been free for years and needs no card, but
  a provider could alter terms. Unlike GitHub Pages there *is* a billing
  relationship, though nothing charges you unless you deliberately upgrade.

**Verified:** 22 automated assertions cover the merge engine — newer-wins,
older-doesn't-clobber, delete propagation, revival-after-edit, orphan category
protection, idempotent re-merge, and that merging cannot start an endless
push loop between devices. The live network calls to Firebase could not be
tested from here, so treat your first real sign-in as the true end-to-end check;
the Settings card shows any error message plainly.

### Option C — Cloudflare Pages + a free Workers database

Also free and quite elegant (Cloudflare's free tier is very generous), but it is
more setup than Firebase for the same outcome. Only worth it if you already have
a Cloudflare account.

## My recommendation

1. **Deploy to GitHub Pages** (steps above). Five minutes, costs nothing, gets the
   app on both devices with offline support.
2. **Then decide on sync.**
   - Mostly enter expenses in one place? **Skip sync.** Option A is simpler and
     needs no accounts at all.
   - Want one shared budget across PC and phone? Do **Option B**. It's already
     built; you only need to create the free Firebase project.
3. **Download a backup now and then regardless.** Sync is not a backup — if you
   delete something, it is deleted everywhere on purpose. The JSON file is your
   safety net.

## Also still available: this platform's Publish

The **Publish** tab here can host the app for you and give you a live URL, if
you'd rather not touch GitHub. It's a static publish, so it has the same
per-device data behaviour described above. Say the word if you want me to run an
approved deployment instead.
