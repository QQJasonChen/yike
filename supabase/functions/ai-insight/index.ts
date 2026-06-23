// AI 洞察：用站方 OpenAI key 替「登入使用者」生成回顧/洞察。
// 護欄：需登入（JWT）＋每人每日上限＋輸入截斷＋便宜模型，避免帳單失控。
// 部署：supabase functions deploy ai-insight
// 環境：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由平台自動注入；
//       OPENAI_KEY 用 `supabase secrets set OPENAI_KEY=sk-...` 設定。

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

const DAILY_CAP = 15 // 每人每日上限
const MAX_INPUT = 6000 // 輸入截斷字數
const MODEL = 'gpt-4o-mini'
const SYSTEM =
  '你是一位溫暖、誠實、簡潔的中文生產力教練，用繁體中文與台灣用語。' +
  '根據使用者的紀錄數據，給出 3-5 點具體觀察（指出模式、進步、與該注意的地方）和一個可立刻執行的建議。' +
  '不要灌雞湯、不要空泛、不要客套，像一個看得懂數字又關心對方的朋友。'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })

  const url = Deno.env.get('SUPABASE_URL')!
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const openaiKey = Deno.env.get('OPENAI_KEY')
  if (!openaiKey) return json(500, { error: 'AI 尚未設定（缺 OPENAI_KEY）' })

  // 1) 驗證使用者（限登入者，擋公開亂用）
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: '請先登入才能使用 AI' })
  const ures = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: srk },
  })
  if (!ures.ok) return json(401, { error: '請先登入才能使用 AI' })
  const uid = (await ures.json())?.id
  if (!uid) return json(401, { error: '請先登入才能使用 AI' })

  // 2) 每日上限
  const bump = await fetch(`${url}/rest/v1/rpc/ai_usage_bump`, {
    method: 'POST',
    headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, cap: DAILY_CAP }),
  })
  if (bump.ok && (await bump.json()) === false)
    return json(429, { error: `今天的 AI 次數用完了（每天 ${DAILY_CAP} 次），明天再來。` })

  // 3) 取輸入
  let prompt = '',
    data = ''
  try {
    const body = await req.json()
    prompt = String(body.prompt ?? '').slice(0, 1200)
    data = String(body.data ?? '').slice(0, MAX_INPUT)
  } catch {
    return json(400, { error: '格式錯誤' })
  }
  if (!data) return json(400, { error: '沒有資料可分析' })

  // 4) 呼叫 OpenAI
  const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `${prompt}\n\n以下是資料：\n${data}` },
      ],
      temperature: 0.6,
      max_tokens: 700,
    }),
  })
  if (!aiRes.ok) return json(502, { error: 'AI 服務暫時無法回應，稍後再試' })
  const text = (await aiRes.json())?.choices?.[0]?.message?.content ?? ''
  return json(200, { text })
})
