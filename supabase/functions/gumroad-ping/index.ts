// Gumroad 售出 Ping → 把買家 Email 寫進付費白名單（買家用購買 email 註冊即自動開通）
// 部署：supabase functions deploy gumroad-ping --no-verify-jwt
// 驗證：URL query ?secret=<GUMROAD_PING_SECRET>
// Gumroad Ping 送的是 application/x-www-form-urlencoded（不是 JSON）
import { BodyReadError, readBoundedText } from '../_shared/boundedBody.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const url = new URL(req.url)
  const expectedSecret = Deno.env.get('GUMROAD_PING_SECRET')
  if (!expectedSecret || url.searchParams.getAll('secret').length !== 1 || url.searchParams.get('secret') !== expectedSecret)
    return json(401, { error: 'bad secret' })

  // Gumroad Ping = form-encoded
  let form: URLSearchParams
  try {
    form = new URLSearchParams(await readBoundedText(req, 64 * 1024, 5000))
  } catch (error) {
    return json(error instanceof BodyReadError ? error.status : 400, { error: 'bad body' })
  }

  // URLSearchParams.get and Object.fromEntries disagree on duplicate keys. Never
  // authorize using one value while retaining a different value as the receipt.
  const keys = [...form.keys()]
  if (new Set(keys).size !== keys.length) return json(400, { error: 'ambiguous form fields' })

  // Shared secret authenticates this endpoint, not the product being purchased.
  // Missing product configuration must not grant all products from a seller.
  const productId = Deno.env.get('GUMROAD_PRODUCT_ID')?.trim()
  if (!productId) return json(503, { error: 'product verification unavailable' })
  if (form.get('product_id') !== productId) return json(422, { error: 'unexpected product' })

  // This path only adds grants; refund revocation/ordering needs separate proof.
  for (const key of ['refunded', 'disputed', 'chargebacked', 'test', 'is_test']) {
    const value = form.get(key)?.trim().toLowerCase()
    if (value === undefined) continue
    if (value === 'true') return json(200, { ok: true, skipped: 'refunded/disputed/test' })
    if (value !== 'false') return json(400, { error: 'invalid payment flag' })
  }

  const email = (form.get('email') ?? '').toLowerCase().trim()
  if (new TextEncoder().encode(email).byteLength > 254 || !/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+$/.test(email))
    return json(422, { error: 'no email in ping' })

  const base = Deno.env.get('SUPABASE_URL')!
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  let res: Response
  try { res = await fetch(`${base}/rest/v1/entitlements`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      apikey: srk,
      Authorization: `Bearer ${srk}`,
      'Content-Type': 'application/json',
      // Preserve existing manual/IAP/other-provider receipts and their timestamps.
      Prefer: 'resolution=ignore-duplicates',
    },
    body: JSON.stringify({
      email,
      source: 'gumroad',
      raw: Object.fromEntries(form),
    }),
  }) } catch { return json(503, { error: 'grant result unconfirmed; retry the same event' }) }
  if (!res.ok) return json(503, { error: 'grant result unconfirmed; retry the same event' })
  return json(200, { ok: true, email })
})
