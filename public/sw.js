// Offline-friendly caching + real Web Push handling.
//
// Bumped to v3 when API-response caching was removed: the activate handler
// below deletes every cache whose name isn't CACHE, so bumping the version
// is what purges the team data older builds had already written to disk.
const CACHE = 'percolate-v3';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Only ever cache our own app shell. Supabase REST responses carry real
  // team data (messages, notes, payroll hours) and must NEVER land in Cache
  // Storage: it outlives sign-out and is readable by whoever picks up the
  // device next — which for a shared shop iPad is the whole problem.
  // Falling through without respondWith lets the browser fetch normally.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const save = (res) => {
    // Don't memoize errors or opaque responses.
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };

  // Build assets are content-hashed by Vite, so a given URL's bytes can
  // never change — a new build means a new filename. Serve them straight
  // from cache and don't block launch on the network at all. This was the
  // big one: network-first meant every launch waited on ~450 KB of JS it
  // already had on disk, and the cache only ever helped if the network was
  // fully down.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(save)));
    return;
  }

  // Everything else — the HTML shell above all — stays network-first, so a
  // fresh deploy is picked up straight away rather than being pinned to a
  // stale index.html pointing at asset names that no longer exist.
  e.respondWith(
    fetch(req)
      .then(save)
      .catch(() => caches.match(req))
  );
});

// Sign-out asks us to drop everything cached on this device.
self.addEventListener('message', (e) => {
  if (e.data === 'percolate-purge-cache') {
    e.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

// A push message arrived from notify-push (see supabase/functions/).
self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: 'Percolate', body: e.data ? e.data.text() : '' };
  }
  const title = data.title || 'Percolate';
  const options = {
    body: data.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag || 'percolate-message',
    data: { url: data.url || '/' },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Tapping a notification focuses an open tab, or opens a new one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
