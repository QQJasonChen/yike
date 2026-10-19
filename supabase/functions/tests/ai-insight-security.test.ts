// Real handler, synthetic env/accounts/provider only. Deno grants no network/env access.
export {}
type Handler = (request: Request) => Promise<Response>
let handler: Handler
const serve = Deno.serve
Deno.serve = ((fn: Handler) => { handler = fn; return {} as Deno.HttpServer }) as typeof serve
try { await import('../ai-insight/index.ts') } finally { Deno.serve = serve }
const CONTRACT = 'yike-ai-proxy-v1'
const allowed = { contract: CONTRACT, allowed: true, reserved_units: 35192 }
const UID = '00000000-0000-4000-8000-000000000001'
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
type Options = { quota?: unknown; payload?: unknown; rawBody?: BodyInit; signal?: AbortSignal; headers?: Record<string, string>; auth?: unknown; fetcher?: (url: string, init: RequestInit) => Promise<Response> }
function test(name: string, fn: (run: (options?: Options) => Promise<{ res: Response; calls: string[] }>) => Promise<void>) {
  Deno.test(name, async () => {
    const originalGet = Deno.env.get, originalFetch = globalThis.fetch
    Deno.env.get = key => ({ SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', OPENAI_KEY: 'synthetic-ai', YIKE_SERVER_AI_ENABLED: 'enabled-v1' })[key]
    try {
      await fn(async (options = {}) => {
        const calls: string[] = []
        globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
          calls.push(String(url))
          if (options.fetcher) return options.fetcher(String(url), init)
          if (String(url).endsWith('/auth/v1/user')) return reply(options.auth ?? { id: UID })
          if (String(url).endsWith('/rpc/ai_proxy_reserve')) return reply('quota' in options ? options.quota : allowed)
          if (String(url) === 'https://api.openai.com/v1/chat/completions') return reply({ choices: [{ message: { content: 'Synthetic insight' } }] })
          throw new Error('unexpected endpoint')
        }) as typeof fetch
        const res = await handler(new Request('https://app.invalid/ai-insight', {
          method: 'POST', headers: { Authorization: 'Bearer synthetic-user', ...options.headers },
          body: options.rawBody ?? JSON.stringify('payload' in options ? options.payload : { prompt: 'Review', data: 'Synthetic diary' }), signal: options.signal,
        }))
        return { res, calls }
      })
    } finally { Deno.env.get = originalGet; globalThis.fetch = originalFetch }
  })
}
test('AI explicitly enabled request uses fixed proxy contract', async run => {
  const { res, calls } = await run()
  equal(res.status, 200); equal(await res.json(), { text: 'Synthetic insight' }); equal(calls.length, 3)
})
test('AI explicit quota exhaustion never starts paid provider', async run => {
  const { res, calls } = await run({ quota: { contract: CONTRACT, allowed: false, reason: 'quota' } }); equal(res.status, 429); equal(calls.length, 2)
})
for (const quota of [null, true, false, 'true', 1, {}, [], { allowed: true }, { ...allowed, contract: 'other' }, { ...allowed, reserved_units: 0 }, { ...allowed, reserved_units: '35192' }, { ...allowed, reserved_units: 1e20 }]) {
  test(`AI malformed quota ${JSON.stringify(quota)} fails closed`, async run => {
    const { res, calls } = await run({ quota }); equal(res.status, 503); equal(calls.some(url => url.includes('openai.com')), false)
  })
}
for (const payload of [null, [], { data: {} }, { prompt: [], data: 'test' }, { data: '' }]) {
  test(`AI malformed input ${JSON.stringify(payload)} rejects before quota/provider`, async run => {
    const { res, calls } = await run({ payload }); equal(res.status, 400); equal(calls.length, 0)
  })
}
test('AI actual UTF8 cap rejects dishonest Content-Length before upstream work', async run => {
  const { res, calls } = await run({ payload: { data: '繁'.repeat(12000) }, headers: { 'content-length': '1' } })
  equal(res.status, 413); equal(calls.length, 0)
})
test('AI missing bearer does not contact auth/quota/provider', async run => {
  const { res, calls } = await run({ headers: { Authorization: '' } }); equal(res.status, 401); equal(calls.length, 0)
})
test('AI invalid auth identity cannot become service-role quota input', async run => {
  const { res, calls } = await run({ auth: { id: '../other' } }); equal(res.status, 401); equal(calls.length, 1)
})
test('AI malformed limiter JSON yields safe unavailable response', async run => {
  const { res, calls } = await run({ fetcher: async url => url.endsWith('/auth/v1/user') ? reply({ id: UID }) : new Response('not-json') })
  equal(res.status, 503); equal(calls.length, 2)
})
test('AI outbound requests reject redirects and have bounded deadlines', async run => {
  const { res } = await run({ fetcher: async (url, init) => {
    equal(init.redirect, 'error'); equal(init.signal instanceof AbortSignal, true)
    if (url.endsWith('/auth/v1/user')) return reply({ id: UID })
    if (url.endsWith('/rpc/ai_proxy_reserve')) return reply(allowed)
    return reply({ choices: [{ message: { content: 'Synthetic insight' } }] })
  } }); equal(res.status, 200)
})
test('AI stalled upstream body is cancelled under deadline', async run => {
  const original = globalThis.setTimeout
  globalThis.setTimeout = ((fn: Parameters<typeof setTimeout>[0], ms?: number) => original(fn, ms === 8000 ? 5 : ms)) as typeof setTimeout
  let cancelled = false
  try {
    const { res, calls } = await run({ fetcher: async () => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })) })
    equal(res.status, 503); equal(calls.length, 1); equal(cancelled, true)
  } finally { globalThis.setTimeout = original }
})
test('AI overlarge provider reply never reports success', async run => {
  const { res } = await run({ fetcher: async url => {
    if (url.endsWith('/auth/v1/user')) return reply({ id: UID })
    if (url.endsWith('/rpc/ai_proxy_reserve')) return reply(allowed)
    return reply({ choices: [{ message: { content: 'x'.repeat(70000) } }] })
  } }); equal(res.status, 502)
})
// N4 regression: absent/ambiguous opt-in must never create a paid request.
for (const value of [undefined, '', 'true', '1']) {
  test(`AI proxy requires exact explicit opt-in: ${String(value)}`, async run => {
    const get = Deno.env.get
    Deno.env.get = key => key === 'YIKE_SERVER_AI_ENABLED' ? value : get(key)
    const { res, calls } = await run()
    equal(res.status, 503); equal(calls.length, 0)
  })
}
test('AI DB opt-in missing/expired/invalid config never starts provider', async run => {
  const { res, calls } = await run({ quota: { contract: CONTRACT, allowed: false, reason: 'config' } })
  equal(res.status, 503); equal(calls.some(url => url.includes('openai.com')), false)
})
test('AI quota transport failure never starts provider', async run => {
  const { res, calls } = await run({ fetcher: async url => url.endsWith('/auth/v1/user') ? reply({ id: UID }) : reply(allowed, 500) })
  equal(res.status, 503); equal(calls.length, 2)
})
test('AI caller cannot select model, quota, UID or cost; reservation precedes one bounded provider call', async run => {
  const steps: string[] = []
  const { res } = await run({ payload: { data: '繁'.repeat(6000), prompt: 'x'.repeat(1200), model: 'attacker', uid: 'attacker', cap: 1e9, reserved_units: 0 }, fetcher: async (url, init) => {
    steps.push(url)
    if (url.endsWith('/auth/v1/user')) return reply({ id: UID })
    if (url.endsWith('/rpc/ai_proxy_reserve')) {
      equal(JSON.parse(String(init.body)), { uid: UID, contract: CONTRACT }); return reply(allowed)
    }
    equal(steps.length, 3)
    const payload = JSON.parse(String(init.body))
    equal(payload.model, 'gpt-4o-mini-2024-07-18'); equal(payload.max_tokens, 700)
    equal(new TextEncoder().encode(JSON.stringify(payload.messages)).byteLength <= 32768, true)
    equal(payload.tools, undefined); equal(payload.n, undefined)
    return reply({ choices: [{ message: { content: 'bounded' } }] })
  } }); equal(res.status, 200)
})
test('AI provider error/timeout never issues a release or automatic retry', async run => {
  const { res, calls } = await run({ fetcher: async url => {
    if (url.endsWith('/auth/v1/user')) return reply({ id: UID })
    if (url.endsWith('/rpc/ai_proxy_reserve')) return reply(allowed)
    throw new Error('synthetic timeout')
  } }); equal(res.status, 502); equal(calls.length, 3)
})

for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_KEY']) {
  test(`AI missing ${key} rejects before auth/quota/provider`, async run => {
    const get = Deno.env.get
    Deno.env.get = name => name === key ? undefined : get(name)
    const { res, calls } = await run()
    equal(res.status, 503); equal(calls.length, 0)
  })
}
test('AI malformed JSON and blank data reject before quota/provider', async run => {
  for (const rawBody of ['{', JSON.stringify({ data: '  \n\t' })]) {
    const { res, calls } = await run({ rawBody })
    equal(res.status, 400); equal(calls.length, 0)
  }
})
test('AI aborted caller cannot reserve quota or start paid provider', async run => {
  const controller = new AbortController(); controller.abort()
  const { res, calls } = await run({ signal: controller.signal })
  equal(res.status, 408); equal(calls.length, 0)
})
test('AI stalled input is cancelled at body deadline before auth/quota/provider', async run => {
  const original = globalThis.setTimeout
  globalThis.setTimeout = ((fn: Parameters<typeof setTimeout>[0], ms?: number) => original(fn, ms === 5000 ? 5 : ms)) as typeof setTimeout
  let cancelled = false
  try {
    const { res, calls } = await run({ rawBody: new ReadableStream<Uint8Array>({ cancel() { cancelled = true } }) })
    equal(res.status, 408); equal(calls.length, 0); equal(cancelled, true)
  } finally { globalThis.setTimeout = original }
})
for (const phase of ['auth', 'quota', 'provider']) {
  test(`AI ${phase} header timeout aborts without retry or release`, async run => {
    const original = globalThis.setTimeout
    globalThis.setTimeout = ((fn: Parameters<typeof setTimeout>[0], ms?: number) => original(fn, ms === 8000 ? 5 : ms)) as typeof setTimeout
    let aborted = false
    try {
      const { res, calls } = await run({ fetcher: async (url, init) => {
        if (phase !== 'auth' && url.endsWith('/auth/v1/user')) return reply({ id: UID })
        if (phase === 'provider' && url.endsWith('/rpc/ai_proxy_reserve')) return reply(allowed)
        return await new Promise<Response>((_, reject) => {
          init.signal!.addEventListener('abort', () => { aborted = true; reject(new DOMException('synthetic private upstream detail', 'AbortError')) }, { once: true })
        })
      } })
      equal(res.status, phase === 'provider' ? 502 : 503)
      equal(calls.length, phase === 'auth' ? 1 : phase === 'quota' ? 2 : 3)
      equal(aborted, true); equal((await res.text()).includes('synthetic private'), false)
    } finally { globalThis.setTimeout = original }
  })
}
for (const phase of ['quota', 'provider']) {
  test(`AI ${phase} stalled response body is cancelled without retry or release`, async run => {
    const original = globalThis.setTimeout
    globalThis.setTimeout = ((fn: Parameters<typeof setTimeout>[0], ms?: number) => original(fn, ms === 8000 ? 5 : ms)) as typeof setTimeout
    let cancelled = false
    try {
      const { res, calls } = await run({ fetcher: async url => {
        if (url.endsWith('/auth/v1/user')) return reply({ id: UID })
        if (phase === 'provider' && url.endsWith('/rpc/ai_proxy_reserve')) return reply(allowed)
        return new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true } }))
      } })
      equal(res.status, phase === 'provider' ? 502 : 503)
      equal(calls.length, phase === 'quota' ? 2 : 3); equal(cancelled, true)
    } finally { globalThis.setTimeout = original }
  })
}
test('AI shared total deadline aborts before the per-upstream deadline', async run => {
  const original = globalThis.setTimeout
  globalThis.setTimeout = ((fn: Parameters<typeof setTimeout>[0], ms?: number) => original(fn, ms === 30000 ? 5 : ms)) as typeof setTimeout
  let aborted = false
  try {
    const { res, calls } = await run({ fetcher: async (_url, init) => await new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => { aborted = true; reject(new DOMException('synthetic budget', 'AbortError')) }, { once: true })
    }) })
    equal(res.status, 503); equal(calls.length, 1); equal(aborted, true)
  } finally { globalThis.setTimeout = original }
})
for (const content of ['', 'x'.repeat(8193), { private: 'synthetic provider detail' }]) {
  test(`AI invalid provider content type/length ${typeof content}/${typeof content === 'string' ? content.length : 0} returns safe error`, async run => {
    const { res, calls } = await run({ fetcher: async url => {
      if (url.endsWith('/auth/v1/user')) return reply({ id: UID })
      if (url.endsWith('/rpc/ai_proxy_reserve')) return reply(allowed)
      return reply({ choices: [{ message: { content } }] })
    } })
    equal(res.status, 502); equal(calls.length, 3)
    equal((await res.text()).includes('synthetic provider detail'), false)
  })
}
test('AI auth/quota/provider non-success errors cancel upstream bodies without exposing details', async run => {
  for (const phase of ['auth', 'quota', 'provider']) {
    let cancelled = false
    const { res, calls } = await run({ fetcher: async url => {
      if (phase !== 'auth' && url.endsWith('/auth/v1/user')) return reply({ id: UID })
      if (phase === 'provider' && url.endsWith('/rpc/ai_proxy_reserve')) return reply(allowed)
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode('synthetic private error')) },
        cancel() { cancelled = true },
      }), { status: 500 })
    } })
    equal(res.status, phase === 'auth' ? 401 : phase === 'quota' ? 503 : 502)
    equal(calls.length, phase === 'auth' ? 1 : phase === 'quota' ? 2 : 3)
    equal(cancelled, true); equal((await res.text()).includes('synthetic private'), false)
  }
})
