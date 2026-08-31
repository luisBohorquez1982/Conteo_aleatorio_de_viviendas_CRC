const CACHE_NAME = "crc-v25-cache-2026-08-30-25.16.1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles_v16.4.css",
  "./script_v25_13.js?v=25.16.1",
  "./manifest.webmanifest",
  "./data/Muestra_V5.1.xlsx",
  "./data/Muestra_V5.1_Distribucion.xlsx",
  "./data/Muestra_V5.1_reemplazos_manzanas.xlsx",
  "./data/Muestra_V5.1_reemplazos_viviendas.xlsx",
  "./data/PERSONAL_CRC.xlsx"
];

const DATA_PATH = "/data/";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isOperationalData = url.origin === self.location.origin && url.pathname.includes(DATA_PATH);

  // Los Excel operativos deben actualizarse cuando hay internet y quedar
  // disponibles offline con la última copia válida descargada.
  if (isOperationalData) {
    event.respondWith(
      fetch(new Request(request, { cache: "no-cache" }))
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || Promise.reject(new Error("Sin datos operativos disponibles offline."))))
    );
    return;
  }

  // Para la aplicación, mantener cache-first para asegurar funcionamiento offline.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    }).catch(() => caches.match("./index.html"))
  );
});
