// AI 洞察：用「使用者自己的 OpenAI 金鑰」，瀏覽器直接呼叫 OpenAI。
//
// 為什麼不走站方的 key／不經過站方伺服器：
//   1. 你的日記是最私密的東西。少一個中繼站就少一個外洩點——內容從你的裝置
//      直接到 OpenAI，站方看不到、也存不到。
//   2. 金鑰綁著信用卡。站方不碰它，就沒有替你保管的責任，也不可能被站方外洩。
//   3. 費用由你自己的帳戶承擔，用多少付多少，站方不必為了控制成本而限制你的次數。
// 金鑰用 ppl: 前綴存在 localStorage：不同步上雲、不進匯出檔、不進備份。
import { getOpenAIKey, getOpenAIModel } from './storage'

export const OPENAI_KEY_HELP_URL = 'https://platform.openai.com/api-keys'

const MAX_INPUT = 6000 // 輸入截斷，避免一次送出過長內容而爆費用

// 偏好順序：新的在前。不寫死單一型號——OpenAI 的型號會汰換，寫死的那天
// 使用者會收到「model not found」而完全不知道發生什麼事。
// 存金鑰時向 /v1/models 問「這個帳號實際能用什麼」，挑第一個對得上的。
const MODEL_PREFERENCE = ['gpt-5.4-mini', 'gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini']
const FALLBACK_MODEL = 'gpt-4o-mini' // 查不到時的保底，存在最久、幾乎一定還在

export const aiEnabled = (): boolean => Boolean(getOpenAIKey())

/** 驗證金鑰並挑出這個帳號可用的最新 mini 型號。存金鑰時呼叫。 */
export const verifyKeyAndPickModel = async (
  key: string
): Promise<{ ok: true; model: string } | { ok: false; error: string }> => {
  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    })
  } catch {
    return { ok: false, error: '連不上 OpenAI——請檢查網路連線' }
  }
  if (res.status === 401) return { ok: false, error: '金鑰無效，請確認有整串複製到' }
  if (!res.ok) return { ok: false, error: `OpenAI 回應 ${res.status}，請稍後再試` }
  const body = (await res.json().catch(() => ({}))) as { data?: { id: string }[] }
  const ids = new Set((body.data ?? []).map((m) => m.id))
  const model = MODEL_PREFERENCE.find((m) => ids.has(m)) ?? FALLBACK_MODEL
  return { ok: true, model }
}

/** 用 prompt + 資料生成洞察。沒設定金鑰會 throw 友善訊息。 */
export const generateInsight = async (prompt: string, data: string): Promise<string> => {
  const key = getOpenAIKey()
  if (!key) throw new Error('請先到 ⚙ 設定填入你自己的 OpenAI 金鑰')

  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: getOpenAIModel(),
        messages: [
          {
            role: 'system',
            content:
              '你是使用者的專注教練。用繁體中文（台灣用語）回答，具體、簡短、可行動，不要客套話。',
          },
          { role: 'user', content: `${prompt.slice(0, 1200)}\n\n---\n${data.slice(0, MAX_INPUT)}` },
        ],
        max_completion_tokens: 700,
      }),
    })
  } catch {
    throw new Error('連不上 OpenAI——請檢查網路連線')
  }

  if (res.status === 401) throw new Error('金鑰無效或已被撤銷，請到 ⚙ 設定重新填一次')
  if (res.status === 429)
    throw new Error('OpenAI 回報額度不足或請求過於頻繁——請確認你的 OpenAI 帳戶還有餘額')
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(`AI 失敗（${res.status}）：${b.error?.message ?? '未知錯誤'}`)
  }
  const body = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = body.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('AI 沒有回傳內容，請再試一次')
  return String(text)
}
