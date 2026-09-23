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
  contentHash,
  decodePng,
  matchByContent,
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

// ── Matching by content, for release builds ─────────────────────────────────
// AGP canonicalises `res/` paths in release builds (`res/mipmap-xxxhdpi-v4/ic_launcher.png`
// becomes something like `res/aB.png`), so the first signed release failed 0/26 with the
// artwork physically present in the binary. These pin the fallback: it must find renamed
// artwork, and must not excuse artwork that is genuinely wrong or absent.

/** Distinct generated images, keyed by EXPECTED_KEYS' shape (approximated with real files). */
const artwork = () => new Map([
  ['mipmap-mdpi/ic_launcher.png', readIcon('icon-192.png')],
  ['mipmap-hdpi/ic_launcher.png', readIcon('icon-512.png')],
  ['drawable/splash.png', readIcon('apple-touch-icon.png')],
  ['drawable-land-mdpi/splash.png', readIcon('favicon-32.png')],
]);

/** An APK whose res/ entries have been renamed, as a release build does. */
const renamed = (expected, shorts = ['res/aB.png', 'res/cD.png', 'res/eF.png', 'res/gH.png']) => {
  const out = new Map();
  [...expected.values()].forEach((img, i) => out.set(shorts[i], img));
  return out;
};

test('renamed release resources are still matched, because they are the same drawing', () => {
  const expected = artwork();
  const { matched, missing, byPath } = matchByContent(expected, renamed(expected));
  assert.equal(missing.length, 0, 'nothing should be reported missing');
  assert.equal(matched.size, expected.size);
  assert.equal(byPath.size, 0, 'none of these matched by path — that is the point');
  assert.equal(matched.get('mipmap-mdpi/ic_launcher.png'), 'res/aB.png');
});

test('a path match is preferred and consumes only its own entry', () => {
  const expected = artwork();
  const candidates = new Map([...expected.entries()]);
  const { byPath, missing } = matchByContent(expected, candidates);
  assert.equal(byPath.size, expected.size);
  assert.equal(missing.length, 0);
});

test('stale artwork is not excused by the content search', () => {
  const expected = artwork();
  const candidates = renamed(expected, ['res/aB.png', 'res/cD.png', 'res/eF.png']);
  // The fourth image is present but repainted, so it cannot satisfy its expectation.
  const stale = { width: 32, height: 32, data: Uint8Array.from(readIcon('favicon-32.png').data) };
  for (let i = 0; i < stale.data.length; i += 4) stale.data[i] = 255;
  candidates.set('res/gH.png', stale);

  const { missing } = matchByContent(expected, candidates);
  assert.deepEqual(missing, ['drawable-land-mdpi/splash.png']);
});

test('an absent image is reported, however the APK is laid out', () => {
  const expected = artwork();
  const candidates = renamed(expected, ['res/aB.png', 'res/cD.png', 'res/eF.png']);
  const { missing } = matchByContent(expected, candidates);
  assert.deepEqual(missing, ['drawable-land-mdpi/splash.png']);
});

test('one stored copy cannot satisfy two different expectations', () => {
  // The count of distinct branding images is what makes this check worth anything: a build
  // that dropped three of four icons must not pass by having one left over.
  const expected = artwork();
  const onlyFirst = new Map([['res/only.png', readIcon('icon-192.png')]]);
  const { matched, missing } = matchByContent(expected, onlyFirst);
  assert.equal(matched.size, 1);
  assert.equal(missing.length, expected.size - 1);
});

test('identical artwork may legitimately be stored once', () => {
  // `drawable/splash.png` and `drawable-land-mdpi/splash.png` are the same 480x320 drawing,
  // and a build is entitled to deduplicate identical resources.
  const img = readIcon('icon-192.png');
  const expected = new Map([
    ['drawable/splash.png', img],
    ['drawable-land-mdpi/splash.png', img],
  ]);
  assert.equal(contentHash(img), contentHash({ width: img.width, height: img.height, data: Uint8Array.from(img.data) }),
    'the hash must not depend on the buffer identity');
  const { matched, missing } = matchByContent(expected, new Map([['res/x.png', img]]));
  assert.equal(missing.length, 0);
  assert.equal(matched.get('drawable/splash.png'), 'res/x.png');
  assert.equal(matched.get('drawable-land-mdpi/splash.png'), 'res/x.png', 'the twin reuses the same stored copy');
});

const SPLASH_A = path.join(ROOT, 'android/app/src/main/res/drawable/splash.png');
const SPLASH_B = path.join(ROOT, 'android/app/src/main/res/drawable-land-mdpi/splash.png');

test('the real generated splashes are a dedupable pair, which is why that case exists',
  { skip: fs.existsSync(SPLASH_A) ? false : 'android/ not generated here (npx cap add android + npm run icons -- --android)' },
  () => {
    // If this ever stops being true the test above becomes theoretical; while it holds, the
    // dedupe allowance is load-bearing for release builds that store identical resources once.
    assert.equal(contentHash(decodePng(fs.readFileSync(SPLASH_A))), contentHash(decodePng(fs.readFileSync(SPLASH_B))));
  });

// ── The web icon set ────────────────────────────────────────────────────────
// A launcher masks a `maskable` icon to whatever shape its theme wants, so two things have
// to hold that are invisible on a desktop browser: the background must reach the edges
// (a rounded icon's transparent corners become wedges once masked) and the mark must stay
// inside the safe circle. The manifest used to claim `any maskable` for the rounded icons,
// which cannot satisfy both readings at once — hence separate files per purpose.

/** The furthest "ink" (the white mark, not the gradient background) from the centre,
 *  measured as a fraction of the icon size, plus the coverage that produced it. */
function glyphExtent(img) {
  const centre = img.width / 2;
  let max = 0, ink = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const p = pixelAt(img, x, y);
      // alpha>128 is the 50% coverage contour; min(r,g,b)>128 excludes navy/blue (min 3–15)
      // and includes anything half-blended toward white.
      if (p[3] > 128 && Math.min(p[0], p[1], p[2]) > 128) {
        ink++;
        max = Math.max(max, Math.hypot(x + 0.5 - centre, y + 0.5 - centre) / img.width);
      }
    }
  }
  return { max, ink };
}

const MASKABLE_SAFE_RADIUS = 0.4; // the spec's safe zone: central 80% diameter

test('the maskable icons are full-bleed, so a launcher mask cannot expose gaps', () => {
  for (const name of ['icon-maskable-192.png', 'icon-maskable-512.png']) {
    const img = readIcon(name);
    for (const [x, y] of [[0, 0], [img.width - 1, 0], [0, img.height - 1], [img.width - 1, img.height - 1]]) {
      assert.equal(pixelAt(img, x, y)[3], 255, `${name} corner (${x},${y}) must be opaque`);
    }
  }
});

test('the maskable icons keep the mark inside the safe circle', () => {
  for (const name of ['icon-maskable-192.png', 'icon-maskable-512.png']) {
    const img = readIcon(name);
    const { max, ink } = glyphExtent(img);
    assert.ok(ink > 200, `${name} should contain the mark, found ${ink} ink pixels`);
    assert.ok(max <= MASKABLE_SAFE_RADIUS,
      `${name} mark reaches ${max.toFixed(3)} of the icon size — a masked launcher would clip it (safe radius ${MASKABLE_SAFE_RADIUS})`);
    assert.ok(max > 0.15,
      `${name} mark only reaches ${max.toFixed(3)} — it would look shrunken inside a masked launcher`);
  }
});

test('the rounded icons keep their transparent corners (the two purposes are not the same file)', () => {
  for (const name of ['icon-192.png', 'icon-512.png']) {
    assert.equal(pixelAt(readIcon(name), 0, 0)[3], 0, `${name} is the "any" shape: transparent corners`);
  }
});

test('every declared icon exists, and its purpose matches how it is actually drawn', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const purposes = manifest.icons.map(i => i.purpose);
  assert.ok(purposes.includes('maskable'), 'the manifest should offer a maskable icon');
  assert.ok(purposes.includes('any'), 'and an unmodified one');
  assert.equal(purposes.filter(p => p.includes(' ')).length, 0,
    'a single file cannot be both "any" and "maskable" — the shapes conflict');

  for (const icon of manifest.icons) {
    const file = path.join(ROOT, icon.src);
    assert.ok(fs.existsSync(file), `${icon.src} is declared but not committed`);
    const img = decodePng(fs.readFileSync(file));
    assert.equal(`${img.width}x${img.height}`, icon.sizes, `${icon.src} must match its declared size`);
    if (icon.purpose === 'maskable') {
      assert.equal(pixelAt(img, 0, 0)[3], 255, `${icon.src} is declared maskable but has transparent corners`);
      assert.ok(glyphExtent(img).max <= MASKABLE_SAFE_RADIUS, `${icon.src} is declared maskable but the mark leaves the safe circle`);
    }
  }
});

test('the icon generator emits exactly the icons the manifest declares', () => {
  // A file that no longer ships, or a new file nothing declares, is a silent drift between
  // the generator and the install experience.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const declared = new Set(manifest.icons.map(i => path.basename(i.src)));
  for (const extra of ['apple-touch-icon.png', 'favicon-32.png']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'icons', extra)), `${extra} should be committed`);
  }
  for (const name of declared) {
    assert.ok(fs.existsSync(path.join(ROOT, 'icons', name)), `${name} should exist`);
  }
});

test('the service worker precaches files that exist (a 404 would abort its install)', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  const block = sw.slice(sw.indexOf('const ASSETS'), sw.indexOf('];', sw.indexOf('const ASSETS')));
  const assets = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(assets.length > 20, 'the precache list should cover the app');
  for (const asset of assets) {
    if (asset === './' || asset.endsWith('/')) continue;
    assert.ok(fs.existsSync(path.join(ROOT, asset)),
      `${asset} is precached but missing — \`addAll\` rejects on a 404, which breaks the offline install`);
  }
  for (const name of manifestIcons()) {
    assert.ok(assets.includes(`./${name}`), `${name} should be precached for offline installs`);
  }
});

test('the docs quote the cache version the service worker actually uses', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  const actual = /^const CACHE = '([^']+)'/m.exec(sw)?.[1];
  assert.ok(actual, 'service-worker.js should declare CACHE');

  // The README named `signout-v3` long after the constant had moved to v5, which is exactly
  // the kind of stale detail nobody notices until a user follows it.
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const quoted = [...readme.matchAll(/signout-v\d+/g)].map(m => m[0]);
  assert.ok(quoted.length > 0, 'the README should document the cache name');
  for (const name of new Set(quoted)) {
    assert.equal(name, actual, `README says \`${name}\` but service-worker.js uses \`${actual}\``);
  }
});

/** Basenames of the icons the manifest declares, for cross-checks. */
function manifestIcons() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  return manifest.icons.map(i => i.src);
}
