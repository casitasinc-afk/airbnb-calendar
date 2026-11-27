// Built by build_pwa.py — VERSION changes on every rebuild so phones pick up new data.
const VERSION = "ada299f07936";
const CACHE = "airbnb-cal-" + VERSION;
const SHELL = ["./", "index.html", "data.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("airbnb-cal-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first, bypassing the HTTP cache (t183u: everyone gets the latest published data), fall back to cache when offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(new Request(e.request.url, { cache: "no-store", credentials: "same-origin" }))
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          const key = e.request.url.split("?")[0]; // t183u: one entry per file (the 90 s re-check adds ?ts=…)
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});

// t319u: Web Push for newly red inbox threads (even when the app is closed).
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  const title = data.title || "🔴 Nová červená zpráva";
  const payload = data.data || data;
  const opts = {
    body: data.body || "",
    tag: data.tag || "red-msg",
    renotify: true,
    data: payload,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png"
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const url = d.url || (self.registration.scope + (d.id ? ("#msg=" + encodeURIComponent(d.id)) : ""));
  e.waitUntil((async () => {
    const clis = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clis) {
      if (c.url && c.url.startsWith(self.registration.scope) && "focus" in c) {
        try { c.postMessage({ type: "open-msg", id: d.id || "", url }); } catch (_) {}
        await c.focus();
        return;
      }
    }
    await self.clients.openWindow(url || self.registration.scope);
  })());
});
