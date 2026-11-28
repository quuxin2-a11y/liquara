var C = "liquara-v3.0.7";
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.filter(function (x) { return x !== C; }).map(function (x) { return caches.delete(x); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener("fetch", function (e) {
  var u = new URL(e.request.url);
  /* The Android app file is a download, not part of the site: never keep a copy of it in the offline cache. */
  if (e.request.method !== "GET" || u.origin !== location.origin || /\.apk(\.sha256)?$/i.test(u.pathname)) return;
  e.respondWith(fetch(e.request).then(function (r) { var c = r.clone(); caches.open(C).then(function (x) { x.put(e.request, c); }); return r; }).catch(function () { return caches.match(e.request); }));
});
