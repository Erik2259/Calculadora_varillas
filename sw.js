/* ==========================================================
   Calculadora de Varillas — Service Worker
   ----------------------------------------------------------
   Estrategia:
   - install:  precachea los archivos principales (App Shell).
   - activate: elimina cachés de versiones anteriores.
   - fetch:    "stale-while-revalidate" → responde al instante desde la
               caché y en paralelo descarga la versión más reciente
               para la próxima visita. Así funciona sin conexión y los
               archivos se actualizan solos.

   Al publicar cambios importantes, incrementa CACHE_VERSION para
   forzar una reinstalación completa de la caché.
   ========================================================== */

const CACHE_VERSION = 'v3.4.0';
const CACHE_NAME = `calculadora-varillas-${CACHE_VERSION}`;
const CACHE_FUENTES = 'calculadora-varillas-fuentes';   // Google Fonts (sin versión: no cambian)
const ORIGENES_FUENTES = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './calc.js',
  './exportar.js',
  './manifest.json',
  './assets/logo.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

// ---------- Instalación: guardar el App Shell ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())   // activar la nueva versión sin esperar
  );
});

// ---------- Activación: limpiar cachés viejas ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('calculadora-varillas-') && key !== CACHE_NAME && key !== CACHE_FUENTES)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())  // tomar control de las pestañas abiertas
  );
});

// ---------- Peticiones: stale-while-revalidate ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;
  const origen = new URL(request.url).origin;

  // Tipografías: cache-first, para que la interfaz se vea igual sin conexión
  if (ORIGENES_FUENTES.includes(origen)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_FUENTES);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const respuesta = await fetch(request);
        if (respuesta && (respuesta.ok || respuesta.type === 'opaque')) cache.put(request, respuesta.clone());
        return respuesta;
      } catch {
        return new Response('', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Resto: solo mismo origen (no cachear extensiones, APIs externas, etc.)
  if (origen !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Todas las navegaciones (p.ej. "/?b=30&h=45" de un enlace compartido) usan
    // una sola entrada: index.html. Así la caché no crece con cada enlace.
    const clave = request.mode === 'navigate' ? './index.html' : request;
    const cached = await cache.match(clave, { ignoreSearch: request.mode === 'navigate' });

    const red = fetch(request)
      .then((respuesta) => {
        if (respuesta && respuesta.ok && !respuesta.redirected) cache.put(clave, respuesta.clone());
        return respuesta;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(red);  // actualizar la caché en segundo plano
      return cached;
    }

    const respuesta = await red;
    if (respuesta) return respuesta;

    // Sin red y sin caché: para navegaciones devolver la app principal
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('Sin conexión', { status: 503, statusText: 'Offline' });
  })());
});
