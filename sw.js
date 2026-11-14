// VIP WMS service worker — app shell + offline support.
// Same-origin files: network-first (latest code online), cache fallback (offline).
// CDN libraries (icons, Excel, PDF, Supabase, scanner): stale-while-revalidate, so the app also opens offline.
// Supabase API calls (supabase.co) and /api/* are never touched.
var CACHE = 'vip-wms-shell-v2';
var SHELL = ['/', '/index.html', '/style.css', '/script.js', '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
var CDN_HOSTS = ['unpkg.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', function (e) {
    e.waitUntil(caches.open(CACHE).then(function (c) {
        return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
    }));
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

    if (url.origin === self.location.origin) {
        if (url.pathname.indexOf('/api/') === 0) return;          // serverless functions — direct network
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
        return;
    }

    if (CDN_HOSTS.indexOf(url.hostname) > -1) {
        e.respondWith(
            caches.open(CACHE).then(function (c) {
                return c.match(req).then(function (hit) {
                    var net = fetch(req).then(function (res) {
                        if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
                        return res;
                    }).catch(function () { return hit; });
                    return hit || net;
                });
            })
        );
    }
    // everything else (Supabase etc.) — direct network
});