// Cache-first for map and elevation tiles, so known areas load offline and fast.
const CACHE = 'tiles-v1';
const TILE_HOSTS = [
  'server.arcgisonline.com',
  'tile.opentopomap.org',
  'tile.openstreetmap.org',
  's3.amazonaws.com',
  'tiles.maps.eox.at',
];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (!TILE_HOSTS.some((h) => url.hostname.endsWith(h))) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
      return res;
    }),
  );
});
