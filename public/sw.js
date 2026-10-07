const V = 'mai-v3';
const SHELL = ['/', '/index.html', '/styles.css?v=3', '/app.js?v=3', '/manifest.webmanifest', '/bank.json', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  if (u.origin.includes('fonts.g')) {
    e.respondWith(caches.open(V).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (u.origin !== location.origin) return;
  // network first for pages, cache first for assets
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(r => { const rc = r.clone(); caches.open(V).then(c => c.put('/', rc)); return r; }).catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok) { const rc = r.clone(); caches.open(V).then(c => c.put(e.request, rc)); } return r; })));
});
