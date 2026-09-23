/**
 * scripts/configure-android-signing.mjs — make the generated Android project produce a
 * **signed** release: a Play-uploadable AAB and an installable release APK.
 *
 * Why a script instead of committing a signingConfig: `android/` is generated fresh by
 * `npx cap add android` on every CI run (it is git-ignored), so there is no committed
 * Gradle file to hold one. This patches the generated `app/build.gradle` in place.
 *
 * Credentials are never written into the patched file — Gradle reads them from the
 * environment at build time (`System.getenv`), so the patched project contains no secrets
 * even though it lives on disk.
 *
 * The release tag also sets `versionCode` / `versionName`. Play permanently rejects a
 * version code it has already seen in a release, so the template's hardcoded
 * `versionCode 1` would work exactly once; the scheme here is
 * `major*10000 + minor*100 + patch`, which increases with `vX.Y.Z`.
 *
 *   node scripts/configure-android-signing.mjs v1.2.3
 *
 * Exits non-zero, without touching the file, when the tag is unusable, the environment is
 * missing credentials, or the Gradle template no longer matches what this expects — a
 * silent no-op would attach an *unsigned* AAB to the release.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Environment variables Gradle reads at build time; the workflow supplies them. */
export const REQUIRED_ENV = [
  'ANDROID_KEYSTORE_PATH',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
];

/** The signingConfig block injected into `android { }`, before `buildTypes`. */
const SIGNING_CONFIGS = `    signingConfigs {
        release {
            // Filled from the environment at build time: no secret is written to disk.
            storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('ANDROID_KEY_ALIAS')
            keyPassword System.getenv('ANDROID_KEY_PASSWORD')
            // This is the *upload* key. With Play App Signing enabled, Google holds the
            // real app key and this one only authorises uploads (and can be reset).
        }
    }
`;

// ── Pure helpers (unit-tested in tests/signing.test.mjs) ─────────────────────

/**
 * `v1.2.3`, `1.2.3`, and pre-releases like `v1.2.3-rc.1` → { major, minor, patch }.
 * Throws on anything else, because guessing a version code is how two releases collide.
 */
export function versionFromTag(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(tag).trim());
  if (!match) throw new Error(`cannot read a version out of the tag "${tag}" — expected vMAJOR.MINOR.PATCH`);
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (minor > 99 || patch > 99) {
    throw new Error(`tag "${tag}" has a minor/patch above 99, which this version-code scheme cannot order`);
  }
  return { major, minor, patch };
}

/** Monotonic, Play-legal version code for a version. */
export function versionCodeFor({ major, minor, patch }) {
  const code = major * 10000 + minor * 100 + patch;
  if (code < 1 || code > 2100000000) throw new Error(`version code ${code} is outside Play's valid range`);
  return code;
}

/** The version name Play displays, e.g. `1.2.3`. */
export const versionNameFor = ({ major, minor, patch }) => `${major}.${minor}.${patch}`;

/** Extract a top-level `android { }` child block (e.g. `buildTypes`, `signingConfigs`). */
export function readBlock(source, name) {
  const match = new RegExp(`^ {4}${name} \\{\\n([\\s\\S]*?)^ {4}\\}`, 'm').exec(source);
  return match ? match[1] : null;
}

/**
 * Patch the generated app/build.gradle: signingConfigs + wiring + version.
 * Idempotent — patching twice produces the same text, so a re-run can't duplicate blocks.
 */
export function patchBuildGradle(source, { versionCode, versionName }) {
  const fail = message => { throw new Error(`${message} (the Capacitor Gradle template changed?)`); };

  if (!/^android \{/m.test(source)) fail('no `android {` block found');
  if (!/^ {4}buildTypes \{/m.test(source)) fail('no `buildTypes {` block found');
  if (!/^ {4}signingConfigs \{/m.test(source) && !/^ {4}buildTypes \{/m.test(source)) fail('cannot find where to add signingConfigs');
  if (!/^\s*versionCode \d+/m.test(source)) fail('no `versionCode` line found');
  if (!/^\s*versionName "/m.test(source)) fail('no `versionName` line found');

  let out = source;

  // 1. The signingConfigs block: drop a previously injected one, then insert before buildTypes.
  out = out.replace(/^ {4}signingConfigs \{[\s\S]*?^ {4}\}\n/m, '');
  const buildTypesAt = out.search(/^ {4}buildTypes \{/m);
  if (buildTypesAt < 0) fail('the buildTypes block disappeared while patching');
  out = out.slice(0, buildTypesAt) + SIGNING_CONFIGS + out.slice(buildTypesAt);

  // 2. Wire *the release build type inside buildTypes* to it. This has to be scoped to the
  //    buildTypes block: the first `release {` in the file now belongs to signingConfigs,
  //    so a file-wide replace would wire the signing config to itself and leave the actual
  //    release build type unsigned.
  const bt = /^ {4}buildTypes \{\n([\s\S]*?)^ {4}\}/m.exec(out);
  if (!bt) fail('could not read the buildTypes block');
  let block = bt[1].replace(/^[ \t]*signingConfig signingConfigs\.release\r?\n/gm, '');
  const wired = block.replace(/^([ \t]*)release \{\n/m, (m, indent) => `${m}${indent}    signingConfig signingConfigs.release\n`);
  if (wired === block) fail('the release build type has no `release {` block inside buildTypes');
  out = out.slice(0, bt.index) + `    buildTypes {\n${wired}    }` + out.slice(bt.index + bt[0].length);

  // 3. Version, which Play requires to move forward on every upload.
  out = out.replace(/^(\s*)versionCode \d+$/m, `$1versionCode ${versionCode}`);
  out = out.replace(/^(\s*)versionName "[^"]*"$/m, `$1versionName "${versionName}"`);

  // 4. Prove the patch landed where intended rather than assuming the regexes matched.
  const signingConfigs = readBlock(out, 'signingConfigs');
  const buildTypes = readBlock(out, 'buildTypes');
  if (!signingConfigs) fail('signingConfigs block is missing after patching');
  if (!buildTypes) fail('buildTypes block is unreadable after patching');

  const wiring = (buildTypes.match(/signingConfig signingConfigs\.release/g) || []).length;
  if (wiring !== 1) fail(`the release build type should reference signingConfigs.release once, found ${wiring}`);
  if (/signingConfig signingConfigs\.release/.test(signingConfigs)) fail('the signingConfigs block wires itself');
  for (const env of ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
    if (!signingConfigs.includes(env)) fail(`the signingConfigs block does not read ${env}`);
  }

  const counts = {
    [`versionCode ${versionCode}`]: (out.match(new RegExp(`versionCode ${versionCode}\\b`, 'g')) || []).length,
    [`versionName "${versionName}"`]: (out.match(new RegExp(`versionName "${versionName}"`, 'g')) || []).length,
    'signingConfigs {': (out.match(/^ {4}signingConfigs \{/gm) || []).length,
  };
  for (const [needle, count] of Object.entries(counts)) {
    if (count !== 1) fail(`expected exactly one "${needle}" after patching, found ${count}`);
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function main(argv = process.argv.slice(2), env = process.env) {
  const gradleFlag = argv.indexOf('--gradle');
  const gradleValue = gradleFlag >= 0 ? argv[gradleFlag + 1] : null;
  const tag = argv.find(a => !a.startsWith('--') && a !== gradleValue);
  const gradlePath = path.resolve(gradleValue || path.join(ROOT, 'android/app/build.gradle'));

  if (!tag) {
    console.error('usage: node scripts/configure-android-signing.mjs <tag> [--gradle <path>]');
    process.exit(2);
  }
  if (!fs.existsSync(gradlePath)) {
    console.error(`::error::${path.relative(ROOT, gradlePath)} not found — run \`npx cap add android\` first.`);
    process.exit(1);
  }

  const missing = REQUIRED_ENV.filter(name => !env[name]);
  if (missing.length) {
    console.error(`::error::missing signing credentials in the environment: ${missing.join(', ')}`);
    console.error('::error::Refusing to build a release that would be unsigned — an unsigned AAB cannot be uploaded to Play.');
    process.exit(1);
  }
  if (!fs.existsSync(env.ANDROID_KEYSTORE_PATH)) {
    console.error(`::error::keystore not found at ANDROID_KEYSTORE_PATH (${env.ANDROID_KEYSTORE_PATH})`);
    process.exit(1);
  }

  // Every refusal below is reported as an annotation with the file left untouched — a
  // half-patched project that still builds would attach an unsigned AAB to the release.
  let versionCode;
  let versionName;
  let after;
  let changed;
  try {
    const version = versionFromTag(tag);
    versionCode = versionCodeFor(version);
    versionName = versionNameFor(version);
    const before = fs.readFileSync(gradlePath, 'utf8');
    after = patchBuildGradle(before, { versionCode, versionName });
    changed = before !== after;
  } catch (err) {
    console.error(`::error::${err.message}`);
    console.error('::error::Refusing to build a release that would be unsigned or mis-versioned.');
    process.exit(1);
  }
  fs.writeFileSync(gradlePath, after);

  console.log(`🔏 release signing configured for ${tag}`);
  console.log(`   versionCode ${versionCode} · versionName ${versionName} · alias ${env.ANDROID_KEY_ALIAS}`);
  console.log(`   keystore   ${path.basename(env.ANDROID_KEYSTORE_PATH)} (path from the environment, not the file)`);
  console.log(`   patched    ${path.relative(ROOT, gradlePath)}${changed ? '' : ' (already configured)'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
