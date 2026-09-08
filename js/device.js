/**
 * device.js — Device fingerprinting
 * Generates a stable unique hash for the current device.
 * Used to lock worker accounts to their registered phone.
 */

const Device = (() => {

  /**
   * Generate a device fingerprint hash string.
   * Combines multiple hardware/browser signals then SHA-256 hashes them.
   * Returns a Promise<string> (hex hash).
   */
  async function getFingerprint() {
    const signals = _collectSignals();
    const raw     = JSON.stringify(signals);
    const hash    = await _sha256(raw);
    return hash;
  }

  // ── Signal collection ─────────────────────────────────────

  function _collectSignals() {
    const nav = navigator;
    return {
      // Hardware
      cores:        nav.hardwareConcurrency || 0,
      memory:       nav.deviceMemory        || 0,
      platform:     nav.platform            || '',
      // Screen
      screenW:      screen.width            || 0,
      screenH:      screen.height           || 0,
      colorDepth:   screen.colorDepth       || 0,
      pixelRatio:   window.devicePixelRatio || 1,
      // Browser / language
      language:     nav.language            || '',
      languages:    (nav.languages || []).join(','),
      userAgent:    nav.userAgent           || '',
      // Timezone
      timezone:     Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      tzOffset:     new Date().getTimezoneOffset(),
      // Touch support
      maxTouch:     nav.maxTouchPoints      || 0,
      // Canvas fingerprint — unique rendering per GPU/driver
      canvas:       _canvasFingerprint(),
      // WebGL renderer string
      webgl:        _webglFingerprint(),
    };
  }

  function _canvasFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width  = 200;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font         = '14px Arial';
      ctx.fillStyle    = '#1a73e8';
      ctx.fillRect(0, 0, 200, 50);
      ctx.fillStyle = '#fff';
      ctx.fillText('WorkTap🔒fingerprint', 4, 10);
      ctx.fillStyle = 'rgba(102,204,0,0.7)';
      ctx.fillText('WorkTap🔒fingerprint', 5, 11);
      return canvas.toDataURL().slice(-80); // last 80 chars is enough
    } catch {
      return 'nocanvas';
    }
  }

  function _webglFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      const gl     = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return 'nowebgl';
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        return gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) +
               '|' + gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
      }
      return gl.getParameter(gl.RENDERER) || 'unknown';
    } catch {
      return 'nowebgl';
    }
  }

  // ── SHA-256 via Web Crypto API ────────────────────────────

  async function _sha256(str) {
    const buf    = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ── Short display ID (first 8 chars of hash) ─────────────
  async function getShortId() {
    const fp = await getFingerprint();
    return fp.slice(0, 8).toUpperCase();
  }

  return { getFingerprint, getShortId };

})();
