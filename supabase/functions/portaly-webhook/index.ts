// Portaly new entitlement grants are intentionally unavailable in this candidate.
// The configured live product, buyer/event mapping and callback verification
// contract have not been confirmed. A query secret is not payment/product proof.
// See docs/security-acceptance-20261018/portaly-contract-gate.md before integration.
import { BodyReadError, readBoundedJson } from '../_shared/boundedBody.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const url = new URL(req.url)
  const expectedSecret = Deno.env.get('PORTALY_SECRET')
  if (!expectedSecret || url.searchParams.getAll('secret').length !== 1 || url.searchParams.get('secret') !== expectedSecret)
    return json(401, { error: 'bad secret' })

  let payload: unknown
  try {
    payload = await readBoundedJson(req, 64 * 1024, 5000)
  } catch (error) {
    return json(error instanceof BodyReadError ? error.status : 400, { error: 'invalid json' })
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return json(400, { error: 'invalid payload' })

  // Fail closed for ALL products until a verified, explicitly Yike-bound adapter
  // is implemented against approved sanitized fixtures. Do not add an env toggle
  // or revive generic status / recursive email or product searches to bypass this.
  // No provider/DB calls, receipt changes, account creation or entitlement grants.
  // Existing accounts and entitlements are unaffected. A 503 also avoids falsely
  // acknowledging an unprocessed paid event as a successful entitlement grant.
  return json(503, { error: 'portaly contract unavailable' })
})
