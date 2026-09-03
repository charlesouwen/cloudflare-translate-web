const CACHE_NAME = 'translate-v29';
const CACHE_PREFIX = 'translate-';
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/css/style.css',
  '/js/app.js',
  '/js/i18n.js',
  '/js/languages.js',
  '/js/translator.js',
  '/js/tts.js',
  '/js/history.js',
  '/js/ocr.js',
  '/js/camera.js',
  '/js/interpreter-echo.js',
  '/js/interpreter.js',
  '/js/tabs.js',
  '/js/tesseract/tesseract.min.js',
  '/vendor/onnx/ort.wasm.min.js',
  '/vendor/vad/bundle.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }
  if (request.method !== 'GET' || request.headers.has('range')) return;

  if (url.pathname === '/sw.js') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // The legacy standalone interpreter is now a redirect, so its old bundles
  // must never be restored from a runtime cache.
  if (url.pathname.startsWith('/interpreter/') && request.mode !== 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});

function isStaticAsset(pathname) {
  return pathname.startsWith('/css/') ||
    pathname.startsWith('/js/') ||
    pathname.startsWith('/vendor/') ||
    pathname === '/manifest.json' ||
    /\.(?:css|js|mjs|wasm|onnx|json|png|jpe?g|gif|webp|svg|ico|woff2?|ttf)$/i.test(pathname);
}

function isCacheable(response) {
  const cacheControl = response.headers.get('cache-control') || '';
  return response.ok && response.status === 200 && response.type === 'basic' &&
    !/no-store/i.test(cacheControl);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    return (await cache.match(request)) || (await cache.match('/')) || Response.error();
  }
}

function staleWhileRevalidate(event, request) {
  const refresh = fetch(request).then(async (response) => {
    if (isCacheable(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  });

  event.waitUntil(refresh.then(() => undefined, () => undefined));
  return caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(request);
    return cached || refresh;
  });
}
