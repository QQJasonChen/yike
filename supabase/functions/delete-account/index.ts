// 永久刪除帳號（App Store 5.1.1(v) 強制：能註冊就要能在 app 內刪除帳號）
// 流程：驗證使用者 JWT → 刪掉 auth 帳號，journal 由外鍵同交易 cascade。
// 不先獨立刪 journal，避免 Auth 刪除失敗時帳號仍在、手帳卻已消失。
// 部署：supabase functions deploy delete-account
// 環境：SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 由平台自動注入

import { readBoundedJson } from '../_shared/boundedBody.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

// Bound both headers and identity body reads; never consume/reflect admin errors.
const upstream = async (url: string, init: RequestInit, budget: AbortSignal, identity = false) => {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 8000)
  const signal = AbortSignal.any([budget, ac.signal])
  try {
    signal.throwIfAborted()
    const response = await fetch(url, { ...init, redirect: 'error', signal })
    if (!response.ok || !identity) {
      void response.body?.cancel().catch(() => {})
      return { response, body: null }
    }
    const body = await readBoundedJson(
      { headers: response.headers, body: response.body, signal } as Request,
      262144, 8000, signal,
    )
    return { response, body }
  } finally { clearTimeout(timer) }
}
const unavailable = '刪除服務暫時無法使用，請稍後再試。'
const uncertain = '刪除結果尚未確認。請先確認登入狀態；若仍可登入再重試，如有疑問請聯絡客服。'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  // 1) 從 Authorization 取使用者 JWT，向 GoTrue 驗證身分
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1]
  if (!token || token.length > 8192) return json(401, { error: '請先登入' })

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !srk) return json(503, { error: unavailable })

  let deleting = false
  try {
    const me = await upstream(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
    }, req.signal, true)
    if (!me.response.ok) return json([401, 403].includes(me.response.status) ? 401 : 503,
      { error: [401, 403].includes(me.response.status) ? '登入已過期，請重新登入再刪除' : unavailable })
    const uid = me.body !== null && typeof me.body === 'object' && !Array.isArray(me.body)
      ? (me.body as Record<string, unknown>).id : undefined
    if (typeof uid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid))
      return json(401, { error: '無法確認身分' })

    // 2) Only the verified identity reaches the admin API. auth.users deletion
    // cascades journal and journal_storage_usage atomically through existing FKs.
    // This does not erase ai_usage, payment/redemption records or rate-limit
    // buckets. Their retention policy and metadata cleanup are still incomplete.
    deleting = true
    const delUser = await upstream(`${url}/auth/v1/admin/users/${uid}`, {
      method: 'DELETE',
      headers: { apikey: srk, Authorization: `Bearer ${srk}` },
    }, req.signal)
    if (!delUser.response.ok) return json(503, { error: uncertain })
    return json(200, { ok: true })
  } catch {
    return json(503, { error: deleting ? uncertain : unavailable })
  }
})
