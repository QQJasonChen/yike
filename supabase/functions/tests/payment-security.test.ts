// Real handlers, synthetic secrets/receipts and isolated fetch: never contacts a provider.
type Handler = (req: Request) => Promise<Response>
const handlers: Record<string, Handler> = {}
const serve = Deno.serve
let current = ''
Deno.serve = ((fn: Handler) => { handlers[current] = fn; return {} as Deno.HttpServer }) as typeof Deno.serve
try {
  current = 'iap-activate'; await import('../iap-activate/index.ts')
  current = 'gumroad-ping'; await import('../gumroad-ping/index.ts')
  current = 'portaly-webhook'; await import('../portaly-webhook/index.ts')
} finally { Deno.serve = serve }
const assert = (value: boolean, message: string) => { if (!value) throw new Error(message) }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const BUYER = 'synthetic-buyer@example.invalid'
const OTHER = 'synthetic-other@example.invalid'
const env: Record<string, string> = {
  SUPABASE_URL: 'https://synthetic-database.invalid', SUPABASE_SERVICE_ROLE_KEY: 'SYNTHETIC_SERVICE',
  GUMROAD_PING_SECRET: 'SYNTHETIC_SECRET', PORTALY_SECRET: 'SYNTHETIC_SECRET',
  GUMROAD_PRODUCT_ID: 'SYNTHETIC_YIKE_PRODUCT', REVENUECAT_SECRET: 'SYNTHETIC_RC_SECRET',
}
const form = (extra: Record<string, string> = {}) => new URLSearchParams({ email: BUYER, product_id: env.GUMROAD_PRODUCT_ID, sale_id: 'SYNTHETIC_SALE', ...extra }).toString()

type Harness = { calls: string[]; writes: Record<string, unknown>[]; rows: Map<string, Record<string, unknown>> }
async function withHarness(run: (harness: Harness) => Promise<void>, override: Record<string, string | undefined> = {}) {
  const savedGet = Deno.env.get, savedFetch = globalThis.fetch
  const h: Harness = { calls: [], writes: [], rows: new Map() }
  Deno.env.get = key => Object.hasOwn(override, key) ? override[key] : env[key]
  globalThis.fetch = async (input, init) => {
    const url = String(input); h.calls.push(url)
    const requestInit = init as { body?: BodyInit; headers?: HeadersInit } | undefined
    if (url.startsWith('https://api.revenuecat.com/v1/subscribers/'))
      return response({ subscriber: { entitlements: { sync: { expires_date: null } } } })
    if (url === `${env.SUPABASE_URL}/auth/v1/admin/users`) {
      const body = JSON.parse(String(requestInit?.body)); h.writes.push(body)
      return response({ id: '00000000-0000-4000-8000-000000000001', email: body.email })
    }
    if (url === `${env.SUPABASE_URL}/rest/v1/entitlements`) {
      const body = JSON.parse(String(requestInit?.body)); h.writes.push(body)
      const previous = h.rows.get(body.email)
      const prefer = new Headers(requestInit?.headers).get('Prefer') ?? ''
      if (!previous || !prefer.includes('ignore-duplicates')) h.rows.set(body.email, { ...previous, ...body })
      return response({}, 201)
    }
    throw new Error('Unexpected request: real network is forbidden')
  }
  try { await run(h) } finally { Deno.env.get = savedGet; globalThis.fetch = savedFetch }
}
const invoke = (name: string, body: string, secret = 'SYNTHETIC_SECRET', headers: HeadersInit = {}) => handlers[name](new Request(`https://synthetic-app.invalid/${name}?secret=${encodeURIComponent(secret)}`, {
  method: 'POST', body, headers: { 'Content-Type': name === 'gumroad-ping' ? 'application/x-www-form-urlencoded' : 'application/json', ...headers },
}))

Deno.test('IAP identifier replay cannot create two accounts for two supplied emails', () => withHarness(async h => {
  const statuses: number[] = []
  for (const email of [BUYER, OTHER]) statuses.push((await invoke('iap-activate', JSON.stringify({ appUserId: 'SYNTHETIC_SHARED_PUBLIC_IDENTIFIER', email, password: 'synthetic-password' }))).status)
  assert(statuses.every(status => status === 503) && h.calls.length === 0,
    `Unsafe IAP replay: statuses=${statuses.join(',')}; outbound=${h.calls.length}; account writes=${h.writes.length}`)
}))
Deno.test('Portaly never chooses between two different email identities', () => withHarness(async h => {
  const res = await invoke('portaly-webhook', JSON.stringify({ seller_email: OTHER, payment_status: 'paid', customer: { email: BUYER } }))
  assert(res.status === 503 && h.calls.length === 0, `Expected unavailable contract, got ${res.status} / ${h.calls.length} calls`)
}))
Deno.test('Portaly synthetic normalized paid email cannot enable an unverified contract', () => withHarness(async h => {
  const res = await invoke('portaly-webhook', JSON.stringify({ email: BUYER.toUpperCase(), payment_status: 'paid', customer: { email: BUYER } }))
  assert(res.status === 503 && h.calls.length === 0, 'Unverified Portaly paid payload was acknowledged or granted')
}))
for (const name of ['gumroad-ping', 'portaly-webhook']) {
  Deno.test(`${name} replay preserves an existing manual entitlement receipt`, () => withHarness(async h => {
    const original = { email: BUYER, source: 'manual', raw: { synthetic: 'first receipt' }, redeemed_at: '2026-01-01T00:00:00Z', created_at: '2025-01-01T00:00:00Z' }
    h.rows.set(BUYER, original)
    const body = name === 'gumroad-ping' ? form() : JSON.stringify({ email: BUYER, payment_status: 'paid' })
    for (let i = 0; i < 2; i++) assert((await invoke(name, body)).status === (name === 'portaly-webhook' ? 503 : 200), 'Unexpected replay response')
    assert(JSON.stringify(h.rows.get(BUYER)) === JSON.stringify(original), 'Replay overwrote an existing receipt/source/timestamp')
    if (name === 'portaly-webhook') assert(h.calls.length === 0 && h.writes.length === 0, 'Unavailable Portaly replay attempted an account or entitlement write')
  }))
  Deno.test(`${name} rejects actual oversized bytes even when Content-Length lies`, () => withHarness(async h => {
    const padding = 'x'.repeat(70 * 1024)
    const body = name === 'gumroad-ping' ? form({ padding }) : JSON.stringify({ email: BUYER, payment_status: 'paid', padding })
    const res = await invoke(name, body, 'SYNTHETIC_SECRET', { 'Content-Length': '1' })
    assert(res.status === 413 && h.calls.length === 0, `Expected bounded rejection; HTTP ${res.status}, outbound ${h.calls.length}`)
  }))
  Deno.test(`${name} handles synthetic upstream failure or unavailable contract without leaking details`, () => withHarness(async () => {
    globalThis.fetch = () => Promise.reject(new Error('SYNTHETIC_PRIVATE_DETAIL'))
    const body = name === 'gumroad-ping' ? form() : JSON.stringify({ email: BUYER, payment_status: 'paid' })
    const res = await invoke(name, body)
    assert(res.status === 503 && !(await res.text()).includes('SYNTHETIC_PRIVATE_DETAIL'), 'Expected safe retryable failure')
  }))
}
Deno.test('Gumroad empty configured secret cannot authenticate empty query', () => withHarness(async h => {
  const res = await invoke('gumroad-ping', form(), '')
  assert(res.status === 401 && h.calls.length === 0, 'Empty secret authenticated')
}, { GUMROAD_PING_SECRET: '' }))
for (const flag of ['refunded', 'disputed', 'chargebacked', 'test', 'is_test']) {
  for (const value of ['true', 'TRUE']) Deno.test(`Gumroad never grants ${flag}=${value}`, () => withHarness(async h => {
    const res = await invoke('gumroad-ping', form({ [flag]: value }))
    assert(res.status === 200 && h.calls.length === 0, `Unsafe flag accepted: HTTP ${res.status}, writes ${h.writes.length}`)
  }))
  Deno.test(`Gumroad rejects malformed ${flag}`, () => withHarness(async h => {
    const res = await invoke('gumroad-ping', form({ [flag]: '1' }))
    assert(res.status === 400 && h.calls.length === 0, `Malformed flag accepted: HTTP ${res.status}`)
  }))
}
Deno.test('Gumroad rejects a sale for a different product', () => withHarness(async h => {
  const res = await invoke('gumroad-ping', form({ product_id: 'SYNTHETIC_OTHER_PRODUCT' }))
  assert(res.status === 422 && h.calls.length === 0, 'Other product received Yike entitlement')
}))
Deno.test('Gumroad product configuration absence fails closed', () => withHarness(async h => {
  const res = await invoke('gumroad-ping', form())
  assert(res.status === 503 && h.calls.length === 0, 'Missing product configuration granted')
}, { GUMROAD_PRODUCT_ID: undefined }))
Deno.test('Gumroad duplicate payment flag cannot hide refund', () => withHarness(async h => {
  const res = await invoke('gumroad-ping', form({ refunded: 'false' }) + '&refunded=true')
  assert(res.status === 400 && h.calls.length === 0, 'Ambiguous duplicate flag granted')
}))
Deno.test('Gumroad duplicate email cannot disagree with persisted raw receipt', () => withHarness(async h => {
  const res = await invoke('gumroad-ping', form() + '&email=' + encodeURIComponent(OTHER))
  assert(res.status === 400 && h.calls.length === 0, 'Ambiguous duplicate email granted')
}))
Deno.test('Gumroad supported valid sale remains idempotent', () => withHarness(async h => {
  for (let i = 0; i < 2; i++) assert((await invoke('gumroad-ping', form())).status === 200, 'Valid supported sale was rejected')
  assert(h.rows.size === 1 && h.rows.get(BUYER)?.source === 'gumroad', 'Valid sale did not grant exactly one identity')
}))
for (const name of ['gumroad-ping', 'portaly-webhook']) {
  Deno.test(`${name} rejects an already-aborted request before network activity`, () => withHarness(async h => {
    const controller = new AbortController(); controller.abort()
    const body = name === 'gumroad-ping' ? form() : JSON.stringify({ email: BUYER, payment_status: 'paid' })
    const res = await handlers[name](new Request(`https://synthetic-app.invalid/${name}?secret=SYNTHETIC_SECRET`, {
      method: 'POST', signal: controller.signal, body,
    }))
    assert(res.status === 408 && h.calls.length === 0, `Expected aborted body rejection, got ${res.status}`)
  }))
  Deno.test(`${name} rejects duplicate secret query parameters`, () => withHarness(async h => {
    const body = name === 'gumroad-ping' ? form() : JSON.stringify({ email: BUYER, payment_status: 'paid' })
    const res = await handlers[name](new Request(`https://synthetic-app.invalid/${name}?secret=SYNTHETIC_SECRET&secret=other`, { method: 'POST', body }))
    assert(res.status === 401 && h.calls.length === 0, 'Duplicate secret authentication was ambiguous')
  }))
  Deno.test(`${name} synthetic upstream failure or unavailable contract remains retryable`, () => withHarness(async () => {
    globalThis.fetch = async () => response({ detail: 'SYNTHETIC_PRIVATE_DETAIL' }, 500)
    const body = name === 'gumroad-ping' ? form() : JSON.stringify({ email: BUYER, payment_status: 'paid' })
    const res = await invoke(name, body)
    assert(res.status === 503 && !(await res.text()).includes('SYNTHETIC_PRIVATE_DETAIL'), 'DB rejection leaked details or was acknowledged')
  }))
}
Deno.test('Portaly deeply nested synthetic identities remain contract-blocked', () => withHarness(async h => {
  let nested: unknown = { email: OTHER }
  for (let depth = 0; depth < 12; depth++) nested = { nested }
  const res = await invoke('portaly-webhook', JSON.stringify({ email: BUYER, payment_status: 'paid', nested }))
  assert(res.status === 503 && h.calls.length === 0, 'Unverified deeply nested contract was granted')
}))
for (const email of ['two@@example.invalid', 'a b@example.invalid', 'buyer@example.invalid\n.other', 'x'.repeat(255) + '@example.invalid']) {
  Deno.test('Portaly malformed synthetic buyer cannot enable an unverified contract', () => withHarness(async h => {
    const res = await invoke('portaly-webhook', JSON.stringify({ email, payment_status: 'paid' }))
    assert(res.status === 503 && h.calls.length === 0, 'Unverified Portaly contract was granted')
  }))
  Deno.test('Gumroad rejects malformed or oversized buyer email', () => withHarness(async h => {
    const res = await invoke('gumroad-ping', form({ email }))
    assert(res.status === 422 && h.calls.length === 0, 'Malformed email was granted')
  }))
}
Deno.test('IAP retains preflight and method behavior without any provider access', () => withHarness(async h => {
  const preflight = await handlers['iap-activate'](new Request('https://synthetic-app.invalid/iap-activate', { method: 'OPTIONS' }))
  const get = await handlers['iap-activate'](new Request('https://synthetic-app.invalid/iap-activate'))
  assert(preflight.status === 200 && preflight.headers.get('Access-Control-Allow-Origin') === '*' && get.status === 405 && h.calls.length === 0, 'IAP transport behavior regressed')
}))
