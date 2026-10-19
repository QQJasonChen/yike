// Actual handler, synthetic HTTP only; never network, Auth, purchases or customer data.
type Handler = (req: Request) => Promise<Response>
let handler: Handler
const serve = Deno.serve
Deno.serve = ((fn: Handler) => { handler = fn; return {} as Deno.HttpServer }) as typeof Deno.serve
try { await import('../activate/index.ts') } finally { Deno.serve = serve }
const EMAIL = 'synthetic@example.invalid', UID = '00000000-0000-4000-8000-000000000001'
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Synthetic assertion ${JSON.stringify(a)} != ${JSON.stringify(b)}`) }
type Stage = 'rate' | 'gumroad' | 'create' | 'signin' | 'grant' | 'counter'
async function scenario(task: (state: ReturnType<typeof stateFor>) => Promise<void>, stage?: Stage, mode = 'normal') {
  const get = Deno.env.get, fetcher = globalThis.fetch, log = console.error
  const state = stateFor(stage, mode)
  Deno.env.get = (key: string) => ({ SUPABASE_URL: 'https://db.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'SYNTHETIC_SERVICE', SUPABASE_ANON_KEY: 'SYNTHETIC_PUBLIC', GUMROAD_PRODUCT_ID: 'SYNTHETIC_PRODUCT' })[key as 'SUPABASE_URL']
  globalThis.fetch = state.fetcher; console.error = () => {}
  try { await task(state) } finally { Deno.env.get = get; globalThis.fetch = fetcher; console.error = log }
}
function stateFor(faultStage?: Stage, mode = 'normal') {
  const s = { calls: [] as Stage[], redirects: [] as (string | undefined)[], authExists: faultStage === 'signin', ledger: false, increments: 0, cancelled: false, controller: new AbortController(), faulted: false, timeout: (() => {}) as () => void, fetcher: null! as typeof fetch }
  s.fetcher = async (input, init) => {
    const url = String(input), config = init as { body?: string; method?: string; redirect?: string } | undefined
    if (!['/rest/v1/rpc/rate_limit_bump', '/auth/v1/admin/users', '/auth/v1/token?grant_type=password', '/rest/v1/rpc/license_activate_grant'].some(path => url === 'https://db.example.invalid' + path) && url !== 'https://api.gumroad.com/v2/licenses/verify') throw new Error('Unexpected route: real network and journal access forbidden')
    const stage: Stage = url.includes('rate_limit_bump') ? 'rate' : url.includes('licenses/verify') ? new URLSearchParams(config?.body as string).get('increment_uses_count') === 'true' ? 'counter' : 'gumroad' : url.includes('/token?') ? 'signin' : url.includes('license_activate_grant') ? 'grant' : 'create'
    if (config?.method === 'DELETE') throw new Error('Destructive compensation forbidden')
    s.calls.push(stage); s.redirects.push(config?.redirect)
    let value: unknown = true, status = 200
    if (stage === 'gumroad' || stage === 'counter') { value = { success: true, uses: 0, purchase: { email: EMAIL } }; if (stage === 'counter') s.increments++ }
    if (stage === 'create') { if (s.authExists) { value = { error_code: 'email_exists' }; status = 422 } else { s.authExists = true; value = { id: UID, email: EMAIL } } }
    if (stage === 'signin') value = { access_token: 'SYNTHETIC_TOKEN', user: { id: UID, email: EMAIL } }
    if (stage === 'grant') { value = { ok: true, new_redemption: !s.ledger }; s.ledger = true }
    if (!s.faulted && stage === faultStage) {
      s.faulted = true
      if (mode === 'oversized') return new Response(JSON.stringify(value) + ' '.repeat(128 * 1024), { status })
      if (mode === 'redirect') return new Response('', { status: 302, headers: { location: 'https://other.example.invalid/' } })
      if (mode === 'abort') s.controller.abort()
      if (mode === 'deadline') s.timeout()
      if (mode === 'hang') return await new Promise<Response>(() => {})
      if (mode === 'body-hang') return new Response(new ReadableStream<Uint8Array>({ start() { queueMicrotask(() => s.controller.abort()) }, cancel() { s.cancelled = true } }), { status })
    }
    return json(value, status)
  }
  return s
}
async function call(s: ReturnType<typeof stateFor>) {
  const response = await handler(new Request('https://app.example.invalid/activate', { method: 'POST', signal: s.controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: 'synthetic-original', licenseKey: 'SYNTHETIC_LICENSE' }) }))
  const value = await response.text()
  if (value.includes('SYNTHETIC_TOKEN') || value.includes(EMAIL) || value.includes(UID)) throw new Error('Private synthetic proof escaped')
  return response.status
}
Deno.test('before-boundary: every upstream fetch forbids redirects', () => scenario(async s => { eq(await call(s), 200); eq(s.redirects.every(x => x === 'error'), true) }))
for (const stage of ['rate', 'gumroad', 'create', 'signin', 'grant'] as Stage[]) Deno.test(`before-boundary: actual oversized ${stage} JSON is unconfirmed`, () => scenario(async s => { eq(await call(s), 503); eq(s.increments, 0) }, stage, 'oversized'))
for (const stage of ['rate', 'gumroad', 'create', 'signin', 'grant'] as Stage[]) Deno.test(`redirect ${stage} cannot advance to success or provider increment`, () => scenario(async s => { eq(await call(s), 503); eq(s.increments, 0) }, stage, 'redirect'))
for (const stage of ['create', 'grant'] as Stage[]) Deno.test(`caller abort after ${stage} may commit but original password retry preserves account`, () => scenario(async s => {
  eq(await call(s), 503); eq(s.authExists, true); eq(s.increments, 0)
  s.controller = new AbortController(); eq(await call(s), 200); eq(s.authExists, true); eq(s.ledger, true); eq(s.increments, stage === 'grant' ? 0 : 1)
  eq(s.calls.filter(x => x === 'signin').length, 1)
}, stage, 'abort'))
Deno.test('caller abort releases a stalled upstream response body', () => scenario(async s => { eq(await call(s), 503); eq(s.cancelled, true); eq(s.authExists, false) }, 'gumroad', 'body-hang'))
Deno.test('total deadline stops work after account creation without deleting the account', () => scenario(async s => {
  const timeout = globalThis.setTimeout
  globalThis.setTimeout = ((fn: () => void, ms?: number) => { if (ms === 45_000) s.timeout = fn as () => void; return timeout(fn, ms) }) as typeof setTimeout
  try { eq(await call(s), 503); eq(s.authExists, true); eq(s.increments, 0) } finally { globalThis.setTimeout = timeout }
}, 'create', 'deadline'))
Deno.test('fetch that ignores abort is still bounded by the per-call deadline', () => scenario(async s => {
  const timeout = globalThis.setTimeout
  globalThis.setTimeout = ((fn: () => void, ms?: number) => { if (ms === 10_000) queueMicrotask(fn as () => void); return timeout(fn, ms) }) as typeof setTimeout
  try { eq(await call(s), 503); eq(s.authExists, false) } finally { globalThis.setTimeout = timeout }
}, 'rate', 'hang'))
Deno.test('counter oversized JSON keeps committed grant successful and never blindly increments again', () => scenario(async s => {
  eq(await call(s), 200); eq(s.ledger, true); eq(s.increments, 1); eq(await call(s), 200); eq(s.increments, 1)
}, 'counter', 'oversized'))
