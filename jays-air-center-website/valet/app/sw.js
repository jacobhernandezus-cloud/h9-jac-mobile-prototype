// Jay's Valet — minimal PWA service worker (installability + offline shell).
// No push messaging here: status updates surface as in-app banners driven by
// the app's polling loop. Network-first for navigations so the app stays fresh;
// cache-first for static assets.
const CACHE = "valet-shell-v6";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/app.js",
  "./js/data.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                 // never cache API writes
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return;     // always hit the network for data

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("./index.html")));
    return;
  }
  // Network-first for app code so a fresh deploy is always picked up; the cache
  // is just an offline fallback. (Cache-first here is what served George a
  // stale build after we shipped the redesign.)
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
