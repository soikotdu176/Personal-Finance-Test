/* Personal Finance service worker - offline-first caching for the app shell and CDN libraries. */
const VERSION = 'v13.0.0';
const SHELL_CACHE = `assetbook-shell-${VERSION}`;
const RUNTIME_CACHE = `assetbook-runtime-${VERSION}`;

const SHELL_ASSETS = [
  './',
  'index.html',
  'styles.css?v=13',
  'app.js?v=13',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

// Third-party libraries the app needs to work offline (cached best-effort).
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    // Cache one asset at a time: a single 404 must not leave the app with no offline shell at all.
    await Promise.all(SHELL_ASSETS.map(async url => {
      try { await shell.add(new Request(url, { cache: 'reload' })); }
      catch (error) { console.warn('[sw] skipped shell asset', url, error); }
    }));
    const runtime = await caches.open(RUNTIME_CACHE);
    // Best-effort: a single CDN failure must not abort installation.
    await Promise.all(CDN_ASSETS.map(async url => {
      try { await runtime.add(new Request(url, { mode: 'cors', credentials: 'omit' })); } catch (e) { /* retried at runtime */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('assetbook-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isCacheable(response) {
  return response && (response.ok || response.type === 'opaque');
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    // 'no-cache' revalidates with the server so a stale HTTP cache can never mix old and new files
    const fresh = await fetch(request, { cache: 'no-cache' });
    if (isCacheable(fresh)) cache.put(request, fresh.clone());
    return fresh;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true }) || await cache.match('index.html') || await cache.match('./');
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(response => {
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || (await refresh) || Response.error();
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  } catch (error) {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!/^https?:$/.test(url.protocol)) return;

  // Page navigations: network first, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  // Same-origin assets: network first (always the newest files), cached copy only when offline.
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }
  // Pinned CDN libraries and Google Fonts files never change for a given URL.
  if (/(^|\.)jsdelivr\.net$|(^|\.)cdnjs\.cloudflare\.com$|fonts\.gstatic\.com$/.test(url.hostname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  // Google Fonts stylesheets.
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});
