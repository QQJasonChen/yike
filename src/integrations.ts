// 第二大腦整合：範圍匯出的共用邏輯（Notion 直送設定 + 快速日期範圍 + 下載）
// Heptabase 沒有公開 API——走「複製 / 下載 .md」路線（貼進 journal 或拖進 app 即成卡片）。
// Notion 直送：用戶自帶 integration token（只存在自己裝置的 localStorage），
// 經 notion-push edge function 無狀態轉發（瀏覽器直打 api.notion.com 會被 CORS 擋）。

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './cloudConfig'
import { addDays, mondayOf } from './storage'

const KEY = 'pp:integrations'

export interface NotionConfig {
  token: string
  parentPageId: string
  /** 顯示用：正規化的官方 Notion 頁面連結 */
  parentUrl: string
}

export const loadNotionConfig = (): NotionConfig | null => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw) as Partial<NotionConfig> | null
    if (!cfg || typeof cfg.token !== 'string' || !cfg.token.trim() || cfg.token.length > 4096 ||
        typeof cfg.parentPageId !== 'string') return null
    const parentPageId = extractNotionPageId(cfg.parentPageId)
    if (!parentPageId) return null
    return { token: cfg.token.trim(), parentPageId, parentUrl: notionPageUrl(parentPageId)! }
  } catch {
    return null
  }
}

export const saveNotionConfig = (cfg: NotionConfig | null): void => {
  if (cfg) {
    const parentPageId = extractNotionPageId(cfg.parentPageId)
    if (!parentPageId || typeof cfg.token !== 'string' || !cfg.token.trim() || cfg.token.length > 4096)
      throw new Error('請填入有效的 Notion 頁面 ID 與 Integration Secret')
    localStorage.setItem(KEY, JSON.stringify({
      token: cfg.token.trim(), parentPageId, parentUrl: notionPageUrl(parentPageId),
    }))
  }
  else localStorage.removeItem(KEY)
}

/** 從 Notion 頁面連結（或直接貼 ID）抽出 32 碼頁面 ID，轉成帶連字號的 UUID */
export const extractNotionPageId = (input: string): string | null => {
  const s = input.trim()
  if (!s || s.length > 2048 || [...s].some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)) return null
  const idPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}'
  let raw = s.match(new RegExp(`^(?:${idPattern})$`, 'i'))?.[0]
  if (!raw) {
    let url: URL
    try { url = new URL(s) } catch { return null }
    const official = ['notion.so', 'notion.site'].some(host =>
      url.hostname === host || url.hostname.endsWith(`.${host}`))
    if (url.protocol !== 'https:' || !official || url.username || url.password || url.port) return null
    // Only a terminal page ID in the path; query/fragment IDs cannot authorize a link.
    raw = url.pathname.replace(/\/$/, '').match(new RegExp(`(?:^|[-/])(${idPattern})$`, 'i'))?.[1]
  }
  if (!raw) return null
  const h = raw.replace(/-/g, '').toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Never expose an arbitrary pasted/provider URL as href; discard query/fragment/title. */
export const notionPageUrl = (input: string): string | null => {
  const id = extractNotionPageId(input)
  return id ? `https://www.notion.so/${id.replace(/-/g, '')}` : null
}

export type RangePreset = 'today' | 'last7' | 'week' | 'month'

/** 快速範圍 → { from, to }（皆為本地日期 key） */
export const presetRange = (preset: RangePreset, todayKey: string): { from: string; to: string } => {
  switch (preset) {
    case 'today':
      return { from: todayKey, to: todayKey }
    case 'last7':
      return { from: addDays(todayKey, -6), to: todayKey }
    case 'week':
      return { from: mondayOf(todayKey), to: todayKey }
    case 'month':
      return { from: `${todayKey.slice(0, 7)}-01`, to: todayKey }
  }
}

export type NotionFailureOutcome = 'partial' | 'uncertain' | 'rejected'

export class NotionPushError extends Error {
  constructor(message: string, readonly outcome: NotionFailureOutcome, readonly url?: string) {
    super(message)
    this.name = 'NotionPushError'
  }
}

const readPushResponse = async (res: Response): Promise<Record<string, unknown>> => {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('missing response')
  const decoder = new TextDecoder()
  let bytes = 0
  let json = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 64 * 1024) throw new Error('response too large')
      json += decoder.decode(value, { stream: true })
    }
    json += decoder.decode()
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid response')
    return parsed as Record<string, unknown>
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
}

const uncertainMessage = '無法確認這次是否已寫入 Notion。請先檢查目標頁面，再決定是否重送，避免重複頁面。'

/** One request only. Write errors retain a safe page receipt; absence of it is uncertain. */
export const pushToNotion = async (
  cfg: NotionConfig,
  title: string,
  markdown: string,
  dryRun = false
): Promise<{ url?: string }> => {
  const parentPageId = extractNotionPageId(cfg.parentPageId)
  if (!parentPageId || typeof cfg.token !== 'string' || !cfg.token.trim() || cfg.token.length > 4096)
    throw new NotionPushError('請先完成有效的 Notion 設定', 'rejected')
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/notion-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ token: cfg.token, parentPageId, title, markdown, dryRun }),
      signal: AbortSignal.timeout(35000),
      redirect: 'error',
    })
  } catch {
    throw new NotionPushError(dryRun ? '連不上匯出服務，請確認網路後再測試' : uncertainMessage,
      dryRun ? 'rejected' : 'uncertain')
  }
  let body: Record<string, unknown>
  try { body = await readPushResponse(res) } catch {
    throw new NotionPushError(dryRun ? '無法確認連線測試結果，請重新測試' : uncertainMessage,
      dryRun ? 'rejected' : 'uncertain')
  }
  const url = typeof body.url === 'string' ? notionPageUrl(body.url) : null
  if (res.ok && body.ok === true && body.error === undefined &&
      (body.outcome === undefined || body.outcome === 'complete') && (dryRun || url))
    return dryRun ? {} : { url: url! }
  const reason = typeof body.error === 'string' && body.error.trim()
    ? body.error.slice(0, 500) : `匯出服務回應不完整（${res.status}）`
  if (dryRun) throw new NotionPushError(reason, 'rejected')
  if (url) throw new NotionPushError(`頁面已建立，但無法確認內容完整。${reason} 請先開啟頁面檢查，避免重複匯出。`, 'partial', url)
  throw new NotionPushError(`${reason} ${uncertainMessage}`, 'uncertain')
}

/** 下載 Markdown 檔（拖進 Heptabase 即成卡片；Notion 也可 import） */
export const downloadMarkdown = (filename: string, md: string): void => {
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
