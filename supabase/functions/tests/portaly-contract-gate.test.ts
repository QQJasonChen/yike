// This is an intentionally unavailable contract, not a claim of provider support.
// Real handler + synthetic payloads only; no network, credentials, orders or users.
type Handler = (request: Request) => Promise<Response>
let handler: Handler | undefined
const serve = Deno.serve
Deno.serve = ((value: Handler) => { handler = value; return {} as Deno.HttpServer }) as typeof Deno.serve
try { await import('../portaly-webhook/index.ts') } finally { Deno.serve = serve }

type GateCase = {
  payload?: unknown; rawBody?: string; method?: string; query?: string;
  configuredSecret?: string | null; extraEnv?: Record<string, string>;
  headers?: HeadersInit; expectedStatus?: number;
}
const buyer = 'synthetic-buyer@example.invalid'
const digital = {
  event: 'digital_product.checkout.completed', status: 'completed', mode: 'live', buyerEmail: buyer,
  orders: [{ orderId: 'SYNTHETIC_ORDER', productId: 'SYNTHETIC_YIKE_PRODUCT' }],
}
const payment = {
  event: 'creator_subscription.checkout.completed', status: 'completed', mode: 'live',
  customerEmail: buyer, planId: 'SYNTHETIC_PLAN', sessionId: 'SYNTHETIC_SESSION',
}
const check = async (options: GateCase) => {
  const get = Deno.env.get, fetcher = globalThis.fetch
  let calls = 0
  const accessed: string[] = []
  const env: Record<string, string | undefined> = {
    PORTALY_SECRET: options.configuredSecret === null ? undefined : options.configuredSecret ?? 'SYNTHETIC_SECRET',
    SUPABASE_URL: 'https://synthetic-database.invalid', SUPABASE_SERVICE_ROLE_KEY: 'SYNTHETIC_SERVICE_ROLE',
    ...options.extraEnv,
  }
  Deno.env.get = key => { accessed.push(key); return env[key] }
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 201 }) }
  try {
    if (!handler) throw new Error('Handler not registered')
    const method = options.method ?? 'POST'
    const request = new Request('https://synthetic-app.invalid/portaly?' + (options.query ?? 'secret=SYNTHETIC_SECRET'), {
      method, headers: options.headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: options.rawBody ?? JSON.stringify(options.payload ?? {}) }),
    })
    const response = await handler(request)
    const body = await response.json()
    const expectedStatus = options.expectedStatus ?? 503
    if (response.status !== expectedStatus || calls !== 0 || accessed.some(key => key !== 'PORTALY_SECRET'))
      throw new Error(`Expected HTTP ${expectedStatus} / no network or service credentials; got HTTP ${response.status} / ${calls} calls / env ${accessed.join(',')}`)
    if (expectedStatus === 503 && body.error !== 'portaly contract unavailable')
      throw new Error('Unavailable contract must not acknowledge the event as processed')
  } finally { Deno.env.get = get; globalThis.fetch = fetcher }
}
const cases: [string, GateCase][] = [
  ['generic paid JSON cannot grant a Yike entitlement', { payload: { email: buyer, payment_status: 'paid' } }],
  ['an unrelated product cannot grant a Yike entitlement', { payload: { email: buyer, payment_status: 'paid', product_id: 'SYNTHETIC_OTHER_PRODUCT' } }],
  ['nested product and buyer guessing cannot grant', { payload: { payment_status: 'paid', customer: { email: buyer }, purchase: { product: { id: 'SYNTHETIC_YIKE_PRODUCT' } } } }],
  ['invented product configuration cannot enable an unverified contract', {
    payload: { email: buyer, payment_status: 'paid', product_id: 'SYNTHETIC_YIKE_PRODUCT' },
    extraEnv: { PORTALY_YIKE_PRODUCT_ID: 'SYNTHETIC_YIKE_PRODUCT', PORTALY_WEBHOOK_CONTRACT: 'legacy-json-v1', PORTALY_ENABLED: 'true' },
  }],
  ['Digital Products shaped JSON is not proof of configured provider support', { payload: digital }],
  ['Payment shaped JSON cannot be mistaken for Digital Products', { payload: payment }],
  ['a mixed bundle cannot activate an unverified Yike product', { payload: { ...digital, orders: [...digital.orders, { orderId: 'SYNTHETIC_OTHER_ORDER', productId: 'SYNTHETIC_OTHER_PRODUCT' }] } }],
  ['a test-mode completed event cannot activate production rights', { payload: { ...digital, mode: 'test' } }],
  ['a refund event cannot grant or revoke existing rights through this gate', { payload: { event: 'digital_product.order.refunded', productId: 'SYNTHETIC_YIKE_PRODUCT', buyerEmail: buyer } }],
  ['a manual-style completed Payment event is still unavailable', { payload: { ...payment, paymentMethod: 'custom-provider', paymentReference: 'SYNTHETIC_REFERENCE' } }],
  ['signature-shaped headers and callback config cannot open this gate', {
    payload: digital, extraEnv: { PORTALY_CALLBACK_SECRET: 'SYNTHETIC_CALLBACK_SECRET' },
    headers: { 'x-portaly-event': digital.event, 'x-portaly-timestamp': '2026-01-01T00:00:00Z', 'x-portaly-signature': '0'.repeat(64) },
  }],
  ['an absent configured secret fails closed', { configuredSecret: null, expectedStatus: 401 }],
  ['an empty configured secret cannot authenticate an empty query', { configuredSecret: '', query: 'secret=', expectedStatus: 401 }],
  ['a wrong query secret fails closed', { query: 'secret=other', expectedStatus: 401 }],
  ['a missing query secret fails closed', { query: '', expectedStatus: 401 }],
  ['different duplicate query secrets fail closed', { query: 'secret=SYNTHETIC_SECRET&secret=other', expectedStatus: 401 }],
  ['identical duplicate query secrets also fail closed', { query: 'secret=SYNTHETIC_SECRET&secret=SYNTHETIC_SECRET', expectedStatus: 401 }],
  ['malformed JSON cannot reach a grant', { rawBody: '{', expectedStatus: 400 }],
]
for (const [name, options] of cases)
  Deno.test(`Portaly unavailable contract: ${name}`, () => check(options))
for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
  Deno.test(`Portaly unavailable contract: ${method} cannot bypass POST enforcement`, () => check({ method, expectedStatus: 405 }))
