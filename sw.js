// Built by build_pwa.py — VERSION changes on every rebuild so phones pick up new data.
const VERSION = "07c81b2d742c";
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
