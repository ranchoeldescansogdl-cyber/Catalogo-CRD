/* Service worker de la app de Rancho El Descanso.
   Conservador a propósito: la página siempre se pide a la red (precios y caballos al día);
   solo si no hay internet se muestra la última versión guardada.
   No toca /api/ (pagos), ni la hoja de Google, ni nada de otros dominios. */
const CACHE = "crd-app-v1";
const PRECACHE = ["/", "/manifest.webmanifest", "/app-icon-192.png", "/app-icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put("/", copy));
        return res;
      }).catch(() => caches.match("/"))
    );
    return;
  }
  // Íconos, fotos y demás archivos propios: primero la red, respaldo en caché
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req))
  );
});

/* Listo para la fase 2: notificaciones (caballo nuevo, evento, recordatorio de sesión) */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Rancho El Descanso", {
    body: d.body || "",
    icon: "/app-icon-192.png",
    badge: "/app-icon-192.png",
    data: { url: d.url || "/?app=1" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/?app=1";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) { c.navigate(url); return c.focus(); } }
    return clients.openWindow(url);
  }));
});
