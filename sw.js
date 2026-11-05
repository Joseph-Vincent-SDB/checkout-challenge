/* Checkout Challenge service worker.
   Caches the app shell so the app opens with no network after the first visit.
   When you change any file, bump CACHE so phones pick up the new version. */
var CACHE = 'checkout-challenge-v3';
var ASSETS = [
  './',
  'index.html',
  'qr.js',
  'logo.jpg',
  'manifest.webmanifest',
  'icons/favicon.png',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Serve from cache first (fast and works offline), refresh the cache in the background. */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () { return hit || (req.mode === 'navigate' ? cache.match('index.html') : undefined); });
        return hit || net;
      });
    })
  );
});
