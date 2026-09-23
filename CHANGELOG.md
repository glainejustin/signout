# Changelog

All notable changes to SignOut are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

<!-- New entries go here. When releasing, rename the section to `## [x.y.z] — YYYY-MM-DD`,
     bump the version in package.json + package-lock.json, and add a compare link at the bottom. -->

### Added
- **`npm run verify:apk`** (`scripts/verify-apk-branding.mjs`) — opens a built APK, decodes its launcher,
  adaptive-foreground and splash PNGs and compares them against the generated artwork. The release
  workflow runs it right after `assembleDebug` and **fails before naming or uploading anything**, so an
  APK carrying stale or template icons can no longer be published. Comparisons are pixel-based (8×8 cell
  means), so PNG crunching or a different zlib level can't fail a healthy build, while different artwork
  always will. It also asserts each splash is navy with a logo drawn on it, that all 26 expected density
  buckets exist on both sides, and that the icons in the APK's web payload match the committed ones.
  Covered by `tests/branding.test.mjs` (PNG decoder, comparison tolerance, icon inventory, and that the
  navy is identical in the verifier, `manifest.json`, `index.html` and `capacitor.config.json`).

### Changed
- **Release notes come from the changelog.** The release workflow now fills a brand-new release's body with
  that version's `CHANGELOG.md` section (falling back to GitHub's generated notes only when a version has no
  section), rather than always publishing a bare `**Full Changelog**` link. Existing releases are never
  rewritten. Backfilled v1.1.1 and v1.1.2, which had shipped with generated notes.

## [1.1.2] — 2026-09-23

Branding patch: the app icon, launcher icon and launch splash are SignOut's own now, and the APK
finally ships them.

### Added
- **`npm run icons`** (`scripts/generate-icons.mjs`) — draws the SignOut mark (a stopwatch) as signed distance
  fields and exports it with zero dependencies: PWA icons, an Apple touch icon and a favicon, plus, with
  `--android`, every launcher / round / adaptive-foreground / splash density bucket the Android project expects.
  Wired into the release pipeline, so APKs are branded at build time.
- `index.html` now declares a favicon and an `apple-touch-icon` (it previously had neither).
- **Stable APK download URL** — every release now also publishes `signout-latest.apk` (with its own `.sha256`)
  alongside the versioned `signout-<tag>.apk`, so `releases/latest/download/signout-latest.apk` keeps working
  as versions move.
- README: a download badge, a dynamic latest-release badge, and a one-liner install + checksum-verify block
  in the Android section.

### Fixed
- **The shipped icon still said “WT” (WorkTap).** `icons/icon-192.png` and `icon-512.png` hadn't been touched
  since the initial release commit, so the rebrand missed the artwork — visible in the README, on the PWA home
  screen and as the APK launcher icon. Regenerated in SignOut branding.
- **Android launch branding** — `cap add android` supplied Capacitor's stock launcher icons and a Capacitor
  splash screen; both are replaced at build time now, and the adaptive-icon background colour is set to navy
  (was `#FFFFFF`).

### Changed
- `manifest.json` `background_color`/`theme_color` and the Capacitor splash colour were still the pre-rebrand
  indigo `#4f46e5`; now `#0F172A`, matching `<meta name="theme-color">`.
- Service worker precaches the PWA icons (cache → `signout-v5`).

## [1.1.1] — 2026-09-23

Android build pipeline release: the first version with an installable APK attached automatically.

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

[1.1.2]: https://github.com/glainejustin/signout/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/glainejustin/signout/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/glainejustin/signout/compare/v1.0.0...v1.1.0
