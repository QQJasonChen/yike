// RevenueCat appUserId is a client-visible identifier, not purchase-owner proof.
// Until a verified receipt/transaction is bound to one authenticated UID, looking
// up its entitlement would let one purchase create arbitrary unrelated accounts.
// Existing accounts/entitlements are untouched. Reopening requires a new protocol,
// not an environment flag that can accidentally restore this unsafe grant path.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method not allowed' }), {
    status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
  // Do not parse a body, look up a provider, or mutate Auth/DB on this closed path.
  void req.body?.cancel().catch(() => {})
  return new Response(JSON.stringify({
    code: 'iap-activation-unavailable',
    error: 'App 內購新帳號開通尚未開放。已有 Yike 帳號請直接登入；已付款者請聯絡 qqleveragelearning@gmail.com 核對，不必重新購買。',
  }), { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } })
})
