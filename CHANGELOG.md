# Changelog

All notable changes to SignOut are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **Tag-triggered APK release pipeline** (`.github/workflows/release.yml`) — pushing a `v*` tag installs
  dependencies (JDK 21 + the runner's Android SDK), runs the unit tests, generates the Android project,
  builds a debug APK, and attaches `signout-<tag>.apk` plus a `.sha256` checksum to that tag's GitHub
  release (creating the release if the tag doesn't have one). The APK is also kept as a workflow artifact.
- **`npm run build`** (`scripts/build-web.mjs`) — stages the web app into `dist/`, now `webDir` in
  `capacitor.config.json`.

### Fixed
- **`npm test` failed on the CI runner.** `node --test "tests/**/*.test.mjs"` only understands glob patterns on
  Node 22+, so Node 20 reported `Could not find '.../tests/**/*.test.mjs'` and the CI job failed. The script now
  passes `tests/*.test.mjs` (shell-expanded on Linux/macOS, globbed natively by Node ≥22 on Windows) and all three
  workflows pin Node 22.
- **APK web payload contained the whole repo.** `webDir: "."` made `cap sync` copy `node_modules`,
  `tests/`, `.github/` and the rest of the source tree into the app's assets. Only `index.html`,
  `manifest.json`, `service-worker.js`, `css/`, `js/` and `icons/` are staged now (~325 KB), and the script
  fails the build if `index.html` references a file that isn't there.
- `package-lock.json` still said `signinout` / `1.0.0` / `ISC`; aligned with `package.json` (`signout` / `1.1.0` / `MIT`).

### Changed
- `npm run sync` / `npm run android` now rebuild `dist/` first, so they can't ship stale assets.
- GitHub Pages (`pages.yml`) now deploys `dist/` instead of the repo root, so `tests/`, `scripts/`,
  `.github/` and package metadata are no longer served (and downloadable) from the public site — the
  deployed PWA is the same payload the APK embeds.
- README: Android build steps, the prebuilt-APK note, and `scripts/` in the project structure.

## [1.1.0] — 2026-09-23

### Added
- **Payroll CSV export** — Admin → Summary → *Payroll CSV*: one row per worker per day with gross, break,
  regular and overtime hours (split against the daily threshold), paid hours, a TOTAL row per worker, and
  flags for missing clock-outs. BOM-prefixed so Excel opens it cleanly; ready for Xero / QuickBooks.
  The builder (`DB.buildPayrollCsv`) is pure and unit-tested.
- **Overtime guard** — optional hard stop on clock-in once the daily or weekly threshold is reached
  (Admin → Settings → Overtime & Sound). Clock-out is never blocked. Every change is written to the audit trail.
- **Accessible in-app dialogs** — `UI.alert()` / `UI.confirm()` / `UI.prompt()`: promise-based, focus-trapped,
  `Esc` to cancel, `aria-modal` + labelled, dark-mode aware, and rendered with `textContent` (no HTML injection).
  All native `alert` / `confirm` / `prompt` calls in the app are now gone.
- **Unit tests** — `npm test` runs Node's built-in runner over `tests/` (hours maths, payroll CSV, overtime guard,
  sanitizers, PIN hashing, geofence maths, dialog fallback). No dependencies, wired into CI.
- `CHANGELOG.md`, and payroll / guard toggles in the admin UI.

### Fixed
- **Dark mode never applied its explicit theme.** Every `[data-theme="dark"]` selector in `css/styles.css`
  was written with escaped quotes (`[data-theme=\"dark\"]`), which is an invalid selector — so the whole dark
  token block was dead and only the `prefers-color-scheme` fallback worked. 28 selectors repaired.
- **PWA install pill never initialised.** Its bootstrap was an inline `<script>`, which the page CSP
  (`script-src 'self'`) blocks. It now self-initialises from `js/pwa-install.js` (idempotent).
- **Missing offline assets** — `audio.js`, `face.js` and `pdf.js` were not precached by the service worker.
- `UI.alert()` resolved with `true` instead of `undefined` when confirmed.
- Leave notes are sanitized at write time (was render-time only).

### Changed
- Service worker cache bumped to `signout-v4` (required for the fixes above to reach existing installs).
- README: project structure, tests section, troubleshooting entries for the new behaviours.

## [1.0.0] — 2026-09-08

### Added
- Initial release: NFC/QR/PIN worker clock-in, GPS geofence, selfie capture, rota & shift templates,
  swaps, leave requests, open-shift bidding, multi-site geofences, audit trail, analytics charts,
  Google Sheets sync, Slack/Teams/Discord webhooks, WhatsApp daily report, PWA offline mode,
  Capacitor Android shell, plus `SECURITY.md` / `RECOMMENDATIONS.md`.

[1.1.0]: https://github.com/glainejustin/signout/compare/v1.0.0...v1.1.0
