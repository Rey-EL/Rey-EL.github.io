/* Idris OS app service worker — SOURCE OF RECORD, NOT SERVED by this
   artifact: the platform's client staging requires exactly one JS
   bundle in the built output, so a second .js file (a service worker)
   cannot be published from this artifact (verified at Phase 6 build
   time: the CVM client build fails with "expected exactly one JS
   bundle" when sw.js is present in client/dist). The app still attempts
   registration of ./sw.js at runtime and reports the outcome plainly in
   its install panel; the offline fallback is carried by the app's
   last-received-snapshot store instead. This file is kept ready to
   serve unchanged if the platform gains a static-JS route.
   Scope (when served): the directory this file is served from — the
   artifact root — which covers the app route (/#/app) and the default
   view.

   Strategy:
   - App shell and static assets (scripts, styles, images, icons, audio,
     the manifest): cache-first, refreshed from the network in the
     background of the install step only.
   - Snapshot reads (POST ./actions): network-first. A successful read is
     kept in the snapshot cache; when the network fails, the LAST snapshot
     response this device received is returned, so the app renders it with
     its own as-of time (generated_at) clearly shown — never as current.
   This worker never fabricates a response: with nothing cached and no
   network, the request fails and the app shows its plain failure state. */

var SHELL_CACHE = "idris-os-shell-v1";
var SNAPSHOT_CACHE = "idris-os-snapshot-v1";
var SNAPSHOT_KEY = "./actions-last-snapshot";

var SHELL_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./pwa/icon-192.png",
  "./pwa/icon-512.png",
  "./pwa/icon-maskable-512.png",
  "./pwa/apple-touch-icon.png",
  "./pwa/favicon-32.png",
  "./pwa/idris-greeting-presence.mp3",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(function (cache) {
        return cache.addAll(SHELL_URLS);
      })
      .then(function () {
        return self.skipWaiting();
      })
      .catch(function () {
        /* Shell precache is best-effort: a failed precache must not block
           the worker; runtime caching below still applies. */
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return k !== SHELL_CACHE && k !== SNAPSHOT_CACHE;
            })
            .map(function (k) {
              return caches.delete(k);
            }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

function isSnapshotRead(request) {
  if (request.method !== "POST") return false;
  try {
    return new URL(request.url).pathname.endsWith("/actions");
  } catch (e) {
    return false;
  }
}

self.addEventListener("fetch", function (event) {
  var request = event.request;

  if (isSnapshotRead(request)) {
    // Network-first for snapshot reads; fall back to the last snapshot
    // this device actually received.
    event.respondWith(
      fetch(request.clone())
        .then(function (response) {
          if (response && response.ok) {
            var copy = response.clone();
            caches
              .open(SNAPSHOT_CACHE)
              .then(function (cache) {
                return cache.put(SNAPSHOT_KEY, copy);
              })
              .catch(function () {});
          }
          return response;
        })
        .catch(function () {
          return caches.open(SNAPSHOT_CACHE).then(function (cache) {
            return cache.match(SNAPSHOT_KEY).then(function (cached) {
              if (cached) return cached;
              throw new Error("offline and no snapshot has been received yet");
            });
          });
        }),
    );
    return;
  }

  if (request.method !== "GET") return;

  // Cache-first for the app shell and static assets.
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response && response.ok && new URL(request.url).origin === self.location.origin) {
          var copy = response.clone();
          caches
            .open(SHELL_CACHE)
            .then(function (cache) {
              return cache.put(request, copy);
            })
            .catch(function () {});
        }
        return response;
      });
    }),
  );
});
