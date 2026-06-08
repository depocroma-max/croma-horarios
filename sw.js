const CACHE = 'croma-v1';
const ASSETS = [
  '/croma-horarios/',
  '/croma-horarios/index.html',
  '/croma-horarios/style.css',
  '/croma-horarios/app.js',
  '/croma-horarios/tridente_solo.png',
  '/croma-horarios/favicon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network first, cache fallback
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // No cachear llamadas al Apps Script
  if (e.request.url.includes('script.google.com')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
