/* Ese Daily Habit Tracker — service worker (offline support).
   - The app itself, its icons and the Firebase library are saved on the phone,
     so the app opens and works with no internet.
   - The Bible text is saved the first time it loads, then always read from the phone.
   - Firebase's own data traffic is left alone (Firebase keeps its own offline copy
     and syncs automatically when the connection comes back). */
var CACHE = "ese-habit-tracker-v5";
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

function shouldHandle(req) {
  if (req.method !== "GET") return false;
  var u = new URL(req.url);
  if (u.origin === self.location.origin) return true;
  return u.hostname === "www.gstatic.com"; /* the Firebase library files */
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (!shouldHandle(req)) return;

  // Bible text and Firebase library: cache-first (they never change).
  if (req.url.indexOf("bible-kjv.min.json") !== -1 || req.url.indexOf("gstatic.com") !== -1) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) { if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone()); return res; });
        });
      })
    );
    return;
  }

  // Everything else (the app): network first so updates show, saved copy when offline.
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined);
      });
    })
  );
});

/* ---------- phone alarms ----------
   The server sends only a short code. The words shown come from text the app saved
   privately on this phone, so habit names never pass through the server. */
function idbGet(k) {
  return new Promise(function (res) {
    var r = indexedDB.open("ese-push", 1);
    r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
    r.onsuccess = function () {
      try {
        var g = r.result.transaction("kv", "readonly").objectStore("kv").get(k);
        g.onsuccess = function () { res(g.result); }; g.onerror = function () { res(undefined); };
      } catch (e) { res(undefined); }
    };
    r.onerror = function () { res(undefined); };
  });
}
function localDate(d) { var m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day; }

self.addEventListener("push", function (e) {
  var p = {}; try { p = e.data ? e.data.json() : {}; } catch (x) {}
  var d = p.data || p, tag = String(d.tag || "");
  e.waitUntil(Promise.all([idbGet("texts"), idbGet("daily"), idbGet("status")]).then(function (r) {
    var texts = r[0] || {}, daily = r[1] || {}, st = r[2] || {}, date = localDate(new Date());
    var nm = st.name ? ", " + st.name : "";
    var t = texts[tag] || { title: "Ese Daily Habit Tracker", body: "Your daily check-in is here." };
    var title = t.title, body = t.body;
    if (tag === "daily" && daily[date]) { title = daily[date].title; body = daily[date].body; }
    if (tag === "evening" && st.date === date && st.total) {
      if (st.done >= st.total) { title = "🎉 All done today" + nm; body = "Every habit ticked. Rest well tonight."; }
      else { body = "You've done " + st.done + " of " + st.total + ". Still time for one more" + nm + "."; }
    }
    if (tag === "steps" && st.date === date) {
      if (st.steps >= st.goal) { title = "👟 Step goal reached" + nm + "!"; body = st.steps.toLocaleString() + " steps today. Well done."; }
      else { body = "You're at " + (st.steps || 0).toLocaleString() + " of " + (st.goal || 8000).toLocaleString() + " steps. A short walk will help."; }
    }
    return self.registration.showNotification(title, {
      body: body, icon: "./icon-192.png", badge: "./icon-192.png", tag: tag || "ese",
      renotify: true, requireInteraction: tag.indexOf("h:") === 0, vibrate: [200, 100, 200], data: { url: "./" }
    });
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ("focus" in list[i]) return list[i].focus(); }
    return self.clients.openWindow("./");
  }));
});
