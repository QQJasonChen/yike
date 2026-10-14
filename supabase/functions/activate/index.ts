// 付費自動開通：驗證 Gumroad 序號 → 建立 Supabase 帳號
// 部署：supabase functions deploy activate --no-verify-jwt
// 環境：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY 由平台自動注入；
//       GUMROAD_PRODUCT_ID 優先使用；未設定時沿用 GUMROAD_PERMALINK（預設 'yike'）
import { BodyReadError, readBoundedJson } from '../_shared/boundedBody.ts'

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
    const body = await readBoundedJson(req, 16 * 1024, 5000)
    if (body === null || typeof body !== 'object' || Array.isArray(body))
      return json(400, { error: '格式錯誤' })
    const data = body as Record<string, unknown>
    if (typeof data.email !== 'string' || typeof data.password !== 'string' ||
        (data.licenseKey !== undefined && typeof data.licenseKey !== 'string'))
      return json(400, { error: '格式錯誤' })
    licenseKey = typeof data.licenseKey === 'string' ? data.licenseKey.trim() : ''
    email = data.email.trim().toLowerCase()
    password = data.password
  } catch (error) {
    if (error instanceof BodyReadError && error.status === 413)
      return json(413, { error: '開通資料超過上限，請確認序號、Email 與密碼後再試。' })
    if (error instanceof BodyReadError && error.status === 408)
      return json(408, { error: '接收開通資料逾時，請確認網路後再試。' })
    return json(400, { error: '格式錯誤' })
  }
  const encoder = new TextEncoder()
  if (encoder.encode(email).byteLength > 254 || password.length > 256 || encoder.encode(licenseKey).byteLength > 256)
    return json(413, { error: '開通資料超過上限，請確認序號、Email 與密碼後再試。' })
  if (!email.includes('@') || password.length < 8)
    return json(400, { error: '請填寫 Email 與至少 8 碼的密碼' })
  // 購買 Email 白名單不是身分證明。僅知道買家 Email 的人不能替買家設定密碼。
  // 新帳號需持有購買序號且 Email 對得上購買；既有帳號照常使用帳密登入。
  if (!licenseKey)
    return json(403, {
      code: 'license-required',
      error: '請填入購買序號（License Key）再開通。可從 Gumroad 購買信的「檢視內容」取得；找不到序號請來信 qqleveragelearning@gmail.com，不必重新購買。',
    })

  const url = Deno.env.get('SUPABASE_URL')!
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 節流。activate 是唯一不需登入、卻能建立帳號並打外部 API 的入口，
  // 沒有節流時：共用邀請碼可被腳本無限開帳號（每個帳號每天 15 次 AI，燒站方的
  // OpenAI key）、Gumroad 序號可被無限暴力猜、409/403 的差異可用來列舉 email。
  // 真人一輩子只會開通一兩次，所以額度可以抓得很緊。
  const forwarded = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown'
  // 只限制計數器 key 的工作量；此處沒有宣稱 client header 是已驗證的來源 IP。
  const ip = forwarded.length > 200 || encoder.encode(forwarded).byteLength > 200
    ? 'oversized-ip-header' : forwarded.split(',')[0].trim() || 'unknown'
  const bump = async (key: string, cap: number, windowSeconds = 3600) => {
    try {
      const r = await fetch(`${url}/rest/v1/rpc/rate_limit_bump`, {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ k: key, cap, window_seconds: windowSeconds }),
      })
      if (!r.ok) {
        console.error('rate_limit_bump 未確認', r.status)
        return 'unavailable'
      }
      const allowed: unknown = await r.json().catch(() => null)
      return allowed === true ? 'ok' : allowed === false ? 'limited' : 'unavailable'
    } catch { return 'unavailable' }
  }
  // 額度校準（2026-09-01）：原本抓 IP 20 / email 5，理由是「真人一輩子只會開通一兩次」。
  // 錯了。實際看節流表，一個真實使用者在一小時內試了 13 次才成功，另一個試 3 次就放棄且
  // 至今沒有帳號。開通流程本身夠讓人困惑，卡住的人會反覆重試——把重試當成攻擊來擋，
  // 擋掉的是真人不是腳本（腳本一小時打幾千次，這個級距怎麼設都攔得住）。
  // 尚未驗證購買前只扣來訪者 IP。任意假序號不能耗光他人的 Email 額度。
  const ipLimit = await bump(`act:ip:${ip}`, 40)
  if (ipLimit === 'unavailable') return activationUnconfirmed()
  if (ipLimit === 'limited')
    return json(429, {
      error:
        '嘗試次數過多，請一小時後再試。如果你已經付款卻一直開不通，別再試了——直接回覆購買信給我，我手動幫你開通。',
    })

  // 舊共用邀請碼未綁定 Email，不能作為新帳號的身分證明。停用新兌換；既有帳號不受影響。
  const inviteCodes = (Deno.env.get('INVITE_CODES') ?? '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
  if (inviteCodes.length > 0 && inviteCodes.includes(licenseKey.toUpperCase())) {
    return json(403, {
      code: 'invite-disabled',
      error: '共用邀請碼已停止開通新帳號。已有帳號請直接登入；新購買者請使用購買序號。',
    })
  }

  // 路徑 B：帶序號 → 向 Gumroad 驗證（會累計啟用次數）
  const productId = (Deno.env.get('GUMROAD_PRODUCT_ID') ?? '').trim()
  const permalink = Deno.env.get('GUMROAD_PERMALINK') ?? 'yike'
  // 先「不計次」驗證。原本每次呼叫都 increment_uses_count=true，代表使用者
  // 每打錯一次就燒掉一次額度——實測有真人試了 13 次才成功。計次要留給
  // 「真的開通成功」那一刻，不是留給每一次嘗試。
  const verify = (increment: boolean) =>
    fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        ...(productId ? { product_id: productId } : { product_permalink: permalink }),
        license_key: licenseKey,
        increment_uses_count: increment ? 'true' : 'false',
      }),
    })

  const unavailable = () => json(503, {
    error: '目前暫時無法驗證購買序號，請稍後再試。若已付款仍無法開通，請來信 qqleveragelearning@gmail.com；不必重新購買。',
  })
  let gumRes: Response
  try {
    gumRes = await verify(false)
  } catch {
    return unavailable()
  }
  if (gumRes.status >= 500 || gumRes.status === 429) return unavailable()
  const gum = await gumRes.json().catch(() => null)
  if (!gum || typeof gum.success !== 'boolean') return unavailable()
  if (gum.success !== gumRes.ok) return unavailable()
  if (!gum.success) {
    if (/disabled/i.test(String(gum.message ?? '')))
      return json(403, {
        code: 'license-disabled',
        error: '此購買序號已停用，請來信 qqleveragelearning@gmail.com，附購買確認信讓客服核對；不必重新購買。',
      })
    return json(403, { error: '序號無效——請確認購買信裡的 License Key' })
  }
  const purchase = gum.purchase ?? {}
  if (typeof purchase !== 'object' || purchase === null || Array.isArray(purchase)) return unavailable()
  // Official Gumroad flags are boolean; absent fields remain compatible with old responses.
  // A malformed flag is an upstream verification failure, not proof of a valid purchase.
  if (['disputed', 'dispute_won', 'refunded', 'chargebacked', 'test'].some((key) => purchase[key] !== undefined && typeof purchase[key] !== 'boolean'))
    return unavailable()
  if (purchase.test === true || purchase.test === 'true')
    return json(403, { code: 'test-license', error: '這是測試交易的序號，無法開通正式帳號。' })
  if (purchase.refunded || purchase.chargebacked)
    return json(403, { error: '此序號的訂單已退款，無法啟用' })
  if (purchase.disputed === true && purchase.dispute_won !== true)
    return json(403, {
      code: 'purchase-disputed',
      error: '此訂單的付款爭議尚未解除，暫時無法開通。請聯絡 qqleveragelearning@gmail.com 核對訂單狀態；不必重新購買。',
    })
  const purchaseEmail = typeof purchase.email === 'string' ? purchase.email.trim().toLowerCase() : ''
  if (!purchaseEmail || purchaseEmail !== email)
    return json(403, {
      code: 'purchase-email-mismatch',
      error: '請填入這組序號購買時使用的 Email，需與 Gumroad 購買確認信一致。若序號沒有購買 Email，請聯絡客服核對。',
    })
  // 只有持有此 Email 有效購買序號的人，才可消耗該買家的重試額度。
  const emailLimit = await bump(`act:email:${email}`, 20)
  if (emailLimit === 'unavailable') return activationUnconfirmed()
  if (emailLimit === 'limited')
    return json(429, {
      error: '嘗試次數過多，請一小時後再試，或聯絡客服協助開通；不必重新購買。',
    })
  const seed = gum.uses === undefined ? 0 : gum.uses
  if (typeof seed !== 'number' || !Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647)
    return unavailable()

  // Existing accounts are repaired only after the supplied original password proves ownership.
  // No password reset, receipt-only UID lookup or destructive Auth compensation.
  const created = await createUser(url, srk, email, password)
  if (!created.ok || !created.userId) return created.response

  let grantResponse: Response
  try {
    grantResponse = await fetch(`${url}/rest/v1/rpc/license_activate_grant`, {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_license_key: licenseKey, p_email: email, p_user_id: created.userId, p_seed_uses: seed }),
    })
  } catch {
    return activationUnconfirmed()
  }
  if (!grantResponse.ok) {
    console.error('atomic activation grant 未確認', grantResponse.status)
    return activationUnconfirmed()
  }
  const result: unknown = await grantResponse.json().catch(() => null)
  if (!result || typeof result !== 'object' || Array.isArray(result)) return activationUnconfirmed()
  const grant = result as Record<string, unknown>
  if (typeof grant.ok !== 'boolean' || typeof grant.new_redemption !== 'boolean' ||
      (!grant.ok && grant.new_redemption)) return activationUnconfirmed()
  if (!grant.ok) {
    if (grant.reason === 'cap-reached') return json(403, {
      code: 'activation-cap-reached',
      error: '此序號的兌換額度已用完，請回覆購買信讓客服核對；不必重新購買。',
    })
    return activationUnconfirmed()
  }

  // The atomic DB claim is the durable cap. Gumroad has no increment idempotency key:
  // count a new ledger redemption once; never blindly retry an uncertain provider increment.
  if (grant.new_redemption) {
    try {
      const counted = await verify(true)
      const payload: unknown = await counted.json().catch(() => null)
      if (!counted.ok || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
          (payload as Record<string, unknown>).success !== true)
        console.error('Gumroad 計次未確認', counted.status)
    } catch {
      console.error('Gumroad 計次未確認：逾時或網路失敗')
    }
  }
  // Both durable ledger/cap and entitlement have committed before this success.
  return json(200, { ok: true })
})

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const activationUnconfirmed = () => json(503, {
  code: 'activation-result-unconfirmed',
  error: '開通結果尚未確認。請用相同購買 Email、購買序號與原本的 Yike 密碼重試；若仍失敗請聯絡 qqleveragelearning@gmail.com，不必重新購買。',
})
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const accountId = (value: Record<string, unknown>, email: string): string | null =>
  typeof value.id === 'string' && UUID.test(value.id) && typeof value.email === 'string' &&
    value.email.trim().toLowerCase() === email ? value.id : null

async function createUser(
  url: string, srk: string, email: string, password: string
): Promise<{ ok: boolean; response: Response; userId?: string }> {
  let createRes: Response
  try {
    createRes = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }),
    })
  } catch { return { ok: false, response: activationUnconfirmed() } }
  const created = record(await createRes.json().catch(() => null))
  const id = accountId(created, email)
  if (createRes.ok) return id
    ? { ok: true, response: json(200, { ok: true }), userId: id }
    : { ok: false, response: activationUnconfirmed() }

  // HTTP422 and msg do not identify an existing account. Use official REST code fields.
  const codes = [created.code, created.error_code].filter((code): code is string => typeof code === 'string')
  const authCode = codes.length && new Set(codes).size === 1 ? codes[0] : ''
  if (authCode === 'email_exists' || authCode === 'user_already_exists') {
    const anon = Deno.env.get('SUPABASE_ANON_KEY')
    if (!anon) return { ok: false, response: activationUnconfirmed() }
    let signedIn: Response
    try {
      signedIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
    } catch { return { ok: false, response: activationUnconfirmed() } }
    if (signedIn.status === 429) return { ok: false, response: json(429, {
      code: 'account-rate-limited', error: '帳號服務暫時限制請求，請稍後再試或聯絡客服；不必重新購買。',
    }) }
    if (signedIn.status >= 500) return { ok: false, response: activationUnconfirmed() }
    if (!signedIn.ok) return { ok: false, response: json(409, {
      error: '這個 Email 已經有帳號。請使用原本的 Yike 密碼登入；開通表單不能重設密碼。',
    }) }
    const session = record(await signedIn.json().catch(() => null))
    const existingId = accountId(record(session.user), email)
    if (!existingId || typeof session.access_token !== 'string' || !session.access_token || session.access_token.length > 16 * 1024)
      return { ok: false, response: activationUnconfirmed() }
    // The proof session tokens remain in memory only; never return/log/persist them.
    return { ok: true, response: json(200, { ok: true }), userId: existingId }
  }
  if (authCode === 'weak_password') return { ok: false, response: json(422, {
    code: 'password-rejected', error: '密碼未符合帳號安全規則，請換一組較長且不易猜測的密碼再試；不用提供密碼給客服。',
  }) }
  if (createRes.status === 429) return { ok: false, response: json(429, {
    code: 'account-rate-limited', error: '帳號服務暫時限制請求，請稍後再試或聯絡客服；不必重新購買。',
  }) }
  if (createRes.status === 400 || createRes.status === 422) return { ok: false, response: json(createRes.status, {
    code: 'account-creation-rejected', error: '帳號建立未完成，請確認購買 Email 與密碼格式。仍有問題請聯絡 qqleveragelearning@gmail.com；不必重新購買。',
  }) }
  return { ok: false, response: activationUnconfirmed() }
}
