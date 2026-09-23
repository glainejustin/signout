/**
 * scripts/generate-icons.mjs — draw the SignOut mark and export every icon size.
 *
 * The shipped artwork used to say "WT" (WorkTap) from before the rebrand, and the
 * Android launcher icons came straight from Capacitor's template. This generates
 * both from one source of truth, with **zero dependencies**: shapes are signed
 * distance fields rendered with 4×4 supersampling, encoded through Node's zlib.
 *
 *   npm run icons              # PWA icons (icons/) — committed
 *   npm run icons -- --android # also brand the generated android/ project (CI)
 *
 * Colours follow the design system: navy #0F172A → blue #0369A1, white glyph.
 *
 * Two shapes ship for the web, because they answer different questions:
 *
 *   - `icon-192/512` are the *rounded* mark ("any") — transparent corners, shown as drawn.
 *   - `icon-maskable-192/512` are full-bleed with the mark inside the safe zone, for
 *     `"purpose": "maskable"`. A launcher applies its own mask to those, so an icon with
 *     transparent corners gets them cut into wedges, and a mark outside the central 80%
 *     circle gets clipped. tests/branding.test.mjs pins both properties.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = process.argv.includes('--android');

// ── Palette (mirrors css/styles.css tokens) ──────────────────
const NAVY = [0x0f, 0x17, 0x2a];
const BLUE = [0x03, 0x69, 0xa1];
const WHITE = [0xff, 0xff, 0xff];

const hex = rgb => '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();

// ── Minimal PNG encoder ──────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array of width*height*4 (straight alpha) → PNG Buffer. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Geometry: signed distance fields, normalized 0..1 space ──
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

const sdCircle  = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
const sdRing    = (px, py, cx, cy, r, w) => Math.abs(sdCircle(px, py, cx, cy, r)) - w / 2;
const sdCapsule = (px, py, ax, ay, bx, by, w) => sdSegment(px, py, ax, ay, bx, by) - w / 2;

function sdRoundedRect(px, py, cx, cy, half, radius) {
  const qx = Math.abs(px - cx) - (half - radius);
  const qy = Math.abs(py - cy) - (half - radius);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

/**
 * The mark: a stopwatch. Returns distance (≤ 0 = inside) for a point in a
 * 0..1 space that is *already scaled* by `s` around the centre.
 */
function sdGlyph(px, py, s) {
  // scale around centre
  const x = (px - 0.5) / s + 0.5;
  const y = (py - 0.5) / s + 0.5;

  const ring  = sdRing(x, y, 0.5, 0.545, 0.205, 0.062);
  const crown = sdCapsule(x, y, 0.5, 0.245, 0.5, 0.305, 0.062);
  const earL  = sdCapsule(x, y, 0.352, 0.372, 0.288, 0.308, 0.052);
  const earR  = sdCapsule(x, y, 0.648, 0.372, 0.712, 0.308, 0.052);
  const handM = sdCapsule(x, y, 0.5, 0.545, 0.5, 0.395, 0.045);
  const handH = sdCapsule(x, y, 0.5, 0.545, 0.632, 0.607, 0.045);
  const hub   = sdCircle(x, y, 0.5, 0.545, 0.042);

  return Math.min(ring, crown, earL, earR, handM, handH, hub) * s;
}

// ── Renderer ─────────────────────────────────────────────────
const SS = 4; // supersampling per axis

/**
 * Scale for the maskable marks. The glyph's furthest ink sits ≈0.344 from the centre in
 * normalized space, and a maskable icon must keep its content inside the central
 * 80%-diameter circle (radius 0.4) — so 0.82 leaves a comfortable margin while keeping the
 * mark the same visual weight as the Android adaptive foreground, which uses the same
 * scale against Android's tighter 66% safe zone.
 */
const MASKABLE_GLYPH_SCALE = 0.82;

/**
 * @param {number} size
 * @param {object} opts
 *   mask: 'rounded' | 'circle' | 'square' | 'none'  (background shape)
 *   glyphScale: multiplier applied to the mark
 *   glyphOnly: transparent background (adaptive-icon foreground)
 */
function render(size, { mask = 'rounded', glyphScale = 1, glyphOnly = false } = {}) {
  const rgba = new Uint8Array(size * size * 4);
  const step = 1 / (size * SS);
  const samples = SS * SS;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgCov = 0, glyphCov = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px * SS + sx + 0.5) * step;
          const y = (py * SS + sy + 0.5) * step;

          if (!glyphOnly) {
            let inside;
            if (mask === 'circle')       inside = sdCircle(x, y, 0.5, 0.5, 0.5) <= 0;
            else if (mask === 'square')  inside = true;
            else                         inside = sdRoundedRect(x, y, 0.5, 0.5, 0.5, 0.235) <= 0;
            if (inside) bgCov++;
          }
          if (sdGlyph(x, y, glyphScale) <= 0) glyphCov++;
        }
      }

      bgCov /= samples;
      glyphCov /= samples;

      // gradient: navy (top-left) → blue (bottom-right)
      const t = clamp01((px / size + py / size) / 2 * 1.15);
      const bg = [
        Math.round(NAVY[0] + (BLUE[0] - NAVY[0]) * t),
        Math.round(NAVY[1] + (BLUE[1] - NAVY[1]) * t),
        Math.round(NAVY[2] + (BLUE[2] - NAVY[2]) * t),
      ];

      // source-over: glyph on top of background
      const a = glyphCov + bgCov * (1 - glyphCov);
      const i = (py * size + px) * 4;
      if (a <= 0) { rgba[i + 3] = 0; continue; }
      for (let c = 0; c < 3; c++) {
        rgba[i + c] = Math.round((WHITE[c] * glyphCov + bg[c] * bgCov * (1 - glyphCov)) / a);
      }
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, size, rgba);
}

/** Splash: flat navy canvas + the mark scaled in, drawn once and blitted. */
function renderSplash(width, height) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = NAVY[0]; rgba[i * 4 + 1] = NAVY[1]; rgba[i * 4 + 2] = NAVY[2]; rgba[i * 4 + 3] = 255;
  }

  // Render the mark once into a raw buffer (cheaper than a second full-size SDF pass).
  const markSize = Math.max(64, Math.round(Math.min(width, height) * 0.42));
  const markRgba = new Uint8Array(markSize * markSize * 4);
  const step = 1 / (markSize * SS);
  for (let py = 0; py < markSize; py++) {
    for (let px = 0; px < markSize; px++) {
      let cov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (sdGlyph((px * SS + sx + 0.5) * step, (py * SS + sy + 0.5) * step, 1.05) <= 0) cov++;
        }
      }
      const a = cov / (SS * SS);
      const i = (py * markSize + px) * 4;
      markRgba[i] = WHITE[0]; markRgba[i + 1] = WHITE[1]; markRgba[i + 2] = WHITE[2];
      markRgba[i + 3] = Math.round(a * 255);
    }
  }

  const ox = Math.round((width - markSize) / 2);
  const oy = Math.round((height - markSize) / 2);
  for (let y = 0; y < markSize; y++) {
    for (let x = 0; x < markSize; x++) {
      const s = (y * markSize + x) * 4;
      const a = markRgba[s + 3] / 255;
      if (a <= 0) continue;
      const d = ((oy + y) * width + (ox + x)) * 4;
      for (let c = 0; c < 3; c++) {
        rgba[d + c] = Math.round(WHITE[c] * a + rgba[d + c] * (1 - a));
      }
    }
  }
  return encodePng(width, height, rgba);
}

// ── Emit ─────────────────────────────────────────────────────
let written = 0;
function write(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  written++;
  console.log(`   ${path.relative(ROOT, file).replace(/\\/g, '/')} — ${(buffer.length / 1024).toFixed(1)} KB`);
}

console.log('🎨 SignOut icons — ' + hex(NAVY) + ' → ' + hex(BLUE));

// PWA / web
write(path.join(ROOT, 'icons/icon-192.png'), render(192));
write(path.join(ROOT, 'icons/icon-512.png'), render(512));

// Maskable: full-bleed background (the launcher supplies the mask) with the mark pulled
// inside the safe circle. Separate files rather than a `purpose: "any maskable"` claim on
// the rounded ones, because those cannot satisfy both readings at once.
for (const size of [192, 512]) {
  write(path.join(ROOT, `icons/icon-maskable-${size}.png`),
    render(size, { mask: 'square', glyphScale: MASKABLE_GLYPH_SCALE }));
}

write(path.join(ROOT, 'icons/apple-touch-icon.png'), render(180, { mask: 'square', glyphScale: 0.92 }));
write(path.join(ROOT, 'icons/favicon-32.png'), render(32, { mask: 'square', glyphScale: 0.95 }));

// Android (only when the platform has been generated)
if (ANDROID) {
  const res = path.join(ROOT, 'android/app/src/main/res');
  if (!fs.existsSync(res)) {
    console.error('✖ android/app/src/main/res not found — run `npx cap add android` first (or drop --android).');
    process.exit(1);
  }

  const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
  const SPLASH = {
    'drawable':                [480, 320],
    'drawable-port-mdpi':      [320, 480],
    'drawable-port-hdpi':      [480, 800],
    'drawable-port-xhdpi':     [720, 1280],
    'drawable-port-xxhdpi':    [960, 1600],
    'drawable-port-xxxhdpi':   [1280, 1920],
    'drawable-land-mdpi':      [480, 320],
    'drawable-land-hdpi':      [800, 480],
    'drawable-land-xhdpi':     [1280, 720],
    'drawable-land-xxhdpi':    [1600, 960],
    'drawable-land-xxxhdpi':   [1920, 1280],
  };

  for (const [density, size] of Object.entries(LAUNCHER)) {
    const dir = path.join(res, `mipmap-${density}`);
    write(path.join(dir, 'ic_launcher.png'), render(size));
    write(path.join(dir, 'ic_launcher_round.png'), render(size, { mask: 'circle' }));
  }
  // Adaptive foreground: transparent, mark inside the 66% safe area.
  for (const [density, size] of Object.entries(FOREGROUND)) {
    write(path.join(res, `mipmap-${density}`, 'ic_launcher_foreground.png'),
      render(size, { glyphOnly: true, glyphScale: 0.82 }));
  }
  for (const [dir, [w, h]] of Object.entries(SPLASH)) {
    write(path.join(res, dir, 'splash.png'), renderSplash(w, h));
  }

  // Adaptive background colour (was #FFFFFF from the Capacitor template).
  const bgFile = path.join(res, 'values/ic_launcher_background.xml');
  fs.writeFileSync(bgFile,
    '<resources>\n    <color name="ic_launcher_background">' + hex(NAVY) + '</color>\n</resources>\n');
  written++;
  console.log(`   android/.../values/ic_launcher_background.xml — ${hex(NAVY)}`);
}

console.log(`✔ wrote ${written} files${ANDROID ? '' : ' (PWA only — pass --android inside a built android/ project)'}`);
