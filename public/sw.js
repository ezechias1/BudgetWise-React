// Minimal service worker for the React port — cache-first for the shell,
// network-first for API calls. The vanilla app uses a more aggressive
// cache (budgetwise-v34) that turned out to cause stale-JS issues in
// development (per project memory). This intentionally ships a thin SW
// that just enables PWA installability + offline fallback for the shell.

const CACHE = 'budgetwise-react-v1';
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

  // App shell: try cache, fall back to network
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html').then((cached) => cached ?? fetch(event.request)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ??
        fetch(event.request).then((response) => {
          // Only cache same-origin successful GETs
          if (
            event.request.method === 'GET' &&
            response.status === 200 &&
            url.origin === self.location.origin
          ) {
            const clone = response.clone();
            caches.open(CACHE).then((c) => c.put(event.request, clone));
          }
          return response;
        }),
    ),
  );
});
