/* Avisos del portal del equipo (10 oct 2026): recordatorios de reporte de turno, problemas y movimientos de caballos.
   Solo muestra notificaciones; no guarda páginas ni datos (el portal siempre se pide a la red). Alcance: /equipo/ */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {body: e.data && e.data.text()}; }
  e.waitUntil(self.registration.showNotification(d.title || "Rancho El Descanso", {
    body: d.body || "", icon: "/app-icon-192.png", badge: "/app-icon-192.png", tag: d.tag || undefined, renotify: !!d.tag,
    data: {url: d.url && String(d.url).indexOf("/equipo/") === 0 ? d.url : "/equipo/"}
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/equipo/";
  e.waitUntil(clients.matchAll({type: "window", includeUncontrolled: true}).then(list => {
    for (const c of list) { if (c.url.indexOf("/equipo/") >= 0 && "focus" in c) { c.navigate(url); return c.focus(); } }
    return clients.openWindow(url);
  }));
});
