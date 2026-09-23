# Changelog

All notable changes to SignOut are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

<!-- New entries go here. When releasing, rename the section to `## [x.y.z] — YYYY-MM-DD`,
     bump the version in package.json + package-lock.json, and add a compare link at the bottom. -->

## [1.2.1] — 2026-09-23

The first release whose **signed artifacts actually publish**. Tag `v1.2.0` built and
signature-verified its AAB, but the branding check then rejected the release APK and every upload step
was skipped, so no `v1.2.0` release was ever created. Everything in the 1.2.0 section below ships here
instead, plus:

### Fixed
- **`npm run verify:apk` rejected release-variant APKs, which blocked the signed artifacts.** AGP's
  release resource optimisation rewrites `res/` paths to short canonical names (`res/aa.png`), so the
  path-based comparison found none of the 26 expected images and reported every one of them missing —
  one step before the AAB and the release APK would have been attached. The check now falls back to
  matching the generated artwork against the PNGs the APK actually contains, and prints the `res/`
  inventory when a match still can't be found. The strict path comparison still runs first, so a stale
  icon sitting at a known path is still caught by pixel comparison. `tests/branding.test.mjs` covers
  both layouts — canonical names, AGP-shortened names, one repainted icon, one dropped icon, and an APK
  whose artwork isn't ours at all.

## [1.2.0] — 2026-09-23

> **Tag `v1.2.0` produced no release.** Its artifact verification failed before anything was uploaded,
> so these changes first shipped in v1.2.1.

### Added
- **`npm run release:check`** (`scripts/release-check.mjs`) — one command that reproduces the release
  workflow locally, before a tag is pushed: dependencies → required files → unit tests → staged web
  assets → debug APK → APK branding verification. The APK stages need a JDK and an Android SDK; without
  them the run ends **PARTIAL** and names what was skipped rather than claiming a pass it didn't earn,
  `--require-apk` makes that fatal, and `--apk <file>` verifies a binary you already have (a downloaded
  release, a CI artifact) with no Android toolchain at all. Platform plumbing — SDK/JDK discovery, the
  `cmd /c` wrapper Windows needs for the npm/npx shims, the Gradle wrapper invocation — is covered by
  `tests/release-check.test.mjs`. CI runs its fast path (`--no-android`) on every push and PR, so the
  staged web payload and its leakage rules are now enforced there too, not only on release. Its
  required-files stage also asserts the release workflow's own scripts exist (`build-web`,
  `generate-icons`, `verify-apk`, `configure-android-signing`), so a missing one fails locally instead of
  halfway through a release.
- **`npm run verify:apk`** (`scripts/verify-apk-branding.mjs`) — opens a built APK, decodes its launcher,
  adaptive-foreground and splash PNGs and compares them against the generated artwork. The release
  workflow runs it right after `assembleDebug` and **fails before naming or uploading anything**, so an
  APK carrying stale or template icons can no longer be published. Comparisons are pixel-based (8×8 cell
  means), so PNG crunching or a different zlib level can't fail a healthy build, while different artwork
  always will. It also asserts each splash is navy with a logo drawn on it, that all 26 expected density
  buckets exist on both sides, and that the icons in the APK's web payload match the committed ones.
  Covered by `tests/branding.test.mjs` (PNG decoder, comparison tolerance, icon inventory, and that the
  navy is identical in the verifier, `manifest.json`, `index.html` and `capacitor.config.json`).
- **`.github/workflows/apk-audit.yml` — a daily audit of the *published* APK.** The release workflow
  checks the binary it builds, but that only happens when a tag is pushed; a published asset can still
  stop matching its source afterwards (re-uploaded, hand-uploaded, mutated). This job downloads the latest
  release's assets, verifies the published checksums and that the stable alias is byte-identical to the
  versioned APK, then regenerates the expected artwork **from that release's own tag** and runs the same
  `verify:apk` comparison against the published binary. Runs nightly (06:17 UTC), immediately on
  `release: published`, and on demand for any tag. A tag predating the icon generator is skipped with a
  notice rather than reported as a failure.
- **`npm run check:actions` (`scripts/check-action-runtimes.mjs`) — CI now fails when a workflow pins an
  action that runs on a deprecated Node runtime.** Bumping eight actions off Node 20 was a one-off; nothing
  stopped the next `uses: actions/checkout@v4` from arriving, since a stale pin looks identical to a current
  one in review and the only signal was a warning annotation nobody fails on. The runtime is not derivable
  from the pin — it lives in each action's own `action.yml` (`runs.using`) — so this reads that file **at the
  pinned ref**, which also catches a tag republished onto an older runtime. There is deliberately no
  action→runtime table to go stale: the single fact encoded is `CURRENT_NODE`, and anything behind it fails
  while anything newer is a warning. **Composite actions are followed into what they wrap** (bounded and
  cycle-safe), because a stale Node action hidden inside e.g. `upload-pages-artifact` is still a stale Node
  action. Malformed references, reusable workflows (which declare no runtime) and `docker://` refs are
  classified rather than skipped silently, and a manifest that cannot be read is an error — a check that
  passes when it verified nothing is worse than no check. Runs in `ci.yml` on every push and PR, needs no
  install or token, and covers `tests/action-runtimes.test.mjs` for the parsing, verdicts, traversal,
  depth limit and cycle handling.
- **Signed release builds — a Play-uploadable AAB and a signed release APK.** Releases previously carried
  only a debug-signed APK, which Play rejects: uploads need a bundle signed with an upload key, and Play
  permanently binds an app to the first key it sees, so a per-run generated key would ship something
  nobody could ever update. `scripts/configure-android-signing.mjs` patches the *generated*
  `app/build.gradle` (there is no committed Gradle file to hold a signingConfig — `android/` is produced
  by `cap add android` on each run) with a signingConfig that reads the credentials from the environment
  at build time, so no secret is ever written to disk, and wires it to the **release build type inside
  `buildTypes`** — the first `release {` in the patched file belongs to `signingConfigs`, so a file-wide
  replace would silently leave the release build unsigned (a regression `tests/signing.test.mjs` now
  pins down). The tag also sets `versionCode`/`versionName`, since Capacitor's template hardcodes
  `versionCode 1` and Play rejects a version code it has already seen. `bundleRelease assembleRelease`
  then produces `signout-vX.Y.Z.aab` and `signout-vX.Y.Z-release.apk`, both attached to the release with
  checksums; before that, the workflow proves the AAB carries a `META-INF` signature entry, runs
  `apksigner verify --print-certs` on the release APK, and re-runs the artwork verification against the
  release variant rather than inferring it from the debug build. Credentials come only from
  `ANDROID_KEYSTORE_BASE64` and the three password/alias secrets; **without them the job still publishes
  the debug APK but warns visibly** in an annotation and in the run summary, so a release with no
  Play-uploadable artifact cannot be mistaken for one that has it. Documented in the README under
  *Signed release builds*.
- **A real maskable app icon.** The manifest declared both icons `"purpose": "any maskable"`, but a single
  file cannot be both: a launcher masks a maskable icon to its own shape, and the rounded mark has
  **transparent corners** (alpha 0 at `(0,0)`), so those corners were being cut into wedges on any launcher
  that masks. `icons/icon-maskable-192/512.png` are now generated full-bleed (corner alpha 255) with the mark
  pulled inside the maskable safe circle (the central 80% diameter, measured at 64% of it), and the manifest
  declares real purposes — `any` for the rounded pair, `maskable` for the new one — alongside the existing
  favicon and Apple touch icon. The mark itself is unchanged: the four pre-existing PNGs regenerate
  byte-for-byte identically, and so do the Android launcher, round, adaptive-foreground and splash assets.
  `tests/branding.test.mjs` now asserts the maskable invariants against the committed pixels (full-bleed, mark
  inside the safe zone, and not shrunk), that each manifest entry exists at its declared size and its purpose
  matches how the file is actually drawn, and that the service worker precaches files that exist — a 404 there
  makes `addAll` reject and breaks the offline install.

### Fixed
- **The README's icons and documentation.** Its four screenshots pointed at `via.placeholder.com`, which no
  longer resolves — they had been rendering as broken images — so they now use a host that answers, and the
  note beside them says plainly that they are placeholders. The docs also quoted a service-worker cache from
  three versions ago (`signout-v3`, and `signout-v4` in the project tree, against an actual `v5`), named a
  released APK that was no longer current (`signout-v1.1.1.apk`), and listed a `scripts/` and `icons/`
  directory that had never been updated for the signing script or the new icon files. The cache version is
  bumped to `signout-v6` for the new icons, and a test now fails if the README ever quotes a cache name the
  service worker does not use — the same class of staleness, in the one place a user actually reads.
- **Manifest entries that could not be satisfied.** The `screenshots` array declared a 512×512 icon as both a
  `narrow` and a `wide` app screenshot, which is not a screenshot and misdescribes both form factors; with no
  real captures in the repo it is removed rather than left to feed the install UI something wrong.

### Changed
- **All GitHub Actions bumped to their current majors** (`checkout` v4→v7, `setup-node` v4→v7, `setup-java` v5→v6,
  `cache` v4→v6, `upload-artifact` v4→v7, `configure-pages` v5→v6, `upload-pages-artifact` v3→v5,
  `deploy-pages` v4→v5). `checkout@v4` and `setup-node@v4` ran on the deprecated Node 20 runtime, which GitHub
  was already force-upgrading to Node 24 with a warning on every run; `cache@v4`, `upload-artifact@v4`,
  `configure-pages@v5` and `deploy-pages@v4` were on the same runtime. Every pinned action now runs on Node 24
  (or is composite), which needs Actions Runner 2.327.1+ — satisfied by hosted `ubuntu-latest`. No workflow
  inputs changed.
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

[1.2.1]: https://github.com/glainejustin/signout/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/glainejustin/signout/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/glainejustin/signout/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/glainejustin/signout/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/glainejustin/signout/compare/v1.0.0...v1.1.0
