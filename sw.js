const CACHE = 'croma-v7';
const ASSETS = [
  '/',
  '/index.html',
  '/croma-ds.css',
  '/croma-icons.js',
  '/style.css',
  '/js/01-config-y-datos.js',
  '/js/02-grilla-y-en-vivo.js',
  '/js/03-empleados-lista.js',
  '/js/04-detalle-empleado.js',
  '/js/05-reportes-y-render-principal.js',
  '/js/06-carga-de-datos-y-ui.js',
  '/js/07-certificados-y-vacaciones-aprobadas.js',
  '/js/08-login-y-vista-empleado.js',
  '/js/09-admin-panel-y-ajuste-jornada.js',
  '/js/10-admin-sucursales-y-kioscos.js',
  '/js/11-admin-fichadas-y-empleados.js',
  '/js/12-admin-recibos.js',
  '/js/13-init-confirmacion-y-foto.js',
  '/js/14-vacaciones-config-y-modales.js',
  '/js/15-portal-empleado-y-calendario.js',
  '/js/16-admin-vacaciones-y-banco-horas.js',
  '/js/17-anuncios.js',
  '/tridente_solo.png',
  '/favicon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network first, cache fallback
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // No cachear llamadas al Apps Script
  if (e.request.url.includes('script.google.com')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
