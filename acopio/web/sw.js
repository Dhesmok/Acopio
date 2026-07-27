// =====================================================================
//  sw.js  ·  hace que la app abra aunque no haya señal.
//  Sube la versión al publicar cambios: los celulares se actualizan solos.
// =====================================================================
const VERSION = 'acopio-v12';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './js/app.js',
  './js/mapa.js',
  './js/store.js',
  './js/config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Las llamadas a Supabase nunca se cachean: los datos viven en IndexedDB.
  if (url.hostname.endsWith('supabase.co')) return;
  if (e.request.method !== 'GET') return;

  // Librerías de CDN: se guardan la primera vez que hay señal.
  if (url.hostname === 'esm.sh') {
    e.respondWith(
      caches.match(e.request).then((hit) =>
        hit || fetch(e.request).then((res) => {
          const copia = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copia));
          return res;
        })
      )
    );
    return;
  }

  // App: primero la caché (abre instantáneo), y se refresca por detrás.
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const red = fetch(e.request).then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copia));
        }
        return res;
      }).catch(() => hit);
      return hit || red;
    })
  );
});
