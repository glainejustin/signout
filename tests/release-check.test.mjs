/**
 * tests/release-check.test.mjs — the release gate's platform plumbing.
 *
 * `npm run release:check` orchestrates npm, npx, Gradle and Node across Windows, macOS and
 * Linux. Those decisions are pure, so they can be pinned here instead of being discovered
 * by whichever contributor happens to be on the odd platform — the EINVAL that Windows
 * `npm.cmd` produces (and that this suite now guards) is exactly that kind of bug.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FORBIDDEN_DIST,
  REQUIRED_DIRS,
  REQUIRED_DIST,
  REQUIRED_FILES,
  findAndroidSdk,
  findJava,
  gradleInvocation,
  spawnCommand,
} from '../scripts/release-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const none = () => false;
/** Pretend exactly the given path fragments exist, whatever the host separator. */
const only = (...present) => p => present.some(fragment => p.replace(/\\/g, '/').includes(fragment));
/** Compare paths regardless of the host separator, so these tests read on any OS. */
const norm = p => (p === null ? null : p.replace(/\\/g, '/'));

test('an SDK named by environment wins over the platform default', () => {
  const env = { ANDROID_HOME: '/opt/android', LOCALAPPDATA: '/win/local' };
  // Both exist; the environment must take priority.
  const both = only('/opt/android', 'win/local');
  assert.equal(norm(findAndroidSdk({ env, platform: 'win32', home: '/home/u' }, both)), '/opt/android');
});

test('the SDK is found in Android Studio’s default location per platform', () => {
  const home = '/home/u';
  assert.equal(
    norm(findAndroidSdk({ env: {}, platform: 'darwin', home }, only('Library/Android/sdk/licenses'))),
    norm(path.join(home, 'Library', 'Android', 'sdk')),
  );
  assert.equal(
    norm(findAndroidSdk({ env: {}, platform: 'linux', home }, only('Android/Sdk/platform-tools'))),
    norm(path.join(home, 'Android', 'Sdk')),
  );
  assert.equal(
    norm(findAndroidSdk(
      { env: { LOCALAPPDATA: 'C:/Users/u/AppData/Local' }, platform: 'win32', home: 'C:/Users/u' },
      only('AppData/Local/Android/Sdk/platform-tools'),
    )),
    'C:/Users/u/AppData/Local/Android/Sdk',
  );
});

test('no SDK anywhere is reported as absent, not guessed', () => {
  assert.equal(findAndroidSdk({ env: {}, platform: 'linux', home: '/home/u' }, none), null);
});

test('a half-populated SDK pointed at by env is still honoured', () => {
  // Better to attempt a build and let Gradle explain, than to silently skip the APK stage.
  assert.equal(findAndroidSdk({ env: { ANDROID_SDK_ROOT: '/odd/place' }, platform: 'linux', home: '/home/u' }, none), '/odd/place');
});

test('JAVA_HOME is preferred over whatever java is on PATH', () => {
  const found = findJava(
    { env: { JAVA_HOME: 'C:/jdk-21' }, platform: 'win32' },
    only('jdk-21'),
    () => 'C:/somewhere/else/java.exe',
  );
  assert.equal(norm(found), norm(path.join('C:/jdk-21', 'bin', 'java.exe')));
});

test('a JAVA_HOME without bin/java falls back to PATH', () => {
  assert.equal(findJava({ env: { JAVA_HOME: '/broken' }, platform: 'linux' }, none, () => '/usr/bin/java'), '/usr/bin/java');
});

test('no java at all is reported as absent', () => {
  assert.equal(findJava({ env: {}, platform: 'linux' }, none, () => null), null);
});

test('Windows runs the Gradle wrapper through cmd, POSIX platforms run it directly', () => {
  assert.deepEqual(gradleInvocation('win32'), { command: 'cmd', args: ['/c', 'gradlew.bat', 'assembleDebug', '--no-daemon'] });
  assert.deepEqual(gradleInvocation('linux'), { command: './gradlew', args: ['assembleDebug', '--no-daemon'] });
  assert.deepEqual(gradleInvocation('darwin').command, './gradlew');
});

test('npm and npx go through cmd on Windows but nowhere else', () => {
  // Node throws EINVAL when asked to spawn a .cmd shim without a shell, so `cmd /c` is
  // the only portable invocation.
  assert.deepEqual(spawnCommand('npm', ['test'], 'win32'), { command: 'cmd', args: ['/c', 'npm', 'test'] });
  assert.deepEqual(spawnCommand('npx', ['cap', 'add', 'android'], 'win32'), { command: 'cmd', args: ['/c', 'npx', 'cap', 'add', 'android'] });
  assert.deepEqual(spawnCommand('npm', ['test'], 'linux'), { command: 'npm', args: ['test'] });
  // `node` is a real executable everywhere and must not be wrapped.
  assert.deepEqual(spawnCommand('node', ['x'], 'win32'), { command: 'node', args: ['x'] });
});

test('the gate checks the same required files as CI', () => {
  for (const required of REQUIRED_FILES) {
    assert.ok(fs.existsSync(path.join(ROOT, required)), `${required} should exist`);
  }
  for (const dir of REQUIRED_DIRS) {
    assert.ok(fs.statSync(path.join(ROOT, dir)).isDirectory(), `${dir}/ should exist`);
  }
});

test('the dist assertions cover what the APK actually embeds', () => {
  for (const required of ['index.html', 'js/app.js', 'css/styles.css', 'icons/icon-192.png']) {
    assert.ok(REQUIRED_DIST.includes(required), `${required} should be asserted present in dist/`);
  }
  for (const forbidden of ['node_modules', 'tests', '.github']) {
    assert.ok(FORBIDDEN_DIST.includes(forbidden), `${forbidden} must never reach dist/`);
  }
  assert.equal(REQUIRED_DIST.filter(f => FORBIDDEN_DIST.includes(f)).length, 0);
});

test('importing the gate does not run it', () => {
  // Regression guard: this file imports the module, so a stray top-level stage would have
  // spawned npm/gradle during `npm test`. Reaching here without side effects is the test.
  assert.equal(typeof findAndroidSdk, 'function');
});
