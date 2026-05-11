/**
 * Service Worker for Phim.tv
 * Caches static assets for instant loading
 */

const CACHE_NAME = 'phimtv-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/platform.js',
  '/performance.js',
  '/cache.js',
  '/mobile.css',
  '/truyenhinh/truyenhinh.html',
  '/truyenhinh/css/base.css',
  '/truyenhinh/css/header.css',
  '/truyenhinh/css/hero.css',
  '/truyenhinh/css/channels.css',
  '/truyenhinh/css/player.css',
  '/truyenhinh/css/modals.css',
  '/truyenhinh/css/responsive.css',
  '/truyenhinh/js/config.js',
  '/truyenhinh/js/cache.js',
  '/truyenhinh/js/utils.js',
  '/truyenhinh/js/channels.js',
  '/truyenhinh/js/player.js',
  '/truyenhinh/js/navigation.js',
  '/truyenhinh/js/main.js',
  '/phim/phim.html',
  '/phim/css/base.css',
  '/phim/css/header.css',
  '/phim/css/hero.css',
  '/phim/css/layout.css',
  '/phim/css/detail.css',
  '/phim/css/player.css',
  '/phim/css/modals.css',
  '/phim/css/responsive.css',
  '/phim/js/api.js',
  '/phim/js/utils.js',
  '/phim/js/cards.js',
  '/phim/js/detail.js',
  '/phim/js/player.js',
  '/phim/js/home.js',
  '/phim/js/main.js',
  '/phim/hls.min.js'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for static, network-first for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  // Skip external API requests (let them go to network)
  if (url.hostname !== location.hostname && 
      !url.hostname.includes('fonts.googleapis.com') &&
      !url.hostname.includes('fonts.gstatic.com')) {
    return;
  }
  
  // Cache-first for static assets
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.match(event.request)
        .then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, clone);
              });
            }
            return response;
          });
        })
    );
    return;
  }
  
  // Network-first for dynamic content (fonts, API)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && url.hostname.includes('fonts')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

function isStaticAsset(pathname) {
  return STATIC_ASSETS.some(asset => pathname === asset || pathname === asset.replace(/^\//, ''));
}