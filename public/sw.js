// Offline-capable service worker.
// - Navigations (index.html): network-first so updates arrive promptly.
// - Static assets & fonts: cache-first (Vite assets are content-hashed).
const CACHE = 'pp-cache-v2'
const isRecovery = (url) =>
  url.origin === self.location.origin &&
  (url.pathname === '/recover' || url.pathname === '/recover.html')
const mayStore = (res) =>
  !(res.headers.get('Cache-Control') || '')
    .split(',')
    .some((directive) => directive.split('=')[0].trim().toLowerCase() === 'no-store')

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => /^pp-cache-v\d+$/.test(key)).map(async (key) => {
            const cache = await caches.open(key)
            const requests = await cache.keys()
            await Promise.all(requests.filter((request) => isRecovery(new URL(request.url))).map((request) => cache.delete(request)))
          }),
        ),
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // A worker from the main page can control this route even though recovery
  // never registers one. Do not read/write Cache API entries or intercept it.
  // URL.pathname excludes every query variant, including old credential links.
  if (isRecovery(url)) return
  const cacheable =
    url.origin === self.location.origin ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  if (!cacheable) return

  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (mayStore(res)) {
            const clone = res.clone()
            caches.open(CACHE).then((c) => c.put(request, clone))
          }
          return res
        })
        .catch(() => caches.match(request, { cacheName: CACHE }))
    )
    return
  }

  e.respondWith(
    caches.match(request, { cacheName: CACHE }).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok && mayStore(res)) {
            const clone = res.clone()
            caches.open(CACHE).then((c) => c.put(request, clone))
          }
          return res
        })
    )
  )
})
