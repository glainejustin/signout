/**
 * tests/signing.test.mjs — signed release builds (Play AAB).
 *
 * The Gradle project is generated on every CI run, so signing is patched in by a script.
 * Two mistakes there are expensive and silent: wiring the signing config to the wrong
 * `release {` block (the file has two once `signingConfigs` is inserted — which is exactly
 * what happened when this was first written), and a no-op patch that still lets an
 * unsigned AAB be attached to a release. Both are pinned here.
 *
 * The second half asserts the *pipeline* around the script, because a correct script can
 * still sit in a broken workflow — and nothing about that is observable on a developer
 * machine, only on a tag push with the real secrets. The credentials the patched Gradle
 * reads have to actually reach the Gradle step (a step-level `env:` does not carry over to
 * later steps, which is how the passwords were first wired up), the keystore must never
 * land in the workspace, and proving the signature has to happen before the upload that
 * publishes it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_ENV,
  patchBuildGradle,
  readBlock,
  versionCodeFor,
  versionFromTag,
  versionNameFor,
} from '../scripts/configure-android-signing.mjs';

/** The shape of Capacitor's generated app/build.gradle, trimmed to what matters. */
const TEMPLATE = `apply plugin: 'com.android.application'

android {
    namespace = "com.signout.attendance"
    compileSdk = rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "com.signout.attendance"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}

dependencies {
    implementation project(':capacitor-android')
}
`;

const patched = (tag = 'v1.1.3') => {
  const v = versionFromTag(tag);
  return patchBuildGradle(TEMPLATE, { versionCode: versionCodeFor(v), versionName: versionNameFor(v) });
};

test('version codes follow the tag and move forward', () => {
  assert.equal(versionCodeFor(versionFromTag('v1.1.2')), 10102);
  assert.equal(versionCodeFor(versionFromTag('1.1.3')), 10103);
  assert.equal(versionCodeFor(versionFromTag('v1.1.3-rc.1')), 10103, 'pre-release suffix ignored');
  assert.ok(versionCodeFor(versionFromTag('v1.2.0')) > versionCodeFor(versionFromTag('v1.1.9')));
  assert.ok(versionCodeFor(versionFromTag('v2.0.0')) > versionCodeFor(versionFromTag('v1.99.99')));
  assert.equal(versionNameFor(versionFromTag('v1.1.3')), '1.1.3');
});

test('an unusable tag is refused rather than guessed', () => {
  for (const bad of ['latest', 'v1.2', 'v1.2.3.4', '', 'main', 'vnext']) {
    assert.throws(() => versionFromTag(bad), /cannot read a version|/i, `"${bad}" should be refused`);
  }
  // The scheme cannot order a version code past minor/patch 99, so it must not try.
  assert.throws(() => versionFromTag('v1.100.0'), /above 99/);
  assert.throws(() => versionCodeFor({ major: 300000, minor: 0, patch: 0 }), /outside Play's valid range/);
});

test('the patch wires signingConfigs.release into the *build type*, not into signingConfigs', () => {
  const out = patched();
  const buildTypes = readBlock(out, 'buildTypes');
  const signingConfigs = readBlock(out, 'signingConfigs');

  assert.ok(buildTypes, 'buildTypes block should exist');
  assert.ok(signingConfigs, 'signingConfigs block should be injected');
  assert.equal((buildTypes.match(/signingConfig signingConfigs\.release/g) || []).length, 1);
  assert.equal((signingConfigs.match(/signingConfig signingConfigs\.release/g) || []).length, 0,
    'signingConfigs must not wire itself');
  // The regression this guards: a file-wide replace hits the first `release {`, which is
  // now inside signingConfigs, leaving the real release build type unsigned.
  assert.ok(buildTypes.indexOf('signingConfig signingConfigs.release') < buildTypes.indexOf('minifyEnabled'),
    'the wiring should sit inside the release build type');
});

test('credentials are read from the environment, never written into the file', () => {
  const out = patched();
  for (const name of REQUIRED_ENV) {
    assert.ok(out.includes(`System.getenv('${name}')`), `${name} should be read from the environment`);
  }
  assert.ok(!/storePassword\s+["']/.test(out), 'no literal store password');
  assert.ok(!/keyPassword\s+["']/.test(out), 'no literal key password');
});

test('the version, which Play requires to advance, comes from the tag', () => {
  const out = patched('v2.3.4');
  assert.match(out, /^\s*versionCode 20304$/m);
  assert.match(out, /^\s*versionName "2\.3\.4"$/m);
  assert.equal((out.match(/versionCode /g) || []).length, 1);
  assert.equal((out.match(/versionName /g) || []).length, 1);
});

test('patching is idempotent — a re-run cannot duplicate blocks', () => {
  const once = patched('v1.1.3');
  const twice = patchBuildGradle(once, { versionCode: 10103, versionName: '1.1.3' });
  assert.equal(twice, once);
  assert.equal((twice.match(/^ {4}signingConfigs \{/gm) || []).length, 1);
});

test('re-patching a different version updates in place', () => {
  const v113 = patched('v1.1.3');
  const v120 = patchBuildGradle(v113, { versionCode: 10200, versionName: '1.2.0' });
  assert.match(v120, /^\s*versionCode 10200$/m);
  assert.equal((v120.match(/^ {4}signingConfigs \{/gm) || []).length, 1);
  assert.equal((v120.match(/signingConfig signingConfigs\.release/g) || []).length, 1);
});

test('a template that no longer matches is refused, not silently skipped', () => {
  const noBuildTypes = TEMPLATE.replace(/^ {4}buildTypes \{[\s\S]*?^ {4}\}\n/m, '');
  assert.throws(() => patchBuildGradle(noBuildTypes, { versionCode: 1, versionName: '1.0' }), /buildTypes/);

  const noVersion = TEMPLATE.replace(/^\s*versionCode \d+$/m, '');
  assert.throws(() => patchBuildGradle(noVersion, { versionCode: 1, versionName: '1.0' }), /versionCode/);

  const noRelease = TEMPLATE.replace(/^ {8}release \{[\s\S]*?^ {8}\}\n/m, '');
  assert.throws(() => patchBuildGradle(noRelease, { versionCode: 1, versionName: '1.0' }), /release|build type/);
});

test('the rest of the Gradle file is preserved', () => {
  const out = patched();
  for (const keep of ["apply plugin: 'com.android.application'", 'applicationId "com.signout.attendance"',
    'implementation project(\':capacitor-android\')']) {
    assert.ok(out.includes(keep), `should still contain ${keep}`);
  }
  assert.ok(out.trimEnd().endsWith('}'));
});

// ── The pipeline around the script ──────────────────────────────────────────
// Parsed with a small line scanner rather than a YAML dependency: the repo has no
// runtime dependencies, and the shapes being asserted (step names, step-level `env:`
// keys, `$GITHUB_ENV` exports, step order) are fixed and shallow.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');

/** The workflow's steps, in file order, with their bodies kept verbatim. */
function parseSteps(text) {
  const steps = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const head = /^ {6}- (.*)$/.exec(line);
    if (head) {
      current = { head: head[1], body: [] };
      current.name = /^name:\s*(.+)$/.exec(head[1])?.[1]?.trim() || null;
      steps.push(current);
    } else if (current) {
      // A line at step indent (including the comment block before the next step) starts
      // outside this step: attributing prose to the step above it would let a stray
      // "if:" in a comment satisfy — or break — the control-flow assertions below.
      if (/^ {0,6}\S/.test(line)) current = null;
      else current.body.push(line);
    }
  }
  return steps;
}

const STEPS = parseSteps(WORKFLOW);

function step(name) {
  const found = STEPS.find(s => s.name === name);
  assert.ok(found, `release.yml should have a step named "${name}"`);
  return found;
}

const indexOfStep = name => STEPS.indexOf(step(name));

/** Keys of a step's own `env:` block (2-space children of `env:` at step indent). */
function stepEnv(step) {
  const keys = [];
  let inEnv = false;
  for (const line of step.body) {
    if (/^ {8}env:\s*$/.test(line)) { inEnv = true; continue; }
    if (inEnv && /^ {8}\S/.test(line)) inEnv = false;
    if (inEnv) {
      const key = /^ {10}([A-Z_][A-Z0-9_]*):/.exec(line);
      if (key) keys.push(key[1]);
    }
  }
  return keys;
}

/** Variables the workflow persists for later steps via `$GITHUB_ENV`. */
const exportedToEnv = [...WORKFLOW.matchAll(/echo "([A-Z_][A-Z0-9_]*)=[^"]*" >> "\$GITHUB_ENV"/g)].map(m => m[1]);

assert.ok(exportedToEnv.length > 0, 'the scanner should find at least one $GITHUB_ENV export');

/** Keys of the job-level `env:` block, if the workflow ever grows one. */
const JOB_ENV = (() => {
  const keys = [];
  let inEnv = false;
  for (const line of WORKFLOW.split(/\r?\n/)) {
    if (/^ {4}env:\s*$/.test(line)) { inEnv = true; continue; }
    if (inEnv && /^ {4}\S/.test(line)) inEnv = false;
    if (inEnv) {
      const key = /^ {6}([A-Z_][A-Z0-9_]*):/.exec(line);
      if (key) keys.push(key[1]);
    }
  }
  return keys;
})();

const reachable = (...steps) => [
  ...steps.flatMap(s => stepEnv(step(s))),
  ...exportedToEnv,
  ...JOB_ENV,
];

test('the workflow parses into the steps the assertions below rely on', () => {
  assert.ok(STEPS.length >= 20, `expected the full pipeline, found ${STEPS.length} steps`);
  // If the scanner ever stops understanding the file, these look-ups would throw instead
  // of the suite silently asserting nothing.
  for (const name of ['Detect signing credentials', 'Decode the signing keystore',
    'Configure release signing', 'Build signed AAB and release APK', 'Verify the signature']) {
    assert.ok(STEPS.some(s => s.name === name), `missing step: ${name}`);
  }
});

test('every credential the patched Gradle reads actually reaches the Gradle step', () => {
  // The bug this pins down: ANDROID_KEYSTORE_PASSWORD / _ALIAS / _KEY_PASSWORD were set as
  // step-level `env:` on the configure step only. Gradle reads them from its own process
  // environment, and step env does not persist — so the release build would have signed
  // with nulls and failed on the first real tag, the one place it cannot be rehearsed.
  const atBuild = reachable('Build signed AAB and release APK');
  for (const name of REQUIRED_ENV) {
    assert.ok(atBuild.includes(name), `${name} is read from the environment by the patched ` +
      'build.gradle but never reaches the Gradle build step (step env does not carry over)');
  }
});

test('signing steps are gated on the secret being present', () => {
  const gated = ['Decode the signing keystore', 'Configure release signing',
    'Build signed AAB and release APK', 'Verify the signature',
    'Name and checksum the signed artifacts', 'Upload signed artifacts',
    'Attach the signed artifacts to the release'];
  for (const name of gated) {
    const s = step(name);
    assert.match(s.body.join('\n'), /if:.*steps\.signing\.outputs\.configured == 'true'/,
      `"${name}" should not run without credentials`);
  }
  // …and the debug APK path stays unconditional, so a release without secrets still ships.
  assert.ok(!/if:/.test(step('Build debug APK').body.join('\n')), 'debug build should always run');
  assert.ok(!/if:/.test(step('Attach APK to the release').body.join('\n')), 'debug APK should always attach');
});

test('a missing secret degrades visibly instead of silently', () => {
  const detect = step('Detect signing credentials').body.join('\n');
  assert.match(detect, /::warning::/, 'absence of the secret should be annotated');
  assert.match(detect, /configured=false/, 'the unconfigured path should be recorded');

  const summary = step('Summary').body.join('\n');
  assert.match(summary, /No signed build/, 'the run summary should say the AAB is missing');
  assert.match(summary, /steps\.signing\.outputs\.configured/, 'the summary should branch on it');
});

test('the keystore lives outside the workspace and is removed afterwards', () => {
  const decode = step('Decode the signing keystore').body.join('\n');
  assert.match(decode, /KEYSTORE="\$RUNNER_TEMP\//, 'the keystore should be written to $RUNNER_TEMP');
  assert.match(decode, /base64 -d/, 'the secret is base64 and must be decoded');

  // It must never end up in an artifact: that is how a signing key leaks out of CI. Any
  // upload step reaching into $RUNNER_TEMP is suspect, not just one naming the file —
  // `path: $RUNNER_TEMP` would sweep up the keystore just as effectively.
  const uploads = STEPS.filter(s => /uses: actions\/upload-artifact/.test(s.body.join('\n')));
  assert.ok(uploads.length >= 2, 'expected the unsigned and signed artifact uploads');
  for (const s of uploads) {
    const body = s.body.join('\n');
    assert.ok(!/upload\.jks/.test(body), `"${s.name}" must not upload the keystore`);
    assert.ok(!/\$RUNNER_TEMP|\$\{\{ env\.RUNNER_TEMP/.test(body),
      `"${s.name}" must not upload anything from $RUNNER_TEMP, where the keystore lives`);
  }

  const remove = step('Remove the keystore');
  assert.match(remove.body.join('\n'), /if: always\(\)/, 'cleanup should run even when the build fails');
});

test('no signing password is ever echoed into the log', () => {
  for (const line of WORKFLOW.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    assert.ok(!/echo[^\n]*\$(ANDROID_KEYSTORE_PASSWORD|ANDROID_KEY_PASSWORD|KEYSTORE_B64)\b/.test(line),
      `a password would be printed: ${line.trim()}`);
    assert.ok(!/set -x/.test(line), 'set -x would print the credentials in the decode steps');
  }
});

test('the signature and the artwork are proven before the artifacts are named or attached', () => {
  const order = ['Build signed AAB and release APK', 'Verify the signature',
    'Verify the release APK ships the branded artwork', 'Name and checksum the signed artifacts',
    'Upload signed artifacts', 'Attach the signed artifacts to the release'];
  const indices = order.map(indexOfStep);
  assert.deepEqual(indices, [...indices].sort((a, b) => a - b),
    `these must run in this order: ${order.join(' → ')}`);

  // "It built" is not "it is signed": the AAB needs a META-INF signature and the release
  // APK needs a verifiable one, checked before either is published.
  const verify = step('Verify the signature').body.join('\n');
  assert.match(verify, /META-INF/, 'the AAB is a signed JAR — assert it carries a signature entry');
  assert.match(verify, /apksigner/i, 'the release APK should be checked with apksigner');
  assert.match(verify, /--print-certs/, 'and the signing certificate printed, so the run records the key used');

  const attach = step('Attach the signed artifacts to the release').body.join('\n');
  assert.match(attach, /steps\.signed\.outputs\.aab/, 'the AAB should be attached to the release');
  assert.match(attach, /\.sha256/, 'artifacts should ship with checksums');
});

test('the release build is verified against the release variant, not the debug one', () => {
  const verifyArt = step('Verify the release APK ships the branded artwork').body.join('\n');
  assert.match(verifyArt, /apk\/release\/app-release\.apk/, 'should verify the signed release APK');
  assert.match(step('Configure release signing').body.join('\n'), /configure-android-signing\.mjs/);
  assert.match(step('Configure release signing').body.join('\n'), /steps\.rel\.outputs\.tag/,
    'the tag decides versionCode/versionName');
});

test('an older tag without the signing script fails loudly only when signing is on', () => {
  const preflight = step('Preflight — tagged tree is buildable').body.join('\n');
  assert.match(preflight, /configure-android-signing\.mjs/, 'preflight should know about the script');
  assert.match(preflight, /steps\.signing\.outputs\.configured/, 'the check should be conditional');
});

test('the README has the section the workflow tells people to read', () => {
  // The warning/error annotations say "see README → Signed release builds"; a dead pointer
  // in an error message is worse than no pointer, because it reads as documented help.
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const heading = readme.match(/^#{2,4}\s+(.*Signed release builds.*)$/m)?.[1];
  assert.ok(heading, 'README should document signing under a "Signed release builds" heading');
  for (const name of ['ANDROID_KEYSTORE_BASE64', ...REQUIRED_ENV.slice(1)]) {
    assert.ok(readme.includes(name), `README should name the ${name} secret`);
  }
  // Every secret the workflow consumes should be documented; a secret nobody can find is
  // a secret nobody configures, which is why the signed path silently never ran.
  for (const secret of WORKFLOW.matchAll(/secrets\.([A-Z0-9_]+)/g)) {
    assert.ok(readme.includes(secret[1]), `${secret[1]} is used by the workflow but undocumented`);
  }
});
