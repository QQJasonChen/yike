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

  // 節流。activate 是唯一不需登入、卻能建立帳號並打外部 API 的入口，
  // 沒有節流時：共用邀請碼可被腳本無限開帳號（每個帳號每天 15 次 AI，燒站方的
  // OpenAI key）、Gumroad 序號可被無限暴力猜、409/403 的差異可用來列舉 email。
  // 真人一輩子只會開通一兩次，所以額度可以抓得很緊。
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('cf-connecting-ip') ||
    'unknown'
  const bump = async (key: string, cap: number, windowSeconds = 3600) => {
    const r = await fetch(`${url}/rest/v1/rpc/rate_limit_bump`, {
      method: 'POST',
      headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: key, cap, window_seconds: windowSeconds }),
    })
    // fail-closed：計數器壞掉就擋，不要因為節流故障而變成完全不設防
    if (!r.ok) {
      console.error('rate_limit_bump 失敗', r.status, await r.text().catch(() => ''))
      return false
    }
    return (await r.json()) === true
  }
  // 額度校準（2026-09-01）：原本抓 IP 20 / email 5，理由是「真人一輩子只會開通一兩次」。
  // 錯了。實際看節流表，一個真實使用者在一小時內試了 13 次才成功，另一個試 3 次就放棄且
  // 至今沒有帳號。開通流程本身夠讓人困惑，卡住的人會反覆重試——把重試當成攻擊來擋，
  // 擋掉的是真人不是腳本（腳本一小時打幾千次，這個級距怎麼設都攔得住）。
  if (!(await bump(`act:ip:${ip}`, 40)) || !(await bump(`act:email:${email}`, 20)))
    return json(429, {
      error:
        '嘗試次數過多，請一小時後再試。如果你已經付款卻一直開不通，別再試了——直接回覆購買信給我，我手動幫你開通。',
    })

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

  // 路徑 B0：邀請碼（免費試用）→ 比對 INVITE_CODES（逗號分隔，可多組/隨時輪替）→ 直接建帳號
  const inviteCodes = (Deno.env.get('INVITE_CODES') ?? '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
  if (inviteCodes.length > 0 && inviteCodes.includes(licenseKey.toUpperCase())) {
    return (await createUser(url, srk, email, password)).response
  }

  // 路徑 B：帶序號 → 向 Gumroad 驗證（會累計啟用次數）
  const permalink = Deno.env.get('GUMROAD_PERMALINK') ?? 'yike'
  // 先「不計次」驗證。原本每次呼叫都 increment_uses_count=true，代表使用者
  // 每打錯一次就燒掉一次額度——實測有真人試了 13 次才成功。計次要留給
  // 「真的開通成功」那一刻，不是留給每一次嘗試。
  const verify = (increment: boolean) =>
    fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        product_permalink: permalink,
        license_key: licenseKey,
        increment_uses_count: increment ? 'true' : 'false',
      }),
    })

  const gumRes = await verify(false)
  const gum = await gumRes.json().catch(() => ({}))
  if (!gum.success) return json(403, { error: '序號無效——請確認購買信裡的 License Key' })
  const purchase = gum.purchase ?? {}
  if (purchase.refunded || purchase.chargebacked)
    return json(403, { error: '此序號的訂單已退款，無法啟用' })
  // 一筆購買開一個帳號；留 3 次是給換裝置、打錯、重設密碼的空間。
  // 原本是 10，等於一組序號可以分給 9 個朋友共用。
  //
  // 用資料庫的原子計數器，不是只看 Gumroad 回報的 uses（Codex 互審 #6）：
  // 「查 uses → 建帳號 → 回頭計次」中間有窗，同一組序號用不同 email 並行送進來，
  // 每一個都會看到 uses < 3 而全部放行。rate_limit_bump 是 insert…on conflict…
  // returning 後才判斷，先加再比，沒有這個窗。窗期設一年當作「總量」用。
  if ((gum.uses ?? 0) >= 3)
    return json(403, {
      error: '此序號的啟用次數已用完。如果你是本人要重新開通，直接回覆購買信給我。',
    })

  // 2) 建立帳號（service role）
  const created = await createUser(url, srk, email, password)

  // 額度只在「真的建成帳號」時扣。不能在建立前先扣——開通失敗（例如 email 已註冊、
  // 密碼太短、使用者打錯重試）也會燒掉序號額度，那正是幾小時前才修過的
  // 「把重試當成攻擊」同一個錯誤。
  // 原子計數器擋的是並行：同一組序號用不同 email 同時送進來，Gumroad 的 uses
  // 來不及反映，資料庫這邊的 insert…on conflict…returning 會擋下超額的那些。
  if (created.ok && created.userId) {
    const within = await bump(`lic:${licenseKey.toUpperCase()}`, 3, 31536000)
    if (!within) {
      // 並行競爭輸了：把剛建的帳號收回去，不留下一個超額的帳號
      await fetch(`${url}/auth/v1/admin/users/${created.userId}`, {
        method: 'DELETE',
        headers: { apikey: srk, Authorization: `Bearer ${srk}` },
      }).catch(() => {})
      return json(403, {
        error: '此序號的啟用次數已用完。如果你是本人要重新開通，直接回覆購買信給我。',
      })
    }
  }
  // 只有真的建成帳號才計次
  if (created.ok) {
    // 計次失敗要留紀錄。原本 .catch(() => {}) 吞掉錯誤，Gumroad 那邊的次數
    // 沒加到卻回報開通成功，額度就默默失效了。
    // （資料庫那邊的 licSlot 已經先扣過，所以總量仍受控，這裡是為了對帳。）
    try {
      const inc = await verify(true)
      if (!inc.ok) console.error('Gumroad 計次失敗', inc.status, await inc.text().catch(() => ''))
    } catch (e) {
      console.error('Gumroad 計次例外', String(e))
    }
    // 記下是哪筆購買、用什麼 email 開的，之後對帳與客服查得到
    await fetch(`${url}/rest/v1/entitlements`, {
      method: 'POST',
      headers: {
        apikey: srk,
        Authorization: `Bearer ${srk}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        email,
        source: 'gumroad-license',
        redeemed_at: new Date().toISOString(),
        raw: { purchase_email: purchase.email ?? null, license_uses: gum.uses ?? 0 },
      }),
    }).catch(() => {})
  }
  return created.response
})

async function createUser(
  url: string,
  srk: string,
  email: string,
  password: string
): Promise<{ ok: boolean; response: Response; userId?: string }> {
  const createRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const created = await createRes.json().catch(() => ({}))
  if (createRes.ok && created.id)
    return { ok: true, response: json(200, { ok: true }), userId: String(created.id) }
  const msg = String(created.msg ?? created.message ?? '')
  if (/already.*(registered|exists)/i.test(msg) || createRes.status === 422)
    return { ok: false, response: json(409, { error: '這個 Email 已經開通過——直接用它登入即可' }) }
  return { ok: false, response: json(500, { error: `開通失敗：${msg || createRes.status}` }) }
}
