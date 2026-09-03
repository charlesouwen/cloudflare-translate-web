const CACHE_NAME = 'translate-v19';
const STATIC_ASSETS = [
  '/', '/css/style.css', '/js/app.js', '/js/i18n.js', '/js/languages.js',
  '/js/translator.js', '/js/tts.js', '/js/history.js', '/js/ocr.js',
  '/js/interpreter-echo.js', '/js/interpreter.js', '/js/tabs.js', '/interpreter/',
  '/interpreter/styles.css?v=16', '/interpreter/app.js?v=16',
  '/interpreter/speech-quality.js?v=16'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; /* API 不缓存 */
  /* Always fetch the worker itself so an older service worker cannot pin the
     application to stale UI text indefinitely. */
  if (url.pathname === '/sw.js') {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
    if (resp.ok && e.request.method === 'GET') {
      const clone = resp.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
    }
    return resp;
  }).catch(() => caches.match('/'))));
});
