// Focused actual-handler regressions only. Every identity, key, response and fetch is synthetic.
type Handler = (request: Request) => Promise<Response>
let handler: Handler
const originalServe = Deno.serve
Deno.serve = ((fn: Handler) => { handler = fn; return {} as Deno.HttpServer }) as typeof Deno.serve
try { await import('../activate/index.ts') } finally { Deno.serve = originalServe }
const eq = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const EMAIL = 'synthetic-buyer@example.invalid'
const MARKER = 'SYNTHETIC_PRIVATE_UPSTREAM_DETAIL'
const env: Record<string, string> = { SUPABASE_URL: 'https://database.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'SYNTHETIC_ONLY', SUPABASE_ANON_KEY: 'SYNTHETIC_PUBLIC', GUMROAD_PRODUCT_ID: 'SYNTHETIC_PRODUCT' }

function scenario(name: string, purchase: Record<string, unknown>, expectedStatus: number,
  expectedCode?: string, authBody: unknown = { id: '00000000-0000-4000-8000-000000000001', email: EMAIL }, authStatus = 200) {
  Deno.test(name, async () => {
    const savedGet = Deno.env.get, savedFetch = globalThis.fetch
    const calls: string[] = [], verifyModes: string[] = []
    Deno.env.get = (key) => env[key]
    globalThis.fetch = async (input, init) => {
      const url = String(input); calls.push(url)
      if (url.endsWith('/rpc/rate_limit_bump')) return json(true)
      if (url === 'https://api.gumroad.com/v2/licenses/verify') {
        verifyModes.push(new URLSearchParams((init as { body?: BodyInit } | undefined)?.body as string).get('increment_uses_count')!)
        return json({ success: true, uses: 0, purchase: { email: EMAIL, ...purchase } })
      }
      if (url.endsWith('/auth/v1/admin/users')) return json(authBody, authStatus)
      if (url.endsWith('/auth/v1/token?grant_type=password')) return json({ error_code: 'invalid_credentials' }, 400)
      if (url.endsWith('/rpc/license_activate_grant')) return json({ ok: true, new_redemption: true })
      throw new Error('Unexpected request: no real network is permitted')
    }
    try {
      const response = await handler!(new Request('https://app.example.invalid/activate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: 'SYNTHETIC_LICENSE', email: EMAIL, password: 'synthetic-password' }),
      }))
      eq(response.status, expectedStatus)
      const text = await response.text(), body = JSON.parse(text)
      if (text.includes(MARKER)) throw new Error('Response leaked upstream details')
      if (expectedCode) eq(body.code, expectedCode)
      if (expectedStatus !== 200) {
        eq(verifyModes, ['false'])
        eq(calls.some((url) => url.endsWith('/rpc/license_activate_grant')), false)
        eq(calls.some((url) => /\/admin\/users\//.test(url)), false) // no rollback/delete on rejected input
      } else {
        eq(body.ok, true); eq(verifyModes, ['false', 'true'])
        eq(calls.some((url) => url.endsWith('/rpc/license_activate_grant')), true)
      }
      if (expectedCode === 'purchase-disputed' || (expectedStatus === 503 && authStatus === 200 && 'id' in (authBody as object)))
        eq(calls.some((url) => url.endsWith('/auth/v1/admin/users')), false)
      if (expectedStatus === 409) {
        if (!body.error.includes('原本的 Yike 密碼登入')) throw new Error('Known account should direct to existing login')
      } else if (expectedStatus === 422) {
        if (body.error.includes('已經開通') || body.error.includes('直接用它登入')) throw new Error('Validation rejection must not impersonate an existing account')
      }
    } finally { Deno.env.get = savedGet; globalThis.fetch = savedFetch }
  })
}

scenario('unresolved dispute true with missing outcome rejects before account creation', { disputed: true }, 403, 'purchase-disputed')
scenario('unresolved dispute true and dispute_won false rejects before account creation', { disputed: true, dispute_won: false }, 403, 'purchase-disputed')
scenario('explicitly won dispute permits new activation', { disputed: true, dispute_won: true }, 200)
scenario('omitted dispute flags retain legacy-compatible activation', {}, 200)
scenario('explicit false dispute remains valid', { disputed: false, dispute_won: false }, 200)
scenario('refund still rejects even when dispute was won', { disputed: true, dispute_won: true, refunded: true }, 403)
for (const value of ['true', 'false', 0, 1, null]) {
  scenario(`malformed disputed ${JSON.stringify(value)} is unavailable, never accepted by coercion`, { disputed: value }, 503)
  scenario(`malformed dispute_won ${JSON.stringify(value)} is unavailable, never accepted by coercion`, { disputed: true, dispute_won: value }, 503)
}
for (const field of ['code', 'error_code']) for (const value of ['email_exists', 'user_already_exists'])
  scenario(`official ${field} ${value} maps existing account to409`, {}, 409, undefined, { [field]: value, msg: MARKER }, 422)
scenario('legacy numeric HTTP code with official error_code remains compatible', {}, 409, undefined, { code: 422, error_code: 'email_exists', msg: MARKER }, 422)
scenario('existing-account error is identified by code even with HTTP400', {}, 409, undefined, { error_code: 'email_exists' }, 400)
scenario('weak password422 has a safe password-specific rejection, not existing-account advice', {}, 422, 'password-rejected', { error_code: 'weak_password', msg: MARKER }, 422)
scenario('invalid email422 has safe input rejection, not existing-account advice', {}, 422, 'account-creation-rejected', { code: 'email_address_invalid', message: MARKER }, 422)
scenario('validation failed422 stays validation rejection', {}, 422, 'account-creation-rejected', { error_code: 'validation_failed', msg: MARKER }, 422)
scenario('unknown422 with misleading already-exists text must not select login', {}, 422, 'account-creation-rejected', { msg: `already registered ${MARKER}` }, 422)
scenario('numeric code422 alone is not an existing-account signal', {}, 422, 'account-creation-rejected', { code: 422, msg: MARKER }, 422)
scenario('conflicting official code fields fail safely instead of guessing an existing account', {}, 422, 'account-creation-rejected', { code: 'weak_password', error_code: 'email_exists', msg: MARKER }, 422)
scenario('null422 payload remains a safe rejection', {}, 422, 'account-creation-rejected', null, 422)
scenario('array422 payload remains a safe rejection', {}, 422, 'account-creation-rejected', [MARKER], 422)
scenario('Auth429 remains a rate-limit failure with no redemption', {}, 429, 'account-rate-limited', { msg: MARKER }, 429)
scenario('Auth500 does not echo private detail or claim that creation definitely failed', {}, 503, 'activation-result-unconfirmed', { msg: MARKER }, 500)
scenario('Auth200 without a created id is unconfirmed and never redeems', {}, 503, 'activation-result-unconfirmed', { msg: MARKER }, 200)
