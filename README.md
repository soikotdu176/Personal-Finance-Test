# Personal Finance (SOIKOT RAIHAN) - Personal Assets & Liabilities Management System

Vanilla HTML/CSS/JS · IndexedDB (`AssetBookDB`) · Chart.js · JSZip · SheetJS · jsPDF + AutoTable.
No build step, no framework, no server: everything runs in the browser and the data never leaves the device.

## Run
Serve the folder over HTTP(S) - required for the service worker / install prompt:

```
python -m http.server 8080
```

then open `http://localhost:8080`. Opening `index.html` directly still works, without PWA features.

## Files
`index.html`, `styles.css`, `app.js`, `manifest.json`, `sw.js`, `icons/` (PWA icons).

`Assets & Liabilities.xlsx` is the **private** source workbook used for the one-off Excel
migration. It is git-ignored on purpose: it contains real financial records and must never be
committed or deployed.

## Highlights
- New "Income & Expenses" page: fiscal-year (Jul–Jun) + month filters, cascading Major Head → Category → Subcategory, Excel-style category summary, Excel/PDF exports, and a receipt-PDF attachment per transaction.
- The Dashboard keeps every website section (filters, nine KPI cards, all six charts, the recent income/expense widget and the records table) on desktop and mobile. On small screens the mobile overview is an extra summary above that content, never a replacement for it.
- Mobile overview starts with a **Financial Year** pill: choosing a year (July–June) rebuilds the month strip (`JUL 26` … `JUN 27`), the period picker and NET BALANCE (assets − liabilities as of that year) and jumps to the latest month that has activity.
- Mobile dashboard filters are a compact two-column card with ellipsised labels, slimmer date fields side by side and a subtle "Clear Filters" pill; the desktop filter row is unchanged.
- Every mobile filter box (Dashboard, Records / Assets & Liabilities, Income & Expenses, Balance and the Calendar year picker) now shares one compact card style: 33px controls, two/three-column grid, ellipsised labels, applied-filter accent and small action pills. Desktop layouts are untouched.
- First launch convenience: if the database is empty and a `Project/` folder with the source workbooks is next to `index.html`, the app imports it once through the normal migration pipeline. Existing data is never replaced, and deployments without `Project/` simply skip this step.
- Dashboard now shows Total Income, Total Expenses and Net Cash Flow KPIs, "Income vs Expenses" and "Expenses by Major Head" charts, plus a "Recent Income & Expenses" widget.
- Add/Edit transaction modal with cascading classification dropdowns derived from the master Income/Expense tree (editable in Settings → Categories & Subcategories).
- Excel & Budge CSV migration: imports Assets & Liabilities.xlsx, Income & Expenses.xlsx, and `budge-*.csv`/`.xlsx` with smart category normalization and duplicate detection (`Imported X transactions (Skipped Y duplicates)`).
- PDF badges in tables/lists, embedded PDF viewer (Download / New tab), staged View/Download/Replace/Remove in the Edit modal.
- Transfers move money between two **Cash & Bank subcategories** (Cash in Hand, bKash, a bank account, …): the sheet lists one row per subcategory with its live balance, never the same subcategory on both sides, and an optional fee/difference so the received amount can be smaller. Nothing is written to the ledger: both balances are rebuilt at read time, so editing or deleting a transfer restores them exactly.
- A record outside Cash & Bank (a vehicle, land, an investment, …) can say which **Asset subcategory funded it**. The amount is deducted from that subcategory the same way, so choosing *None*, changing the amount or deleting the record can never double-deduct; a newer Cash & Bank snapshot always wins over an older movement.
- Transfers can carry one supporting PDF (deposit slip, receipt): attach it in the transfer sheet, then preview, download, replace or remove it from the transfer's View dialog. The file is staged until **Save Transfer**, stored in the same offline IndexedDB stores as every other attachment and cleaned up when the transfer is deleted.
- Add/Edit form adapts to Category + Subcategory (15 schemas mapped to `Assets & Liabilities.xlsx`).
- Income Year filter auto-fills the Bangladesh fiscal year dates (1 Jul - 30 Jun).
- Generate PDF Report (one category per page, auto portrait/landscape) and Excel Report (summary + per-category sheets with SUM formulas).
- Excel import detects each sheet's header row; re-importing skips rows already imported (sheet + row).
- Installable PWA with offline cache; Figma-style UI, dark mode, reduced-motion support.
- Backup / restore (ZIP), including every attached PDF and the income/expense transactions.

## Google Drive sync (v16.34)
- A Drive backup (`assetbook-backup-*.json`) no longer contains PDF bytes: it lists them (`pdfIndex`: id, name, page folder, SHA-256) and is only ~1-2 MB.
- PDFs live in sub-folders of the backup folder (`PersonalFinance_Backups` on the Test site, `PF_Backup` on the Main site), one folder per page:
  `Assets & Liabilities`, `Income & Expenses`, `Official Account` (incl. Advanced Adjustment), `Income Tax Calculation`. The folder is chosen from the record the PDF is attached to. Files keep their readable names.
- A sync uploads only PDFs that their folder does not have yet; a restore downloads only PDFs the device does not have yet. The same PDF attached many times to one page is stored once.
- PDFs are uploaded **before** the backup JSON, and a restore downloads and verifies every PDF **before** it writes anything, so an interrupted sync or restore never leaves a half-updated database.
- Backups made by older versions (PDF bytes inside the JSON) still restore normally. Unused PDFs in Drive are never deleted automatically.
- Open the site once on every device (reload when the "new version" bar appears) before editing on it, so no device keeps running the old sync code.

## Data safety
- **A new release never deletes local data.** The old build wiped the database whenever its
  reset token changed; that is gone. An update only shows a reminder to take a backup.
- Deleting data is an explicit action: *Settings → Delete All Local Data*.
- PDF bytes live in their own IndexedDB store, so start-up only reads lightweight metadata.
  Upgrading an existing database to v2 migrates the blobs automatically, and the original bytes
  are kept if the copy fails.
- Restore validates the whole archive (and reads every PDF) **before** it replaces anything, and
  each store is rewritten in a single transaction.
- The app asks for persistent storage and shows real usage in *Settings → Local Storage*.
- If start-up ever fails, a recovery screen offers Retry / Clear app cache / Delete local database.

## Security
- `esc()` for every rendered value, and **no inline `onclick` handlers** - actions go through one
  delegated listener, so a crafted category / income-year name cannot break out of a JS string.
- CDN libraries are pinned and loaded with Subresource Integrity (`integrity` + `crossorigin`).
- Excel import is capped (30 MB, 20 000 rows per sheet); restore is capped at 250 MB.
- **Known limitation:** SheetJS `0.18.5` (the last release published to npm) is affected by
  CVE-2023-30533 (prototype pollution, fixed in 0.19.3) and CVE-2024-22363 (ReDoS, fixed in
  0.20.2). The fixed build is only distributed from `cdn.sheetjs.com`, which was unreachable from
  this machine; the import path is therefore size- and row-capped. Switch the script tag to
  `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js` (and update `sw.js`
  `CDN_ASSETS` plus the SRI hash) when that CDN is reachable.

## Deploying
- Upload ALL files together (`index.html`, `styles.css`, `app.js`, `manifest.json`, `sw.js`, `icons/`)
  and never upload the `.xlsx`.
- The workbook is git-ignored, and this repository's history has been rewritten so it is absent from
  every commit. The remote still holds the old commits, so publishing the clean history needs a
  force push:

```
git push --force origin main
```

- Then set the repository to **Private** (Settings → General → Danger Zone). Treat the data as
  already disclosed: it was publicly downloadable at
  `https://soikotdu176.github.io/Personal-Finance/Assets%20%26%20Liabilities.xlsx`
  until that push, and GitHub Pages can serve the previous deployment for a few minutes afterwards.
- Undo the local rewrite (before pushing) with `git reset --hard refs/original/refs/heads/main`.
- Drop the local backup refs once the push looks right:
  `git for-each-ref --format="%(refname)" refs/original | xargs -n1 git update-ref -d` then `git gc --prune=now`.

## Version
App `2026-11-20-v8` · database schema `v4` · service worker `v16.0.0`.
