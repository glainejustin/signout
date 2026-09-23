/**
 * tests/branding.test.mjs — the artwork contract.
 *
 * The release workflow refuses to publish an APK whose icons don't match the generated
 * images (scripts/verify-apk-branding.mjs). These tests cover the pieces of that check
 * that don't need an APK: the PNG decoder, the pixel comparison and its tolerance, the
 * icon inventory, and that the navy is the same everywhere it is declared.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED_KEYS,
  SIGNATURE_GRID,
  SPLASH_NAVY,
  compareImages,
  decodePng,
  normalizeKey,
  pixelAt,
  pixelSignature,
  readZipEntries,
} from '../scripts/verify-apk-branding.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readIcon = name => decodePng(fs.readFileSync(path.join(ROOT, 'icons', name)));
const hex = rgb => '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();

test('decodes a committed PNG (icon-192)', () => {
  const img = readIcon('icon-192.png');
  assert.equal(img.width, 192);
  assert.equal(img.height, 192);
  assert.equal(img.data.length, 192 * 192 * 4);
});

test('the rounded icon is transparent outside its shape and opaque in the middle', () => {
  const img = readIcon('icon-192.png');
  assert.equal(pixelAt(img, 0, 0)[3], 0, 'corner should be transparent (rounded square)');
  assert.equal(pixelAt(img, img.width >> 1, img.height >> 1)[3], 255, 'centre should be opaque');
});

test('the Apple touch icon is full-bleed navy (iOS applies its own mask)', () => {
  const img = readIcon('apple-touch-icon.png');
  assert.deepEqual([img.width, img.height], [180, 180]);
  const corner = pixelAt(img, 0, 0);
  assert.equal(corner[3], 255, 'corner must be opaque, not transparent');
  assert.deepEqual(corner.slice(0, 3), SPLASH_NAVY);
});

test('every committed icon decodes at its manifest-declared size', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const declared = new Map(manifest.icons.map(i => [path.basename(i.src), i.sizes]));
  assert.ok(declared.size >= 2, 'manifest should declare the PWA icons');

  for (const [name, sizes] of declared) {
    const img = readIcon(name);
    assert.equal(`${img.width}x${img.height}`, sizes, `${name} must match its manifest entry`);
  }
  for (const name of ['favicon-32.png', 'apple-touch-icon.png']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'icons', name)), `${name} should be committed`);
  }
});

test('an image compared with itself matches exactly', () => {
  const img = readIcon('icon-192.png');
  const cmp = compareImages(img, img);
  assert.equal(cmp.ok, true);
  assert.equal(cmp.maxDiff, 0);
});

test('a re-encode within tolerance is accepted (PNG crunching must not fail a release)', () => {
  const img = readIcon('icon-512.png');
  const shifted = { width: img.width, height: img.height, data: Uint8Array.from(img.data) };
  for (let i = 0; i < shifted.data.length; i++) {
    shifted.data[i] = Math.max(0, shifted.data[i] - 3); // quantisation-level drift
  }
  const cmp = compareImages(img, shifted);
  assert.equal(cmp.ok, true, `3/255 drift should stay under tolerance, was ${cmp.maxDiff}`);
});

test('different artwork in the APK is rejected (the WorkTap-icon regression)', () => {
  const img = readIcon('icon-192.png');
  // Recolour the navy background to white, as the old artwork effectively was.
  const repainted = { width: img.width, height: img.height, data: Uint8Array.from(img.data) };
  for (let i = 0; i < repainted.data.length; i += 4) {
    repainted.data[i] = repainted.data[i + 1] = repainted.data[i + 2] = 255;
  }
  const cmp = compareImages(img, repainted);
  assert.equal(cmp.ok, false);
  assert.ok(cmp.maxDiff > 100, `recolouring should be obvious, delta was ${cmp.maxDiff}`);
});

test('a size mismatch is reported separately from a pixel diff', () => {
  const cmp = compareImages(readIcon('icon-192.png'), readIcon('icon-512.png'));
  assert.equal(cmp.dimsMatch, false);
  assert.equal(cmp.ok, false);
  assert.deepEqual(cmp.aSize, [192, 192]);
  assert.deepEqual(cmp.bSize, [512, 512]);
});

test('the signature summarises an image as grid cells', () => {
  const sig = pixelSignature(readIcon('icon-192.png'));
  assert.equal(sig.length, SIGNATURE_GRID * SIGNATURE_GRID * 4);
  for (const v of sig) assert.ok(v >= 0 && v <= 255);
  assert.ok(sig.filter((_, i) => i % 4 === 3).some(a => a > 0), 'some cells should be opaque');
  assert.ok(sig.filter((_, i) => i % 4 === 3).some(a => a < 255), 'some cells should be transparent');
});

test('APK resource keys normalise to the generated layout', () => {
  assert.equal(normalizeKey('res/mipmap-xxxhdpi-v4/ic_launcher.png'), 'mipmap-xxxhdpi/ic_launcher.png');
  assert.equal(normalizeKey('res/drawable/splash.png'), 'drawable/splash.png');
  assert.equal(normalizeKey('res\\drawable-land-hdpi-v4\\splash.png'), 'drawable-land-hdpi/splash.png');
  assert.equal(normalizeKey('assets/public/icons/icon-192.png'), 'assets/public/icons/icon-192.png');
  assert.equal(normalizeKey('mipmap-mdpi/ic_launcher.png'), 'mipmap-mdpi/ic_launcher.png');
});

test('the expected inventory covers every Android density bucket', () => {
  assert.equal(EXPECTED_KEYS.length, 26, '15 icon layers + 11 splash screens');
  assert.equal(new Set(EXPECTED_KEYS).size, EXPECTED_KEYS.length, 'keys must be unique');
  for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    assert.ok(EXPECTED_KEYS.includes(`mipmap-${d}/ic_launcher.png`), d);
    assert.ok(EXPECTED_KEYS.includes(`mipmap-${d}/ic_launcher_round.png`), d);
    assert.ok(EXPECTED_KEYS.includes(`mipmap-${d}/ic_launcher_foreground.png`), d);
    assert.ok(EXPECTED_KEYS.includes(`drawable-land-${d}/splash.png`), d);
    assert.ok(EXPECTED_KEYS.includes(`drawable-port-${d}/splash.png`), d);
  }
  assert.ok(EXPECTED_KEYS.includes('drawable/splash.png'));
});

test('the navy is the same in the verifier, manifest and index.html', () => {
  const navy = hex(SPLASH_NAVY);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.theme_color.toUpperCase(), navy);
  assert.equal(manifest.background_color.toUpperCase(), navy);

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const meta = html.match(/<meta\s+name="theme-color"\s+content="([^"]+)"/i);
  assert.ok(meta, 'index.html should declare a theme-color');
  assert.equal(meta[1].toUpperCase(), navy);

  const capacitor = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
  assert.equal(capacitor.plugins.SplashScreen.backgroundColor.toUpperCase(), navy);
});

test('a non-zip file is rejected with a clear error', () => {
  assert.throws(() => readZipEntries(Buffer.from('this is definitely not an APK, not even close')), /not a zip/i);
});
