// Garmin 官方 Health API 直連（前端）：連結帳號、查狀態、拉回 Garmin 推送的每日摘要。
// 後端：supabase/functions/garmin-oauth（OAuth PKCE）、garmin-webhook（接收推送）。
// 需要登入一刻雲端帳號——Garmin 是推送到伺服器，得知道要放進誰的帳號。
import { Capacitor } from '@capacitor/core'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './cloudConfig'
import { parseGarminJson, mergeRecords, type HealthRecord } from './health'
import { addDays, toDateKey } from './storage'

const LINKED_KEY = 'ppl:garminLinked' // 快取「這個帳號已連結 Garmin」，免得每次開 app 都問伺服器

export interface GarminStatus {
  configured: boolean // 站方是否已設定 Garmin 開發者金鑰
  linked: boolean
  signedIn: boolean
}

const session = async () => {
  const { supa } = await import('./cloud')
  const { data } = await (await supa()).auth.getSession()
  return data.session
}

const call = async (body: Record<string, unknown>) => {
  const s = await session()
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/garmin-oauth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${s?.access_token ?? SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('連不上伺服器——請確認網路後再試')
  }
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(String(out.error ?? `伺服器回應 ${res.status}`))
  return out
}

export const garminLinkedCached = (): boolean => localStorage.getItem(LINKED_KEY) === '1'
const setLinkedCache = (on: boolean) =>
  on ? localStorage.setItem(LINKED_KEY, '1') : localStorage.removeItem(LINKED_KEY)

export const garminStatus = async (): Promise<GarminStatus> => {
  const s = await session().catch(() => null)
  if (!s) return { configured: true, linked: false, signedIn: false }
  const out = await call({ action: 'status' })
  const linked = Boolean(out.linked)
  setLinkedCache(linked)
  return { configured: out.configured !== false, linked, signedIn: true }
}

/** 導去 Garmin 同意頁；同意後 Garmin 導回 app，網址帶 ?garmin=linked */
export const garminConnect = async (): Promise<void> => {
  const returnTo = Capacitor.isNativePlatform()
    ? 'https://yikeday.com/' // 原生 app 用系統瀏覽器授權，完成後回 app 按「重新整理」即可
    : location.origin + location.pathname
  const out = await call({ action: 'start', returnTo })
  if (typeof out.url !== 'string') throw new Error('Garmin 直連尚未開放')
  if (Capacitor.isNativePlatform()) window.open(out.url, '_blank')
  else location.href = out.url
}

export const garminUnlink = async (): Promise<void> => {
  await call({ action: 'unlink' })
  setLinkedCache(false)
}

/** 讀自己帳號在 health_daily 的資料（RLS 只看得到自己的），解析成日紀錄 */
export const pullGarminHealth = async (days = 45): Promise<HealthRecord[]> => {
  const { supa } = await import('./cloud')
  const db = await supa()
  const since = addDays(toDateKey(new Date()), -days)
  const { data, error } = await db.from('health_daily').select('day,data').gte('day', since)
  if (error) throw new Error(error.message)
  const recs: HealthRecord[] = []
  for (const row of (data ?? []) as { day: string; data: Record<string, unknown> }[]) {
    // 每個摘要類型各自帶 calendarDate；保險起見以列的 day 為準
    for (const r of parseGarminJson(Object.values(row.data ?? {}))) recs.push({ date: row.day, m: r.m })
  }
  return mergeRecords(recs)
}

/** OAuth 導回時網址會帶 ?garmin=…，讀完就從網址拿掉 */
export const consumeGarminRedirect = (): string | null => {
  const u = new URL(location.href)
  const v = u.searchParams.get('garmin')
  if (!v) return null
  u.searchParams.delete('garmin')
  history.replaceState(null, '', u.pathname + u.search + u.hash)
  if (v === 'linked') setLinkedCache(true)
  return v
}
