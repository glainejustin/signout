/**
 * tests/security.test.mjs — sanitization, PIN hashing, dialog fallback.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const { Sanitize, Crypto, UI } = loadApp();

// ── Sanitize ─────────────────────────────────────────────────

test('Sanitize.text escapes markup for safe innerHTML interpolation', () => {
  assert.equal(Sanitize.text('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(Sanitize.text('Ana & Reyes'), 'Ana &amp; Reyes');
  assert.equal(Sanitize.text(null), '');
});

test('Sanitize.strip removes dangerous characters and caps length at write time', () => {
  assert.equal(Sanitize.strip('  <b>Bobby</b> "Tables"  '), 'bBobby/b Tables');
  assert.equal(Sanitize.strip('a'.repeat(200), 10).length, 10);
  assert.equal(Sanitize.strip("O'Brien`; DROP", 40), 'OBrien; DROP');
});

test('Sanitize.id keeps only id-safe characters', () => {
  assert.equal(Sanitize.id('w_1234<script>'), 'w_1234script');
  assert.equal(Sanitize.id('loc:main.site-2'), 'loc:main.site-2');
});

test('only allow-listed HTTPS hosts may receive data', () => {
  assert.equal(Sanitize.isSheetsUrl(''), true, 'unset is fine');
  assert.equal(Sanitize.isSheetsUrl('https://script.google.com/macros/s/AKfy/exec'), true);
  assert.equal(Sanitize.isSheetsUrl('https://script.googleusercontent.com/x'), true);
  assert.equal(Sanitize.isSheetsUrl('https://evil.example.com/collect'), false);
  assert.equal(Sanitize.isSheetsUrl('http://script.google.com/x'), false, 'plain http rejected');
  assert.equal(Sanitize.isUrlAllowed('https://hooks.slack.com/services/T/B/X'), true);
  assert.equal(Sanitize.isUrlAllowed('javascript:alert(1)'), false);
});

// ── Crypto ───────────────────────────────────────────────────

test('PINs are stored as SHA-256 hex, never in plain text', async () => {
  const hash = await Crypto.hashPin('1234');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.ok(!hash.includes('1234'));
  assert.equal(hash, await Crypto.hashPin('1234'), 'deterministic for the same PIN');
  assert.notEqual(hash, await Crypto.hashPin('1235'));
  assert.equal(Crypto.isHashed(hash), true);
  assert.equal(Crypto.isHashed('1234'), false);
  assert.equal(Crypto.isLegacyPin('1234'), true);
});

test('verifyPin accepts the right PIN and rejects the wrong one', async () => {
  const hash = await Crypto.hashPin('4321');
  assert.equal(await Crypto.verifyPin('4321', hash), true);
  assert.equal(await Crypto.verifyPin('4322', hash), false);
  assert.equal(await Crypto.verifyPin('4321', '4321'), true, 'legacy plain values still verify');
  assert.equal(await Crypto.verifyPin('  4321 ', hash), true, 'whitespace tolerant');
  assert.equal(await Crypto.verifyPin('4321', ''), false);
});

// ── UI dialogs ───────────────────────────────────────────────

test('UI dialogs fall back safely when there is no DOM (SSR / tests)', async () => {
  assert.equal(UI.isOpen(), false);
  assert.equal(await UI.confirm('Delete?'), false, 'never auto-confirms');
  assert.equal(await UI.prompt('Name?'), null, 'never auto-submits');
  assert.equal(await UI.alert('Heads up'), undefined);
});
