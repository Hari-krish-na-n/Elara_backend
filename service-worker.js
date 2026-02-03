importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

if (workbox) {
  console.log(`Workbox is loaded`);

  workbox.setConfig({ debug: true });

  const { precacheAndRoute, createHandlerBoundToURL } = workbox.precaching;
  const { registerRoute, NavigationRoute } = workbox.routing;
  const { NetworkFirst, StaleWhileRevalidate, CacheFirst } = workbox.strategies;
  const { ExpirationPlugin } = workbox.expiration;
  const { CacheableResponsePlugin } = workbox.cacheableResponse;

  // 1. Precache App Shell
  // Since we don't have a build step (Vite/Webpack) to generate the manifest,
  // we manually list the critical files to precache.
  // Note: We use the server path '/web/' because server.js serves root at '/web'.
  const PWA_ASSETS = [
    { url: '/web/index.html', revision: 'v1' },
    { url: '/web/repository.js', revision: 'v1' },
    { url: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css', revision: null }
  ];

  precacheAndRoute(PWA_ASSETS);

  // 2. Navigation Route (SPA Fallback)
  // This ensures that navigation requests (e.g. refreshing the page) serve index.html
  // from the cache, preventing "non-precached-url" errors.
  // We use createHandlerBoundToURL pointing to the precached index.html.
  const handler = createHandlerBoundToURL('/web/index.html');
  
  const navigationRoute = new NavigationRoute(handler, {
    // Exclude API routes and other files from being handled as navigation
    denylist: [
      new RegExp('^/api/'),      // API requests
      new RegExp('^/uploads/'),  // Uploaded files
      new RegExp('\\.[a-z]{2,4}$'), // Files with extensions
    ],
  });
  
  registerRoute(navigationRoute);

  // 3. Runtime Caching Strategies

  // API Requests: Network First (fall back to cache if offline)
  registerRoute(
    ({ url }) => url.pathname.startsWith('/api/'),
    new NetworkFirst({
      cacheName: 'elara-api-cache',
      plugins: [
        new CacheableResponsePlugin({
          statuses: [0, 200],
        }),
        new ExpirationPlugin({
          maxEntries: 50,
          maxAgeSeconds: 24 * 60 * 60, // 24 Hours
        }),
      ],
    })
  );

  // Uploaded Media: Cache First (serve from cache, update in background? No, media rarely changes)
  // Actually, for media, CacheFirst is good, but we need to be careful about storage.
  registerRoute(
    ({ url }) => url.pathname.startsWith('/uploads/'),
    new CacheFirst({
      cacheName: 'elara-uploads-cache',
      plugins: [
        new CacheableResponsePlugin({
          statuses: [0, 200],
        }),
        new ExpirationPlugin({
          maxEntries: 20, // Limit number of cached songs
          maxAgeSeconds: 7 * 24 * 60 * 60, // 7 Days
          purgeOnQuotaError: true,
        }),
      ],
    })
  );

  // Static Assets (JS, CSS, Images) from /web/
  registerRoute(
    ({ url }) => url.pathname.startsWith('/web/') && 
                 !url.pathname.endsWith('index.html') && 
                 !url.pathname.endsWith('repository.js'), // Already precached
    new StaleWhileRevalidate({
      cacheName: 'elara-static-resources',
    })
  );

  // Force immediate activation
  self.addEventListener('install', (event) => {
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
  });

} else {
  console.log(`Workbox didn't load`);
}
