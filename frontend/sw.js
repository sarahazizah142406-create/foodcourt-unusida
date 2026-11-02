// Service worker: notifikasi sistem + Web Push saat browser/tab ditutup.
// install & activate
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Buka / fokus halaman saat notifikasi diketuk
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { c.focus(); return; }
      }
      return self.clients.openWindow(url);
    })
  );
});

// Web Push: terima push dari server meski browser ditutup
self.addEventListener("push", (e) => {
  let data = { title: "Food Court UNUSIDA", body: "Ada kabar baru untuk pesananmu." };
  try { data = Object.assign(data, e.data.json()); } catch { /* pakai default */ }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/assets/logo.png",
      badge: "/assets/logo.png",
      tag: data.tag || "fc-push",
      renotify: true,
      vibrate: [200, 100, 200, 100, 200],
      data: { url: data.url || "/" }
    })
  );
});
