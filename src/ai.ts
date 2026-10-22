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

// /v1/models 會回一堆不是聊天模型的東西：tts、realtime、audio、image、transcribe、
// embedding、moderation、search…。原本的保底是「第一個 gpt- 開頭的」，
// 很可能挑到 gpt-4o-mini-tts 之類——存的時候宣告「可以用了」，
// 第一次分析才收到 400（Codex 互審第 6 輪 P2-1）。
const NOT_CHAT = /(tts|realtime|audio|image|transcribe|whisper|embedding|moderation|search|dall-e|omni-moderation)/i
const isChatModel = (id: string): boolean => id.startsWith('gpt-') && !NOT_CHAT.test(id)

/** 帶逾時的 JSON 取得——逾時要**涵蓋讀 body**。
 *
 *  原本兩處都在 `finally` 裡 clearTimeout，然後才 `await res.json()`：
 *  headers 回來了但 body 卡住（連線半死、代理吃掉、伺服器不收尾）時，
 *  AbortController 已經解除，那個 await 會永遠等下去，畫面就永遠停在「分析中…」。
 *  所以 controller 必須活到 body 讀完為止。 */
const fetchJsonWithTimeout = async (
  url: string,
  init: RequestInit,
  ms: number
): Promise<{ status: number; ok: boolean; body: unknown } | { timedOut: true } | { netError: true }> => {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    const res = await fetch(url, { ...init, signal: ac.signal })
    let body: unknown = {}
    try {
      body = await res.json()
    } catch {
      // 這裡**不能**一律當成「空 body」。原本寫 `.catch(() => ({}))`，
      // 於是 body 讀到一半被 abort 時，AbortError 被吞掉、回傳一個空物件，
      // 呼叫端看到的是「AI 沒有回傳內容」或「沒有可用型號」——逾時被自己的防呆蓋掉，
      // 使用者拿到一句完全誤導的錯誤訊息。
      if (ac.signal.aborted) return { timedOut: true }
      body = {} // 真的空 body / 不是 JSON（204、HTML 錯誤頁）：不算逾時
    }
    return { status: res.status, ok: res.ok, body }
  } catch {
    return ac.signal.aborted ? { timedOut: true } : { netError: true }
  } finally {
    clearTimeout(timer)
  }
}

export const aiEnabled = (): boolean => Boolean(getOpenAIKey())

/** 驗證金鑰並挑出這個帳號可用的最新 mini 型號。存金鑰時呼叫。 */
export const verifyKeyAndPickModel = async (
  key: string
): Promise<{ ok: true; model: string } | { ok: false; error: string }> => {
  // 沒有逾時的話，網路卡住會讓畫面永遠停在「驗證中…」，按鈕還是 disabled，
  // 使用者只能重開 App（Codex UI/UX 審查 P0）。
  const r = await fetchJsonWithTimeout(
    'https://api.openai.com/v1/models',
    { headers: { Authorization: `Bearer ${key}` } },
    15_000
  )
  if ('timedOut' in r) return { ok: false, error: '連線逾時，請確認網路後再試一次' }
  if ('netError' in r) return { ok: false, error: '連不上 OpenAI——請檢查網路連線' }
  if (r.status === 401) return { ok: false, error: '金鑰無效，請確認有整串複製到' }
  if (!r.ok) return { ok: false, error: `OpenAI 回應 ${r.status}，請稍後再試` }
  const ids = ((r.body as { data?: { id: string }[] }).data ?? []).map((m) => m.id)
  // 只能從「這個帳號實際回傳的型號」裡挑，而且必須是聊天模型。原本挑不到就存一個
  // 寫死的保底，那等於在帳號根本沒有相容型號時還宣告「可以用了」，第一次分析才失敗。
  const model =
    MODEL_PREFERENCE.find((m) => ids.includes(m)) ??
    ids.find((id) => isChatModel(id) && /mini/.test(id)) ??
    ids.find(isChatModel)
  if (!model)
    return {
      ok: false,
      error: '這個帳號目前沒有可用的 gpt 型號——通常是還沒儲值。到 OpenAI 帳單頁加值後再試',
    }
  return { ok: true, model }
}

/** 用 prompt + 資料生成洞察。沒設定金鑰會 throw 友善訊息。 */
export const generateInsight = async (prompt: string, data: string): Promise<string> => {
  const key = getOpenAIKey()
  if (!key) throw new Error('請先到 ⚙ 設定填入你自己的 OpenAI 金鑰')

  // 這一支原本完全沒有逾時：OpenAI 卡住、或連線半死，畫面就永遠停在「分析中…」，
  // 按鈕 disabled，只能重開 App（Codex 互審第 6 輪 P2-1）。
  // 60 秒：mini 型號寫 700 tokens 通常 10 秒內，留三倍餘裕給慢速網路。
  const r = await fetchJsonWithTimeout(
    'https://api.openai.com/v1/chat/completions',
    {
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
    },
    60_000
  )
  if ('timedOut' in r)
    throw new Error('AI 逾時（60 秒沒回應）——請再試一次，或檢查 OpenAI 服務狀態')
  if ('netError' in r) throw new Error('連不上 OpenAI——請檢查網路連線')

  if (r.status === 401) throw new Error('金鑰無效或已被撤銷，請到 ⚙ 設定重新填一次')
  if (r.status === 429)
    throw new Error('OpenAI 回報額度不足或請求過於頻繁——請確認你的 OpenAI 帳戶還有餘額')
  if (!r.ok) {
    const b = r.body as { error?: { message?: string } }
    throw new Error(`AI 失敗（${r.status}）：${b.error?.message ?? '未知錯誤'}`)
  }
  const text =
    (r.body as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ??
    ''
  if (!text) throw new Error('AI 沒有回傳內容，請再試一次')
  return String(text)
}
