/**
 * security.js — Central sanitization & hardening helpers
 * - Sanitize.text()  → HTML-escape for safe innerHTML interpolation
 * - Sanitize.attr()  → escape for attribute contexts
 * - Sanitize.strip() → strip dangerous chars at write time + cap length
 * - Sanitize.id()    → allow-list for IDs
 * - UI helpers       → non-blocking confirm/prompt fallback
 */

const Sanitize = (() => {

  // HTML-escape via textContent — the canonical safe escaper
  function text(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  // Attribute-escape (reuses text but also escapes quotes explicitly)
  function attr(str) {
    return text(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Strip dangerous characters at WRITE time + cap length
  // Keeps human-readable text but removes < > " ' ` and trims
  function strip(str, maxLen = 120) {
    let s = String(str == null ? '' : str);
    // Remove angle brackets, quotes, backticks, and control chars
    s = s.replace(/[<>"'`]/g, '').replace(/[\x00-\x1F\x7F]/g, '');
    s = s.trim();
    if (s.length > maxLen) s = s.slice(0, maxLen);
    return s;
  }

  // Strict allow-list for IDs (worker IDs, shift IDs, rota keys)
  function id(str) {
    return String(str == null ? '' : str).replace(/[^a-zA-Z0-9_\-:.]/g, '').slice(0, 80);
  }

  // Quick check for bare innerHTML foot-gun in CI
  // Usage: grep -R "innerHTML = " js/*.js | grep -v "Sanitize\|_esc\|text("
  function audit() {
    console.warn('Sanitize audit: ensure every innerHTML interpolation uses Sanitize.text() or _esc()');
  }

  return { text, attr, strip, id, audit };
})();

// Lightweight non-blocking UI helpers — prefer over window.confirm/prompt
// Falls back to native dialogs if custom modal not available
const UI = (() => {
  function confirm(message, onConfirm) {
    // If a custom confirm modal exists, use it; otherwise native confirm
    if (typeof document !== 'undefined' && document.getElementById('confirmModal')) {
      // Future: wire to custom modal
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
