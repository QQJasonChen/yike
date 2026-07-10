// iOS 內購開通：驗證 RevenueCat entitlement → 建立 Supabase 帳號。
// 跟 activate（Gumroad 序號版）平行的第三條開通路徑：
//   Gumroad 序號 / Portaly 白名單 / ★ Apple IAP（this）
// 部署：supabase functions deploy iap-activate --no-verify-jwt
// 秘密：supabase secrets set REVENUECAT_SECRET=sk_xxx（RevenueCat 的 Secret API key，絕不進前端）

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

const ENTITLEMENT = 'sync'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  let appUserId = '', email = '', password = ''
  try {
    const body = await req.json()
    appUserId = String(body.appUserId ?? '').trim()
    email = String(body.email ?? '').trim().toLowerCase()
    password = String(body.password ?? '')
  } catch {
    return json(400, { error: '格式錯誤' })
  }
  if (!appUserId) return json(400, { error: '缺少購買資訊，請先完成購買或恢復購買' })
  if (!email.includes('@') || password.length < 8)
    return json(400, { error: '請填寫 Email 與至少 8 碼的密碼' })

  // 1) 向 RevenueCat 驗證這個 app user 真的擁有 sync entitlement（伺服器端驗證，防偽造請求）
  const rcSecret = Deno.env.get('REVENUECAT_SECRET')
  if (!rcSecret) return json(500, { error: '伺服器尚未設定（REVENUECAT_SECRET）' })
  const rcRes = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    { headers: { Authorization: `Bearer ${rcSecret}` } }
  )
  if (!rcRes.ok) return json(403, { error: '驗證購買失敗，請稍後再試或聯絡我們' })
  const sub = (await rcRes.json().catch(() => ({}))) as {
    subscriber?: { entitlements?: Record<string, { expires_date: string | null }> }
  }
  const ent = sub.subscriber?.entitlements?.[ENTITLEMENT]
  // 買斷制（非消耗型）expires_date = null；訂閱制要沒過期
  const active = ent !== undefined && (ent.expires_date === null || new Date(ent.expires_date) > new Date())
  if (!active) return json(403, { error: '找不到有效的購買記錄——請先在 App 內完成購買或恢復購買' })

  // 2) 建帳號（跟 activate 相同的 admin API 流程）
  const url = Deno.env.get('SUPABASE_URL')!
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const createRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const created = await createRes.json().catch(() => ({}))
  if (createRes.ok && created.id) return json(200, { ok: true })
  const msg = String(created.msg ?? created.message ?? '')
  if (/already.*(registered|exists)/i.test(msg) || createRes.status === 422)
    return json(409, { error: '這個 Email 已經開通過——直接用它登入即可' })
  return json(500, { error: `開通失敗：${msg || createRes.status}` })
})
