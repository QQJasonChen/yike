// 給 AI 助理的唯讀 token：產生、雜湊、管理。
//
// 明文 token 只在產生那一刻回給畫面，之後只存 sha256 hash（資料庫被讀走也拿不到可用的 token）。
// 格式 yk_ + 32 bytes base64url（43 字元）。edge function 用同一個 hash 去查。
import { supa } from './cloud'

export const TOKEN_PREFIX = 'yk_'

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const generateAgentToken = (): string => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return TOKEN_PREFIX + b64url(bytes)
}

export const hashAgentToken = async (token: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface AgentTokenMeta {
  id: string
  label: string
  scope: string
  created_at: string
  last_used_at: string | null
}

/** 這個帳號目前有效（未撤銷）的 token。RLS 保證只看得到自己的。 */
export const listAgentTokens = async (): Promise<AgentTokenMeta[]> => {
  const db = await supa()
  const { data, error } = await db
    .from('agent_tokens')
    .select('id,label,scope,created_at,last_used_at')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`讀取 token 清單失敗：${error.message}`)
  return (data ?? []) as AgentTokenMeta[]
}

/** 產生一組新 token，存 hash，回明文（**只回這一次**，之後拿不到）與它的 id。 */
export const createAgentToken = async (label: string): Promise<{ token: string; id: string }> => {
  const db = await supa()
  const { data: sess } = await db.auth.getSession()
  const uid = sess.session?.user.id
  if (!uid) throw new Error('請先登入')
  const token = generateAgentToken()
  const token_hash = await hashAgentToken(token)
  const { data, error } = await db
    .from('agent_tokens')
    .insert({ user_id: uid, token_hash, label: label.trim().slice(0, 60), scope: 'read' })
    .select('id')
    .single()
  if (error) throw new Error(`建立 token 失敗：${error.message}`)
  return { token, id: (data as { id: string }).id }
}

/** 撤銷＝填 revoked_at。edge function 查詢帶 revoked_at=is.null，立刻失效。 */
export const revokeAgentToken = async (id: string): Promise<void> => {
  const db = await supa()
  const { error } = await db
    .from('agent_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`撤銷失敗：${error.message}`)
}
