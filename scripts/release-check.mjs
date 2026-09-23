/**
 * scripts/release-check.mjs — reproduce the release gate locally, in one command.
 *
 *   npm run release:check
 *
 * The release workflow (`.github/workflows/release.yml`) is the source of truth for what
 * shipping requires, but it only runs after a tag is pushed — so a failing test, a web
 * build that stages the wrong files, or stale icon artwork is discovered *by the release*,
 * on `main`, where the fix costs another tag. This runs the same stages in the same order
 * on your machine, before you tag.
 *
 * Stages: dependencies → required files → unit tests → staged web assets → debug APK →
 * APK branding verification.
 *
 * The APK stages need a JDK and an Android SDK. When those are missing they are reported
 * as **skipped** and the run ends PARTIAL rather than pretending to have passed; pass
 * `--require-apk` to make that fatal on a machine that should be able to build, or
 * `--apk <file>` to check a binary you already have (a downloaded release, a CI artifact)
 * with no Android toolchain at all.
 *
 * Zero dependencies, like the rest of scripts/.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APK_REL = 'android/app/build/outputs/apk/debug/app-debug.apk';

/** Files and dirs `.github/workflows/ci.yml` insists on. */
export const REQUIRED_FILES = ['index.html', 'manifest.json', 'service-worker.js', 'capacitor.config.json'];
export const REQUIRED_DIRS = ['js', 'css'];

/**
 * Scripts the *release* workflow invokes. Its preflight fails without them, and the signed
 * path in particular degrades loudly — so a missing one should be visible here, before a
 * tag, rather than only on the release job.
 */
export const REQUIRED_RELEASE_SCRIPTS = [
  'scripts/build-web.mjs',
  'scripts/generate-icons.mjs',
  'scripts/verify-apk-branding.mjs',
  'scripts/configure-android-signing.mjs',
];

/** What `npm run build` must have produced, and must never have copied in. */
export const REQUIRED_DIST = [
  'index.html',
  'manifest.json',
  'service-worker.js',
  'css/styles.css',
  'js/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];
export const FORBIDDEN_DIST = ['node_modules', 'tests', 'scripts', '.github', 'package.json', 'android'];

// ── Pure helpers (unit-tested in tests/release-check.test.mjs) ───────────────

/**
 * Locate the Android SDK the way the ecosystem does: environment first, then the default
 * install location Android Studio uses on each platform.
 */
export function findAndroidSdk(
  { env = {}, platform = process.platform, home = os.homedir() } = {},
  exists = fs.existsSync,
) {
  const candidates = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    platform === 'win32' ? path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Android', 'Sdk') : null,
    platform === 'darwin' ? path.join(home, 'Library', 'Android', 'sdk') : null,
    platform === 'linux' ? path.join(home, 'Android', 'Sdk') : null,
  ].filter(Boolean);

  for (const dir of candidates) {
    if (exists(path.join(dir, 'platform-tools')) || exists(path.join(dir, 'licenses'))) return dir;
  }
  // An env var pointing anywhere is still an explicit statement by the developer; trust it
  // so a half-populated SDK still gets attempted rather than silently skipped.
  return env.ANDROID_HOME || env.ANDROID_SDK_ROOT || null;
}

const whichDefault = (command, platform) => {
  const probe = spawnSync(platform === 'win32' ? 'where' : 'which', [command], { encoding: 'utf8' });
  return probe.status === 0 ? String(probe.stdout).trim().split(/\r?\n/)[0] : null;
};

/** A JDK requires `$JAVA_HOME/bin/java`, or `java` on PATH. */
export function findJava({ env = {}, platform = process.platform } = {}, exists = fs.existsSync, which = whichDefault) {
  const exe = platform === 'win32' ? 'java.exe' : 'java';
  if (env.JAVA_HOME && exists(path.join(env.JAVA_HOME, 'bin', exe))) return path.join(env.JAVA_HOME, 'bin', exe);
  return which('java', platform);
}

/**
 * How to invoke the Gradle wrapper. On Windows the wrapper is a `.bat`, which Node can only
 * launch through the shell; elsewhere it is the POSIX script and needs the executable bit
 * (the release workflow runs `chmod +x` for the same reason).
 */
export function gradleInvocation(platform = process.platform) {
  return platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'gradlew.bat', 'assembleDebug', '--no-daemon'] }
    : { command: './gradlew', args: ['assembleDebug', '--no-daemon'] };
}

/**
 * How to launch a command. Windows ships npm/npx as `.cmd` shims, which Node refuses to
 * spawn directly (`EINVAL`, since the CVE-2024-27980 fix), so those go through cmd.exe.
 * Nothing is shell-interpolated: arguments are passed to cmd as separate argv entries.
 */
export function spawnCommand(name, args, platform = process.platform) {
  return platform === 'win32' && (name === 'npm' || name === 'npx')
    ? { command: 'cmd', args: ['/c', name, ...args] }
    : { command: name, args };
}

// ── The gate ─────────────────────────────────────────────────────────────────

export function main(argv) {
  const apkFlag = argv.indexOf('--apk');
  const OPTIONS = {
    apk: apkFlag >= 0 ? argv[apkFlag + 1] : null,
    requireApk: argv.includes('--require-apk'),
    noAndroid: argv.includes('--no-android'),
    fresh: argv.includes('--fresh'),
    help: argv.includes('--help') || argv.includes('-h'),
  };

  const useColor = process.stdout.isTTY;
  const C = {
    dim: s => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
    green: s => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
    red: s => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
    yellow: s => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
    bold: s => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  };

  const results = [];
  let stepNo = 0;
  const totalSteps = OPTIONS.noAndroid ? 4 : 6;

  function run(name, args, opts = {}) {
    const started = Date.now();
    const { command, args: spawnArgs } = spawnCommand(name, args);
    const result = spawnSync(command, spawnArgs, {
      cwd: opts.cwd || ROOT,
      stdio: opts.quiet ? 'pipe' : 'inherit',
      encoding: 'utf8',
    });
    if (result.error) throw new Error(`could not run ${name}: ${result.error.message}`);
    return {
      status: result.status,
      output: `${result.stdout || ''}${result.stderr || ''}`,
      ms: Date.now() - started,
    };
  }

  /** Record a stage: pass, fail, skip (a coverage gap) or info (bypassed on purpose). */
  function record(title, status, detail = '') {
    stepNo++;
    const mark = { pass: C.green('✔'), fail: C.red('✖'), skip: C.dim('○'), info: C.dim('○') }[status];
    const colour = status === 'fail' ? C.red : status === 'skip' || status === 'info' ? C.dim : String;
    const label = `${mark} ${String(stepNo).padStart(2)}/${totalSteps} ${title.padEnd(26)}`;
    console.log(`${label} ${colour(detail)}`);
    results.push({ title, status, detail });
  }

  function stage(title, fn) {
    const outcome = fn();
    record(title, outcome.status, outcome.detail);
    return outcome.status !== 'fail';
  }

  function summary() {
    const failed = results.filter(r => r.status === 'fail');
    const skipped = results.filter(r => r.status === 'skip');
    const info = results.filter(r => r.status === 'info');
    const passed = results.filter(r => r.status === 'pass');
    console.log();

    if (failed.length) {
      const extras = [
        skipped.length && `${skipped.length} skipped`,
        info.length && `${info.length} bypassed`,
      ].filter(Boolean).join(', ');
      console.log(C.red(C.bold(`FAIL — ${passed.length} passed, ${failed.length} failed${extras ? `, ${extras}` : ''}`)));
      for (const f of failed) console.log(C.red(`  ✖ ${f.title}: ${f.detail}`));
      console.log(C.dim('\nA tag pushed now would fail the release workflow.'));
      process.exit(1);
    }
    if (skipped.length) {
      const severity = OPTIONS.requireApk ? C.red : C.yellow;
      console.log(severity(C.bold(
        `${OPTIONS.requireApk ? 'FAIL' : 'PARTIAL'} — ${passed.length} passed, ${skipped.length} skipped`
        + (OPTIONS.requireApk ? ' and --require-apk was given' : ''),
      )));
      for (const s of skipped) console.log(severity(`  ○ ${s.title}: ${s.detail}`));
      console.log(C.dim('\nThose stages need a JDK + Android SDK, or an APK to check:'));
      console.log(C.dim('  npm run release:check -- --apk path/to/signout-vX.Y.Z.apk   (a build you already downloaded)'));
      console.log(C.dim('  npm run release:check -- --require-apk                      (fail instead of skipping)'));
      process.exit(OPTIONS.requireApk ? 1 : 0);
    }
    for (const i of info) console.log(C.dim(`  ○ ${i.title}: ${i.detail}`));
    console.log(C.green(C.bold(`PASS — ${passed.length} stages, all clear. Safe to tag.`)));
    process.exit(0);
  }

  if (OPTIONS.help) {
    console.log(`SignOut release gate

  npm run release:check                     # everything the release workflow runs
  npm run release:check -- --apk <file>     # check an APK you already have (no SDK needed)
  npm run release:check -- --require-apk    # treat "cannot build the APK" as a failure
  npm run release:check -- --no-android     # fast: dependencies, files, tests, web build
  npm run release:check -- --fresh          # npm ci instead of reusing node_modules

Signed release artifacts (Play AAB + release APK) are the one part of the release
workflow this cannot rehearse: signing needs the keystore, which only exists as a
repository secret. Their wiring is asserted by tests/signing.test.mjs instead, and the
signed build itself first runs on a real tag.
`);
    process.exit(0);
  }

  // An APK handed in on the command line is copied aside first: the web-assets stage
  // rebuilds dist/, so `--apk dist/release.apk` would otherwise delete its own input.
  let apkInput = null;
  if (OPTIONS.apk) {
    const given = path.resolve(OPTIONS.apk);
    if (!fs.existsSync(given)) {
      console.error(C.red(`✖ --apk file not found: ${given}`));
      process.exit(1);
    }
    apkInput = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'signout-check-')), 'input.apk');
    fs.copyFileSync(given, apkInput);
  }

  const java = findJava();
  const sdk = findAndroidSdk();

  console.log(C.bold('SignOut release gate') + C.dim('  —  the same stages as .github/workflows/release.yml, run locally'));
  console.log(C.dim(`node ${process.version} · java ${java || 'not found'} · android sdk ${sdk || 'not found'}`));
  console.log();

  // ── 1. Dependencies ────────────────────────────────────────────────────────
  stage('dependencies', () => {
    if (!OPTIONS.fresh && fs.existsSync(path.join(ROOT, 'node_modules', '@capacitor', 'cli'))) {
      return { status: 'pass', detail: 'node_modules present (--fresh to reinstall)' };
    }
    const { status } = run('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error']);
    return status === 0
      ? { status: 'pass', detail: 'npm ci' }
      : { status: 'fail', detail: 'npm ci failed — see output above' };
  });

  // ── 2. Required files (mirrors ci.yml) ────────────────────────────────────
  stage('required files', () => {
    const missing = [
      ...REQUIRED_FILES.filter(f => !fs.existsSync(path.join(ROOT, f))),
      ...REQUIRED_DIRS.filter(d => !fs.statSync(path.join(ROOT, d), { throwIfNoEntry: false })?.isDirectory()),
      ...REQUIRED_RELEASE_SCRIPTS.filter(f => !fs.existsSync(path.join(ROOT, f))),
    ];
    return missing.length
      ? { status: 'fail', detail: `missing: ${missing.join(', ')}` }
      : { status: 'pass', detail: `${REQUIRED_FILES.length} files, ${REQUIRED_DIRS.length} dirs, ${REQUIRED_RELEASE_SCRIPTS.length} release scripts` };
  });

  // ── 3. Unit tests ─────────────────────────────────────────────────────────
  if (!stage('unit tests', () => {
    const { status, output, ms } = run('npm', ['test', '--silent'], { quiet: true });
    const interesting = output.split('\n').filter(l => /^ℹ (tests|pass|fail)|^\s*✖/.test(l.trim()));
    if (interesting.length) process.stdout.write(interesting.join('\n') + '\n');
    return status === 0
      ? { status: 'pass', detail: `all tests passed (${(ms / 1000).toFixed(1)}s)` }
      : { status: 'fail', detail: 'unit tests failed — see output above' };
  })) {
    // Nothing below is worth building on a red test suite, and re-running the gate is cheap.
    summary();
  }

  // ── 4. Staged web assets ──────────────────────────────────────────────────
  stage('stage web assets', () => {
    const { status, output } = run('npm', ['run', 'build'], { quiet: true });
    if (status !== 0) {
      process.stdout.write(output);
      return { status: 'fail', detail: 'npm run build failed' };
    }
    const dist = path.join(ROOT, 'dist');
    const missing = REQUIRED_DIST.filter(f => !fs.existsSync(path.join(dist, f)));
    if (missing.length) return { status: 'fail', detail: `dist/ is missing: ${missing.join(', ')}` };
    const leaked = FORBIDDEN_DIST.filter(f => fs.existsSync(path.join(dist, f)));
    if (leaked.length) return { status: 'fail', detail: `dist/ contains files that must not ship: ${leaked.join(', ')}` };
    const entries = fs.readdirSync(dist, { recursive: true }).length;
    return { status: 'pass', detail: `dist/ staged, ${entries} entries, no leakage` };
  });

  if (OPTIONS.noAndroid) summary();

  // ── 5. Debug APK ──────────────────────────────────────────────────────────
  let apkPath = null;
  stage('build debug APK', () => {
    if (OPTIONS.apk) {
      // Deliberate, not a coverage gap: the caller chose which binary to check.
      apkPath = apkInput;
      return { status: 'info', detail: `verifying the APK you passed: ${OPTIONS.apk}` };
    }
    const built = path.join(ROOT, APK_REL);
    if (fs.existsSync(built)) {
      apkPath = built;
      return { status: 'info', detail: `reusing the existing ${APK_REL} (delete android/app/build to force a rebuild)` };
    }
    if (!java || !sdk) {
      const missing = [!java && 'a JDK (set JAVA_HOME)', !sdk && 'an Android SDK (set ANDROID_HOME)'].filter(Boolean).join(' and ');
      return { status: 'skip', detail: `needs ${missing} — install Android Studio, or pass --apk <file>` };
    }

    const androidDir = path.join(ROOT, 'android');
    const capArgs = fs.existsSync(androidDir) ? ['cap', 'sync', 'android'] : ['cap', 'add', 'android'];
    const cap = run('npx', capArgs);
    if (cap.status !== 0) return { status: 'fail', detail: `npx ${capArgs.join(' ')} failed` };

    // Branding must run after the platform exists and before Gradle reads the resources.
    const icons = run('npm', ['run', 'icons', '--', '--android'], { quiet: true });
    if (icons.status !== 0) {
      process.stdout.write(icons.output);
      return { status: 'fail', detail: 'npm run icons -- --android failed' };
    }

    if (process.platform !== 'win32') {
      try { fs.chmodSync(path.join(androidDir, 'gradlew'), 0o755); } catch { /* absent — Gradle will say so */ }
    }
    const gradle = gradleInvocation();
    const build = run(gradle.command, gradle.args, { cwd: androidDir });
    if (build.status !== 0) return { status: 'fail', detail: 'gradle assembleDebug failed — see output above' };
    if (!fs.existsSync(built)) return { status: 'fail', detail: `gradle reported success but ${APK_REL} is missing` };

    apkPath = built;
    return { status: 'pass', detail: `assembleDebug in ${(build.ms / 1000).toFixed(0)}s` };
  });

  // ── 6. APK branding verification ──────────────────────────────────────────
  stage('verify APK branding', () => {
    if (!apkPath) return { status: 'skip', detail: 'no APK to verify' };

    // The Android artwork is generated, not committed, so materialise the expected images
    // without needing Capacitor or the SDK: the generator creates every directory below
    // the res root (this is how the nightly audit checks a published APK too).
    const res = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
    if (!fs.existsSync(res)) {
      fs.mkdirSync(path.join(res, 'values'), { recursive: true });
      const icons = run('node', ['scripts/generate-icons.mjs', '--android'], { quiet: true });
      if (icons.status !== 0) {
        process.stdout.write(icons.output);
        return { status: 'fail', detail: 'could not generate the expected artwork' };
      }
    }

    const { status, output } = run(
      'node',
      ['scripts/verify-apk-branding.mjs', apkPath, res, path.join(ROOT, 'icons')],
      { quiet: true },
    );
    if (status === 0) {
      const line = output.split('\n').find(l => l.startsWith('verified ')) || 'artwork matches';
      const worst = output.split('\n').find(l => l.startsWith('worst match'));
      return { status: 'pass', detail: line + (worst ? `, worst delta ${worst.match(/delta ([\d.]+)/)?.[1]}` : '') };
    }
    process.stdout.write(output);
    return { status: 'fail', detail: 'the APK does not ship the generated artwork — see output above' };
  });

  summary();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
