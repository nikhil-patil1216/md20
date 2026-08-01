var CACHE_NAME = 'vip-wms-v2';
var URLS_TO_CACHE = ['./index.html', './style.css', './script.js'];

self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function(cache) {
    return cache.addAll(URLS_TO_CACHE);
  }));
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(caches.keys().then(function(names) {
    return Promise.all(names.filter(function(n) { return n !== CACHE_NAME; }).map(function(n) { return caches.delete(n); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  event.respondWith(
    fetch(event.request).then(function(response) {
      var clone = response.clone();
      caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
      return response;
    }).catch(function() {
      return caches.match(event.request);
    })
  );
});