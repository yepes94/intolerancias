/* Intolerancias · sw.js
 * Solo para notificaciones: permite mostrar el recordatorio del diario con
 * registration.showNotification (Android no admite `new Notification`) y,
 * al tocarlo, enfocar la app y abrir el diario.
 * Sin handler de fetch: no cachea nada, la app se sirve siempre fresca.
 * Sin push: no hay servidor de envío (ver PR del diario, opción Web Push). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const day = (event.notification.data && event.notification.data.day) || "";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if ("focus" in w) {
        w.postMessage({ type: "open-diary", day });
        return w.focus();
      }
    }
    return self.clients.openWindow("./?diario=" + encodeURIComponent(day || "1"));
  })());
});
