/**
 * tests/harness.mjs — zero-dependency loader for the browser modules.
 *
 * SignOut ships as plain <script> files (no bundler), so tests load them into a
 * Node `vm` context with just enough browser surface: `localStorage`, a minimal
 * `document` (only what Sanitize.text needs), `window`, and Web Crypto.
 * No jsdom, no test framework — `node --test` is enough.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_FILES = ['js/security.js', 'js/db.js', 'js/gps.js'];

/** Map-backed localStorage stand-in (getItem/setItem/removeItem/clear/key/length). */
function makeLocalStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    getItem(k) { const key = String(k); return map.has(key) ? map.get(key) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    _dump() { return Object.fromEntries(map); },
  };
}

/** Tiny document stand-in — only Sanitize.text()/attr() touch the DOM at test time. */
function makeDocument() {
  return {
    createElement() {
      const el = { _text: '' };
      Object.defineProperty(el, 'textContent', {
        get() { return el._text; },
        set(v) { el._text = v == null ? '' : String(v); },
      });
      Object.defineProperty(el, 'innerHTML', {
        get() { return el._text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
      });
      return el;
    },
    // No body/querySelector: UI._hasDom() is false → dialogs use the fallback path.
    querySelector() { return null; },
    addEventListener() {},
    removeEventListener() {},
  };
}

/**
 * Load the app modules into a fresh sandbox.
 * Returns { DB, Sanitize, Crypto, GPS, UI, localStorage }.
 */
export function loadApp(files = DEFAULT_FILES) {
  const localStorage = makeLocalStorage();
  const sandbox = {
    localStorage,
    document: makeDocument(),
    console,
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    URL,
    Blob: globalThis.Blob,
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(src, ctx, { filename: file });
  }

  // Top-level `const` bindings live in the context's global lexical scope, so they
  // are read back by evaluating an expression in that same scope.
  const api = vm.runInContext('({ DB, Sanitize, Crypto, GPS, UI })', ctx);
  return { ...api, localStorage };
}

/** ISO timestamp with a stable UTC date prefix: stamp('2026-09-23', '09:00'). */
export function stamp(dateStr, hhmm) {
  return `${dateStr}T${hhmm}:00.000Z`;
}

/** Today's local date string, matching DB.localDateStr(). */
export function today(DB) {
  return DB.localDateStr();
}

/** Shift a YYYY-MM-DD string by n days. */
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
