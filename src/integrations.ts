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
  /** 顯示用：用戶貼的原始頁面連結 */
  parentUrl: string
}

export const loadNotionConfig = (): NotionConfig | null => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw) as Partial<NotionConfig>
    if (!cfg.token || !cfg.parentPageId) return null
    return { token: cfg.token, parentPageId: cfg.parentPageId, parentUrl: cfg.parentUrl ?? '' }
  } catch {
    return null
  }
}

export const saveNotionConfig = (cfg: NotionConfig | null): void => {
  if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg))
  else localStorage.removeItem(KEY)
}

/** 從 Notion 頁面連結（或直接貼 ID）抽出 32 碼頁面 ID，轉成帶連字號的 UUID */
export const extractNotionPageId = (input: string): string | null => {
  const s = input.trim()
  const dashed = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  const raw = dashed?.[0].replace(/-/g, '') ?? s.replace(/\?.*$/, '').match(/[0-9a-f]{32}(?![0-9a-f])/gi)?.pop()
  if (!raw) return null
  const h = raw.toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
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

interface PushResult {
  ok?: boolean
  url?: string
  error?: string
}

/** 直送 Notion（dryRun = 只測試連線不寫入）。失敗丟出帶人話的 Error。 */
export const pushToNotion = async (
  cfg: NotionConfig,
  title: string,
  markdown: string,
  dryRun = false
): Promise<{ url?: string }> => {
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/notion-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ token: cfg.token, parentPageId: cfg.parentPageId, title, markdown, dryRun }),
    })
  } catch {
    throw new Error('連不上匯出服務——請確認網路後再試')
  }
  const body = (await res.json().catch(() => ({}))) as PushResult
  if (!res.ok || !body.ok) throw new Error(body.error ?? `匯出失敗（${res.status}）`)
  return { url: body.url }
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
