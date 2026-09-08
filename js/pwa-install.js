/**
 * pwa-install.js — beforeinstallprompt banner + installed telemetry
 * Passive — no UX jank. Shows a dismissible pill when the PWA is installable.
 */
const PWAInstall = (() => {
  let deferred = null;
  let banner = null;

  function init() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferred = e;
      _showBanner();
    });
    window.addEventListener('appinstalled', () => {
      deferred = null;
      _hideBanner();
      try { if (typeof DB !== 'undefined') DB.addAuditLog('PWA_INSTALLED', 'PWA installed to home screen'); } catch {}
    });
    // If already installed (standalone), never show
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      deferred = null;
    }
  }

  function _showBanner() {
    if (banner || !deferred) return;
    // Don't nag more than once per 7 days if dismissed
    try {
      const dismissed = localStorage.getItem('signout_pwa_dismissed');
      if (dismissed && Date.now() - Number(dismissed) < 7 * 24 * 3600000) return;
    } catch {}
    banner = document.createElement('div');
    banner.id = 'pwaInstallBanner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#0f172a;color:#fff;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.25);font-size:13px;font-weight:600;">
        <span style="width:28px;height:28px;display:grid;place-items:center;background:rgba(255,255,255,.14);border-radius:999px;font-size:14px;">◈</span>
        <span>Install SignOut for faster tap-in</span>
        <button id="pwaInstallBtn" style="margin-left:8px;background:#4f46e5;color:#fff;border:none;padding:7px 14px;border-radius:999px;font-weight:800;cursor:pointer;font-size:12.5px;">Install</button>
        <button id="pwaDismissBtn" aria-label="Dismiss" style="background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.18);width:28px;height:28px;border-radius:999px;cursor:pointer;font-size:14px;line-height:1;">×</button>
      </div>`;
    banner.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;display:flex;animation:pageIn .25s ease;';
    document.body.appendChild(banner);
    const style = document.createElement('style');
    style.textContent = '@keyframes pageIn{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}';
    document.head.appendChild(style);
    document.getElementById('pwaInstallBtn').addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      const choice = await deferred.userChoice.catch(() => null);
      if (choice && choice.outcome === 'accepted') _hideBanner();
      deferred = null;
    });
    document.getElementById('pwaDismissBtn').addEventListener('click', () => {
      try { localStorage.setItem('signout_pwa_dismissed', String(Date.now())); } catch {}
      _hideBanner();
    });
    // Auto-hide after 14s if ignored
    setTimeout(() => { if (banner) _hideBanner(); }, 14000);
  }

  function _hideBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  return { init };
})();
