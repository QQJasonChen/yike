// Real delete-account handler; synthetic identities and intercepted fetch only.
type Handler = (req: Request) => Promise<Response>
let handler: Handler
const serve = Deno.serve
Deno.serve = ((fn: Handler) => { handler = fn; return {} as Deno.HttpServer }) as typeof Deno.serve
try { await import('../delete-account/index.ts') } finally { Deno.serve = serve }

const UID = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'
const env: Record<string, string> = {
  SUPABASE_URL: 'https://synthetic-database.invalid',
  SUPABASE_ANON_KEY: 'SYNTHETIC_ANON', SUPABASE_SERVICE_ROLE_KEY: 'SYNTHETIC_SERVICE',
}
const assert = (value: boolean, message: string) => { if (!value) throw new Error(message) }
const json = (value: unknown, status = 200) => Response.json(value, { status })
type Call = { url: string; init?: RequestInit }
type Harness = {
  calls: Call[]; rows: Map<string, number>; users: Set<string>
  auth: () => Response
  remove: (init?: RequestInit) => Promise<Response>
}
async function withHarness(run: (h: Harness) => Promise<void>, missing = '') {
  const savedGet = Deno.env.get, savedFetch = globalThis.fetch
  const h: Harness = {
    calls: [], rows: new Map([[UID, 2], [OTHER, 3]]), users: new Set([UID, OTHER]),
    auth: () => json({ id: UID }),
    remove: async () => { h.users.delete(UID); h.rows.delete(UID); return json({}) },
  }
  Deno.env.get = key => key === missing ? undefined : env[key]
  globalThis.fetch = async (input, init) => {
    const url = String(input); h.calls.push({ url, init })
    if (url === `${env.SUPABASE_URL}/auth/v1/user`) return h.auth()
    // Baseline route is modeled to demonstrate the pre-fix partial data loss.
    if (url === `${env.SUPABASE_URL}/rest/v1/journal?user_id=eq.${UID}`) {
      h.rows.delete(UID); return json({})
    }
    if (url === `${env.SUPABASE_URL}/auth/v1/admin/users/${UID}`) return await h.remove(init)
    throw new Error('Unexpected request: real network is forbidden')
  }
  try { await run(h) } finally { Deno.env.get = savedGet; globalThis.fetch = savedFetch }
}
const invoke = (authorization = 'Bearer SYNTHETIC_USER_JWT', body?: string, signal?: AbortSignal) =>
  handler(new Request('https://synthetic-app.invalid/delete-account', {
    method: 'POST', headers: { Authorization: authorization }, body, signal,
  }))
const unchanged = (h: Harness) => h.rows.get(UID) === 2 && h.rows.get(OTHER) === 3 && h.users.size === 2

Deno.test('delete-account Auth deletion failure preserves journal and all accounts', () => withHarness(async h => {
  h.remove = async () => json({ detail: 'SYNTHETIC_PRIVATE_DETAIL' }, 500)
  const res = await invoke()
  assert(res.status === 503 && unchanged(h), `Partial deletion: HTTP ${res.status}, journal=${h.rows.get(UID)}, accounts=${h.users.size}`)
  assert(!(await res.text()).includes('SYNTHETIC_PRIVATE_DETAIL'), 'Upstream detail escaped')
}))
Deno.test('delete-account only deletes verified UID and relies on Auth cascade', () => withHarness(async h => {
  const res = await invoke('Bearer SYNTHETIC_USER_JWT', JSON.stringify({ user_id: OTHER }))
  assert(res.status === 200 && !h.users.has(UID) && !h.rows.has(UID), 'Verified account was not removed')
  assert(h.users.has(OTHER) && h.rows.get(OTHER) === 3, 'Body-selected victim was changed')
  assert(h.calls.length === 2 && h.calls[1].init?.method === 'DELETE' && !h.calls.some(c => c.url.includes('/rest/')), 'Separate journal deletion remains')
}))
Deno.test('delete-account rejects absent, malformed and oversized bearer credentials without network', () => withHarness(async h => {
  for (const token of ['', 'SYNTHETIC_USER_JWT', 'Bearer a b', `Bearer ${'a'.repeat(8193)}`]) {
    assert((await invoke(token)).status === 401, 'Invalid bearer credential accepted')
  }
  assert(h.calls.length === 0 && unchanged(h), 'Invalid credentials reached upstream')
}))
Deno.test('delete-account invalid JWT never reaches delete', () => withHarness(async h => {
  h.auth = () => json({ detail: 'SYNTHETIC_PRIVATE_DETAIL' }, 401)
  const res = await invoke()
  assert(res.status === 401 && h.calls.length === 1 && unchanged(h), 'Invalid JWT triggered deletion')
  assert(!(await res.text()).includes('SYNTHETIC_PRIVATE_DETAIL'), 'Auth error leaked')
}))
Deno.test('delete-account malformed upstream UID never reaches privileged path', () => withHarness(async h => {
  for (const id of [undefined, OTHER + '/../../users', ['not-a-uuid']]) {
    h.auth = () => json({ id })
    assert((await invoke()).status === 401, 'Unverified UID accepted')
  }
  assert(h.calls.every(c => c.url.endsWith('/auth/v1/user')) && unchanged(h), 'Malformed identity reached delete')
}))
Deno.test('delete-account catches Auth network failure without exposing details', () => withHarness(async h => {
  globalThis.fetch = () => Promise.reject(new Error('SYNTHETIC_PRIVATE_DETAIL'))
  const res = await invoke()
  assert(res.status === 503 && unchanged(h) && !(await res.text()).includes('SYNTHETIC_PRIVATE_DETAIL'), 'Network failure escaped')
}))
Deno.test('delete-account deletion network ambiguity does not remove journal separately', () => withHarness(async h => {
  h.remove = () => Promise.reject(new Error('SYNTHETIC_PRIVATE_DETAIL'))
  const res = await invoke()
  const body = await res.text()
  assert(res.status === 503 && unchanged(h) && body.includes('尚未確認') && !body.includes('SYNTHETIC_PRIVATE_DETAIL'), 'Deletion uncertainty was hidden or data removed first')
}))
Deno.test('delete-account absent service configuration fails before network', () => withHarness(async h => {
  const res = await invoke()
  assert(res.status === 503 && h.calls.length === 0 && unchanged(h), 'Missing service configuration reached network')
}, 'SUPABASE_SERVICE_ROLE_KEY'))
Deno.test('delete-account transport methods preserve preflight without network', () => withHarness(async h => {
  assert((await handler(new Request('https://synthetic-app.invalid', { method: 'OPTIONS' }))).status === 200, 'Preflight failed')
  assert((await handler(new Request('https://synthetic-app.invalid'))).status === 405, 'GET accepted')
  assert(h.calls.length === 0, 'Transport request reached upstream')
}))
Deno.test('delete-account caps streamed Auth identity bytes before deletion', () => withHarness(async h => {
  h.auth = () => json({ id: UID, metadata: 'x'.repeat(262144) })
  const res = await invoke()
  assert(res.status === 503 && h.calls.length === 1 && unchanged(h), 'Oversized Auth identity was consumed or deleted')
}))
Deno.test('delete-account already-aborted request makes no network calls', () => withHarness(async h => {
  const ac = new AbortController(); ac.abort()
  const res = await invoke('Bearer SYNTHETIC_USER_JWT', undefined, ac.signal)
  assert(res.status === 503 && h.calls.length === 0 && unchanged(h), 'Expired request initiated deletion')
}))
Deno.test('delete-account stalled Auth headers and bodies have bounded deadlines', () => withHarness(async h => {
  const timeout = globalThis.setTimeout
  // Exercise actual abort propagation without waiting for production budgets.
  globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    timeout(fn, Math.min(ms ?? 0, 5), ...args)) as typeof setTimeout
  try {
    globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
      const signal = (init as { signal?: AbortSignal })?.signal
      if (signal?.aborted) reject(new DOMException('aborted', 'AbortError'))
      else signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })
    assert((await invoke()).status === 503 && unchanged(h), 'Stalled headers had no deadline')
    let canceled = false
    globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { canceled = true } }))
    assert((await invoke()).status === 503 && unchanged(h) && canceled, 'Stalled identity body had no deadline/cancellation')
  } finally { globalThis.setTimeout = timeout }
}))
Deno.test('delete-account never consumes upstream deletion response body', () => withHarness(async h => {
  let canceled = false
  h.remove = async () => {
    h.users.delete(UID); h.rows.delete(UID)
    return new Response(new ReadableStream({ cancel() { canceled = true; return new Promise(() => {}) } }))
  }
  const res = await invoke()
  assert(res.status === 200 && canceled, 'Deletion response body delayed success')
}))
