# Budget — Household spending tracker

A small, mobile-first web app for tracking household spending. It was built to
replace an Android app: open it in a phone browser and "Add to home screen" and
it behaves like a native app (full screen, own icon, works offline).

**It runs two ways, both free:** locally on a PC (see *Running it locally*) or on
free static hosting so it's available on both PC and phone (see **HOSTING.md**).
There is no account, no server to pay for and no build step.

**Live site:** https://sarmadnabhas.github.io/budget_app_sm/
(GitHub Pages, free. Repo: `sarmadnabhas/budget_app_sm`.)

Data is stored in the browser's local storage on each device, with JSON
backup/restore built in. Optionally, free Firebase sync can keep one shared
budget across PC and phone (off by default — see **HOSTING.md**).

## What it does

- **Log expenses** with amount, category, optional note, date and payment method
  (cash / debit / credit card).
- **Categories** — ships with Household, Compulsory, Entertainment, Food,
  Transport, Health and Other. Any category can be renamed, recoloured, given an
  emoji and an optional monthly limit, reordered or deleted. New categories can
  be added. Deleting a category never deletes money records — its expenses are
  moved to another category.
- **Credit-card installments** — switch on *Split into installments* for a card
  purchase and pick 2–60 months. Only that month's share counts towards
  spending. Rounding remainders are added to the final payment so the parts
  always sum back to the exact purchase amount.
- **This month** view — total spent, comparison with the previous month,
  one-off vs. installment split, optional overall monthly budget bar, spending
  per category with share and limit, and a day-grouped list of entries.
- **History** — 3/6/12-month range switch, total, average per month, highest
  month, a month-by-month bar chart, a category doughnut chart with legend, the
  biggest items (grouped by note) and a jump-to-month list.
- **Plans** — every installment purchase with paid/remaining count, remaining
  amount, a per-month progress strip, and a full payment schedule per plan.
- **Settings** — 33 currencies, monthly budget, category management, dark/light
  theme, JSON backup download and restore (replace or merge), and a reset.

## Running it locally

**Windows — easiest:** double-click `start-budget.bat`. A command window opens,
and your browser loads the app at `http://localhost:8765/`. Keep the window open
while you use the app; close it to stop. Nothing is installed by this script.

**macOS / Linux:** run `./start-budget.sh` from this folder (if needed, once:
`chmod +x start-budget.sh`). Stop with Ctrl+C.

**What the scripts do:** they start a tiny local web server on your own PC. They
use Python if it is available, otherwise `server.js` (Node.js). If neither is
installed, the launcher just opens `index.html` directly.

**Why a local server instead of opening the file?**

| | Local server (`localhost`) | Double-clicking `index.html` |
| --- | --- | --- |
| All features work | Yes | Yes |
| Data survives page reloads | Yes | Yes |
| Data location is stable | Yes — tied to `localhost:8765` | Tied to the exact file path |
| Works offline / installable | Yes | No (browsers block service workers on `file://`) |
| Bookmark you can rely on | Yes | Yes, but moving the folder breaks the data link |

Either way the data stays on your PC. The local server is simply the more stable
home for it. **Pick one method and stick to it** — browser storage is per-origin,
so data saved via `localhost:8765` will not appear if you later open the file
directly (and vice versa). Use Settings → *Download backup* before switching.

Port 8765 is used by default. If it is busy, either stop the other copy or run:
`set PORT=9000 && node server.js`.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | App shell: app bar, 4 view containers, 3 bottom sheets, tab bar, FAB |
| `css/style.css` | All styling; mobile-first, dark default + light theme, safe-area aware |
| `js/store.js` | Data layer: persistence, migration, installment math, all reports |
| `js/app.js` | UI layer: view rendering, sheets, charts, events, routing |
| `js/sync.js` | Optional cross-device sync via Firebase REST (no SDK, no CDN) |
| `js/vendor/chart.umd.min.js` | Chart.js 4.4.1, bundled locally — no CDN, no internet needed |
| `start-budget.bat` | Windows one-click launcher |
| `start-budget.sh` | macOS / Linux launcher |
| `server.js` | Fallback static server (Node.js, no dependencies) |
| `manifest.json` | PWA metadata so it installs as a phone app |
| `HOSTING.md` | Free hosting (GitHub Pages) + free Firebase sync setup |
| `.nojekyll` | Tells GitHub Pages to serve files as-is, no Jekyll |
| `sw.js` | Service worker: offline cache of the app shell |
| `icons/icon.svg`, `icons/icon-maskable.svg` | App icons |

No build step. Plain HTML/CSS/JS. **Zero external dependencies** — Chart.js is
vendored in `js/vendor/`, so the app makes no network requests at all and works
with your internet disconnected. If Chart.js somehow fails to load, the rest of
the app still works and only the chart boxes stay empty.

## Entry paths

- `index.html` — opens on the *This month* view (served at `http://localhost:8765/`).
- `index.html#home` / `#history` / `#plans` / `#settings` — deep-links to a view
  (the hash updates as you switch tabs, and reloading keeps the view).
- No URL parameters. The visible month is in-memory state, advanced with the
  ‹ › arrows (or ← → keys on desktop).

## Data model and storage

- **Storage:** `localStorage` under the single key `household-budget-v1`.
  Unreadable data is copied to `household-budget-v1-recovered-<timestamp>`
  before anything else happens, and the app never clears the key on load.
- **Shape:**

```json
{
  "version": 1,
  "settings": { "currency": "USD", "symbol": "$", "locale": "", "theme": "dark", "totalBudget": 2000, "monthStartDay": 1 },
  "categories": [{ "id": "household", "name": "Household", "emoji": "🏠", "color": "#4f9cf9", "budget": 800, "order": 0 }],
  "expenses": [{ "id": "exp_...", "amount": 1200, "categoryId": "compulsory", "note": "Laptop",
                 "date": "2026-09-08", "method": "credit", "months": 6, "createdAt": "..." }],
  "updatedAt": "..."
}
```

- `months` is `0` for a single payment, or `2–60` for an installment plan.
  An installment plan's charges are derived, not stored per month:
  `chargedInMonth(expense, "YYYY-MM")` returns that month's share (or `0`).
- `amount` is always the **full** purchase price, not the monthly share.
- Older/odd shapes (`items`, `value`, `cat`, `desc`, `day`) are migrated on load
  and on import, so old exports still restore.
- **Backups:** Settings → *Download backup (.json)* writes one file containing
  settings, categories and every expense. Restore offers replace or merge.

## Verified behaviour

Checked in a headless browser on a 390 px phone viewport (and 1280 px desktop):

- Home, History, Plans, Settings and the add-expense sheet all render correctly
  with realistic seeded data; no raw markup leaking, no overlap.
- Both history charts render from the **local** Chart.js copy with no network
  access, confirming the app is fully self-contained and offline-capable.
- No external URLs remain in `index.html`; the app makes no network requests.
- 60/60 automated data-layer assertions pass, including: installment parts
  always sum to the total (including `0.05` over 3 and `1000` over 7), charges
  only land inside a plan's month window, cash and single card payments stay in
  their own month, plan progress and end month are correct, category deletion
  preserves expenses with no orphan category ids, comma/symbol amount parsing,
  month arithmetic across year boundaries, invalid amounts rejected, and
  export→import round trips (merge and replace, plus legacy format migration).

## Remaining ideas

- Recurring monthly bills (rent, subscriptions) auto-created each month.
- Per-category budget alerts and a month-over-month category comparison.
- CSV export for spreadsheets.
- Keyboard-first entry for desktop use (type an amount, Enter to save).
