// Gumroad 售出 Ping → 把買家 Email 寫進付費白名單（買家用購買 email 註冊即自動開通）
// 部署：supabase functions deploy gumroad-ping --no-verify-jwt
// 驗證：URL query ?secret=<GUMROAD_PING_SECRET>
// Gumroad Ping 送的是 application/x-www-form-urlencoded（不是 JSON）

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const url = new URL(req.url)
  if (url.searchParams.get('secret') !== Deno.env.get('GUMROAD_PING_SECRET'))
    return json(401, { error: 'bad secret' })

  // Gumroad Ping = form-encoded
  let form: URLSearchParams
  try {
    form = new URLSearchParams(await req.text())
  } catch {
    return json(400, { error: 'bad body' })
  }

  // 退款 / 退單 → 不開通
  if (form.get('refunded') === 'true' || form.get('disputed') === 'true')
    return json(200, { ok: true, skipped: 'refunded' })

  const email = (form.get('email') ?? '').toLowerCase().trim()
  if (!email.includes('@')) return json(422, { error: 'no email in ping' })

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
    body: JSON.stringify({
      email,
      source: 'gumroad',
      raw: Object.fromEntries(form),
    }),
  })
  if (!res.ok) return json(500, { error: `db ${res.status}` })
  return json(200, { ok: true, email })
})
