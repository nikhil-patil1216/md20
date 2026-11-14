// VIP WMS service worker — app shell cache.
// Network-first: you always get the latest code/data; when offline, the app shell opens from the cache.
// Does not touch Supabase / CDN (cross-origin) requests, so live data is unaffected.
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
