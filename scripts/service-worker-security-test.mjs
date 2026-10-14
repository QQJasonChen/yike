// Real candidate worker, synthetic Fetch/Cache API. No network, Auth or storage.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const code = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const origin = 'https://yikeday.com'
const home = origin + '/'
const asset = origin + '/assets/main.synthetic.js'
const response = (value, cacheControl = 'public, max-age=600', status = 200) =>
  new Response(value, { status, headers: { 'Cache-Control': cacheControl } })

function worker({ entries = {}, fetcher = async () => response('network') } = {}) {
  const maps = new Map(Object.entries(entries).map(([name, urls]) => [name, new Map(Object.entries(urls))]))
  const calls = { puts: [], deletes: [], cacheMatches: 0, cacheOpens: [], namespaceDeletes: 0,
    network: 0, claims: 0, skipWaiting: 0, storage: 0 }
  const handlers = {}
  const cacheFor = name => {
    if (!maps.has(name)) maps.set(name, new Map())
    const map = maps.get(name)
    return {
      keys: async () => [...map.keys()].map(url => ({ url })),
      put: async (request, res) => { calls.puts.push([name, request.url]); map.set(request.url, res) },
      delete: async request => { calls.deletes.push([name, request.url]); return map.delete(request.url) },
    }
  }
  const forbiddenStorage = new Proxy({}, { get() { calls.storage++; throw Error('Storage forbidden') } })
  vm.runInNewContext(code, {
    URL, self: { location: { origin }, addEventListener(name, handler) { handlers[name] = handler },
      skipWaiting() { calls.skipWaiting++ }, clients: { async claim() { calls.claims++ } } },
    caches: {
      async keys() { return [...maps.keys()] },
      async open(name) { calls.cacheOpens.push(name); return cacheFor(name) },
      async match(request, options = {}) {
        calls.cacheMatches++
        for (const [name, map] of maps) {
          if (options.cacheName && options.cacheName !== name) continue
          if (map.has(request.url)) return map.get(request.url)
        }
        return undefined
      },
      async delete() { calls.namespaceDeletes++; throw Error('Must not delete a cache namespace') },
    },
    localStorage: forbiddenStorage, sessionStorage: forbiddenStorage,
    fetch: async request => { calls.network++; return fetcher(request) },
  }, { filename: 'public/sw.js', timeout: 2000 })
  return {
    calls, maps,
    async fetch(url, mode = 'navigate', method = 'GET') {
      let intercepted = false; let promise
      handlers.fetch({ request: { url, mode, method }, respondWith(p) { intercepted = true; promise = p } })
      const res = promise ? await promise : undefined
      await Promise.resolve() // Drain the worker's existing asynchronous cache.put microtask.
      return { intercepted, res }
    },
    async activate() { let pending; handlers.activate({ waitUntil(p) { pending = p } }); await pending },
    install() { handlers.install() },
  }
}

for (const suffix of ['/recover', '/recover.html', '/recover?type=recovery',
  '/recover.html?token_hash=SYNTHETIC_ONLY&type=recovery',
  '/recover?code=SYNTHETIC_ONLY', '/recover.html?type=recovery&token_hash=SYNTHETIC_ONLY']) {
  test(`recovery pathname bypasses all interception/cache for ${suffix.split('?')[0]} ${suffix.includes('?') ? 'query' : 'clean'}`, async () => {
    const url = origin + suffix
    const w = worker({ entries: { 'pp-cache-v2': { [url]: response('stale recovery') } } })
    const result = await w.fetch(url)
    assert.equal(result.intercepted, false)
    assert.equal(w.calls.cacheMatches, 0); assert.equal(w.calls.cacheOpens.length, 0)
    assert.equal(w.calls.puts.length, 0); assert.equal(w.calls.network, 0); assert.equal(w.calls.storage, 0)
  })
}

test('normal home remains network-first and stores successful fresh content in unchanged v2 namespace', async () => {
  const w = worker({ entries: { 'pp-cache-v2': { [home]: response('old') } },
    fetcher: async () => response('fresh') })
  const result = await w.fetch(home)
  assert.equal(result.intercepted, true); assert.equal(await result.res.text(), 'fresh')
  assert.equal(w.calls.network, 1); assert.equal(w.calls.cacheMatches, 0)
  assert.deepEqual(w.calls.puts, [['pp-cache-v2', home]])
})
test('normal home offline fallback keeps existing content', async () => {
  const w = worker({ entries: { 'pp-cache-v2': { [home]: response('old offline home') } },
    fetcher: async () => { throw Error('synthetic offline') } })
  const result = await w.fetch(home)
  assert.equal(await result.res.text(), 'old offline home')
  assert.equal(w.calls.cacheMatches, 1); assert.equal(w.calls.puts.length, 0)
})
for (const status of [404, 500]) {
  test(`navigation HTTP${status} cannot replace the existing offline home`, async () => {
    let offline = false
    const w = worker({ entries: { 'pp-cache-v2': { [home]: response('good offline home') } },
      fetcher: async () => { if (offline) throw Error('synthetic offline'); return response('error page', 'public', status) } })
    const online = await w.fetch(home)
    assert.equal(online.res.status, status); assert.equal(w.calls.puts.length, 0)
    offline = true
    assert.equal(await (await w.fetch(home)).res.text(), 'good offline home')
  })
}
for (const finalPath of ['/recover', '/recover.html?type=recovery']) {
  test(`final recovery redirect ${finalPath.split('?')[0]} is rendered but never stored under original home`, async () => {
    const res = new Response('synthetic recovery page', { status: 200 }) // Deliberately no no-store.
    Object.defineProperty(res, 'url', { value: origin + finalPath })
    const w = worker({ fetcher: async () => res })
    const result = await w.fetch(home)
    assert.equal(await result.res.text(), 'synthetic recovery page')
    assert.equal(w.calls.puts.length, 0)
  })
}
test('normal successful redirect still stores its content under the requested URL', async () => {
  const res = response('normal redirected home')
  Object.defineProperty(res, 'url', { value: origin + '/index.html' })
  const w = worker({ fetcher: async () => res })
  assert.equal(await (await w.fetch(home)).res.text(), 'normal redirected home')
  assert.deepEqual(w.calls.puts, [['pp-cache-v2', home]])
})
test('malformed final response URL rejects storage without blocking rendering', async () => {
  const res = response('normal visible response')
  Object.defineProperty(res, 'url', { value: 'synthetic invalid absolute URL' })
  const w = worker({ fetcher: async () => res })
  assert.equal(await (await w.fetch(home)).res.text(), 'normal visible response')
  assert.equal(w.calls.puts.length, 0)
})
test('normal asset remains cache-first with no network on an existing cached asset', async () => {
  const w = worker({ entries: { 'pp-cache-v2': { [asset]: response('cached asset') } } })
  const result = await w.fetch(asset, 'cors')
  assert.equal(await result.res.text(), 'cached asset'); assert.equal(w.calls.network, 0)
  assert.equal(w.calls.puts.length, 0)
})
test('uncached normal asset still fetches and stores in v2', async () => {
  const w = worker(); const result = await w.fetch(asset, 'cors')
  assert.equal(await result.res.text(), 'network')
  assert.deepEqual(w.calls.puts, [['pp-cache-v2', asset]])
})
test('non-success asset remains unstored', async () => {
  const w = worker({ fetcher: async () => response('missing', 'public', 404) })
  const result = await w.fetch(asset, 'cors')
  assert.equal(result.res.status, 404); assert.equal(w.calls.puts.length, 0)
})

for (const mode of ['navigate', 'cors']) {
  for (const directive of ['no-store', 'public, No-StOrE', 'no-store, max-age=0']) {
    test(`new ${mode} response respects ${directive}`, async () => {
      const w = worker({ fetcher: async () => response('not persisted', directive) })
      const result = await w.fetch(mode === 'navigate' ? home : asset, mode)
      assert.equal(await result.res.text(), 'not persisted'); assert.equal(w.calls.puts.length, 0)
    })
  }
}
test('unrelated cache directives keep previous normal caching behavior', async () => {
  for (const directive of ['public, max-age=600', 'private', 'x-no-store=1', '']) {
    const w = worker({ fetcher: async () => response('normal', directive) })
    await w.fetch(home); assert.equal(w.calls.puts.length, 1)
  }
})
test('activation removes only same-origin recovery URLs from known Yike caches', async () => {
  const rec = origin + '/recover.html?token_hash=SYNTHETIC_ONLY&type=recovery'
  const clean = origin + '/recover'
  const foreign = 'https://other.invalid/recover.html'
  const entries = {
    'pp-cache-v2': { [home]: response('home'), [asset]: response('asset'), [rec]: response('old recovery'), [foreign]: response('foreign') },
    'pp-cache-v1': { [home]: response('legacy home'), [clean]: response('old recovery') },
    'unrelated-cache': { [home]: response('foreign namespace home'), [rec]: response('foreign namespace recovery') },
  }
  const w = worker({ entries }); await w.activate()
  assert.equal(w.maps.get('pp-cache-v2').has(rec), false)
  assert.equal(w.maps.get('pp-cache-v1').has(clean), false)
  assert.equal(w.maps.get('pp-cache-v2').has(home), true); assert.equal(w.maps.get('pp-cache-v2').has(asset), true)
  assert.equal(w.maps.get('pp-cache-v1').has(home), true)
  assert.equal(w.maps.get('pp-cache-v2').has(foreign), true)
  assert.equal(w.maps.get('unrelated-cache').has(rec), true)
  assert.equal(w.calls.namespaceDeletes, 0); assert.equal(w.calls.claims, 1); assert.equal(w.calls.storage, 0)
})
test('activation plus update retains normal home and assets for offline use', async () => {
  const w = worker({ entries: { 'pp-cache-v2': { [home]: response('home survives'), [asset]: response('asset survives') } },
    fetcher: async () => { throw Error('synthetic offline') } })
  w.install(); await w.activate()
  assert.equal(w.calls.skipWaiting, 1); assert.equal(w.calls.claims, 1)
  assert.equal(await (await w.fetch(home)).res.text(), 'home survives')
  assert.equal(await (await w.fetch(asset, 'cors')).res.text(), 'asset survives')
  assert.equal(w.calls.deletes.length, 0); assert.equal(w.calls.namespaceDeletes, 0)
})
test('preserved legacy and foreign caches cannot shadow active v2 offline home', async () => {
  const w = worker({ entries: {
    'unrelated-cache': { [home]: response('foreign home') },
    'pp-cache-v1': { [home]: response('legacy home') },
    'pp-cache-v2': { [home]: response('current home') },
  }, fetcher: async () => { throw Error('synthetic offline') } })
  await w.activate()
  assert.equal(await (await w.fetch(home)).res.text(), 'current home')
  assert.equal(w.maps.get('pp-cache-v1').has(home), true)
  assert.equal(w.maps.get('unrelated-cache').has(home), true)
  assert.equal(w.calls.namespaceDeletes, 0)
})
test('preserved legacy and foreign caches cannot shadow an active v2 stable asset URL', async () => {
  const stableAsset = origin + '/favicon.svg'
  const w = worker({ entries: {
    'unrelated-cache': { [stableAsset]: response('foreign icon') },
    'pp-cache-v1': { [stableAsset]: response('legacy icon') },
    'pp-cache-v2': { [stableAsset]: response('current icon') },
  } })
  await w.activate()
  assert.equal(await (await w.fetch(stableAsset, 'cors')).res.text(), 'current icon')
  assert.equal(w.calls.network, 0)
  assert.equal(w.maps.get('pp-cache-v1').has(stableAsset), true)
  assert.equal(w.maps.get('unrelated-cache').has(stableAsset), true)
  assert.equal(w.calls.namespaceDeletes, 0)
})
test('non-GET and unknown third-party requests remain unintercepted', async () => {
  const w = worker()
  assert.equal((await w.fetch(home, 'navigate', 'POST')).intercepted, false)
  assert.equal((await w.fetch('https://other.invalid/asset.js', 'cors')).intercepted, false)
  assert.equal(w.calls.network, 0); assert.equal(w.calls.cacheMatches, 0)
})
test('existing allowed font host caching is unchanged', async () => {
  const font = 'https://fonts.gstatic.com/synthetic.woff2'
  const w = worker(); const result = await w.fetch(font, 'cors')
  assert.equal(result.intercepted, true); assert.equal(w.calls.network, 1)
  assert.deepEqual(w.calls.puts, [['pp-cache-v2', font]])
})
