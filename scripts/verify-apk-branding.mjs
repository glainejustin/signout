/**
 * scripts/verify-apk-branding.mjs — fail the release if the APK ships stale artwork.
 *
 * `npm run icons -- --android` writes the SignOut mark into the generated android/
 * project, but nothing proved the *built APK* contained it — and that is exactly how
 * the pre-rebrand "WT" icon reached a published release: the generator existed, the
 * pipeline ran it, and the binary was still wrong.
 *
 * So this reads the APK as a zip, finds every launcher / adaptive-foreground / splash
 * PNG the Android template needs, and compares them against the generated artwork.
 * Comparison is pixel-based (8×8 cell means), not byte-based: an APK built with PNG
 * crunching, a different zlib level or a palette re-encode still passes, while a
 * different *drawing* cannot.
 *
 * Zero dependencies, like the rest of scripts/.
 *
 *   node scripts/verify-apk-branding.mjs [apk] [resDir] [iconsDir]
 *
 * Defaults: android/app/build/outputs/apk/debug/app-debug.apk, android/app/src/main/res
 * (both produced by `npx cap add/sync android` + `npm run icons -- --android`) and
 * icons/. Pass an explicit iconsDir to audit a published APK against another tree, e.g.
 * a release tag (see .github/workflows/apk-audit.yml). Exits non-zero, with GitHub
 * `::error::` annotations, on any missing or mismatched asset.
 *
 * `resDir` only needs android/app/src/main/res to exist — the Android icons are written
 * by the generator alone, so an audit does not need Capacitor or the Android SDK.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The design-system navy the splash and adaptive background must be.
export const SPLASH_NAVY = [0x0f, 0x17, 0x2a];

// Cell grid used to summarise an image for comparison.
export const SIGNATURE_GRID = 8;

// Max per-channel difference between two images' cell means (0–255). Well above
// encoder/quantisation noise, far below a different logo.
export const TOLERANCE = 12;

const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

/**
 * Every branded PNG the native project must contain: three icon variants per density
 * (legacy, round, adaptive foreground) plus the splash in each orientation bucket.
 * This is a contract, not a reflection of what the generator happens to emit — if the
 * generator or the APK loses a bucket, that is a failure.
 */
export const EXPECTED_KEYS = [
  ...DENSITIES.flatMap(d => [
    `mipmap-${d}/ic_launcher.png`,
    `mipmap-${d}/ic_launcher_round.png`,
    `mipmap-${d}/ic_launcher_foreground.png`,
  ]),
  'drawable/splash.png',
  ...DENSITIES.flatMap(d => [`drawable-land-${d}/splash.png`, `drawable-port-${d}/splash.png`]),
];

// ── Minimal ZIP reader ───────────────────────────────────────
// APKs are zips; Node has no archive module, so walk the central directory. Sizes and
// offsets are read from the central directory (authoritative) rather than the local
// headers, which may defer them to a data descriptor.

export function readZipEntries(buf) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  const floor = Math.max(0, buf.length - (0xffff + 22));
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) throw new Error('zip64 archives are not supported');

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central directory entry at ${p}`);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readZipEntry(buf, entry) {
  const off = entry.offset;
  if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error(`bad local header for ${entry.name}`);
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const start = off + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);          // stored
  if (entry.method === 8) return zlib.inflateRawSync(raw);  // deflate
  throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);
}

// ── Minimal PNG decoder ──────────────────────────────────────
// Handles what an Android resource can realistically be: 8-bit greyscale, RGB,
// palette (from PNG crunching), greyscale+alpha and RGBA, non-interlaced.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let pos = 8;
  let hdr = null;
  let plte = null;
  let trns = null;
  const idat = [];

  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      hdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'PLTE') {
      plte = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  if (!hdr) throw new Error('PNG has no IHDR');
  if (hdr.depth !== 8) throw new Error(`unsupported PNG bit depth ${hdr.depth}`);
  if (hdr.interlace) throw new Error('interlaced PNGs are not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[hdr.color];
  if (!channels) throw new Error(`unsupported PNG colour type ${hdr.color}`);

  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = hdr.width * bpp;
  const rows = Buffer.alloc(stride * hdr.height);

  // Undo the per-row filters (PNG spec §9.2).
  for (let y = 0; y < hdr.height; y++) {
    const filter = inflated[y * (stride + 1)];
    const src = inflated.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
    if (filter > 4) throw new Error(`unknown PNG filter ${filter} on row ${y}`);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      const v = src[x];
      const decoded = filter === 0 ? v
        : filter === 1 ? v + a
        : filter === 2 ? v + b
        : filter === 3 ? v + ((a + b) >> 1)
        : v + paeth(a, b, c);
      out[x] = decoded & 0xff;
    }
  }

  // Expand to straight RGBA.
  const rgba = new Uint8Array(hdr.width * hdr.height * 4);
  for (let i = 0, n = hdr.width * hdr.height; i < n; i++) {
    const s = i * bpp;
    const d = i * 4;
    if (hdr.color === 6) {
      rgba[d] = rows[s]; rgba[d + 1] = rows[s + 1]; rgba[d + 2] = rows[s + 2]; rgba[d + 3] = rows[s + 3];
    } else if (hdr.color === 2) {
      rgba[d] = rows[s]; rgba[d + 1] = rows[s + 1]; rgba[d + 2] = rows[s + 2]; rgba[d + 3] = 255;
    } else if (hdr.color === 4) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = rows[s]; rgba[d + 3] = rows[s + 1];
    } else if (hdr.color === 0) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = rows[s]; rgba[d + 3] = 255;
    } else { // palette
      const idx = rows[s];
      if (!plte) throw new Error('palette PNG has no PLTE chunk');
      rgba[d] = plte[idx * 3]; rgba[d + 1] = plte[idx * 3 + 1]; rgba[d + 2] = plte[idx * 3 + 2];
      rgba[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }

  return { width: hdr.width, height: hdr.height, data: rgba };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// ── Comparison ───────────────────────────────────────────────

/** Mean RGBA per cell of a grid×grid lattice covering the whole image. */
export function pixelSignature(img, grid = SIGNATURE_GRID) {
  const sums = new Float64Array(grid * grid * 4);
  const counts = new Float64Array(grid * grid);
  for (let y = 0; y < img.height; y++) {
    const cy = Math.min(grid - 1, Math.floor((y * grid) / img.height));
    for (let x = 0; x < img.width; x++) {
      const cx = Math.min(grid - 1, Math.floor((x * grid) / img.width));
      const cell = cy * grid + cx;
      const p = (y * img.width + x) * 4;
      sums[cell * 4] += img.data[p];
      sums[cell * 4 + 1] += img.data[p + 1];
      sums[cell * 4 + 2] += img.data[p + 2];
      sums[cell * 4 + 3] += img.data[p + 3];
      counts[cell]++;
    }
  }
  for (let cell = 0; cell < grid * grid; cell++) {
    for (let ch = 0; ch < 4; ch++) sums[cell * 4 + ch] /= counts[cell] || 1;
  }
  return sums;
}

/** { ok, maxDiff, cell, dimsMatch } — compares two decoded images. */
export function compareImages(a, b, tolerance = TOLERANCE) {
  if (a.width !== b.width || a.height !== b.height) {
    return { ok: false, dimsMatch: false, maxDiff: Infinity, cell: null, aSize: [a.width, a.height], bSize: [b.width, b.height] };
  }
  const sa = pixelSignature(a);
  const sb = pixelSignature(b);
  let maxDiff = 0;
  let cell = 0;
  for (let i = 0; i < sa.length; i++) {
    const d = Math.abs(sa[i] - sb[i]);
    if (d > maxDiff) { maxDiff = d; cell = i >> 2; }
  }
  return { ok: maxDiff <= tolerance, dimsMatch: true, maxDiff, cell };
}

/** Pixel at (x, y) from a decoded image. */
export function pixelAt(img, x, y) {
  const p = (y * img.width + x) * 4;
  return [img.data[p], img.data[p + 1], img.data[p + 2], img.data[p + 3]];
}

const near = (a, b, tol = TOLERANCE) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

/**
 * `res/mipmap-xxxhdpi-v4/ic_launcher.png` → `mipmap-xxxhdpi/ic_launcher.png`, so an
 * APK entry and a file under `android/app/src/main/res` compare on the same key.
 * The `-v4` resource version qualifier is stripped; `res/` is dropped.
 */
export const normalizeKey = rel => rel.replace(/\\/g, '/').replace(/^res\//, '').replace(/-v\d+\//, '/');

// ── CLI ──────────────────────────────────────────────────────

function collectPngs(dir, root = dir) {
  const out = new Map();
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.png')) out.set(normalizeKey(path.relative(root, p)), p);
    }
  };
  walk(dir);
  return out;
}

function main() {
  const apkPath = path.resolve(process.argv[2] || path.join(ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk'));
  const resDir = path.resolve(process.argv[3] || path.join(ROOT, 'android/app/src/main/res'));
  const iconsDir = path.resolve(process.argv[4] || path.join(ROOT, 'icons'));
  const errors = [];
  const warnings = [];
  const annotate = (level, msg) => {
    errors.push(msg);
    console.log(`${level} ${msg}`);
  };

  if (!fs.existsSync(apkPath)) {
    console.log(`::error::APK not found at ${apkPath} — build it (or pass a path) first.`);
    process.exit(1);
  }
  if (!fs.existsSync(resDir)) {
    console.log(`::error::generated resources not found at ${resDir} — run \`npm run icons -- --android\` first.`);
    process.exit(1);
  }

  const apk = fs.readFileSync(apkPath);
  const entries = readZipEntries(apk);
  const zipPngs = new Map();
  for (const e of entries) {
    if (e.name.endsWith('.png')) zipPngs.set(normalizeKey(e.name), e);
  }
  const generated = collectPngs(resDir);

  console.log(`APK:        ${path.relative(ROOT, apkPath)} (${(apk.length / 1024 / 1024).toFixed(2)} MB, ${entries.length} entries)`);
  console.log(`Generated:  ${path.relative(ROOT, resDir)} (${generated.size} PNGs)`);
  console.log(`Expecting:  ${EXPECTED_KEYS.length} branded images\n`);

  // 1. Contract: every expected bucket must exist on both sides and match in pixels.
  let matched = 0;
  let worstDiff = 0;
  let worstKey = null;
  for (const key of EXPECTED_KEYS) {
    const genPath = generated.get(key);
    const zipEntry = zipPngs.get(key);
    if (!genPath) {
      annotate('::error::', `generator produced no ${key} — the "Brand the app icons" step is incomplete.`);
      continue;
    }
    if (!zipEntry) {
      annotate('::error::', `APK embeds no ${key} — the build did not pick up the generated artwork.`);
      continue;
    }

    let gen;
    let shipped;
    try {
      gen = decodePng(fs.readFileSync(genPath));
      shipped = decodePng(readZipEntry(apk, zipEntry));
    } catch (err) {
      annotate('::error::', `could not compare ${key}: ${err.message}`);
      continue;
    }
    const cmp = compareImages(gen, shipped);
    if (!cmp.ok) {
      annotate('::error::', cmp.dimsMatch
        ? `${key} does not match the generated artwork (max cell delta ${cmp.maxDiff.toFixed(1)} > ${TOLERANCE}) — stale or wrong icon in the APK.`
        : `${key} is ${cmp.bSize.join('×')} in the APK but ${cmp.aSize.join('×')} as generated.`);
      continue;
    }
    matched++;
    if (worstKey === null || cmp.maxDiff > worstDiff) { worstDiff = cmp.maxDiff; worstKey = key; }

    // The splash must be navy with something drawn on it, not a blank rectangle.
    if (key.endsWith('splash.png')) {
      const corner = pixelAt(shipped, 0, 0);
      const centre = pixelAt(shipped, shipped.width >> 1, shipped.height >> 1);
      if (!near(corner.slice(0, 3), SPLASH_NAVY)) {
        annotate('::error::', `${key} background is rgb(${corner.slice(0, 3)}) — expected navy rgb(${SPLASH_NAVY}).`);
      }
      if (near(centre.slice(0, 3), SPLASH_NAVY)) {
        annotate('::error::', `${key} centre is empty — the splash has no logo drawn on it.`);
      }
    }
  }

  // 2. Branding the APK carries that the contract does not expect. A newer Android
  //    template can legitimately add entries (e.g. a monochrome icon), so this warns.
  for (const key of zipPngs.keys()) {
    if (/^(mipmap-.*\/ic_launcher|drawable.*\/splash)/.test(key) && !EXPECTED_KEYS.includes(key)) {
      warnings.push(`::warning::APK contains unbranded-or-unexpected ${key}`);
    }
  }

  // 3. The PWA payload copied into the APK is byte-identical to the committed icons,
  //    so a stale dist/ cannot ship either.
  if (fs.existsSync(iconsDir)) {
    for (const name of fs.readdirSync(iconsDir).filter(n => n.endsWith('.png'))) {
      const local = fs.readFileSync(path.join(iconsDir, name));
      const entry = zipPngs.get(`assets/public/icons/${name}`);
      if (!entry) {
        annotate('::error::', `APK web payload is missing icons/${name}.`);
      } else if (!readZipEntry(apk, entry).equals(local)) {
        annotate('::error::', `APK web payload icons/${name} differs from the committed icon — stale dist/.`);
      }
    }
  }

  for (const w of warnings) console.log(w);

  console.log(`\nverified ${matched}/${EXPECTED_KEYS.length} branded images`);
  if (worstKey) {
    console.log(`worst match: ${worstKey} at max cell delta ${worstDiff.toFixed(1)} (tolerance ${TOLERANCE})`);
  }
  if (errors.length) {
    console.log(`::error::${errors.length} branding problem(s) — refusing to publish this APK.`);
    process.exit(1);
  }
  console.log('OK: the APK ships the SignOut icon and splash artwork.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
