// React port service worker — network-first for navigations so a reload
// always gets fresh HTML (and therefore fresh hashed JS bundles). Falls
// back to cached shell only when offline. Static assets are cache-first.

const CACHE = 'budgetwise-react-v17';
const SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Supabase / Stripe / Plaid / exchangerate-api calls
  if (
    url.hostname.endsWith('supabase.co') ||
    url.hostname.endsWith('stripe.com') ||
    url.hostname.endsWith('plaid.com') ||
    url.hostname.includes('exchangerate-api')
  ) {
    return;
  }

  // NAVIGATIONS (document requests): network-first. Falls back to cached
  // /index.html only when offline so the user still sees the app shell.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Stash the fresh HTML so offline fallback stays up to date.
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE).then((c) => c.put('/index.html', clone));
          }
          return response;
        })
        .catch(() => caches.match('/index.html').then((c) => c || Response.error())),
    );
    return;
  }

  // Static same-origin GETs: network-first with cache fallback.
  if (event.request.method === 'GET' && url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE).then((c) => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((c) => c || Response.error())),
    );
  }
});

// Push notification handler — for bill reminders, stokvel, trial expiry
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const payload = event.data.json();
    event.waitUntil(
      self.registration.showNotification(payload.title || 'BudgetWise', {
        body: payload.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: payload.url || '/',
      }),
    );
  } catch {
    // Fallback for plain text push
    event.waitUntil(
      self.registration.showNotification('BudgetWise', {
        body: event.data.text(),
        icon: '/icons/icon-192.png',
      }),
    );
  }
});

// Notification click — open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
