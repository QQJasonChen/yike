// Garmin 官方 Health API：帳號連結（OAuth 2.0 PKCE）＋狀態查詢＋解除連結。
//
// POST { action: 'status' }                  → { configured, linked }
// POST { action: 'start', returnTo }         → { url }（前端導去 Garmin 同意頁）
// GET  ?code=…&state=…                      ← Garmin 授權完導回這裡（callback）→ 302 回 app
// POST { action: 'unlink' }                  → 通知 Garmin 撤銷 + 刪掉 token 與健康資料
//
// 部署：supabase functions deploy garmin-oauth --no-verify-jwt
//   （callback 是 Garmin 瀏覽器導回，不會帶我們的 JWT；POST 動作在下面自己驗 JWT）
// 必要 secrets（Garmin Connect Developer Program 核准後才拿得到）：
//   supabase secrets set GARMIN_CLIENT_ID=… GARMIN_CLIENT_SECRET=…
// 端點若 Garmin 調整，可用 GARMIN_AUTH_URL / GARMIN_TOKEN_URL / GARMIN_API_BASE 覆寫。

import { API, AUTH_URL, CLIENT_ID, CLIENT_SECRET, SB_URL, db, expiresAt, getLink, tokenRequest, validToken } from '../_shared/garmin.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CALLBACK = `${SB_URL}/functions/v1/garmin-oauth`

// 只准導回自己的網域，避免變成 open redirect
const ALLOWED_RETURN = /^(https:\/\/(yikeday\.com|qqjasonchen\.github\.io)(\/|$)|capacitor:\/\/localhost|http:\/\/localhost(:\d+)?(\/|$))/
const DEFAULT_RETURN = 'https://yikeday.com/'

const userIdFromJwt = async (req: Request): Promise<string | null> => {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })
  if (!r.ok) return null
  const me = (await r.json().catch(() => ({}))) as { id?: string }
  return me.id ?? null
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const randomString = (n = 48) => b64url(crypto.getRandomValues(new Uint8Array(n)))

const challengeOf = async (verifier: string) =>
  b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))

// 連結成功後請 Garmin 回補最近 30 天（Garmin 會非同步推送到 webhook）
const BACKFILL = ['dailies', 'sleeps', 'hrv', 'stressDetails', 'userMetrics', 'pulseox', 'bodyComps']
const backfill = async (token: string) => {
  const end = Math.floor(Date.now() / 1000)
  const start = end - 30 * 86400
  await Promise.allSettled(
    BACKFILL.map((t) =>
      fetch(
        `${API}/wellness-api/rest/backfill/${t}?summaryStartTimeInSeconds=${start}&summaryEndTimeInSeconds=${end}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
    )
  )
}

const redirect = (to: string, status: string) => {
  const u = new URL(to)
  u.searchParams.set('garmin', status)
  return new Response(null, { status: 302, headers: { Location: u.toString() } })
}

const handleCallback = async (url: URL): Promise<Response> => {
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') ?? ''
  const r = await db(`garmin_pkce?state=eq.${encodeURIComponent(state)}&select=*`)
  const pk = ((await r.json().catch(() => [])) as { user_id: string; verifier: string; return_to: string; created_at: string }[])[0]
  if (!pk) return redirect(DEFAULT_RETURN, 'expired')
  await db(`garmin_pkce?state=eq.${encodeURIComponent(state)}`, { method: 'DELETE' })
  const back = pk.return_to
  if (Date.now() - new Date(pk.created_at).getTime() > 10 * 60_000) return redirect(back, 'expired')
  if (!code) return redirect(back, 'denied') // 使用者在 Garmin 頁按了拒絕
  try {
    const t = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      code_verifier: pk.verifier,
      redirect_uri: CALLBACK,
    })
    const idRes = await fetch(`${API}/wellness-api/rest/user/id`, {
      headers: { Authorization: `Bearer ${t.access_token}` },
    })
    const { userId } = (await idRes.json().catch(() => ({}))) as { userId?: string }
    if (!userId) return redirect(back, 'error')
    // 同一個 Garmin 帳號只能連一個一刻帳號：先清掉舊連結
    await db(`garmin_links?garmin_user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' })
    const up = await db('garmin_links', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: pk.user_id,
        garmin_user_id: userId,
        access_token: t.access_token,
        refresh_token: t.refresh_token ?? null,
        expires_at: expiresAt(t),
      }),
    })
    if (!up.ok) return redirect(back, 'error')
    await backfill(t.access_token)
    return redirect(back, 'linked')
  } catch {
    return redirect(back, 'error')
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const configured = Boolean(CLIENT_ID && CLIENT_SECRET)

  if (req.method === 'GET') {
    const url = new URL(req.url)
    if (url.searchParams.has('state')) return handleCallback(url)
    return json(200, { configured })
  }
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  let body: { action?: string; returnTo?: string } = {}
  try {
    body = await req.json()
  } catch {
    return json(400, { error: '格式錯誤' })
  }
  if (!configured) return json(200, { configured: false, linked: false })

  const uid = await userIdFromJwt(req)
  if (!uid) return json(401, { error: '請先登入一刻帳號' })

  if (body.action === 'status') {
    const link = await getLink(uid)
    return json(200, { configured: true, linked: Boolean(link) })
  }

  if (body.action === 'start') {
    const returnTo = body.returnTo && ALLOWED_RETURN.test(body.returnTo) ? body.returnTo : DEFAULT_RETURN
    const verifier = randomString(48)
    const state = randomString(24)
    // 順手清掉過期的暫存
    await db(`garmin_pkce?created_at=lt.${new Date(Date.now() - 3600_000).toISOString()}`, { method: 'DELETE' })
    const ins = await db('garmin_pkce', {
      method: 'POST',
      body: JSON.stringify({ state, user_id: uid, verifier, return_to: returnTo }),
    })
    if (!ins.ok) return json(500, { error: '無法開始連結，請稍後再試' })
    const u = new URL(AUTH_URL)
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('client_id', CLIENT_ID)
    u.searchParams.set('code_challenge', await challengeOf(verifier))
    u.searchParams.set('code_challenge_method', 'S256')
    u.searchParams.set('redirect_uri', CALLBACK)
    u.searchParams.set('state', state)
    return json(200, { url: u.toString() })
  }

  if (body.action === 'unlink') {
    const link = await getLink(uid)
    if (link) {
      try {
        const tok = await validToken(link)
        await fetch(`${API}/wellness-api/rest/user/registration`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tok}` },
        })
      } catch {
        /* Garmin 端撤銷失敗也照樣刪本地 token——使用者要的是「斷開」 */
      }
      await db(`garmin_links?user_id=eq.${uid}`, { method: 'DELETE' })
    }
    await db(`health_daily?user_id=eq.${uid}`, { method: 'DELETE' })
    return json(200, { ok: true })
  }

  return json(400, { error: '未知的動作' })
})
