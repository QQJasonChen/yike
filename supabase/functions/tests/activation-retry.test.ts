// Actual isolated handler plus in-memory provider/Auth/atomic-RPC stubs; never real network.
type Handler = (request: Request) => Promise<Response>
let handler: Handler
const serve = Deno.serve
Deno.serve = ((fn: Handler) => { handler = fn; return {} as Deno.HttpServer }) as typeof Deno.serve
try { await import('../activate/index.ts') } finally { Deno.serve = serve }
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Synthetic assertion: ${JSON.stringify(a)} != ${JSON.stringify(b)}`) }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const EMAIL = 'synthetic-buyer@example.invalid', UID = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002', PASSWORD = 'synthetic-original-password'
const PRIVATE = 'SYNTHETIC_PRIVATE_DETAIL', TOKEN = 'SYNTHETIC_PASSWORD_PROOF_TOKEN'
const request = () => new Request('https://app.example.invalid/activate', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ licenseKey: 'SYNTHETIC_LICENSE', email: EMAIL, password: PASSWORD, user_id: OTHER }),
})
type Options = {
  existing?: boolean; passwordRejected?: boolean; signinFault?: boolean; signinUser?: unknown; missingAnon?: boolean;
  createFault?: boolean; grantFault?: 'before-commit' | 'after-commit' | 'http500'; cap?: boolean;
  grantReply?: unknown; uses?: unknown; omitUses?: boolean; providerStatus?: number; providerSuccess?: boolean;
  counterFault?: boolean; limiterFault?: boolean;
}
async function withState(options: Options, task: (state: ReturnType<typeof setup>) => Promise<void>) {
  const oldGet = Deno.env.get, oldFetch = globalThis.fetch, oldError = console.error
  const state = setup(options)
  Deno.env.get = (name) => ({ SUPABASE_URL: 'https://database.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'SYNTHETIC_SERVICE',
    SUPABASE_ANON_KEY: options.missingAnon ? undefined : 'SYNTHETIC_PUBLIC', GUMROAD_PRODUCT_ID: 'SYNTHETIC_PRODUCT' })[name as 'SUPABASE_URL']
  globalThis.fetch = state.fetcher; console.error = (...args) => { state.logs.push(args) }
  try { await task(state) } finally { Deno.env.get = oldGet; globalThis.fetch = oldFetch; console.error = oldError }
}
function setup(options: Options) {
  const state = {
    authExists: !!options.existing, ledger: false, entitlement: false, calls: [] as string[], proofs: 0,
    rpcCalls: 0, increments: 0, deletes: 0, logs: [] as unknown[][],
    fetcher: null! as typeof fetch,
  }
  state.fetcher = async (input, init) => {
    const url = String(input); state.calls.push(url)
    const config = init as { body?: BodyInit; headers?: Record<string, string>; signal?: AbortSignal }
    if (!(config.signal instanceof AbortSignal)) throw new Error('Every provider/Auth/RPC request needs a bounded signal')
    if (config.signal.aborted) throw new DOMException('Synthetic abort', 'AbortError')
    if (url.endsWith('/rpc/rate_limit_bump')) return options.limiterFault ? json({ msg: PRIVATE }, 500) : json(true)
    if (url === 'https://api.gumroad.com/v2/licenses/verify') {
      const mode = new URLSearchParams(config.body as string).get('increment_uses_count')
      if (mode === 'true') {
        state.increments++
        if (options.counterFault) throw new TypeError(PRIVATE)
      }
      return json({ success: options.providerSuccess ?? true,
        ...(options.omitUses ? {} : { uses: options.uses === undefined ? 0 : options.uses }),
        purchase: { email: EMAIL } }, options.providerStatus ?? 200)
    }
    if (url.endsWith('/auth/v1/admin/users')) {
      if (options.createFault) throw new TypeError(PRIVATE)
      if (state.authExists) return json({ error_code: 'email_exists', msg: PRIVATE }, 422)
      state.authExists = true
      return json({ id: UID, email: EMAIL })
    }
    if (url.endsWith('/auth/v1/token?grant_type=password')) {
      state.proofs++
      eq(config.headers?.apikey, 'SYNTHETIC_PUBLIC')
      eq(JSON.parse(config.body as string), { email: EMAIL, password: PASSWORD })
      if (options.signinFault) throw new TypeError(PRIVATE)
      if (options.passwordRejected) return json({ error_code: 'invalid_credentials', msg: PRIVATE }, 400)
      return json({ user: options.signinUser !== undefined ? options.signinUser : { id: UID, email: EMAIL }, access_token: TOKEN, refresh_token: 'SYNTHETIC_REFRESH' })
    }
    if (url.endsWith('/rpc/license_activate_grant')) {
      state.rpcCalls++
      eq(config.headers?.apikey, 'SYNTHETIC_SERVICE')
      eq(JSON.parse(config.body as string), { p_license_key: 'SYNTHETIC_LICENSE', p_email: EMAIL, p_user_id: UID, p_seed_uses: options.omitUses ? 0 : options.uses ?? 0 })
      if (options.grantReply !== undefined) return json(options.grantReply)
      if (options.cap) return json({ ok: false, new_redemption: false, reason: 'cap-reached' })
      if (state.rpcCalls === 1 && options.grantFault === 'before-commit') throw new TypeError(PRIVATE)
      if (state.rpcCalls === 1 && options.grantFault === 'http500') return json({ msg: PRIVATE }, 500)
      const fresh = !state.ledger
      state.ledger = true; state.entitlement = true
      if (state.rpcCalls === 1 && options.grantFault === 'after-commit') throw new TypeError(PRIVATE)
      return json({ ok: true, new_redemption: fresh })
    }
    if (/\/admin\/users\//.test(url)) state.deletes++
    throw new Error('Unexpected route: real network is forbidden')
  }
  return state
}
async function call(expected: number) {
  const response = await handler!(request()), text = await response.text()
  eq(response.status, expected)
  if ([PRIVATE, TOKEN, UID, OTHER, PASSWORD, 'SYNTHETIC_REFRESH'].some((v) => text.includes(v))) throw new Error('Private proof leaked in response')
  return JSON.parse(text)
}

for (const fault of ['before-commit', 'http500'] as const) Deno.test(`${fault}: failed grant never200; correct original password retry repairs one ledger and entitlement`, () => withState({ grantFault: fault }, async (s) => {
  await call(503); eq(s.authExists, true); eq(s.ledger, false); eq(s.entitlement, false); eq(s.increments, 0)
  await call(200); eq(s.proofs, 1); eq(s.ledger, true); eq(s.entitlement, true); eq(s.increments, 1); eq(s.deletes, 0)
  await call(200); eq(s.proofs, 2); eq(s.increments, 1); eq(s.rpcCalls, 3)
}))
Deno.test('lost RPC response after commit: same Email claim retries idempotently with no extra provider use', () => withState({ grantFault: 'after-commit' }, async (s) => {
  await call(503); eq(s.ledger, true); eq(s.entitlement, true); eq(s.increments, 0)
  await call(200); eq(s.increments, 0); eq(s.proofs, 1); eq(s.deletes, 0)
}))
Deno.test('existing original password proves ownership before repair, and client-supplied UID is ignored', () => withState({ existing: true }, async (s) => {
  await call(200); eq(s.proofs, 1); eq(s.rpcCalls, 1); eq(s.ledger, true); eq(s.entitlement, true)
}))
Deno.test('receipt/license with wrong existing password cannot grant or reset a target account', () => withState({ existing: true, passwordRejected: true }, async (s) => {
  await call(409); eq(s.rpcCalls, 0); eq(s.entitlement, false); eq(s.deletes, 0)
}))
for (const user of [{ id: OTHER, email: 'different@example.invalid' }, { id: UID, email: 'different@example.invalid' }, { id: 'not-a-uuid', email: EMAIL }, null])
  Deno.test('password proof missing/mismatched user cannot become a grant UID', () => withState({ existing: true, signinUser: user }, async (s) => { await call(503); eq(s.rpcCalls, 0); eq(s.deletes, 0) }))
for (const options of [{ existing: true, signinFault: true }, { createFault: true }, { existing: true, missingAnon: true }])
  Deno.test('Auth network/configuration failures are503 with no grant or destructive compensation', () => withState(options, async (s) => { await call(503); eq(s.rpcCalls, 0); eq(s.increments, 0); eq(s.deletes, 0) }))
Deno.test('cap refusal grants no new entitlement and deletes neither new nor existing Auth account', () => withState({ cap: true }, async (s) => {
  await call(403); eq(s.authExists, true); eq(s.ledger, false); eq(s.entitlement, false); eq(s.increments, 0); eq(s.deletes, 0)
  await call(403); eq(s.proofs, 1); eq(s.entitlement, false); eq(s.deletes, 0)
}))
for (const reply of [null, [], {}, { ok: true }, { ok: 'true', new_redemption: false }, { ok: true, new_redemption: 'false' }, { ok: false, new_redemption: true }, { ok: false, new_redemption: false, reason: 'owner-mismatch' }])
  Deno.test('malformed/failed RPC contract is not reported as successful activation', () => withState({ grantReply: reply }, async (s) => { await call(503); eq(s.increments, 0); eq(s.deletes, 0) }))
for (const uses of [-1, 1.5, '0', null, 2147483648, Number.MAX_SAFE_INTEGER + 1])
  Deno.test(`explicit malformed uses ${JSON.stringify(uses)} is rejected before Auth`, () => withState({ uses }, async (s) => { await call(503); eq(s.calls.some((v) => v.includes('/auth/')), false); eq(s.rpcCalls, 0) }))
Deno.test('legacy omitted uses remains0 with valid activation', () => withState({ omitUses: true }, async () => { await call(200) }))
Deno.test('HTTP404 with success true is provider-unavailable, never a valid grant', () => withState({ providerStatus: 404 }, async (s) => { await call(503); eq(s.rpcCalls, 0); eq(s.authExists, false) }))
Deno.test('HTTP200 with success false is inconsistent provider data, not an invalid-license claim', () => withState({ providerSuccess: false }, async (s) => { await call(503); eq(s.rpcCalls, 0) }))
Deno.test('limiter service failure is503 rather than a false exhausted-quota claim', () => withState({ limiterFault: true }, async (s) => { await call(503); eq(s.rpcCalls, 0); eq(s.authExists, false) }))
Deno.test('uncertain counter is not blindly retried and safe logs contain no buyer/proof/body', () => withState({ counterFault: true }, async (s) => {
  await call(200); await call(200); eq(s.increments, 1)
  const logs = JSON.stringify(s.logs)
  if ([EMAIL, PRIVATE, TOKEN, UID, PASSWORD, 'SYNTHETIC_LICENSE'].some((v) => logs.includes(v))) throw new Error('Private proof leaked in logs')
  eq(s.logs.length, 1)
}))
