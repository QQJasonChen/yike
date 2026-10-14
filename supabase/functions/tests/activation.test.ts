// Exercise the real request handlers with in-memory env/fetch stubs.
// No server is started, and no network requests or real accounts are created.
type Handler = (request: Request) => Promise<Response>
const handlers: Handler[] = []
const originalServe = Deno.serve
Deno.serve = ((handler: Handler) => {
  handlers.push(handler)
  return {} as Deno.HttpServer
}) as typeof Deno.serve
try {
  await import('../activate/index.ts')
} finally {
  Deno.serve = originalServe
}
const [activate] = handlers

const PRIVATE_ERROR_MARKER = 'SYNTHETIC_PRIVATE_SQL_BODY'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})
const assert = (condition: unknown, message = 'assertion failed'): void => {
  if (!condition) throw new Error(message)
}
const equal = (actual: unknown, expected: unknown) => {
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
const baseEnv: Record<string, string> = {
  SUPABASE_URL: 'https://database.example',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  GUMROAD_PRODUCT_ID: 'YIKE-PRODUCT',
}
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
const test = (
  name: string,
  env: Record<string, string>,
  fetcher: Fetcher,
  fn: () => Promise<void>,
) => Deno.test(name, async () => {
  const originalGet = Deno.env.get
  const originalFetch = globalThis.fetch
  Deno.env.get = (key: string) => env[key]
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    fetcher(String(url), init)) as typeof fetch
  try {
    await fn()
  } finally {
    Deno.env.get = originalGet
    globalThis.fetch = originalFetch
  }
})
const activationRequest = (licenseKey = 'TEST-LICENSE') => new Request('https://app.example/activate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ licenseKey, email: 'buyer@example.com', password: 'test-password' }),
})
test('activation operational failures never log buyer identifiers or echoed upstream secrets', baseEnv,
  async (url, init) => {
    if (url.endsWith('/rpc/rate_limit_bump')) return json(true)
    if (url === 'https://api.gumroad.com/v2/licenses/verify') {
      const form = new URLSearchParams(init?.body as URLSearchParams)
      return form.get('increment_uses_count') === 'false'
        ? json({ success: true, uses: 0, purchase: { email: 'buyer@example.com' } })
        : json({ detail: PRIVATE_ERROR_MARKER }, 500)
    }
    if (url.endsWith('/auth/v1/admin/users')) return json({ id: 'test-user' })
    if (url.endsWith('/rpc/license_redeem') || url.endsWith('/rpc/license_force_record') ||
      url.endsWith('/auth/v1/admin/users/test-user') || url.endsWith('/rest/v1/entitlements'))
      return json({ detail: PRIVATE_ERROR_MARKER }, 500)
    throw new Error('unexpected request')
  }, async () => {
    const originalError = console.error
    const logs: unknown[][] = []
    console.error = (...args) => { logs.push(args) }
    try {
      equal((await activate(activationRequest())).status, 200)
      assert(logs.length >= 4, 'failure signals must remain visible')
      const text = JSON.stringify(logs)
      for (const value of [PRIVATE_ERROR_MARKER, 'buyer@example.com', 'TEST-LIC', 'test-user'])
        assert(!text.includes(value), 'logs must not expose private operational values')
    } finally { console.error = originalError }
  })
const gumroadFetcher = (verification: Fetcher): Fetcher => (url, init) => {
  if (url.endsWith('/rpc/rate_limit_bump')) return Promise.resolve(json(true))
  assert(url === 'https://api.gumroad.com/v2/licenses/verify', 'unexpected account/database request')
  return verification(url, init)
}
const noFetch: Fetcher = () => { throw new Error('must not write any entitlement') }

const customActivationRequest = (payload: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.example/activate', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload),
  })
const validActivationBody = { licenseKey: 'TEST-LICENSE', email: 'buyer@example.com', password: 'test-password' }
for (const payload of [null, [], { ...validActivationBody, email: {} }, { ...validActivationBody, licenseKey: {} }, { ...validActivationBody, password: [] }]) {
  test('activation rejects non-object or coerced fields before RPC/provider work', baseEnv, noFetch, async () => {
    equal((await activate(customActivationRequest(payload))).status, 400)
  })
}
for (const payload of [
  { ...validActivationBody, email: `${'x'.repeat(250)}@example.com` },
  { ...validActivationBody, licenseKey: '繁'.repeat(86) },
  { ...validActivationBody, password: 'x'.repeat(257) },
]) {
  test('activation enforces field byte/character bounds before RPC/provider work', baseEnv, noFetch, async () => {
    equal((await activate(customActivationRequest(payload))).status, 413)
  })
}
test('activation rejects actual oversized UTF8 despite dishonest Content-Length', baseEnv, noFetch, async () => {
  equal((await activate(customActivationRequest({ ...validActivationBody, padding: '繁'.repeat(6000) }, { 'content-length': '1' }))).status, 413)
})
test('activation cancels an unbounded chunked body once its real byte cap is crossed', baseEnv, noFetch, async () => {
  let cancelled = false
  let pulled = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { pulled++; controller.enqueue(new Uint8Array(5000).fill(32)) },
    cancel() { cancelled = true },
  })
  const req = new Request('https://app.example/activate', { method: 'POST', body: stream })
  equal((await activate(req)).status, 413)
  equal(cancelled, true)
  assert(pulled <= 6, 'unbounded body must not be drained')
})
test('activation caps empty stream fragments before they can starve timers or RPCs', baseEnv, noFetch, async () => {
  let cancelled = false
  let pulled = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { pulled++; controller.enqueue(new Uint8Array()) },
    cancel() { cancelled = true },
  })
  equal((await activate(new Request('https://app.example/activate', { method: 'POST', body: stream }))).status, 413)
  equal(cancelled, true)
  assert(pulled <= 4099, 'fragment count must remain bounded')
})
test('activation times out a stalled body without waiting on cancellation or doing RPC work', baseEnv, noFetch, async () => {
  const originalSetTimeout = globalThis.setTimeout
  // This fixture only shortens the handler's no-argument body deadline.
  // Current Deno infers void timer args, so no unknown args are forwarded.
  globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0], ms?: number) =>
    originalSetTimeout(handler, ms === 5000 ? 5 : ms)) as typeof setTimeout
  let cancelled = false
  try {
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise<void>(() => {}) } })
    equal((await activate(new Request('https://app.example/activate', { method: 'POST', body: stream }))).status, 408)
    equal(cancelled, true)
  } finally { globalThis.setTimeout = originalSetTimeout }
})
test('oversized forwarded header cannot become an unbounded database limiter key', baseEnv,
  async (url, init) => {
    if (url.endsWith('/rpc/rate_limit_bump')) {
      const k = JSON.parse(init?.body as string).k
      equal(k, 'act:ip:oversized-ip-header')
      assert(new TextEncoder().encode(k).byteLength <= 200)
      return json(true)
    }
    equal(url, 'https://api.gumroad.com/v2/licenses/verify')
    return json({ success: false })
  }, async () => {
    equal((await activate(customActivationRequest(validActivationBody, { 'x-forwarded-for': 'x'.repeat(5000) }))).status, 403)
  })

const counters = new Map<string, number>()
let legitimateVerify = false
test('20 fake licenses cannot consume another buyer Email quota or block their valid proof', baseEnv,
  async (url, init) => {
    if (url.endsWith('/rpc/rate_limit_bump')) {
      const { k, cap } = JSON.parse(init?.body as string)
      const count = (counters.get(k) ?? 0) + 1
      counters.set(k, count)
      return json(count <= cap)
    }
    if (url === 'https://api.gumroad.com/v2/licenses/verify') {
      const form = new URLSearchParams(init?.body as URLSearchParams)
      if (form.get('license_key') === 'FAKE-LICENSE') return json({ success: false })
      legitimateVerify = true
      return json({ success: true, uses: 0, purchase: { email: 'buyer@example.com' } })
    }
    if (url.endsWith('/auth/v1/admin/users')) return json({ id: 'test-user' })
    if (url.endsWith('/rpc/license_redeem')) return json(true)
    equal(url, 'https://database.example/rest/v1/entitlements')
    return json({})
  }, async () => {
    counters.clear()
    legitimateVerify = false
    for (let i = 0; i < 20; i++) {
      const req = activationRequest('FAKE-LICENSE')
      req.headers.set('x-forwarded-for', '192.0.2.10')
      equal((await activate(req)).status, 403)
    }
    equal(counters.has('act:email:buyer@example.com'), false)
    const buyer = activationRequest()
    buyer.headers.set('x-forwarded-for', '192.0.2.20')
    equal((await activate(buyer)).status, 200)
    equal(legitimateVerify, true)
    equal(counters.get('act:email:buyer@example.com'), 1)
  })

test('a mismatched paid Email cannot consume the target buyer Email quota', baseEnv,
  async (url, init) => {
    if (url.endsWith('/rpc/rate_limit_bump')) {
      assert(JSON.parse(init?.body as string).k.startsWith('act:ip:'), 'unproved Email quota must not be touched')
      return json(true)
    }
    equal(url, 'https://api.gumroad.com/v2/licenses/verify')
    return json({ success: true, purchase: { email: 'another-buyer@example.com' } })
  }, async () => {
    equal((await activate(activationRequest())).status, 403)
  })

test('a legitimate buyer quota rejection still prevents account creation and counting', baseEnv,
  async (url, init) => {
    if (url.endsWith('/rpc/rate_limit_bump')) return json(JSON.parse(init?.body as string).k.startsWith('act:ip:'))
    equal(url, 'https://api.gumroad.com/v2/licenses/verify')
    equal(new URLSearchParams(init?.body as URLSearchParams).get('increment_uses_count'), 'false')
    return json({ success: true, purchase: { email: 'buyer@example.com' } })
  }, async () => {
    equal((await activate(activationRequest())).status, 429)
  })

test('activate rejects an empty license before reading buyer access or creating an account', baseEnv,
  noFetch, async () => {
    const response = await activate(activationRequest(''))
    equal(response.status, 403)
    equal((await response.json()).code, 'license-required')
  })

test('activate reports disabled licenses clearly without creating an account', baseEnv,
  gumroadFetcher(async () => json({ success: false, message: 'This license key has been disabled.' }, 404)),
  async () => {
    const response = await activate(activationRequest())
    equal(response.status, 403)
    equal((await response.json()).code, 'license-disabled')
  })

test('activate refuses a refunded license even if Gumroad verification reports success', baseEnv,
  gumroadFetcher(async () => json({ success: true, purchase: { refunded: true } })), async () => {
    const response = await activate(activationRequest())
    equal(response.status, 403)
    assert((await response.json()).error.includes('退款'))
  })

test('activate refuses a verification payload explicitly marked as a test purchase', baseEnv,
  gumroadFetcher(async () => json({ success: true, purchase: { test: true, email: 'buyer@example.com' } })),
  async () => {
    const response = await activate(activationRequest())
    equal(response.status, 403)
    equal((await response.json()).code, 'test-license')
  })

for (const purchaseEmail of [undefined, 'other-buyer@example.com']) {
  test(`activate rejects ${purchaseEmail ? 'a license belonging to another buyer' : 'a license without purchase Email'} before creating or counting`,
    baseEnv, gumroadFetcher(async () => json({ success: true, purchase: { email: purchaseEmail } })),
    async () => {
      const response = await activate(activationRequest())
      equal(response.status, 403)
      equal((await response.json()).code, 'purchase-email-mismatch')
    })
}

test('a legacy shared invite cannot create an account with an arbitrary Email', {
  ...baseEnv, INVITE_CODES: 'UNBOUND-TEST-INVITE',
}, async (url) => {
  assert(url.endsWith('/rpc/rate_limit_bump'), 'legacy invite must not call Gumroad or create an account')
  return json(true)
}, async () => {
  const response = await activate(activationRequest('UNBOUND-TEST-INVITE'))
  equal(response.status, 403)
  equal((await response.json()).code, 'invite-disabled')
})

test('activate uses product_id when configured, without spending a license use', {
  ...baseEnv, GUMROAD_PRODUCT_ID: 'YIKE-PRODUCT', GUMROAD_PERMALINK: 'legacy-name',
}, gumroadFetcher(async (_url, init) => {
  const form = new URLSearchParams(init?.body as URLSearchParams)
  equal(form.get('product_id'), 'YIKE-PRODUCT')
  equal(form.has('product_permalink'), false)
  equal(form.get('increment_uses_count'), 'false')
  equal(form.get('license_key'), 'TEST-LICENSE')
  return json({ success: false }, 404)
}), async () => {
  equal((await activate(activationRequest())).status, 403)
})

test('activate keeps the configured permalink fallback for existing installations', {
  ...baseEnv, GUMROAD_PRODUCT_ID: '', GUMROAD_PERMALINK: 'legacy-yike',
}, gumroadFetcher(async (_url, init) => {
  const form = new URLSearchParams(init?.body as URLSearchParams)
  equal(form.get('product_permalink'), 'legacy-yike')
  equal(form.has('product_id'), false)
  return json({ success: false }, 404)
}), async () => {
  equal((await activate(activationRequest())).status, 403)
})

for (const status of [500, 503, 429]) {
  test(`activate treats Gumroad HTTP ${status} as temporary failure, not an invalid license`,
    baseEnv, gumroadFetcher(async () => json({ success: false }, status)), async () => {
      const response = await activate(activationRequest())
      equal(response.status, 503)
      const body = await response.json()
      assert(body.error.includes('暫時無法驗證'))
      assert(!body.error.includes('序號無效'))
    })
}

test('activate handles network failure without creating an account', baseEnv,
  gumroadFetcher(async () => { throw new TypeError('network offline') }), async () => {
    const response = await activate(activationRequest())
    equal(response.status, 503)
    assert((await response.json()).error.includes('不必重新購買'))
  })

test('activate handles malformed upstream JSON as temporary failure', baseEnv,
  gumroadFetcher(async () => new Response('<html>temporary error</html>', { status: 200 })), async () => {
    const response = await activate(activationRequest())
    equal(response.status, 503)
  })

let verificationCalls = 0
test('successful activation verifies first, then records the account and counts one use', {
  ...baseEnv, GUMROAD_PRODUCT_ID: 'YIKE-PRODUCT',
}, async (url, init) => {
  if (url.endsWith('/rpc/rate_limit_bump')) return json(true)
  if (url === 'https://api.gumroad.com/v2/licenses/verify') {
    const form = new URLSearchParams(init?.body as URLSearchParams)
    equal(form.get('product_id'), 'YIKE-PRODUCT')
    equal(form.get('increment_uses_count'), verificationCalls++ === 0 ? 'false' : 'true')
    return json({ success: true, uses: 0, purchase: { email: ' Buyer@Example.COM ' } })
  }
  if (url.endsWith('/auth/v1/admin/users')) {
    equal(verificationCalls, 1)
    return json({ id: 'test-user' })
  }
  if (url.endsWith('/rpc/license_redeem')) return json(true)
  equal(url, 'https://database.example/rest/v1/entitlements')
  equal(verificationCalls, 2)
  equal(JSON.parse(init?.body as string).source, 'gumroad-license')
  return json({})
}, async () => {
  verificationCalls = 0
  equal((await activate(activationRequest())).status, 200)
  equal(verificationCalls, 2)
})

let forcedRecord = false
test('retains the newer safety fix: record an account when over-quota rollback fails', baseEnv,
  async (url, init) => {
    if (url.endsWith('/rpc/rate_limit_bump')) return json(true)
    if (url === 'https://api.gumroad.com/v2/licenses/verify')
      return json({ success: true, uses: 0, purchase: { email: 'buyer@example.com' } })
    if (url.endsWith('/auth/v1/admin/users')) return json({ id: 'test-user' })
    if (url.endsWith('/rpc/license_redeem')) return json(false)
    if (url.endsWith('/auth/v1/admin/users/test-user')) {
      equal(init?.method, 'DELETE')
      return json({}, 500)
    }
    if (url.endsWith('/rpc/license_force_record')) {
      forcedRecord = true
      return json(true)
    }
    equal(url, 'https://database.example/rest/v1/entitlements')
    equal(forcedRecord, true)
    equal(JSON.parse(init?.body as string).raw.over_quota_kept, true)
    return json({})
  }, async () => {
    forcedRecord = false
    const originalError = console.error
    console.error = () => {} // Expected warnings for the intentionally failed rollback.
    try {
      equal((await activate(activationRequest())).status, 200)
      equal(forcedRecord, true)
    } finally {
      console.error = originalError
    }
  })
