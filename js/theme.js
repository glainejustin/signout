/* theme.js — Professional theme system
   explicit light / dark / system with localStorage + no-FOUC + UI binding
   by glainejustin — D:\signout
*/

const Theme = (() => {
  const KEY = 'signout_theme'; // 'light' | 'dark' | 'system'
  const VALID = new Set(['light','dark','system']);

  function _systemPref() {
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
    catch { return 'light'; }
  }
  function _resolved(v) { return v === 'system' ? _systemPref() : v; }

  function getPreference() {
    try { const v = localStorage.getItem(KEY); return VALID.has(v) ? v : 'system'; }
    catch { return 'system'; }
  }
  function getResolved() { return _resolved(getPreference()); }

  function _applyAttr(resolved) {
    const r = resolved === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', r);
    try {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = r === 'dark' ? '#0b0f1a' : '#4f46e5';
      document.documentElement.style.colorScheme = r;
    } catch {}
  }

  function apply() { _applyAttr(getResolved()); }

  function _updateUI() {
    const pref = getPreference();
    const resolved = getResolved();
    // segmented controls
    document.querySelectorAll('[data-theme-val]').forEach(btn => {
      const on = btn.getAttribute('data-theme-val') === pref;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // pills — show current
    const label = pref === 'system' ? '◎ Auto' : pref === 'dark' ? '◐ Dark' : '☀ Light';
    const shortLabel = pref === 'system' ? '◎' : pref === 'dark' ? '◐ Dark' : '☀ Light';
    const resolvedLabel = resolved === 'dark' ? '◐ Dark' : '☀ Light';
    document.querySelectorAll('#workerThemeToggle, #adminThemeToggle, #kioskThemeToggle').forEach(el => {
      // keep compact on admin/kiosk pill, descriptive on worker
      if (el.id === 'adminThemeToggle' || el.id === 'kioskThemeToggle') {
        el.textContent = pref === 'system' ? '◎' : resolved === 'dark' ? '◐' : '☀';
        el.title = 'Theme: ' + pref + ' (' + resolved + ') — click to cycle';
      } else {
        el.textContent = label;
        el.title = 'Theme: ' + pref + ' (' + resolved + ') — click to cycle';
      }
      el.setAttribute('aria-label', 'Theme ' + pref + ' — click to change');
    });
    // optional status text
    const hint = document.getElementById('themeStatusHint');
    if (hint) hint.textContent = pref === 'system' ? 'Following system (' + resolved + ')' : pref;
  }

  function setPreference(value) {
    const v = VALID.has(value) ? value : 'system';
    try { localStorage.setItem(KEY, v); } catch {}
    _applyAttr(_resolved(v));
    _updateUI();
    try { document.dispatchEvent(new CustomEvent('signout:theme', { detail: { preference: v, resolved: _resolved(v) }})); } catch {}
    try { if (typeof DB !== 'undefined' && DB.saveSettings) { /* also mirror to DB settings for backup if available */ } } catch {}
    return v;
  }

  function toggle() {
    const cur = getPreference();
    const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
    return setPreference(next);
  }

  function _bindUI() {
    // segmented buttons
    document.querySelectorAll('[data-theme-val]').forEach(btn => {
      if (btn._themeBound) return;
      btn._themeBound = true;
      btn.addEventListener('click', () => setPreference(btn.getAttribute('data-theme-val')));
    });
    // pill cycles
    ['workerThemeToggle','adminThemeToggle','kioskThemeToggle'].forEach(id => {
      const el = document.getElementById(id);
      if (!el || el._themeBound) return;
      el._themeBound = true;
      el.addEventListener('click', () => toggle());
    });
    _updateUI();
  }

  function init() {
    apply();
    _bindUI();
    // react to OS changes only when in system mode
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (getPreference() === 'system') { apply(); _updateUI(); } };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch {}
    // keep UI in sync if other tab changed
    try { window.addEventListener('storage', (e) => { if (e.key === KEY) { apply(); _updateUI(); } }); } catch {}
    // delegate for dynamically added segments
    try { document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-theme-val]');
      if (t) { setPreference(t.getAttribute('data-theme-val')); }
    }); } catch {}
  }

  return { init, apply, getPreference, getResolved, setPreference, toggle, _updateUI };
})();

// ── Immediate no-FOUC: apply before first paint (script is blocking in <head>) ──
try { Theme.apply(); } catch {}

// ── Bind once DOM is ready ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { try { Theme.init(); } catch {} });
} else {
  try { Theme.init(); } catch {}
}

// Re-bind after full load for late-injected modals
window.addEventListener('load', () => { try { Theme._updateUI(); } catch {} });
