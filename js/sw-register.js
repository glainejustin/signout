/**
 * sw-register.js — Service Worker registration (extracted from inline script for CSP)
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .catch(e => console.warn('SW failed:', e));
  });
}
