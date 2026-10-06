'use strict';
// Service worker: la app funciona sin conexión con los últimos datos vistos.
const VERSION = 'v4'; // al cambiar este número se descartan las copias antiguas de la app
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const SHIELDS = `shields-${VERSION}`;
const SHELL_FILES = ['/', '/styles.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA, SHIELDS].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Datos de la liga: red primero, caché si no hay conexión
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() => caches.open(DATA).then((c) => c.match(url.pathname)).then((r) => r || Response.error())),
    );
    return;
  }

  // Escudos de la web de la liga: caché primero
  if (url.hostname.endsWith('veteransfutbol.com')) {
    e.respondWith(
      caches.open(SHIELDS).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok || res.type === 'opaque') c.put(req, res.clone());
          return res;
        } catch (err) {
          return Response.error();
        }
      }),
    );
    return;
  }

  // Resto (la propia app): red primero, para ver siempre la última versión;
  // la copia guardada sólo se usa si no hay conexión.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.open(SHELL).then((c) => c.match(req, { ignoreSearch: true })).then((r) => r || Response.error())),
    );
  }
});
