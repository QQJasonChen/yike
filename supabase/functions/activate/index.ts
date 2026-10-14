// 付費自動開通：驗證 Gumroad 序號 → 建立 Supabase 帳號
// 部署：supabase functions deploy activate --no-verify-jwt
// 環境：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由平台自動注入；
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
  const redeem = async (lic: string, mail: string, cap: number, seed: number) => {
    const r = await fetch(`${url}/rest/v1/rpc/license_redeem`, {
      method: 'POST',
      headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: lic, mail, cap, seed }),
    })
    if (!r.ok) {
      console.error('license_redeem 失敗', r.status)
      return false // fail-closed
    }
    return (await r.json()) === true
  }

  // 回收帳號失敗時補記一列，讓「永久兌換表」對得上實際存在的帳號。
  const forceRecord = async (lic: string, mail: string) => {
    try {
      const r = await fetch(`${url}/rest/v1/rpc/license_force_record`, {
        method: 'POST',
        headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ k: lic, mail }),
      })
      if (!r.ok)
        console.error('license_force_record 失敗', r.status)
      return r.ok
    } catch {
      console.error('license_force_record 例外')
      return false
    }
  }

  const bump = async (key: string, cap: number, windowSeconds = 3600) => {
    const r = await fetch(`${url}/rest/v1/rpc/rate_limit_bump`, {
      method: 'POST',
      headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: key, cap, window_seconds: windowSeconds }),
    })
    // fail-closed：計數器壞掉就擋，不要因為節流故障而變成完全不設防
    if (!r.ok) {
      console.error('rate_limit_bump 失敗', r.status)
      return false
    }
    return (await r.json()) === true
  }
  // 額度校準（2026-09-01）：原本抓 IP 20 / email 5，理由是「真人一輩子只會開通一兩次」。
  // 錯了。實際看節流表，一個真實使用者在一小時內試了 13 次才成功，另一個試 3 次就放棄且
  // 至今沒有帳號。開通流程本身夠讓人困惑，卡住的人會反覆重試——把重試當成攻擊來擋，
  // 擋掉的是真人不是腳本（腳本一小時打幾千次，這個級距怎麼設都攔得住）。
  // 尚未驗證購買前只扣來訪者 IP。任意假序號不能耗光他人的 Email 額度。
  if (!(await bump(`act:ip:${ip}`, 40)))
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
  if (!gum.success) {
    if (/disabled/i.test(String(gum.message ?? '')))
      return json(403, {
        code: 'license-disabled',
        error: '此購買序號已停用，請來信 qqleveragelearning@gmail.com，附購買確認信讓客服核對；不必重新購買。',
      })
    return json(403, { error: '序號無效——請確認購買信裡的 License Key' })
  }
  const purchase = gum.purchase ?? {}
  if (purchase.test === true || purchase.test === 'true')
    return json(403, { code: 'test-license', error: '這是測試交易的序號，無法開通正式帳號。' })
  if (purchase.refunded || purchase.chargebacked)
    return json(403, { error: '此序號的訂單已退款，無法啟用' })
  const purchaseEmail = typeof purchase.email === 'string' ? purchase.email.trim().toLowerCase() : ''
  if (!purchaseEmail || purchaseEmail !== email)
    return json(403, {
      code: 'purchase-email-mismatch',
      error: '請填入這組序號購買時使用的 Email，需與 Gumroad 購買確認信一致。若序號沒有購買 Email，請聯絡客服核對。',
    })
  // 只有持有此 Email 有效購買序號的人，才可消耗該買家的重試額度。
  if (!(await bump(`act:email:${email}`, 20)))
    return json(429, {
      error: '嘗試次數過多，請一小時後再試，或聯絡客服協助開通；不必重新購買。',
    })
  // 額度的單一真相源＝資料庫的原子計數器（見下方建立帳號後）。
  // 不再另外用 gum.uses 當閘門：兩套計數會互相疊加而過度限制——
  // 例如 uses=2 時 cap 只剩 1，但資料庫那邊還允許 3，兩邊都對不上真實張數
  // （Codex 互審第 2 輪 P1）。Gumroad 這裡只負責「序號是否有效／有沒有退款」，
  // 計次仍照送，供對帳用。

  // 2) 建立帳號（service role）
  const created = await createUser(url, srk, email, password)

  let overQuotaButKept = false
  // 額度只在「真的建成帳號」時扣。不能在建立前先扣——開通失敗（例如 email 已註冊、
  // 密碼太短、使用者打錯重試）也會燒掉序號額度，那正是幾小時前才修過的
  // 「把重試當成攻擊」同一個錯誤。
  // 原子計數器擋的是並行：同一組序號用不同 email 同時送進來，Gumroad 的 uses
  // 來不及反映，資料庫這邊的 insert…on conflict…returning 會擋下超額的那些。
  if (created.ok && created.userId) {
    // 用永久兌換表，不用節流器。節流器的視窗會到期重置——一年後同一組序號
    // 又多 3 次（Codex 互審第 3 輪 P1）。
    // seed 帶 Gumroad 的既有用量：新表建立前已經開通過的次數不能憑空歸零，
    // 否則一張用過 2 次的序號還能再開 3 個（Codex 互審第 6 輪 P1-1）。
    const within = await redeem(licenseKey, email, 3, Number(gum.uses ?? 0))
    if (!within) {
      // 並行競爭輸了：把剛建的帳號收回去。要檢查刪除結果——原本只 catch fetch
      // 的 rejection、不看 HTTP status，DELETE 回 401/500 時帳號其實還在，
      // 卻回報「額度已用完」，等於留下一個超額帳號而且沒人知道
      //（Codex 互審第 2 輪 P1）。
      let rolledBack = false
      try {
        const del = await fetch(`${url}/auth/v1/admin/users/${created.userId}`, {
          method: 'DELETE',
          headers: { apikey: srk, Authorization: `Bearer ${srk}` },
        })
        rolledBack = del.ok
        if (!del.ok)
          console.error('超額帳號回收失敗', del.status)
      } catch {
        console.error('超額帳號回收例外')
      }
      if (rolledBack) {
        return json(403, {
          error: '此序號的啟用次數已用完。如果你是本人要重新開通，直接回覆購買信給我。',
        })
      }
      // 回收失敗，帳號還在。與其謊稱失敗讓使用者以為沒開通，不如放行並留告警——
      // 站方看 log 就知道要人工處理，使用者也不會付了錢卻進不去。
      // 不在這裡 return，才會繼續走下面的 Gumroad 計次與 entitlement 寫入；
      // 提前 return 會變成「帳號能用、但對帳表查無此人」（Codex 互審第 3 輪 P1）。
      // Do not log Email, key prefixes or upstream bodies: SQL error details can contain keys.
      console.error('序號超額但帳號無法回收，已放行；查核 entitlements 的 over_quota_kept 標记')
      // 帳號實際存在，兌換表就必須有這一列。少記的話這組序號等於憑空多出一個
      // 不計入額度的名額，下次還能再生一個（Codex 互審第 4 輪 P1）。
      await forceRecord(licenseKey, email)
      overQuotaButKept = true
    }
  }
  // 只有真的建成帳號才計次
  if (created.ok) {
    // 計次失敗要留紀錄。原本 .catch(() => {}) 吞掉錯誤，Gumroad 那邊的次數
    // 沒加到卻回報開通成功，額度就默默失效了。
    // （資料庫那邊的 licSlot 已經先扣過，所以總量仍受控，這裡是為了對帳。）
    try {
      const inc = await verify(true)
      if (!inc.ok) console.error('Gumroad 計次失敗', inc.status)
    } catch {
      console.error('Gumroad 計次例外')
    }
    // 記下是哪筆購買、用什麼 email 開的，之後對帳與客服查得到。
    // 只 .catch() 不看 status 等於沒檢查：PostgREST 回 400/409/500 時 fetch 仍然
    // resolve，對帳表默默漏一筆也沒人知道（Codex 互審第 4 輪 P1）。
    try {
      const ent = await fetch(`${url}/rest/v1/entitlements`, {
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
          raw: {
            purchase_email: purchase.email ?? null,
            license_uses: gum.uses ?? 0,
            ...(overQuotaButKept ? { over_quota_kept: true } : {}),
          },
        }),
      })
      if (!ent.ok)
        console.error('entitlement 寫入失敗', ent.status)
    } catch {
      console.error('entitlement 寫入例外')
    }
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
