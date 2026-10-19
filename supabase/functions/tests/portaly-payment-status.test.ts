// Historical status shapes are synthetic, unverified provider contracts.
// All object payloads must remain unavailable until a Yike-bound adapter is verified.
// Run the real handler with synthetic environment and fetch; no network or accounts.
type Handler = (request: Request) => Promise<Response>
let handler: Handler | undefined
const originalServe = Deno.serve
Deno.serve = ((value: Handler) => {
  handler = value
  return {} as Deno.HttpServer
}) as typeof Deno.serve
try { await import('../portaly-webhook/index.ts') }
finally { Deno.serve = originalServe }

const test = (name: string, payload: unknown, writesExpected: number, responseExpected = 503,
  configuredSecret: string | undefined = 'synthetic-webhook-secret', querySecret = 'synthetic-webhook-secret') =>
  Deno.test(name, async () => {
    const get = Deno.env.get
    const fetcher = globalThis.fetch
    let writes = 0
    const env: Record<string, string | undefined> = {
      PORTALY_SECRET: configuredSecret,
      SUPABASE_URL: 'https://synthetic-database.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role',
    }
    Deno.env.get = (key: string) => env[key]
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) !== 'https://synthetic-database.invalid/rest/v1/entitlements' || init?.method !== 'POST')
        throw new Error('Unexpected outbound request; real network is forbidden')
      const body = JSON.parse(String(init.body))
      if (body.email !== 'synthetic-buyer@example.invalid' || body.source !== 'portaly')
        throw new Error('Unexpected entitlement owner/source')
      writes++
      return new Response('{}', { status: 201 })
    }) as typeof fetch
    try {
      if (!handler) throw new Error('Handler not registered')
      const response = await handler(new Request('https://synthetic-app.invalid/webhook?secret=' + encodeURIComponent(querySecret), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }))
      if (response.status !== responseExpected || writes !== writesExpected)
        throw new Error(`Expected HTTP ${responseExpected} / ${writesExpected} writes, got HTTP ${response.status} / ${writes} writes`)
    } finally { Deno.env.get = get; globalThis.fetch = fetcher }
  })

const buyer = { email: 'synthetic-buyer@example.invalid' }
for (const status of ['unpaid', 'not_completed', 'payment_failed', 'unsuccessful', 'paid_then_refunded', '', 'unknown'])
  test(`Portaly never grants for non-success status ${JSON.stringify(status)}`, { ...buyer, payment_status: status }, 0)
test('Portaly missing payment status is not proof of payment', buyer, 0)
for (const payment_status of [['paid'], { value: 'paid' }, true, null])
  test('Portaly never coerces a non-string into successful payment', { ...buyer, payment_status }, 0)
test('Portaly conflicting status fields cannot hide a refund', { ...buyer, status: 'paid', payment_status: 'refunded' }, 0)
test('Portaly refund flag ignores case without granting', { ...buyer, payment_status: 'paid', refunded: 'TRUE' }, 0)
test('Portaly malformed refund flag cannot grant', { ...buyer, payment_status: 'paid', refunded: 1 }, 0)
test('Portaly synthetic consistent success fields cannot enable an unverified contract', { ...buyer, status: 'completed', payment_status: 'paid' }, 0)
for (const status of ['paid', 'success', 'succeeded', 'completed', 'complete', ' PAID '])
  test(`Portaly synthetic recognized success remains contract-blocked ${JSON.stringify(status)}`, { ...buyer, payment_status: status }, 0)
for (const flag of ['refunded', 'disputed', 'test', 'is_test'])
  for (const value of [true, 'true'])
    test(`Portaly skips ${flag}=${value}`, { ...buyer, payment_status: 'paid', [flag]: value }, 0)
for (const payload of [null, [], 'paid', 1])
  test('Portaly rejects non-object payload without granting', payload, 0, 400)
test('Portaly empty configured secret cannot authenticate empty query', { ...buyer, payment_status: 'paid' }, 0, 401, '', '')
test('Portaly wrong secret cannot grant', { ...buyer, payment_status: 'paid' }, 0, 401, 'synthetic-webhook-secret', 'wrong')
