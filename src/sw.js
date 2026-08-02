const CACHE_NAME = 'school-mgr-v2';
const urlsToCache = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json', '/jszip.min.js'];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
        .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => response || fetch(event.request).catch(() => {
            if (event.request.headers.get('accept').includes('text/html')) {
                return caches.match('/index.html');
            }
        }))
    );
});