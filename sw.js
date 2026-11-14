// VIP WMS service worker — app shell cache.
// Network-first: hamesha latest code/data milta hai, offline ho to cache se app shell khulta hai.
// Supabase / CDN (cross-origin) requests ko touch nahi karta, to live data pe koi asar nahi.
var CACHE = 'vip-wms-shell-v1';
var SHELL = ['/', '/index.html', '/style.css', '/script.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', function (e) {
    e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).catch(function () {}));
    self.skipWaiting();
});
self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
        }).then(function () { return self.clients.claim(); })
    );
});
self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') return;
    var url = new URL(req.url);
    if (url.origin !== self.location.origin) return;      // Supabase, CDN etc. — direct network
    e.respondWith(
        fetch(req).then(function (res) {
            if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
            return res;
        }).catch(function () {
            return caches.match(req).then(function (hit) {
                return hit || (req.mode === 'navigate' ? caches.match('/index.html') : undefined);
            });
        })
    );
});
