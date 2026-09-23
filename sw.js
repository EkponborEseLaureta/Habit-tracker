/* Ese Daily Habit Tracker — service worker.
   Caches the app shell for offline use, and caches the Bible text the first
   time it is opened so it never needs to be downloaded again. */
var CACHE = "ese-habit-tracker-v3";
var SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var url = e.request.url;

  // The Bible file: cache-first. Once downloaded once, always read from the cache.
  if (url.indexOf("bible-kjv.min.json") !== -1) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(e.request).then(function (hit) {
          if (hit) return hit;
          return fetch(e.request).then(function (res) {
            c.put(e.request, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  // Everything else: try the network first (so updates are picked up when online),
  // fall back to the cache when offline.
  e.respondWith(
    fetch(e.request)
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      })
      .catch(function () { return caches.match(e.request); })
  );
});
