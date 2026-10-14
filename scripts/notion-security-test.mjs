// Actual Notion handler with fake env/fetch/timers. No network, credentials, or journals.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createContext, Script } from 'node:vm'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const base = new URL('../supabase/functions/notion-push/', import.meta.url)
const PAGE = '00000000000040008000000000000000'
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status })
const body = { token: 'mock-notion-token', parentPageId: PAGE, title: 'Synthetic', markdown: 'Synthetic paragraph' }
function server({ timeout, fetcher, env = {} } = {}) {
  let handler
  const calls = []
  const context = createContext({
    Request, Response, URL, TextEncoder, TextDecoder, AbortController, AbortSignal,
    setTimeout: (fn, ms) => setTimeout(fn, timeout?.(ms) ?? ms), clearTimeout,
    console: { error() {} },
    Deno: {
      serve: fn => { handler = fn },
      env: { get: key => ({ SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'mock-service-only', ...env })[key] },
    },
    fetch: async (url, init = {}) => {
      calls.push({ url, init })
      assert.ok(init.signal instanceof AbortSignal, 'All outbound work must be abortable')
      assert.equal(init.redirect, 'error')
      if (fetcher) return fetcher(url, init, calls)
      if (url.endsWith('/rpc/rate_limit_bump')) return reply(true)
      assert.ok(url.startsWith('https://api.notion.com/v1/'))
      if (url.endsWith('/pages')) return reply({ id: PAGE, url: 'javascript:void(0)' })
      if (url.includes('/pages/')) return reply({ id: PAGE })
      return reply({ results: Array(JSON.parse(init.body).children.length).fill({ id: PAGE }) })
    },
  })
  const exports = {}
  const blockCode = ts.transpileModule(readFileSync(new URL('blocks.ts', base), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  new Script(`(function(exports){${blockCode}\n})`).runInContext(context)(exports)
  const code = ts.transpileModule(readFileSync(new URL('index.ts', base), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const shared = {}
  const sharedCode = ts.transpileModule(readFileSync(new URL('../_shared/boundedBody.ts', base), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  new Script(`(function(exports){${sharedCode}\n})`).runInContext(context)(shared)
  new Script(`(function(exports,require){${code}\n})`).runInContext(context)({}, path => {
    if (path === './blocks.ts') return exports
    assert.equal(path, '../_shared/boundedBody.ts')
    return shared
  })
  assert.equal(typeof handler, 'function')
  return { handler, calls, convert: exports.mdToNotionBlocks, rich: exports.toRichText,
    notion: () => calls.filter(call => call.url.startsWith('https://api.notion.com/')) }
}
const request = (payload = body, headers = {}) => new Request('https://mock-edge.invalid/notion-push', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload),
})
const checks = []
const check = async (name, fn) => { await fn(); checks.push(name) }
const blocked = async (s, req, status) => {
  const response = await s.handler(req)
  assert.equal(response.status, status)
  assert.equal(s.notion().length, 0)
  return response
}
const untilAbort = signal => new Promise((_, reject) => {
  if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
  signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
})

await check('preserves anonymous BYOT export and canonical HTTPS page link', async () => {
  const s = server()
  const res = await s.handler(request())
  assert.equal(res.status, 200)
  assert.equal((await res.json()).url, `https://www.notion.so/${PAGE}`)
  assert.equal(s.notion().length, 1)
  assert.equal(s.notion()[0].init.headers.Authorization, 'Bearer mock-notion-token')
})
await check('dry run reads only a canonical page endpoint and never writes', async () => {
  const s = server()
  const res = await s.handler(request({ ...body, parentPageId: '00000000-0000-4000-8000-000000000000', dryRun: true }))
  assert.equal(res.status, 200)
  assert.equal(s.notion().length, 1)
  assert.equal(s.notion()[0].url, `https://api.notion.com/v1/pages/${PAGE}`)
  assert.equal(s.notion()[0].init.method, undefined)
})
for (const parentPageId of ['../users', 'page?query=true', 'http://evil.invalid/page']) {
  await check(`rejects invalid target path ${parentPageId}`, async () => {
    await blocked(server(), request({ ...body, parentPageId, dryRun: true }), 400)
  })
}
for (const payload of [null, [], { ...body, token: {} }, { ...body, markdown: [] }, { ...body, dryRun: 'true' }]) {
  await check('rejects non-object or coerced credential/content fields', async () => {
    await blocked(server(), request(payload), 400)
  })
}
await check('rejects advertised oversized bodies without trusting their contents', async () => {
  const response = await blocked(server(), request(body, { 'content-length': '262145' }), 413)
  assert.match((await response.json()).error, /縮短日期/)
})
await check('actual UTF8 bytes exceed limit despite a small Content-Length', async () => {
  await blocked(server(), request({ ...body, markdown: '繁'.repeat(90_000) }, { 'content-length': '1' }), 413)
})
await check('streaming body is cancelled as soon as actual byte limit is crossed', async () => {
  let cancelled = false
  let chunks = 0
  const stream = new ReadableStream({
    pull(controller) { chunks++; controller.enqueue(new Uint8Array(70_000).fill(32)) },
    cancel() { cancelled = true },
  })
  const req = new Request('https://mock-edge.invalid/notion-push', { method: 'POST', body: stream, duplex: 'half' })
  await blocked(server(), req, 413)
  assert.equal(cancelled, true)
  assert.ok(chunks <= 6, 'Reader must not drain an infinite body')
})
await check('stalled inbound stream times out and cancellation cannot hold the response', async () => {
  let cancelled = false
  const stream = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}) } })
  const req = new Request('https://mock-edge.invalid/notion-push', { method: 'POST', body: stream, duplex: 'half' })
  const s = server({ timeout: ms => ms === 5000 ? 5 : ms })
  await blocked(s, req, 408)
  assert.equal(cancelled, true)
})
await check('unbounded empty stream fragments are capped independently of bytes and timers', async () => {
  let cancelled = false
  let chunks = 0
  const stream = new ReadableStream({
    pull(controller) { chunks++; controller.enqueue(new Uint8Array()) },
    cancel() { cancelled = true },
  })
  const req = new Request('https://mock-edge.invalid/notion-push', { method: 'POST', body: stream, duplex: 'half' })
  await blocked(server(), req, 413)
  assert.equal(cancelled, true)
  assert.ok(chunks <= 4099)
})
await check('block cap is checked before creating a partial page', async () => {
  await blocked(server(), request({ ...body, markdown: Array(1001).fill('Line').join('\n') }), 413)
})
await check('maximum allowed blocks produce exactly ten bounded write chunks', async () => {
  const s = server()
  const res = await s.handler(request({ ...body, markdown: Array(1000).fill('Line').join('\n') }))
  assert.equal(res.status, 200)
  assert.equal(s.notion().length, 10)
  for (const call of s.notion()) assert.equal(JSON.parse(call.init.body).children.length, 100)
})
await check('single huge rich-text array is rejected before Notion write', async () => {
  await blocked(server(), request({ ...body, markdown: 'x'.repeat(200001) }), 413)
})
await check('overlong title is rejected before Notion write', async () => {
  await blocked(server(), request({ ...body, title: 'x'.repeat(2001) }), 413)
})
await check('rate limiter rejects without contacting Notion', async () => {
  await blocked(server({ fetcher: async () => reply(false) }), request(), 429)
})
for (const value of [null, 'true']) {
  await check('malformed limiter output fails closed as unavailable', async () => {
    await blocked(server({ fetcher: async () => reply(value) }), request(), 503)
  })
}
await check('missing server limiter credential fails closed', async () => {
  const s = server({ env: { SUPABASE_SERVICE_ROLE_KEY: '' } })
  await blocked(s, request(), 503)
  assert.equal(s.calls.length, 0)
})
await check('stalled limiter times out and never starts Notion work', async () => {
  const s = server({ timeout: ms => ms === 8000 ? 5 : ms, fetcher: async (_url, init) => untilAbort(init.signal) })
  await blocked(s, request(), 503)
})
await check('stalled provider headers time out without starting append work', async () => {
  const s = server({ timeout: ms => ms === 8000 ? 5 : ms, fetcher: async (url, init) => {
    if (url.endsWith('/rpc/rate_limit_bump')) return reply(true)
    return untilAbort(init.signal)
  } })
  const res = await s.handler(request())
  assert.equal(res.status, 504)
  assert.match((await res.json()).error, /避免重複頁面/)
  assert.equal(s.notion().length, 1)
})
await check('provider body read remains under timeout after headers arrive', async () => {
  const s = server({ timeout: ms => ms === 8000 ? 5 : ms, fetcher: async (url, init) => {
    if (url.endsWith('/rpc/rate_limit_bump')) return reply(true)
    return new Response(new ReadableStream({ pull: () => new Promise(() => {}) }))
  } })
  assert.equal((await s.handler(request())).status, 504)
  assert.equal(s.notion().length, 1)
})
await check('overall deadline stops the batch chain and returns partial-page warning', async () => {
  const s = server({ timeout: ms => ms === 30000 ? 8 : ms, fetcher: async (url, init) => {
    if (url.endsWith('/rpc/rate_limit_bump')) return reply(true)
    if (url.endsWith('/pages')) return reply({ id: PAGE })
    return untilAbort(init.signal)
  } })
  const res = await s.handler(request({ ...body, markdown: Array(201).fill('Line').join('\n') }))
  assert.equal(res.status, 504)
  const data = await res.json()
  assert.match(data.error, /只寫入一部分/)
  assert.equal(data.url, `https://www.notion.so/${PAGE}`)
  assert.equal(s.notion().length, 2, 'No second append after budget expiry')
})
await check('provider failure is not retried and reports committed partial page', async () => {
  const s = server({ fetcher: async (url) => {
    if (url.endsWith('/rpc/rate_limit_bump')) return reply(true)
    if (url.endsWith('/pages')) return reply({ id: PAGE })
    return reply({ message: 'rate limited' }, 429)
  } })
  const res = await s.handler(request({ ...body, markdown: Array(101).fill('Line').join('\n') }))
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /只寫入一部分/)
  assert.equal(s.notion().length, 2)
})
await check('malformed page ID cannot change the append endpoint or create unsafe URLs', async () => {
  const s = server({ fetcher: async url => url.endsWith('/rpc/rate_limit_bump') ? reply(true) : reply({ id: '../users', url: 'javascript:void(0)' }) })
  assert.equal((await s.handler(request())).status, 502)
  assert.equal(s.notion().length, 1)
})
await check('ambiguous create HTTP 503 warns about a possibly committed page without retrying', async () => {
  const s = server({ fetcher: async url => url.endsWith('/rpc/rate_limit_bump') ? reply(true) : reply({ message: 'unavailable' }, 503) })
  const res = await s.handler(request())
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /可能已建立頁面.*避免重複頁面/)
  assert.equal(s.notion().length, 1)
})
await check('oversized forwarded input cannot inflate a limiter key', async () => {
  const s = server()
  assert.equal((await s.handler(request(body, { 'x-forwarded-for': 'x'.repeat(201) }))).status, 200)
  const k = JSON.parse(s.calls[0].init.body).k
  assert.equal(k, 'notion:ip:oversized-ip-header')
  assert.ok(Buffer.byteLength(k) <= 200)
})
await check('bounded conversion fails while constructing blocks and rich text', async () => {
  const s = server()
  assert.throws(() => s.convert(Array(1001).fill('Line').join('\n'), { maxBlocks: 1000 }), /notion-conversion-limit/)
  assert.throws(() => s.rich('x'.repeat(200001), 100), /notion-conversion-limit/)
  assert.equal(s.convert('one\ntwo', { maxBlocks: 2 }).length, 2)
  assert.equal(s.rich('x'.repeat(200000), 100).length, 100)
})
await check('oversized actual provider body fails with ambiguous-create warning and no append', async () => {
  const s = server({ fetcher: async url => url.endsWith('/rpc/rate_limit_bump') ? reply(true) :
    new Response(JSON.stringify({ id: PAGE, padding: 'x'.repeat(524288) }), { headers: { 'content-length': '1' } }) })
  const res = await s.handler(request({ ...body, markdown: Array(101).fill('Line').join('\n') }))
  assert.equal(res.status, 502)
  assert.match((await res.json()).error, /未能確認是否寫入.*避免重複頁面/)
  assert.equal(s.notion().length, 1)
})
await check('provider response empty-fragment amplification is bounded', async () => {
  let fragments = 0
  const s = server({ fetcher: async url => url.endsWith('/rpc/rate_limit_bump') ? reply(true) :
    new Response(new ReadableStream({ pull(c) { fragments++; c.enqueue(new Uint8Array()) } })) })
  assert.equal((await s.handler(request())).status, 502)
  assert.ok(fragments <= 4099)
  assert.equal(s.notion().length, 1)
})
await check('HTTP200 invalid or mismatched dry-run page is not a successful connection', async () => {
  for (const response of [{}, { id: '11111111111141118111111111111111' }]) {
    const s = server({ fetcher: async url => url.endsWith('/rpc/rate_limit_bump') ? reply(true) : reply(response) })
    assert.equal((await s.handler(request({ ...body, dryRun: true }))).status, 502)
    assert.equal(s.notion().length, 1)
    assert.equal(s.notion()[0].init.method, undefined)
  }
})
await check('HTTP200 incomplete append receipt cannot report full export success', async () => {
  for (const result of [{}, { results: [] }, 'not-json']) {
    const s = server({ fetcher: async url => url.endsWith('/rpc/rate_limit_bump') ? reply(true) :
      url.endsWith('/pages') ? reply({ id: PAGE }) : typeof result === 'string' ? new Response(result) : reply(result) })
    const res = await s.handler(request({ ...body, markdown: Array(101).fill('Line').join('\n') }))
    assert.equal(res.status, 502)
    const data = await res.json()
    assert.match(data.error, /只寫入一部分/)
    assert.equal(data.url, `https://www.notion.so/${PAGE}`)
    assert.equal(s.notion().length, 2)
  }
})
console.log(JSON.stringify({ status: 'PASS', network: 'no remote calls', count: checks.length, checks }, null, 2))
