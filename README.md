# ⏱ SignOut — Worker Attendance System

<p align="center">
  <img src="icons/icon-192.png" width="100" alt="SignOut Logo" />
</p>

<p align="center">
  <strong>NFC · QR · GPS · PWA · Offline-First</strong><br/>
  Tap to clock in. Track every hour. Run your workforce from any device.
</p>

<p align="center">
  <a href="https://github.com/glainejustin/signout/releases/latest/download/signout-latest.apk"><img src="https://img.shields.io/badge/APK-Download%20latest-3DDC84?style=flat-square&logo=android&logoColor=white" alt="Download latest APK" /></a>
  <a href="https://github.com/glainejustin/signout/releases/latest"><img src="https://img.shields.io/github/v/release/glainejustin/signout?style=flat-square&label=release&color=0F172A" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/PWA-Ready-1a73e8?style=flat-square&logo=pwa&logoColor=white" alt="PWA Ready" />
  <img src="https://img.shields.io/badge/Offline-First-009624?style=flat-square" alt="Offline First" />
  <img src="https://img.shields.io/badge/NFC-Web%20API-e65100?style=flat-square" alt="Web NFC" />
  <img src="https://img.shields.io/badge/Capacitor-Android-3DDC84?style=flat-square&logo=android&logoColor=white" alt="Capacitor" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="License MIT" />
  <img src="https://img.shields.io/badge/Made%20with%20%E2%9D%A4%EF%B8%8F%20by-glainejustin-ff69b4?style=flat-square" alt="Made with love by glainejustin" />
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-nfc-setup">NFC Setup</a> •
  <a href="#-admin-dashboard">Admin</a> •
  <a href="#-google-sheets-sync">Google Sheets</a> •
  <a href="#-android-build">Android</a>
</p>

<p align="center">
  <a href="https://github.com/glainejustin/signout/releases/latest/download/signout-latest.apk"><strong>⬇️ Download the latest Android APK</strong></a><br/>
  <sub>Always points at the newest release · debug-signed for testing, sideload with <code>adb install -r signout-latest.apk</code> · SHA-256 checksum published alongside</sub>
</p>

---

## ✨ What is SignOut?

**SignOut** is a complete worker attendance & rota system that runs in the browser — no backend, no subscription. Install it as a PWA, hand out cheap NFC stickers, and workers tap to clock IN/OUT. Everything else — shifts, leave, GPS lock, analytics, Sheets sync — is built in.

Perfect for **restaurants, warehouses, retail, clinics, factories** — any team with 5–200 workers who need reliable time tracking.

---

## 🚀 Features

### 👷 For Workers
| Feature | Details |
|---|---|
| **NFC Tap Clock** | Tap an NTAG213 sticker → auto IN/OUT with timestamp |
| **PIN Login** | Search name → 4-digit PIN → device-locked session |
| **QR Badge Login** | Scan a printable QR badge via camera |
| **Break Tracking** | Start Break / Resume Work with net-hour calculation |
| **GPS Geofence** | Must be within workplace radius (configurable 20–500m) |
| **Selfie Verification** | Front-camera snap on clock-in (optional) |
| **Multi-Site Support** | Multiple workplaces with independent geofences |
| **My Schedule** | See personal rota, request leave, bid on open shifts |
| **History** | Week view grouped by day with daily totals |

### 🛡️ Security
- **Hashed PINs (SHA-256)** — worker + admin PINs stored as 64-hex hashes; plain 4-digit migration is automatic
- **Admin lockout** — 5 wrong admin PINs → 15 min lock + audit trail
- **Device fingerprint lock** — account bound to one phone after first login
- **Brute-force lockout** — 3 wrong worker PINs → 10 min lock
- **URL allow-list** — Sheets/webhooks only to `script.google.com`, `hooks.slack.com`, `discord.com`, `api.telegram.org`
- **Audit CSV export** — `Admin → Audit → Export CSV` + `SECURITY.md` threat model
- **Shift time window** — only clock in during scheduled hours (±30 min)
- **Allowed days guard** — blocks clock-in on non-scheduled days
- **Auto-logout** — configurable inactivity timeout (1–60 min)
- **Leave guard** — workers on approved leave cannot clock in

### 📅 Rota & Scheduling
- Weekly grid (Mon–Sun) per worker
- 5 default shift types + unlimited custom shifts (with color)
- Save / load rota templates
- Copy week → next week
- Shift swap requests (pending / approved)
- Open shifts posted by admin → workers bid
- Rota vs Actual comparison table

### 📊 Admin Dashboard (PIN: `1234`)
| Tab | What it does |
|---|---|
| **📋 Logs** | Filter by worker/date, live stats, full log table with photos |
| **📅 Rota** | Full rota editor, shift types, week nav, CSV export |
| **📊 Summary** | Weekly hours per worker with OT / Late / Absent flags |
| **📈 Analytics** | Hours bar chart, punctuality split, heatmap |
| **🏖 Leave** | Approve / reject PTO / Sick / Personal requests |
| **🏢 Sites** | Add / remove geofenced workplaces |
| **📜 Audit** | Immutable admin action trail (last 500 events) |
| **👷 Workers** | Add / edit / delete, assign NFC, set shifts, reset device |
| **⚙ Settings** | Sheets, GPS, notifications, overtime rules, webhooks, backup |

### 🔔 Notifications & Integrations
- **Push notifications** — alerts when someone forgets to clock out (>10h)
- **WhatsApp daily report** — auto-sent at configured time via `wa.me` or webhook
- **Slack / Teams / Discord webhooks** — real-time overtime & late alerts
- **Web Audio feedback** — chimes on success/error (toggleable)
- **Google Sheets sync** — 1-click push of all logs + auto daily summary
- **CSV exports** — all logs / this week / this month / custom date range
- **JSON backup & restore** — full database export in one click

### 📱 Platform
- **PWA** — installs to home screen, works 100% offline, auto-syncs when back online
- **Maskable app icons** — a full-bleed icon for launchers that apply their own mask, plus the
  rounded mark for everywhere else (see `icons/`)
- **Kiosk Mode** — shared tablet at entrance with live clock, worker select + PIN pad
- **Capacitor Android** — `com.signout.attendance`, splash screen included
- **Service Worker** — `signout-v6` cache, offline-first fetch strategy

---

## 📸 Screenshots

> **Placeholders, not screenshots.** They are drawn by a placeholder service and are here only
> so the layout is visible; add real device captures under `docs/` and swap the `src` values.
> The previous ones pointed at `via.placeholder.com`, which stopped resolving — the images had
> been rendering as broken links.

| Login | Worker Today | Admin Logs | Rota |
|---|---|---|---|
| ![Login](https://placehold.co/220x420/0F172A/FFFFFF?text=Login) | ![Today](https://placehold.co/220x420/0369A1/FFFFFF?text=Today) | ![Logs](https://placehold.co/220x420/0F172A/FFFFFF?text=Logs) | ![Rota](https://placehold.co/220x420/0369A1/FFFFFF?text=Rota) |

---

## 🎬 Demo

> 📸 **Live:** **https://glainejustin.github.io/signout/** — tap *Install* banner for home-screen PWA.

<p align="center">
  <img src="icons/icon-512.png" width="220" alt="SignOut — tap to clock in" />
</p>

> Add a 3-second screen recording (`docs/demo.gif`, <3 MB) and replace the image above with `![Demo](docs/demo.gif)` — it auto-plays on GitHub.

---

## ⚡ Quick Start

### Option 1 — Just open it (zero install)

```bash
# No build step — it's vanilla HTML/CSS/JS
# Simply open index.html, or serve it:
npx serve .        # http://localhost:3000
# or
python -m http.server 8000
```

> **NFC requires HTTPS.** For local NFC testing use `npx serve --ssl` or deploy to GitHub Pages / Netlify.

### Option 2 — Deploy to GitHub Pages (free HTTPS)

1. Create a new GitHub repository (e.g. `signout`)
2. Push this project:
   ```bash
   git init
   git add .
   git commit -m "feat: initial SignOut release"
   git branch -M main
   git remote add origin https://github.com/<you>/signout.git
   git push -u origin main
   ```
3. In GitHub: **Settings → Pages → Source: `main` / root** → Save
4. Your live URL: `https://<you>.github.io/signout/`

### Option 3 — Netlify (drag & drop)

Drag the `signout` folder onto [app.netlify.com/drop](https://app.netlify.com/drop) — live HTTPS URL instantly.

### Option 4 — Android APK (Capacitor)

**Download a prebuilt APK** — no toolchain needed:

- **Latest:** [`signout-latest.apk`](https://github.com/glainejustin/signout/releases/latest/download/signout-latest.apk)
  (stable URL, always the newest release)
- **A specific version:** open [`releases`](https://github.com/glainejustin/signout/releases) and take
  `signout-vX.Y.Z.apk` from the release you want (each ships with a `.sha256` beside it)

```bash
# verify the download, then sideload to a connected device
curl -L -O https://github.com/glainejustin/signout/releases/latest/download/signout-latest.apk
curl -L -O https://github.com/glainejustin/signout/releases/latest/download/signout-latest.apk.sha256
sha256sum -c signout-latest.apk.sha256
adb install -r signout-latest.apk
```

> The APK above is **debug-signed** — ideal for sideloading, but Play Store uploads need a signed
> release build. When the signing secrets are configured, every release also carries a
> Play-uploadable `.aab` and a signed release APK — see [Signed release builds](#-signed-release-builds-play).

**Or build it yourself:**

```bash
npm install
npm run build          # stages the web app into dist/ (never ships tests/ or node_modules)
npx cap add android    # generates android/ (git-ignored)
npx cap sync           # copies dist/ into the native project
npx cap open android   # builds in Android Studio
```

`npm run android` does the build + sync + open in one go.

> **Prebuilt APKs:** pushing a `v*` tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml),
> which builds a debug APK on CI (JDK 21 + the runner's Android SDK) and attaches
> `signout-<tag>.apk` plus a `.sha256` checksum to that tag's GitHub release — no Android Studio needed.
> Every release also carries `signout-latest.apk`, the stable alias the badge and download link above point at,
> so those URLs never need repointing as versions move.

---

## 📡 NFC Setup

1. Buy **NTAG213 stickers** (~$4 for 25 on AliExpress / Amazon)
2. Stick one per worker badge (or one per entrance door)
3. In SignOut: **Admin → Workers → Edit → Scan NFC Tag** → hold tag near phone → Save
4. Workers now tap to clock in/out instantly

> NFC requires **Android + Chrome** with NFC enabled in system settings. iPhone Web NFC is limited.

---

## 🔐 Admin Dashboard

- Open the app → tap **⚙ Admin** (or **Admin** button on login)
- Default PIN: **`1234`**
- Change it in **Settings → Change Admin PIN**, or via console:
  ```js
  DB.saveSettings({ adminPin: '9876' })
  ```

---

## 📊 Google Sheets Sync

Push every clock event to a Google Sheet with auto-formatting + daily summary:

1. Open [sheets.google.com](https://sheets.google.com) → New spreadsheet
2. **Extensions → Apps Script** → delete default code
3. Copy-paste the entire `google-apps-script.js` from this repo
4. **Deploy → New deployment → Web app** → Execute as: *Me*, Access: *Anyone* → Deploy
5. Copy the **Web App URL** → paste into **SignOut → Admin → Settings → Google Sheets Sync → Sync Now**

Three tabs are created automatically:
- **Attendance Logs** — every tap (color-coded IN/OUT)
- **Daily Summary** — total hours per worker per day
- **Workers** — roster snapshot

---

## 📍 GPS Location Lock

1. **Admin → Settings → GPS Location Lock → Enable**
2. Tap **📍 Use My Current Location** (while at the workplace), or paste lat/lng manually
3. Set radius (20–500m) with the slider → **Save GPS Settings**
4. Workers outside the radius will see `📍 Not at Workplace` and be blocked

Add extra sites in **Admin → Sites → + Add Site**.

---

## 🏖 Leave & Shifts

- **Workers:** `My Schedule → Request Leave` → pick PTO/Sick/Personal + dates + reason
- **Admin:** `Leave` tab → Approve / Reject
- **Rota:** assign shifts per worker/day, create custom shifts, manage swaps & open shifts

---

## 🗂️ Project Structure

```
signout/
├── index.html              # Single-page app (all views + modals)
├── manifest.json           # PWA manifest — declares both the rounded and maskable icons
├── service-worker.js       # Offline cache — bump CACHE (signout-v6…) on every release
├── capacitor.config.json   # Capacitor Android config (com.signout.attendance, webDir: dist)
├── google-apps-script.js   # Apps Script for Sheets sync
├── css/
│   └── styles.css          # All styling
├── js/
│   ├── security.js         # Sanitizers, SHA-256 PIN hashing, allow-lists, in-app dialogs (UI)
│   ├── db.js               # LocalStorage DB — workers, logs, rota, audit, locations, backup, payroll
│   ├── app.js              # Main controller — login, clock, kiosk, offline sync
│   ├── admin.js            # Admin dashboard — stats, summary, exports, settings
│   ├── workers.js          # Worker CRUD + device reset
│   ├── logs.js             # Log table + weekly summary helpers
│   ├── rota.js             # Rota grid, shift templates, swaps, open shifts
│   ├── gps.js              # Haversine geofence check
│   ├── nfc.js              # Web NFC handler
│   ├── qr.js               # QR badge scanner (BarcodeDetector)
│   ├── selfie.js           # Front-camera capture
│   ├── notify.js           # Push + WhatsApp reports
│   ├── webhooks.js         # Slack/Teams/Discord dispatcher
│   ├── audio.js            # Web Audio chimes
│   ├── face.js             # Lightweight face-presence check
│   ├── device.js           # Fingerprint + short ID
│   ├── pwa-install.js      # beforeinstallprompt pill
│   └── pdf.js              # PDF export helper
├── scripts/
│   ├── build-web.mjs       # Stages css/js/icons + index.html into dist/ for Capacitor
│   ├── generate-icons.mjs  # Draws the app icon → PWA sizes + Android launcher/splash (npm run icons)
│   ├── verify-apk-branding.mjs # Decodes a built APK and checks its icons/splash (npm run verify:apk)
│   ├── configure-android-signing.mjs # Patches the generated Gradle project to sign release builds
│   └── release-check.mjs   # Runs the whole release gate locally (npm run release:check)
├── tests/                  # Unit tests (node --test, zero dependencies)
│   ├── harness.mjs         # Loads the plain <script> modules into a vm sandbox
│   ├── db.test.mjs         # Hours maths, overtime guard, payroll CSV
│   ├── security.test.mjs   # Sanitizers, PIN hashing, dialog fallback
│   ├── gps.test.mjs        # Haversine geofence maths
│   ├── branding.test.mjs   # Icon artwork contract, PNG decoder, pixel comparison
│   ├── signing.test.mjs    # Release-signing patch + the workflow wiring around it
│   └── release-check.test.mjs # Release-gate platform plumbing (SDK/JDK probing, spawn rules)
└── icons/                  # Generated by npm run icons — do not hand-edit
    ├── icon-192.png               # "any": rounded, transparent corners
    ├── icon-512.png
    ├── icon-maskable-192.png      # "maskable": full-bleed, mark inside the safe circle
    ├── icon-maskable-512.png
    ├── apple-touch-icon.png       # iOS home screen (full-bleed, iOS applies its own rounding)
    └── favicon-32.png
```

---

## 💾 Data & Backup

All data lives in `localStorage` (no server). Keys:

```
signout_workers, signout_logs, signout_settings, signout_lockouts,
signout_rotas, signout_shifts, signout_swaps, signout_audit,
signout_locations, signout_leave_reqs, signout_open_shifts, signout_admin_lock
```

- **Admin → Settings → Database → Export Backup (JSON)** — downloads everything
- **Restore Backup** — pick a JSON file to restore (audit-logged)
- Clear all data: `localStorage.clear(); location.reload();` in console

---

## 🔧 Configuration

| Setting | Where | Default |
|---|---|---|
| Admin PIN | Settings | `1234` |
| GPS radius | Settings | `100m` |
| Inactivity logout | Settings | `5 min` |
| Daily overtime | Settings | `8h` |
| Weekly overtime | Settings | `40h` |
| WhatsApp report time | Settings | `18:00` |
| Audio feedback | Settings | `ON` |
| Webhook URL | Settings | _(empty)_ |

---

## 🧪 Tests

Zero dependencies — Node's built-in test runner:

```bash
npm test          # run everything in tests/
npm run test:watch
```

The tests load the real `js/*.js` files into a Node `vm` sandbox (with a tiny `localStorage` + `document` stub), so they exercise the shipped code rather than a copy. CI runs `npm test` on every push and PR.

### Before you tag — the release gate

```bash
npm run release:check
```

The release workflow is the source of truth for what shipping requires, but it only runs
*after* a tag is pushed — so a broken test or stale artwork is discovered by the release
itself, on `main`, where the fix costs another tag. This runs the same stages, in the same
order, locally:

| Stage | What it enforces |
|---|---|
| dependencies | `npm ci` when `node_modules` is missing or `--fresh` |
| required files | the files/dirs `ci.yml` insists on |
| unit tests | the full suite |
| stage web assets | `npm run build`, then that `dist/` has the payload and **no leakage** |
| build debug APK | Capacitor sync, icon branding, `gradlew assembleDebug` |
| verify APK branding | the built APK really ships the generated icons and splash |

The signed artifacts (**Signed release builds** below) are the one part it cannot rehearse:
signing needs the keystore, which exists only as a repository secret. Their wiring is
asserted by the test suite instead, and the signed build itself first runs on a real tag.

The APK stages need a JDK and an Android SDK. Without them the run ends **PARTIAL**, naming
what was skipped — it never reports a pass it didn't earn:

```bash
npm run release:check -- --apk path/to/signout-vX.Y.Z.apk  # check a downloaded build (no SDK)
npm run release:check -- --require-apk                    # fail instead of skipping
npm run release:check -- --no-android                     # fast path: tests + web build
```

### Verifying a release APK

```bash
npm run verify:apk   # needs a built APK + android/app/src/main/res (see Option 4)
```

Icon regressions are silent: the build can succeed and the app can still show the wrong
launcher icon — which is how a pre-rebrand "WT" icon once shipped. This opens the APK as a
zip, decodes the launcher / adaptive-foreground / splash PNGs and compares them
**pixel-by-pixel** (8×8 cell means, not bytes, so PNG crunching doesn't cause false alarms)
against the generated artwork. It also checks every splash is navy with a logo drawn on it
and that the icons inside the APK's web payload match the committed ones. The release
workflow runs it after `assembleDebug` and **fails before uploading anything** if they
differ.

A second workflow, `apk-audit.yml`, runs the same check **nightly against the published
release** — it downloads the latest APK, verifies the published checksums and the stable
alias, regenerates the expected artwork from that release's own tag, and compares. It also
fires whenever a release is published, and can be run on demand for any tag from the
Actions tab.

### Regenerating the app icons

```bash
npm run icons              # PWA icons (icons/) — committed
npm run icons -- --android # also brands the generated android/ project (CI runs this)
```

The mark is drawn in code (`scripts/generate-icons.mjs`), so every size comes from one source:
PWA sizes, the Android launcher, round and adaptive-foreground layers, and the splash screens.
Two shapes ship for the web, because a launcher that masks an icon and one that does not need
*different files*: `icon-192/512` are the rounded mark, while `icon-maskable-192/512` are
full-bleed with the mark inside the maskable safe circle (the central 80% diameter), and the
manifest declares each with its real `purpose`. Claiming `any maskable` on the rounded icons is
the trap — a launcher masks them and cuts the transparent corners into wedges — so
`tests/branding.test.mjs` asserts both properties against the committed PNGs. **Bump `CACHE` in
`service-worker.js` whenever the icons change**, or installed clients keep serving the old ones.

### Keeping the workflows on a supported runtime

```bash
npm run check:actions          # scans .github/workflows/ by default
npm run check:actions -- path/to/workflow.yml
```

A `uses:` pin does not say what runtime the action needs — that lives in the action's own
`action.yml` (`runs.using`). `actions/checkout@v4` and `@v7` look identical in review, which
is why every workflow here ended up on the deprecated Node 20 runtime without anyone
noticing until GitHub annotated every run.

This reads each action's manifest **at the pinned ref** and fails on anything behind
`CURRENT_NODE`:

```
✖ actions/checkout@v4                        [node20]   runs on Node 20; Actions now use Node 24
::error::actions/checkout@v4 (ci.yml:12) — runs on Node 20; Actions now use Node 24
```

There is no action→runtime table to maintain; the one encoded fact is the current Node
major, so a runtime newer than this script knows about warns rather than fails. Composite
actions are followed into what they wrap (bounded, cycle-safe) — a stale action hidden
inside `upload-pages-artifact` is still a stale action. Malformed references, reusable
workflows (which declare no runtime of their own) and `docker://` refs are classified
explicitly, and a manifest that cannot be read is an error rather than a silent pass: a
check that succeeds having verified nothing is worse than no check. It runs in `ci.yml` on
every push and PR, before the install step, so a bad pin is caught on the PR that adds it.

### 🔏 Signed release builds (Play)

A debug APK cannot go to the Play Store, and neither can an AAB signed with a throwaway key:
Play permanently binds the app to the **first** signing key it ever receives, so a key
generated per CI run would produce an app nobody — including you — could ever update.

The workflow therefore signs **only** with a keystore you supply as repository secrets, and
never invents one. Set these under **Settings → Secrets and variables → Actions**:

| Secret | What it is |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the whole `.jks` keystore, base64-encoded (one line) |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias inside the keystore |
| `ANDROID_KEY_PASSWORD` | password for that alias |

Create an upload keystore (keep it somewhere safe — losing it means opening a Play support
request to reset the upload key):

```bash
keytool -genkeypair -v -keystore upload.jks -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000 -storetype JKS

# GitHub secrets are text-only, so store the keystore as one base64 line
base64 -w0 upload.jks > upload.jks.b64     # macOS: base64 -i upload.jks -o upload.jks.b64
```

With those set, a `v*` tag build additionally produces:

| Artifact | Purpose |
|---|---|
| `signout-vX.Y.Z.aab` | the Play Console upload (signed Android App Bundle) |
| `signout-vX.Y.Z-release.apk` | signed release APK, for testers who want the real build |

both attached to the release with `.sha256` checksums and also kept as workflow artifacts
(`signout-signed-<tag>`). Before anything is attached, the workflow proves the signature:
it checks the AAB carries a `META-INF` signature entry and runs `apksigner verify
--print-certs` against the release APK, then re-verifies that the release APK ships the
branded artwork — a release build is a different Gradle variant, so its icons are proven
independently rather than inferred from the debug APK.

`versionCode` / `versionName` come from the tag. Capacitor's template hardcodes
`versionCode 1`, which Play accepts exactly once, so the build maps `vMAJOR.MINOR.PATCH` to
`versionCode = major*10000 + minor*100 + patch` (v1.1.2 → `10102`). This only orders
correctly while minor and patch stay ≤ 99; the script refuses the tag rather than shipping a
duplicate version code (a permanent Play rejection).

> **Upload key, not app-signing key.** With Play App Signing enabled, Google holds the real
> app key and this keystore only authorises uploads — which is why it is replaceable if
> leaked. Anyone who obtains it can upload a release to your listing; treat it as a secret.
>
> **Signed and debug builds cannot coexist on one device.** They carry different signatures,>   so `adb install -r` fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` — uninstall the debug
> build first (`adb uninstall com.signout.attendance`).

Without the secrets, nothing breaks: the job still publishes the debug APK, posts a
`::warning::` annotation, and the run summary says so explicitly, so a release with no
installable Play artifact can never be mistaken for one that has it.

---

## 🧪 Troubleshooting

| Problem | Fix |
|---|---|
| NFC doesn't scan | Chrome + Android only; enable NFC in system settings; serve over HTTPS |
| Unknown tag | Admin → Workers → Edit → Scan NFC Tag to assign |
| App won't install | Must be served over HTTPS |
| Sheets sync fails | Check Web App is deployed as **Anyone**, URL is correct |
| Forgot admin PIN | Console: `DB.saveSettings({ adminPin: '1234' })` |
| Wrong device error | Admin → Workers → Reset Device for that worker |
| GPS blocked incorrectly | Increase radius or re-capture location outdoors |
| Photos not saving | Selfie requires camera permission over HTTPS |
| Old UI after an update | New assets are cached — bump `CACHE` in `service-worker.js`, then hard-reload |
| "Overtime limit reached" on clock-in | Settings → Overtime & Sound → turn off *Block clock-in at overtime limit* |

---

## 🤝 Contributing

PRs welcome! Keep it vanilla — no framework, no bundler required.

```bash
git checkout -b feat/my-feature
# make changes
git commit -m "feat: my feature"
git push -u origin feat/my-feature
```

See **[CONTRIBUTORS.md](CONTRIBUTORS.md)** — made with ❤️ by **glainejustin** 💖

---

## 👥 Contributors

<p align="center">
  <a href="https://github.com/glainejustin">
    <img src="https://github.com/glainejustin.png" width="80" style="border-radius:50%" alt="glainejustin" /><br/>
    <strong>glainejustin</strong>
  </a><br/>
  <sub>Creator & Maintainer — with love ❤️</sub>
</p>

Full credits: **[CONTRIBUTORS.md](CONTRIBUTORS.md)**

---

## 📄 License

MIT — free for personal and commercial use by **glainejustin** & contributors. See [LICENSE](LICENSE).

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/glainejustin"><strong>glainejustin</strong></a> — Web NFC + PWA + LocalStorage — <strong>SignOut v1.0</strong>
</p>

<p align="center">
  <sub>💖 Crafted with love for teams who clock in with a tap</sub>
</p>
