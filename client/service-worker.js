// Generated with a content-derived version and explicit public shell allowlist.
const CACHE = 'moya-shell-__MOYA_CACHE_VERSION__';
const ASSETS = __MOYA_SHELL_ASSETS__;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { await cache.addAll(ASSETS.map(url => new Request(url, { cache:'reload' }))); }
    catch (error) { await caches.delete(CACHE); throw error; }
  })());
  // Wait for existing tabs to close: HTML, JS, CSS and WASM upgrade together.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('moya-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Never intercept API/session tokens, source requests, images or downloads.
  const asset = event.request.mode === 'navigate' && url.pathname === '/' ? '/' : url.pathname;
  if (!ASSETS.includes(asset)) return;
  event.respondWith((async () => (await (await caches.open(CACHE)).match(asset)) || fetch(event.request))());
});
