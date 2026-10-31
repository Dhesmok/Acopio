// =====================================================================
//  sw.js  ·  hace que la app abra aunque no haya señal.
//  Sube la versión al publicar cambios: los celulares se actualizan solos.
// =====================================================================
const VERSION = 'acopio-v96';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './js/app.js',
  './js/mapa.js',
  './js/dibujo.js',
  './js/store.js',
  './js/gps.js',
  // la ventana de calibrar el GPS desde la oficina (solo del admin)
  './calibrar.html',
  './js/calibrar.js',
  // se carga solo al pedir el informe, pero tiene que estar guardado de
  // antemano: si no, sacar el listado dejaría de funcionar sin señal
  './js/excel.js',
  './js/config.js',
  // Los avisos tienen que sonar sin señal, así que se guardan como el
  // resto de la app: la volqueta al registrar un lote y el timbre al
  // llegar una tarea.
  './sonidos/volqueta.mp3',
  './sonidos/tarea.mp3',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // `cache: 'reload'` obliga a ir a la red saltándose la caché HTTP del
      // navegador. Sin esto, subir la versión aquí no garantizaba nada: se
      // podían guardar bajo el nombre nuevo exactamente los archivos viejos.
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cuánto se espera a la red antes de darla por perdida. En el patio con una
// barra de señal que va y viene, el navegador puede tardar decenas de segundos
// en decidir que la conexión falló; mientras tanto la pantalla queda esperando
// y parece congelada. Con este tope, a los cinco segundos se contesta con lo
// que hay —caché o error— y la app sigue viva.
const RED_TIMEOUT_MS = 5000;

// fetch con reloj: si la red no responde dentro del tope, se aborta. El catch
// de quien llamó recibe AbortError igual que un fallo de red, y puede decidir
// qué enseñar sin esperar al timeout largo del navegador.
const fetchConTope = (request) => {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), RED_TIMEOUT_MS);
  return fetch(request, { signal: control.signal }).finally(() => clearTimeout(reloj));
};

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Las llamadas a Supabase nunca se cachean: los datos viven en IndexedDB.
  if (url.hostname.endsWith('supabase.co')) return;
  if (e.request.method !== 'GET') return;
  // Las imágenes de otros sitios —los cuadros del satélite al calibrar el
  // GPS— van directo a la red. Son miles, pesan, cambian de zoom en zoom y
  // solo sirven con señal: guardarlas llenaría el celular de fotos que no
  // se vuelven a mirar, y el tope de cinco segundos de abajo cortaría las
  // que tardan en una conexión floja.
  if (e.request.destination === 'image' && url.origin !== self.location.origin) return;

  // Librerías de CDN: se guardan la primera vez que hay señal.
  if (url.hostname === 'esm.sh') {
    e.respondWith(
      caches.match(e.request).then((hit) =>
        hit || fetchConTope(e.request).then((res) => {
          const copia = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copia));
          return res;
        })
      )
    );
    return;
  }

  // App: primero la caché (abre instantáneo), y se refresca por detrás.
  //
  // Si hay caché se devuelve YA, sin esperar a la red. La versión anterior
  // devolvía `red` cuando no había caché y esperaba a que el navegador
  // declarara muerta la conexión, que en modo avión puede tardar mucho:
  // durante ese tiempo ni el aviso de "sin conexión" salía. Ahora el fallo
  // llega como mucho a los cinco segundos y la interfaz lo enseña de inmediato.
  e.respondWith(
    caches.match(e.request).then(async (hit) => {
      if (hit) {
        // Refresco por detrás: la próxima vez habrá versión nueva si la hubo.
        fetchConTope(e.request).then((res) => {
          if (res.ok) {
            const copia = res.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copia));
          }
        }).catch(() => {});
        return hit;
      }

      // Sin caché: a la red, pero con el tope de arriba para no colgar la UI.
      try {
        const res = await fetchConTope(e.request);
        if (res.ok) {
          const copia = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copia));
        }
        return res;
      } catch {
        return Response.error();
      }
    })
  );
});
