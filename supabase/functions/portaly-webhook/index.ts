// Portaly 售出 webhook → 把買家 Email 寫進付費白名單
// 部署：supabase functions deploy portaly-webhook --no-verify-jwt
// 驗證：URL query ?secret=<PORTALY_SECRET>（supabase secrets set PORTALY_SECRET=...）

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** 在任意巢狀 payload 裡撈出第一個像 email 的值（容忍 Portaly 格式變動） */
const findEmail = (obj: unknown, depth = 0): string | null => {
  if (depth > 5 || obj === null || typeof obj !== 'object') return null
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === 'string' && /email/i.test(k) && v.includes('@')) return v.toLowerCase().trim()
    const nested = findEmail(v, depth + 1)
    if (nested) return nested
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const url = new URL(req.url)
  if (url.searchParams.get('secret') !== Deno.env.get('PORTALY_SECRET'))
    return json(401, { error: 'bad secret' })

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return json(400, { error: 'invalid json' })
  }

  const email = findEmail(payload)
  if (!email) return json(422, { error: 'no email in payload' })

  const base = Deno.env.get('SUPABASE_URL')!
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const res = await fetch(`${base}/rest/v1/entitlements`, {
    method: 'POST',
    headers: {
      apikey: srk,
      Authorization: `Bearer ${srk}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ email, source: 'portaly', raw: payload }),
  })
  if (!res.ok) return json(500, { error: `db ${res.status}` })
  return json(200, { ok: true, email })
})
