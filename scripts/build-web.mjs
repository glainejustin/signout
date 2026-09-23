/**
 * scripts/build-web.mjs — stage the web app into `dist/` for Capacitor.
 *
 * Why this exists: SignOut is plain HTML/CSS/JS served from the repo root, but
 * `webDir: "."` would make `cap sync` copy the whole repo — including
 * node_modules, tests/, .github/ — into the APK's web assets. Staging only the
 * files the browser actually needs keeps the APK small and the payload clean.
 *
 * Zero dependencies (Node 18+), no bundling, no minification: copy, verify, report.
 *
 *   node scripts/build-web.mjs      # or: npm run build
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = path.join(ROOT, 'dist');

/** Files that must exist in the app root. */
const FILES = ['index.html', 'manifest.json', 'service-worker.js'];
/** Directories copied recursively (only the shipped asset dirs). */
const DIRS = ['css', 'js', 'icons'];

const kb = bytes => (bytes / 1024).toFixed(1) + ' KB';

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

function fail(message) {
  console.error('✖ ' + message);
  process.exit(1);
}

// ── Guard: every file index.html references must exist in the source tree ──
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const referenced = Array.from(html.matchAll(/(?:src|href)="((?!https?:|#|data:)[^"]+)"/g)).map(m => m[1]);

const missing = referenced.filter(rel => {
  const clean = rel.split('?')[0].split('#')[0];
  return clean && !clean.startsWith('//') && !fs.existsSync(path.join(ROOT, clean));
});
if (missing.length) fail(`index.html references missing files: ${missing.join(', ')}`);

// ── Clean ──
// maxRetries/retryDelay cover the Windows case where a file is briefly locked;
// a directory held by a running process (e.g. `npm start` serving dist/) cannot
// be removed at all, so that gets an actionable message instead of a raw EPERM.
try {
  fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
} catch (err) {
  fail(`could not clear dist/ (${err.code || err.message}) — stop anything serving dist/ (a dev server, an open terminal in that folder, or a file explorer window) and try again.`);
}
fs.mkdirSync(OUT, { recursive: true });

let files = 0;
for (const file of FILES) {
  const from = path.join(ROOT, file);
  if (!fs.existsSync(from)) fail(`missing required file: ${file}`);
  fs.copyFileSync(from, path.join(OUT, file));
  files++;
}
for (const dir of DIRS) {
  const from = path.join(ROOT, dir);
  if (!fs.existsSync(from)) fail(`missing required directory: ${dir}/`);
  fs.cpSync(from, path.join(OUT, dir), { recursive: true });
  files += fs.readdirSync(from, { recursive: true }).filter(f => fs.statSync(path.join(from, f)).isFile()).length;
}

// ── Report ──
console.log(`✔ staged ${files} files into dist/ (${kb(dirSize(OUT))})`);
for (const entry of fs.readdirSync(OUT).sort()) {
  const full = path.join(OUT, entry);
  const size = fs.statSync(full).isDirectory() ? kb(dirSize(full)) : kb(fs.statSync(full).size);
  console.log(`   ${entry}${fs.statSync(full).isDirectory() ? '/' : ''} — ${size}`);
}
console.log(`   (excluded: node_modules, tests, scripts, .github — webDir is dist/, not ".")`);
