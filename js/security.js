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

// ── UI: accessible in-app dialogs (replaces native alert/confirm/prompt) ──
// Native browser dialogs are unstyled, block the JS thread, and are blocked in
// some kiosk/PWA contexts. These dialogs are promise-based, keyboard-trapped,
// screen-reader labelled, and themeable.
const UI = (() => {

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let _seq = 0;

  function _hasDom() {
    return typeof document !== 'undefined' && document && document.body &&
           typeof document.body.appendChild === 'function' && typeof document.createElement === 'function';
  }

  function _cfg(opts, type) {
    if (typeof opts === 'string') opts = { message: opts };
    opts = opts || {};
    const titles = { alert: 'Heads up', confirm: 'Please confirm', prompt: 'Input required' };
    return {
      type,
      title:        opts.title != null ? opts.title : titles[type],
      message:      opts.message != null ? opts.message : '',
      okText:       opts.okText || (type === 'alert' ? 'Got it' : 'Confirm'),
      cancelText:   opts.cancelText || 'Cancel',
      danger:       !!opts.danger,
      placeholder:  opts.placeholder || '',
      value:        opts.value == null ? '' : String(opts.value),
      password:     !!opts.password,
      maxLength:    Number(opts.maxLength) || 0,
      inputLabel:   opts.inputLabel || 'Value',
    };
  }

  // Fallback when there is no DOM (unit tests / non-browser host).
  function _fallback(cfg) {
    const empty = cfg.type === 'prompt' ? null : cfg.type === 'confirm' ? false : undefined;
    try {
      if (typeof window === 'undefined') return Promise.resolve(empty);
      if (cfg.type === 'prompt')  return Promise.resolve(window.prompt(cfg.message || cfg.title, cfg.value || ''));
      if (cfg.type === 'confirm') return Promise.resolve(!!window.confirm(cfg.message || cfg.title));
      window.alert(cfg.message || cfg.title);
      return Promise.resolve(undefined);
    } catch { return Promise.resolve(empty); }
  }

  function _trap(container, e) {
    const items = Array.prototype.filter.call(
      container.querySelectorAll(FOCUSABLE),
      el => !el.disabled && el.getAttribute('aria-hidden') !== 'true'
    );
    if (!items.length) return;
    const first  = items[0];
    const last   = items[items.length - 1];
    const active = document.activeElement;
    const inside = container.contains(active);
    if (e.shiftKey && (!inside || active === first)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus(); }
  }

  function _dialog(opts, type) {
    const cfg = _cfg(opts, type);
    if (!_hasDom()) return _fallback(cfg);

    return new Promise(resolve => {
      const uid   = ++_seq;
      const opener = document.activeElement;

      const backdrop = document.createElement('div');
      backdrop.className = 'ui-dialog-backdrop';

      const box = document.createElement('div');
      box.className = 'ui-dialog' + (cfg.danger ? ' ui-dialog-danger' : '');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      if (cfg.title)   { box.id = 'uiDialogTitle' + uid;   box.setAttribute('aria-labelledby', box.id); }
      if (cfg.message) { box.setAttribute('aria-describedby', 'uiDialogMessage' + uid); }

      if (cfg.title) {
        const h = document.createElement('h3');
        h.className = 'ui-dialog-title';
        h.textContent = cfg.title;
        box.appendChild(h);
      }
      if (cfg.message) {
        const p = document.createElement('p');
        p.className = 'ui-dialog-message';
        p.id = 'uiDialogMessage' + uid;
        p.textContent = cfg.message;   // textContent → no HTML injection
        box.appendChild(p);
      }

      let input = null;
      if (type === 'prompt') {
        const inputId = 'uiDialogInput' + uid;
        const label = document.createElement('label');
        label.className = 'ui-dialog-label';
        label.setAttribute('for', inputId);
        label.textContent = cfg.inputLabel;
        input = document.createElement('input');
        input.className = 'ui-dialog-input';
        input.id = inputId;
        input.type = cfg.password ? 'password' : 'text';
        input.value = cfg.value;
        if (cfg.placeholder) input.placeholder = cfg.placeholder;
        if (cfg.maxLength)   input.maxLength = cfg.maxLength;
        if (cfg.password)    input.autocomplete = 'new-password';
        box.appendChild(label);
        box.appendChild(input);
      }

      const actions = document.createElement('div');
      actions.className = 'ui-dialog-actions';

      let cancelBtn = null;
      if (type !== 'alert') {
        cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-out ui-dialog-cancel';
        cancelBtn.textContent = cfg.cancelText;
        actions.appendChild(cancelBtn);
      }
      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn ' + (cfg.danger ? 'btn-danger' : 'btn-in') + ' ui-dialog-ok';
      okBtn.textContent = cfg.okText;
      actions.appendChild(okBtn);
      box.appendChild(actions);
      backdrop.appendChild(box);

      let settled = false;
      function close(result) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        backdrop.removeEventListener('mousedown', onBackdrop);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        try { if (opener && typeof opener.focus === 'function') opener.focus(); } catch {}
        resolve(result);
      }
      function submit()  { close(type === 'prompt' ? (input ? input.value.trim() : '') : type === 'alert' ? undefined : true); }
      function dismiss() { close(type === 'prompt' ? null : type === 'confirm' ? false : undefined); }

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); dismiss(); return; }
        if (e.key === 'Enter') {
          if (type === 'prompt' || type === 'alert' || !cfg.danger) { e.preventDefault(); submit(); }
          return;
        }
        if (e.key === 'Tab') _trap(box, e);
      }
      function onBackdrop(e) {
        if (e.target === backdrop && !cfg.danger && type !== 'alert') dismiss();
      }

      okBtn.addEventListener('click', submit);
      if (cancelBtn) cancelBtn.addEventListener('click', dismiss);
      backdrop.addEventListener('mousedown', onBackdrop);
      document.addEventListener('keydown', onKey, true);

      document.body.appendChild(backdrop);

      const focusTarget = input || (cfg.danger && cancelBtn ? cancelBtn : okBtn);
      try { focusTarget.focus(); if (input && input.select) input.select(); } catch {}
    });
  }

  /** Alert → Promise<void> */
  function alert(opts) { return _dialog(opts, 'alert'); }

  /** Confirm → Promise<boolean>. Legacy (message, onConfirm) callbacks still work. */
  function confirm(opts, onConfirm) {
    const p = _dialog(opts, 'confirm');
    if (typeof onConfirm === 'function') p.then(ok => { if (ok) onConfirm(); });
    return p;
  }

  /** Prompt → Promise<string|null> (null = cancelled). */
  function prompt(opts, defaultValue) {
    if (typeof opts === 'string' && defaultValue !== undefined) opts = { message: opts, value: defaultValue };
    return _dialog(opts, 'prompt');
  }

  function isOpen() {
    if (!_hasDom()) return false;
    return !!document.querySelector('.ui-dialog-backdrop');
  }

  return { alert, confirm, prompt, isOpen };
})();
