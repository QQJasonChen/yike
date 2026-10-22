// 給 AI 助理的唯讀 API。
//
// 使用者在設定頁產生 token（yk_…），交給任何 agent；agent 帶 Bearer token 來這裡讀他自己的手帳。
// 這支 function 用 service role 查 agent_tokens（hash → user_id），然後**只讀那個 user 的** journal 列。
// 只有 GET，沒有寫入：寫入要走現有同步協定（client_id / base_updated_at），否則會蓋掉手機上剛打的字。
// 純邏輯（路由、白名單、日期檢查）在 logic.ts，deno test 測得到。
//
// 部署：Management API multipart（index.ts + logic.ts），verify_jwt=false——它自己驗 token。
import { SCHEMA, bearerOf, isReadableKey, paginate, parseRoute, sha256Hex } from './logic.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })

/** 不在 API 回應裡的欄位。journal 列本來就只有這幾欄，列出來是給未來加欄位時擋一道。 */
const row = (r: { key: string; value: unknown; updated_at: string }) => ({
  key: r.key,
  updated_at: r.updated_at,
  entry: r.value,
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'GET') return json(405, { error: '只有 GET。這是唯讀 API，沒有寫入。' })

  const route = parseRoute(new URL(req.url))
  if (route.kind === 'bad') return json(route.status, { error: route.error })
  if (route.kind === 'schema') return json(200, SCHEMA)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !srk) return json(500, { error: '伺服器設定不完整' })
  const H = { apikey: srk, Authorization: `Bearer ${srk}` }

  // ── 驗 token ──────────────────────────────────────────────
  const tok = bearerOf(req.headers.get('authorization'))
  if (!tok) return json(401, { error: '要帶 Authorization: Bearer yk_…（在 app 設定頁產生）' })
  const hash = await sha256Hex(tok)
  const tq = await fetch(
    `${url}/rest/v1/agent_tokens?token_hash=eq.${hash}&revoked_at=is.null&select=id,user_id,label,scope,created_at`,
    { headers: H }
  )
  if (!tq.ok) return json(500, { error: '驗證 token 失敗' })
  const tokens = (await tq.json().catch(() => [])) as {
    id: string
    user_id: string
    label: string
    scope: string
    created_at: string
  }[]
  const t = tokens[0]
  if (!t) return json(401, { error: 'token 無效或已撤銷' })
  if (t.scope !== 'read') return json(403, { error: '這個 token 沒有讀取權限' })

  // ── 節流：每個 token 每小時 300、每個 IP 每小時 600；計數器壞掉就擋 ──
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const bump = async (k: string, cap: number) => {
    try {
      const r = await fetch(`${url}/rest/v1/rpc/rate_limit_bump`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ k, cap, window_seconds: 3600 }),
      })
      return r.ok && (await r.json()) === true
    } catch {
      return false
    }
  }
  if (!(await bump(`agent:tok:${t.id}`, 300)) || !(await bump(`agent:ip:${ip}`, 600)))
    return json(429, { error: '太頻繁了：每個 token 每小時最多 300 次' })

  // 更新「最後使用」。不等它，失敗也不影響回應。
  void fetch(`${url}/rest/v1/agent_tokens?id=eq.${t.id}`, {
    method: 'PATCH',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch(() => {})

  // ── 讀資料：每一條查詢都帶 user_id=eq.<這個 token 的主人> ──
  const uid = t.user_id
  // 分頁拉：PostgREST 一次最多 1000 列，/keys 對長期使用者會超過（/days 最多 92 列，一頁就夠）
  const q = (filter: string, select = 'key,value,updated_at') =>
    paginate(async (offset, limit) => {
      const r = await fetch(
        `${url}/rest/v1/journal?user_id=eq.${uid}&${filter}&select=${select}&order=key.asc&limit=${limit}&offset=${offset}`,
        { headers: H }
      )
      if (!r.ok) {
        console.error('journal 查詢失敗', r.status)
        return null
      }
      return (await r.json()) as { key: string; value: unknown; updated_at: string }[]
    })

  try {
    if (route.kind === 'me')
      return json(200, { ok: true, label: t.label, scope: t.scope, created_at: t.created_at })

    if (route.kind === 'keys') {
      const rows = await q('key=like.pp%3A*', 'key,updated_at')
      return json(200, { keys: rows.filter((r) => isReadableKey(r.key)) })
    }

    if (route.kind === 'day') {
      const rows = await q(`key=eq.${encodeURIComponent(`pp:day:${route.date}`)}`)
      if (!rows[0]) return json(404, { error: '這一天沒有記錄' })
      return json(200, { date: route.date, ...row(rows[0]) })
    }

    if (route.kind === 'days') {
      const rows = await q(
        `key=gte.${encodeURIComponent(`pp:day:${route.from}`)}&key=lte.${encodeURIComponent(`pp:day:${route.to}`)}`
      )
      return json(200, {
        from: route.from,
        to: route.to,
        days: rows
          .filter((r) => r.key.startsWith('pp:day:'))
          .map((r) => ({ date: r.key.slice('pp:day:'.length), ...row(r) })),
      })
    }

    if (route.kind === 'entry') {
      const rows = await q(`key=eq.${encodeURIComponent(route.key)}`)
      if (!rows[0]) return json(404, { error: '沒有這筆資料' })
      return json(200, row(rows[0]))
    }
  } catch (e) {
    console.error('agent-api', String(e))
    return json(500, { error: '讀取失敗，請稍後再試' })
  }
  return json(404, { error: '沒有這個端點' })
})
