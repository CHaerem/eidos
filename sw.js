const CACHE_NAME = 'eidos-v2';

// Install: skip waiting immediately to activate new version ASAP
self.addEventListener('install', () => self.skipWaiting());

// Activate: clean old caches, claim all clients, trigger reload
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => {
        // Notify all clients to reload with new version
        self.clients.matchAll().then(clients => {
          clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
        });
      })
  );
});

// Fetch: network-first for EVERYTHING (always get latest)
// Falls back to cache only when offline
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request).then(resp => {
      // Cache successful responses for offline fallback
      if (resp.ok) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => caches.match(e.request))
  );
});
