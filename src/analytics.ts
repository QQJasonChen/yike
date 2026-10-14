// Our own code creates an image; no external JavaScript can read application storage.
// Only an approximate official-homepage count. Query/hash/referrer/user data are never sent.
const ENDPOINT = 'https://yike.goatcounter.com/count'
export function countPageview(): void {
  if (location.protocol !== 'https:' || location.hostname !== 'yikeday.com' ||
      !['/', '/index.html'].includes(location.pathname) || location.search || location.hash ||
      window.self !== window.top) return
  try {
    const pixel = new Image()
    pixel.referrerPolicy = 'no-referrer'
    pixel.src = `${ENDPOINT}?p=${encodeURIComponent(location.pathname)}&t=${encodeURIComponent('一刻手帳 Yike')}&rnd=${Math.random().toString(36).slice(2)}`
  } catch { /* Counting failure must not affect the app. */ }
}
