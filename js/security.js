/**
 * security.js — Central sanitization & hardening helpers
 * - Sanitize.text()  → HTML-escape for safe innerHTML interpolation
 * - Sanitize.attr()  → escape for attribute contexts
 * - Sanitize.strip() → strip dangerous chars at write time + cap length
 * - Sanitize.id()    → allow-list for IDs
 * - Crypto.hashPin() → SHA-256 hex for PINs (async, SubtleCrypto)
 * - Crypto.verify()  → handles plain→hashed migration transparently
 * - Sanitize.isUrlAllowed() → allow-list for Sheets/webhook hosts
 */

const Sanitize = (() => {

  function text(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function attr(str) {
    return text(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function strip(str, maxLen = 120) {
    let s = String(str == null ? '' : str);
    s = s.replace(/[<>\"'`]/g, '').replace(/[\x00-\x1F\x7F]/g, '');
    s = s.trim();
    if (s.length > maxLen) s = s.slice(0, maxLen);
    return s;
  }

  function id(str) {
    return String(str == null ? '' : str).replace(/[^a-zA-Z0-9_\-:.]/g, '').slice(0, 80);
  }

  // Allow-list for external URLs — prevents exfiltration to arbitrary hosts
  // Keep in sync with CSP connect-src in index.html
  const ALLOWED_HOSTS = [
    'script.google.com',
    'script.googleusercontent.com',
    'hooks.slack.com',
    'hooks.office.com',
    'discord.com',
    'discordapp.com',
    'api.telegram.org',
  ];
  const ALLOWED_PREFIXES = [
    'https://script.google.com/',
    'https://script.googleusercontent.com/',
    'https://hooks.slack.com/',
    'https://hooks.office.com/',
    'https://discord.com/api/webhooks/',
    'https://discordapp.com/api/webhooks/',
    'https://api.telegram.org/bot',
  ];

  function isUrlAllowed(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed.startsWith('https://')) return false;
    try {
      const u = new URL(trimmed);
      if (u.protocol !== 'https:') return false;
      return ALLOWED_PREFIXES.some(p => trimmed.startsWith(p)) || ALLOWED_HOSTS.includes(u.hostname);
    } catch { return false; }
  }

  function isSheetsUrl(url) {
    if (!url) return true; // empty is allowed (not configured)
    return isUrlAllowed(url) && (url.includes('script.google.com') || url.includes('script.googleusercontent.com'));
  }

  function isWebhookUrl(url) {
    if (!url) return true;
    return isUrlAllowed(url);
  }

  function audit() {
    console.warn('Sanitize audit: ensure every innerHTML interpolation uses Sanitize.text() or _esc()');
  }

  return { text, attr, strip, id, isUrlAllowed, isSheetsUrl, isWebhookUrl, ALLOWED_HOSTS, ALLOWED_PREFIXES, audit };
})();

// ── Crypto: PIN hashing (SHA-256 via SubtleCrypto, fallback to djb2 for offline) ──
const Crypto = (() => {
  const HEX_RE = /^[a-f0-9]{64}$/i;

  function isHashed(val) {
    return typeof val === 'string' && HEX_RE.test(val.trim());
  }

  // Fast sync fallback hash (djb2-ish) — only for legacy migration when Subtle unavailable
  function fallbackHash(str) {
    let h1 = 5381, h2 = 52711;
    for (let i = 0; i < str.length; i++) {
      h1 = ((h1 << 5) + h1) ^ str.charCodeAt(i);
      h2 = ((h2 << 5) + h2) ^ (str.charCodeAt(i) * 31);
    }
    const hex = (Math.abs(h1).toString(16).padStart(8,'0') + Math.abs(h2).toString(16).padStart(8,'0')).repeat(4);
    return hex.slice(0, 64);
  }

  async function hashPin(pin) {
    const normalized = String(pin).trim();
    if (!normalized) return '';
    // Prefer Web Crypto
    try {
      if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
        const enc = new TextEncoder().encode(normalized);
        const buf = await crypto.subtle.digest('SHA-256', enc);
        const arr = Array.from(new Uint8Array(buf));
        return arr.map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch {}
    return fallbackHash(normalized);
  }

  // Verify input PIN against stored value (hashed or legacy plain)
  async function verifyPin(inputPin, stored) {
    const input = String(inputPin).trim();
    if (!stored) return false;
    const s = String(stored).trim();
    if (isHashed(s)) {
      const hashedInput = await hashPin(input);
      return hashedInput === s.toLowerCase();
    }
    // Legacy plain comparison (will be migrated after success)
    return input === s;
  }

  // One-shot sync check for legacy plain (used during migration without async)
  function isLegacyPin(stored) {
    return stored != null && !isHashed(String(stored).trim());
  }

  return { hashPin, verifyPin, isHashed, isLegacyPin, fallbackHash };
})();

const UI = (() => {
  function confirm(message, onConfirm) {
    if (typeof document !== 'undefined' && document.getElementById('confirmModal')) {
      if (window.confirm(message)) onConfirm();
    } else {
      if (window.confirm(message)) onConfirm();
    }
  }
  function prompt(message, defaultVal, onSubmit) {
    const val = window.prompt(message, defaultVal || '');
    if (val !== null && onSubmit) onSubmit(val);
  }
  return { confirm, prompt };
})();
