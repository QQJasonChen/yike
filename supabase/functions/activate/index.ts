// 付費自動開通：驗證 Gumroad 序號 → 建立 Supabase 帳號
// 部署：supabase functions deploy activate --no-verify-jwt
// 環境：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由平台自動注入；
//       GUMROAD_PERMALINK 用 supabase secrets set 設定（預設 'yike'）

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  let licenseKey = '', email = '', password = ''
  try {
    const body = await req.json()
    licenseKey = String(body.licenseKey ?? '').trim()
    email = String(body.email ?? '').trim().toLowerCase()
    password = String(body.password ?? '')
  } catch {
    return json(400, { error: '格式錯誤' })
  }
  if (!email.includes('@') || password.length < 8)
    return json(400, { error: '請填寫 Email 與至少 8 碼的密碼' })

  const url = Deno.env.get('SUPABASE_URL')!
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 路徑 A：沒帶序號 → 查付費白名單（Portaly / 手動邀請）
  if (!licenseKey) {
    const q = await fetch(
      `${url}/rest/v1/entitlements?email=eq.${encodeURIComponent(email)}&select=email`,
      { headers: { apikey: srk, Authorization: `Bearer ${srk}` } }
    )
    const rows = (await q.json().catch(() => [])) as unknown[]
    if (!Array.isArray(rows) || rows.length === 0)
      return json(403, { error: 'not-entitled' })
    const user = await createUser(url, srk, email, password)
    if (user.ok) {
      await fetch(`${url}/rest/v1/entitlements?email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ redeemed_at: new Date().toISOString() }),
      })
    }
    return user.response
  }

  // 路徑 B：帶序號 → 向 Gumroad 驗證（會累計啟用次數）
  const permalink = Deno.env.get('GUMROAD_PERMALINK') ?? 'yike'
  const gumRes = await fetch('https://api.gumroad.com/v2/licenses/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      product_permalink: permalink,
      license_key: licenseKey,
      increment_uses_count: 'true',
    }),
  })
  const gum = await gumRes.json().catch(() => ({}))
  if (!gum.success) return json(403, { error: '序號無效——請確認購買信裡的 License Key' })
  const purchase = gum.purchase ?? {}
  if (purchase.refunded || purchase.chargebacked)
    return json(403, { error: '此序號的訂單已退款，無法啟用' })
  if ((gum.uses ?? 0) > 10)
    return json(403, { error: '此序號啟用次數已達上限，請聯繫站方' })

  // 2) 建立帳號（service role）
  return (await createUser(url, srk, email, password)).response
})

async function createUser(
  url: string,
  srk: string,
  email: string,
  password: string
): Promise<{ ok: boolean; response: Response }> {
  const createRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const created = await createRes.json().catch(() => ({}))
  if (createRes.ok && created.id) return { ok: true, response: json(200, { ok: true }) }
  const msg = String(created.msg ?? created.message ?? '')
  if (/already.*(registered|exists)/i.test(msg) || createRes.status === 422)
    return { ok: false, response: json(409, { error: '這個 Email 已經開通過——直接用它登入即可' }) }
  return { ok: false, response: json(500, { error: `開通失敗：${msg || createRes.status}` }) }
}
