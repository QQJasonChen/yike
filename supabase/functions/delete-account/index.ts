// 永久刪除帳號（App Store 5.1.1(v) 強制：能註冊就要能在 app 內刪除帳號）
// 流程：驗證使用者 JWT → 刪掉他的 journal 資料 → 刪掉 auth 帳號本身
// 部署：supabase functions deploy delete-account
// 環境：SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 由平台自動注入

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

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1) 從 Authorization 取使用者 JWT，向 GoTrue 驗證身分
  const authz = req.headers.get('Authorization') ?? ''
  const token = authz.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json(401, { error: '請先登入' })

  const meRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
  })
  if (!meRes.ok) return json(401, { error: '登入已過期，請重新登入再刪除' })
  const me = (await meRes.json().catch(() => ({}))) as { id?: string }
  const uid = me.id
  if (!uid) return json(401, { error: '無法確認身分' })

  // 2) 刪掉這個使用者的所有 journal 資料（service role，繞過 RLS）
  const delData = await fetch(
    `${url}/rest/v1/journal?user_id=eq.${encodeURIComponent(uid)}`,
    {
      method: 'DELETE',
      headers: { apikey: srk, Authorization: `Bearer ${srk}` },
    }
  )
  if (!delData.ok) {
    const t = await delData.text().catch(() => '')
    return json(500, { error: `刪除資料失敗：${t || delData.status}` })
  }

  // 3) 刪掉 auth 帳號本身（admin API）
  const delUser = await fetch(`${url}/auth/v1/admin/users/${uid}`, {
    method: 'DELETE',
    headers: { apikey: srk, Authorization: `Bearer ${srk}` },
  })
  if (!delUser.ok) {
    const t = await delUser.text().catch(() => '')
    return json(500, { error: `刪除帳號失敗：${t || delUser.status}` })
  }

  return json(200, { ok: true })
})
