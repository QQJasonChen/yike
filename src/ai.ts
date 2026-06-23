// AI 洞察：呼叫站方 edge function（用站方 OpenAI key）。需登入。
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './cloudConfig'
import { supa } from './cloud'

// edge function 部署、OPENAI_KEY 設好後，改成 true 即露出 AI 按鈕。
export const AI_ENABLED = false

export const aiEnabled = (): boolean => AI_ENABLED && Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

/** 用 prompt + 資料生成洞察。未登入或超過上限會 throw 友善訊息。 */
export const generateInsight = async (prompt: string, data: string): Promise<string> => {
  const db = await supa()
  const { data: sess } = await db.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('AI 分析需要先登入帳號（到 ⚙ 設定登入，朋友用邀請碼 QQ 即可）')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-insight`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ prompt, data }),
  })
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
  if (!res.ok) throw new Error(body.error ?? `AI 失敗（${res.status}）`)
  return String(body.text ?? '')
}
