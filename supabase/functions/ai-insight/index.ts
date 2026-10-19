// Dormant, separately enabled server-paid proxy. The app's browser BYOK path is unchanged.
// Both YIKE_SERVER_AI_ENABLED=enabled-v1 and complete, unexpired DB configuration
// are mandatory. Every attempt reserves global lifetime/daily and user daily quotas
// before any provider call; timeouts/errors retain that reservation. See N4 contract.

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

const MAX_INPUT = 6000 // 輸入截斷字數
const MODEL = 'gpt-4o-mini-2024-07-18'
const CONTRACT = 'yike-ai-proxy-v1'
const MAX_PROVIDER_INPUT_BYTES = 32768
const MAX_OUTPUT_TOKENS = 700
const SYSTEM =
  '你是一位溫暖、誠實、簡潔的中文生產力教練，用繁體中文與台灣用語。' +
  '根據使用者的紀錄數據，給出 3-5 點具體觀察（指出模式、進步、與該注意的地方）和一個可立刻執行的建議。' +
  '不要灌雞湯、不要空泛、不要客套，像一個看得懂數字又關心對方的朋友。'

// Bound both directions, including response-body reads after headers arrive.
const upstream = async (url: string, init: RequestInit, budget: AbortSignal) => {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 8000)
  const signal = AbortSignal.any([budget, ac.signal])
  try {
    signal.throwIfAborted()
    const response = await fetch(url, { ...init, redirect: 'error', signal })
    if (!response.ok) { void response.body?.cancel().catch(() => {}); return { response, body: null } }
    const body = await readBoundedJson({ headers: response.headers, body: response.body, signal } as Request, 65536, 8000, signal)
    return { response, body }
  } finally { clearTimeout(timer) }
}
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  if (Deno.env.get('YIKE_SERVER_AI_ENABLED') !== 'enabled-v1')
    return json(503, { error: '站方 AI 尚未啟用，請使用設定中的自備金鑰。' })
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1]
  if (!token || token.length > 8192) return json(401, { error: '請先登入才能使用 AI' })
  const budget = new AbortController()
  const timer = setTimeout(() => budget.abort(), 30000)
  const signal = AbortSignal.any([budget.signal, req.signal])
  // Safe errors never include provider bodies, identifiers or credentials.
  let phase: 'input' | 'auth' | 'quota' | 'provider' = 'input'
  try {
    const body = record(await readBoundedJson(req, 32768, 5000, signal))
    if (!body || typeof body.data !== 'string' || !body.data.trim() ||
        (body.prompt !== undefined && typeof body.prompt !== 'string'))
      return json(400, { error: '格式錯誤或沒有資料可分析' })
    const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 1200) : ''
    const data = body.data.slice(0, MAX_INPUT)
    const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: `${prompt}\n\n以下是資料：\n${data}` }]
    // UTF-8 bytes conservatively bound text tokens; SQL also reserves 1,024 tokens
    // for framing. This is an operator-configured estimate, not a provider bill cap.
    if (new TextEncoder().encode(JSON.stringify(messages)).byteLength > MAX_PROVIDER_INPUT_BYTES)
      return json(413, { error: '內容超過處理上限，請縮短範圍。' })
    const url = Deno.env.get('SUPABASE_URL')
    const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const openaiKey = Deno.env.get('OPENAI_KEY')
    if (!url || !srk || !openaiKey) return json(503, { error: 'AI 服務暫時無法使用，請稍後再試。' })
    phase = 'auth'
    const user = await upstream(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: srk } }, signal)
    if (!user.response.ok) return json(401, { error: '請先登入才能使用 AI' })
    const uid = record(user.body)?.id
    if (typeof uid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid))
      return json(401, { error: '請先登入才能使用 AI' })
    phase = 'quota'
    const reservation = await upstream(`${url}/rest/v1/rpc/ai_proxy_reserve`, {
      method: 'POST',
      headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, contract: CONTRACT }),
    }, signal)
    // A bare true from the legacy per-user limiter is deliberately insufficient.
    const receipt = record(reservation.body)
    if (!reservation.response.ok || !receipt || receipt.contract !== CONTRACT ||
        typeof receipt.allowed !== 'boolean' ||
        (receipt.allowed && (!Number.isSafeInteger(receipt.reserved_units) || Number(receipt.reserved_units) <= 0)))
      return json(503, { error: 'AI 服務暫時無法使用，請稍後再試。' })
    if (!receipt.allowed) {
      if (receipt.reason === 'quota') return json(429, { error: '站方 AI 額度已用完，請使用設定中的自備金鑰。' })
      return json(503, { error: 'AI 服務暫時無法使用，請稍後再試。' })
    }
    phase = 'provider'
    const ai = await upstream('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.6, max_tokens: MAX_OUTPUT_TOKENS,
      }),
    }, signal)
    const choices = record(ai.body)?.choices
    const text = Array.isArray(choices) ? record(record(choices[0])?.message)?.content : undefined
    if (!ai.response.ok || typeof text !== 'string' || !text || text.length > 8192)
      return json(502, { error: 'AI 服務暫時無法回應，稍後再試' })
    return json(200, { text })
  } catch (error) {
    if (phase === 'input' && error instanceof BodyReadError)
      return json(error.status, { error: error.status === 413 ? '內容超過處理上限，請縮短範圍。' : '格式錯誤或接收逾時' })
    return json(phase === 'provider' ? 502 : 503, { error: 'AI 服務暫時無法使用，請稍後再試。' })
  } finally { clearTimeout(timer) }
})
