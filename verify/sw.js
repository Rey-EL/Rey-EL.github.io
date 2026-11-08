/**
 * sw.js — the service worker (WP2; Gates O-01, O-05, V-06, A08).
 *
 * INVARIANT (cache contents): the cache holds ONLY the versioned static assets listed in
 * PRECACHE, fetched from this origin at install time. The fetch handler answers from the
 * cache only for those exact paths (and the app shell for navigations). It never calls
 * cache.put at runtime, never caches a POST, never touches the api/ directory beside it,
 * and so can never store an address, hash, camera image, record response, or verdict
 * [Plan §3.4] [Gate O-05].
 *
 * Base path: every path here resolves against the directory this worker was served from
 * (BASE), never the origin root, so the app works from a domain root or any subdirectory
 * with no configuration. PRECACHE entries are therefore relative.
 *
 * Update flow [Plan WP2]: a new CACHE_VERSION installs alongside the old one and waits.
 * The app shows "A new version is ready"; on the user's tap it posts SKIP_WAITING. On
 * activate, only caches whose names start with "vbys-static-" and differ from the current
 * version are deleted. User data lives in localStorage, which a service worker cannot
 * read or clear, so an update never deletes a run, a preference, or a saved card.
 * Any change to PRECACHE must come with a new CACHE_VERSION (and the matching APP_VERSION
 * in js/app.js, Gate A08 test): otherwise the new worker would install into the cache the
 * live worker is serving, and activate would clear nothing. The fix pass (m12, six icons
 * added) moved 0.1.0-phase1-review -> 0.1.1-phase1-fix for this reason; the base-path
 * change moved 0.1.1-phase1-fix -> 0.1.2-phase1-subpath.
 *
 * A08 (integrity): scripts load only from this origin (CSP script-src 'self'); the worker
 * is registered from sw.js beside the app shell, on the same origin; a worker version
 * mismatch simply installs as a waiting update — it never takes control without the
 * user's tap.
 */
const CACHE_VERSION = 'vbys-static-0.1.2-phase1-subpath';
const CACHE_PREFIX = 'vbys-static-';

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/app.js',
  'js/ui/dom.js',
  'js/ui/components.js',
  'js/ui/screens.js',
  'js/ui/camera.js',
  'js/i18n/index.js',
  'js/i18n/en.js',
  'js/i18n/es.js',
  'js/core/hashes.js',
  'js/core/encodings.js',
  'js/core/networks.js',
  'js/core/address.js',
  'js/core/txhash.js',
  'js/core/checks.js',
  'js/core/record.js',
  'js/core/state.js',
  'js/core/content-map.js',
  'js/core/proxy-client.js',
  'js/core/card.js',
  // Every manifest icon (fix-pass m12; pwa.test checks this list against the manifest).
  'icons/icon-48.png',
  'icons/icon-72.png',
  'icons/icon-96.png',
  'icons/icon-128.png',
  'icons/icon-144.png',
  'icons/icon-152.png',
  'icons/icon-192.png',
  'icons/icon-256.png',
  'icons/icon-384.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

const BASE = new URL('./', self.location.href);
const API_PREFIX = new URL('api/', BASE).pathname;
const SHELL = new URL('index.html', BASE).href;
const PRECACHE_PATHS = PRECACHE.map((p) => new URL(p, BASE).pathname);

/** Exported for tests: is this request one the worker may answer from cache? */
function cacheablePath(url, method) {
  if (method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  if (url.search) return false;           // no query-bearing URL is ever served from cache
  if (url.pathname.startsWith(API_PREFIX)) return false;
  return PRECACHE_PATHS.includes(url.pathname);
}

/** Offline navigation answer. The shell's links are relative, so it only works from BASE. */
function offlineShell(url) {
  if (url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1) !== BASE.pathname) return Response.redirect(BASE.href);
  return caches.match(SHELL, { cacheName: CACHE_VERSION });
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(PRECACHE.map((p) => new Request(new URL(p, BASE).href, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Navigations: app shell from cache when offline [Plan WP2 navigation fallback, Gate O-01].
  if (req.mode === 'navigate' && url.origin === self.location.origin && !url.pathname.startsWith(API_PREFIX)) {
    event.respondWith(fetch(req).catch(() => offlineShell(url)));
    return;
  }
  if (!cacheablePath(url, req.method)) return; // default network behavior, nothing cached
  event.respondWith(caches.match(url.pathname, { cacheName: CACHE_VERSION }).then((hit) => hit || fetch(req)));
});

if (typeof module !== 'undefined') module.exports = { PRECACHE, CACHE_VERSION, BASE, cacheablePath };
