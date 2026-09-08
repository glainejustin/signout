const CACHE = 'signout-v2';
const ASSETS = [
  './', './index.html', './manifest.json',
  './css/styles.css',
  './js/theme.js', './js/security.js', './js/sw-register.js', './js/device.js', './js/gps.js', './js/db.js', './js/nfc.js',
  './js/qr.js', './js/selfie.js', './js/notify.js',
  './js/workers.js', './js/logs.js', './js/rota.js', './js/admin.js', './js/app.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Allow-list external fetches; never cache them
  if (e.request.url.includes('script.google.com') || e.request.url.includes('qrserver.com')) return;
  // Only handle same-origin requests
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      }
      return res;
    })).catch(() => e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)
  );
});
