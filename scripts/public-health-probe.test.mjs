import assert from 'node:assert/strict'
import test from 'node:test'
import { readPublicAnonConfig, runPublicHealthProbe } from './public-health-probe.mjs'

const key = (role = 'anon', ref = 'ofhupqifavtafiylehkj') => [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ role, ref })).toString('base64url'), 'synthetic-signature'].join('.')
// Match the public config's JWT prefix without using any real credential.
const anon = key().replace(/^e30/, 'eyJhbGciOiJIUzI1NiJ9')
const healthyHeaders = { 'content-range': '*/0', 'range-unit': 'items', 'preference-applied': 'count=exact' }
const fixture = (overrides = {}) => {
  const calls = []; let reads = 0, cancelled = 0
  return {
    calls, reads: () => reads, cancelled: () => cancelled,
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      const name = url.includes('/journal?') ? 'journal' : url.endsWith('/health') ? 'auth' : url.endsWith('/activate') ? 'activate' : 'gumroad'
      const override = overrides[name] ?? {}
      return {
        status: override.status ?? (name === 'gumroad' ? 405 : name === 'activate' ? 204 : 200),
        headers: new Headers(override.headers ?? (name === 'journal' ? healthyHeaders : {})),
        body: { cancel: async () => { cancelled++ }, getReader() { reads++; throw new Error('row read forbidden') } },
        text() { reads++; throw new Error('row read forbidden') }, json() { reads++; throw new Error('row read forbidden') },
        arrayBuffer() { reads++; throw new Error('row read forbidden') },
      }
    },
  }
}
test('all four public checks succeed using metadata only, fixed host, HEAD count and no IAP dependency', async () => {
  const f = fixture(); const result = await runPublicHealthProbe({ anonKey: anon, fetchImpl: f.fetchImpl })
  assert.equal(result.ok, true); assert.equal(result.passed, 4); assert.equal(f.calls.length, 4)
  assert.equal(f.reads(), 0); assert.equal(f.cancelled(), 4)
  const journal = f.calls[0].init
  assert.equal(journal.method, 'HEAD'); assert.equal(journal.headers.Prefer, 'count=exact'); assert.equal(journal.headers.Range, '0-0')
  for (const { url, init } of f.calls) {
    assert.equal(new URL(url).hostname, 'ofhupqifavtafiylehkj.supabase.co')
    assert.equal(url.includes('iap'), false); assert.equal(init.redirect, 'error'); assert.equal(init.signal instanceof AbortSignal, true)
    assert.equal(init.headers.Authorization, `Bearer ${anon}`)
  }
  assert.equal(JSON.stringify(result).includes(anon), false); assert.equal(JSON.stringify(result).includes('https:'), false)
})
for (const headers of [{}, { 'content-range': '*/0' }, { ...healthyHeaders, 'range-unit': '' }, { ...healthyHeaders, 'range-unit': 'bytes' }, { ...healthyHeaders, 'preference-applied': '' }, { ...healthyHeaders, 'content-range': '*/*' }, { ...healthyHeaders, 'content-range': '0-0/0' }]) {
  test(`incomplete/inconsistent journal count metadata fails closed: ${JSON.stringify(headers)}`, async () => {
    const f = fixture({ journal: { headers } }); const result = await runPublicHealthProbe({ anonKey: anon, fetchImpl: f.fetchImpl })
    assert.equal(result.ok, false); assert.equal(result.checks[0].reason, 'headers'); assert.equal(f.reads(), 0)
  })
}
for (const range of ['*/1', '0-0/2', '0-0/999999999999999999999999999']) {
  test(`nonzero anonymous visible count fails closed: ${range}`, async () => {
    const f = fixture({ journal: { headers: { ...healthyHeaders, 'content-range': range } } })
    const result = await runPublicHealthProbe({ anonKey: anon, fetchImpl: f.fetchImpl })
    assert.equal(result.ok, false); assert.equal(result.checks[0].reason, 'nonzero-count'); assert.equal(f.reads(), 0)
  })
}
for (const name of ['journal', 'auth', 'activate', 'gumroad']) {
  test(`${name} wrong HTTP status fails without reading a body`, async () => {
    const f = fixture({ [name]: { status: 404 } }); const result = await runPublicHealthProbe({ anonKey: anon, fetchImpl: f.fetchImpl })
    assert.equal(result.ok, false); assert.equal(result.checks.filter(check => check.reason === 'status').length, 1); assert.equal(f.reads(), 0)
  })
}
test('redirect response is rejected even when a synthetic fetch returns it', async () => {
  const f = fixture({ auth: { status: 302 } }); const result = await runPublicHealthProbe({ anonKey: anon, fetchImpl: f.fetchImpl })
  assert.equal(result.ok, false); assert.equal(result.checks[1].reason, 'status'); assert.equal(f.reads(), 0)
})
test('network errors expose no URL, key or upstream error', async () => {
  const result = await runPublicHealthProbe({ anonKey: anon, fetchImpl: async () => { throw new Error(`https://private.invalid/${anon}`) } })
  assert.equal(result.ok, false); assert.equal(result.passed, 0)
  assert.equal(result.checks.every(check => check.reason === 'network'), true)
  assert.equal(JSON.stringify(result).includes(anon), false); assert.equal(JSON.stringify(result).includes('private.invalid'), false)
})
test('each stalled fetch has a deadline even when the mock ignores AbortSignal', async () => {
  const result = await runPublicHealthProbe({ anonKey: anon, timeoutMs: 2, fetchImpl: () => new Promise(() => {}) })
  assert.equal(result.ok, false); assert.equal(result.checks.every(check => check.reason === 'timeout'), true)
})
for (const bad of [key('service_role'), key('authenticated'), key('anon', 'other'), '', 'malformed']) {
  test('non-anon or wrong-project configuration cannot start any request', async () => {
    let calls = 0
    const result = await runPublicHealthProbe({ anonKey: bad, fetchImpl: async () => { calls++; throw new Error('must not fetch') } })
    assert.equal(result.ok, false); assert.equal(calls, 0); assert.equal(result.checks[0].reason, 'config')
  })
}
test('public config parser pins URL and anon role without exposing invalid configuration', () => {
  const source = `export const SUPABASE_URL = 'https://ofhupqifavtafiylehkj.supabase.co'; export const SUPABASE_ANON_KEY = '${anon}'`
  assert.equal(readPublicAnonConfig(source), anon)
  for (const bad of [source.replace('ofhupqifavtafiylehkj.supabase.co', 'other.supabase.co'), source.replace(anon, key('service_role').replace(/^e30/, 'eyJhbGciOiJIUzI1NiJ9')), source + ` '${anon}'`]) {
    assert.throws(() => readPublicAnonConfig(bad), error => error.message === 'public configuration invalid')
  }
})

test('observed Yike gateway exact-zero HEAD metadata succeeds when optional Range-Unit is absent', async () => {
  // Local gateway observation, not a claim that documentation guarantees absence.
  const f = fixture({ journal: { headers: { 'content-range': '*/0', 'preference-applied': 'count=exact' } } })
  const result = await runPublicHealthProbe({ anonKey: anon, fetchImpl: f.fetchImpl })
  assert.equal(result.ok, true); assert.equal(result.passed, 4)
  assert.equal(f.reads(), 0); assert.equal(f.cancelled(), 4)
})
