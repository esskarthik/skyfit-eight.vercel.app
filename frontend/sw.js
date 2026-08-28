const CACHE = 'skyfit-v3';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json', '/admin.html', '/admin.js', '/admin.css', '/assets/logo-new-icon.png', '/assets/logo-new.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  // API: network-first, never cache bodies
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).then(r => r.clone()).catch(() => new Response('', { status: 503, statusText: 'Offline' })));
    return;
  }
  // Assets/pages: network-first with cache fallback. The app is deployed regularly,
  // so always try the server first so fresh JS/CSS reach the browser; the cache is
  // only an offline/speedy fallback. (Old behaviour was cache-first, which left the
  // admin panel serving a stale admin.js after every deploy.)
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.ok && e.request.method === 'GET') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('/index.html')))
  );
});
