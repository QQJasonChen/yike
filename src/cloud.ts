// 帳號制雲端同步（Supabase）
// - Email 驗證碼登入（免密碼）
// - journal 資料表：每個 localStorage key 一列，Row Level Security 隔離每個用戶
// - 同步策略：逐 key 比時間戳，新的贏（pull 先、push 後）
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, cloudEnabled } from './cloudConfig'
import { allDataKeys, loadMeta, setOnDataWrite, writeFromCloud } from './storage'

let client: SupabaseClient | null = null

// 動態載入：沒啟用雲端的用戶完全不下載 supabase-js
export const supa = async (): Promise<SupabaseClient> => {
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js')
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  }
  return client
}

export { cloudEnabled }

export const sendCode = async (email: string) => {
  const { error } = await (await supa()).auth.signInWithOtp({ email })
  if (error) throw new Error(error.message)
}

export const verifyCode = async (email: string, code: string) => {
  const { error } = await (await supa()).auth.verifyOtp({ email, token: code, type: 'email' })
  if (error) throw new Error('驗證碼不正確或已過期')
}

export const currentEmail = async (): Promise<string | null> => {
  const { data } = await (await supa()).auth.getSession()
  return data.session?.user.email ?? null
}

export const signOut = async () => (await supa()).auth.signOut()

interface Row {
  key: string
  value: unknown
  updated_at: string
}

/** 雙向同步：回傳 { pulled, pushed } */
export const syncNow = async (): Promise<{ pulled: number; pushed: number }> => {
  const db = await supa()
  const { data: sess } = await db.auth.getSession()
  const user = sess.session?.user
  if (!user) throw new Error('請先登入')

  const meta = loadMeta()

  // 1) Pull：伺服器比本機新的 key 落地
  const { data: rows, error } = await db.from('journal').select('key,value,updated_at')
  if (error) throw new Error(`下載失敗：${error.message}`)
  const serverTs: Record<string, number> = {}
  let pulled = 0
  for (const r of (rows ?? []) as Row[]) {
    const ts = new Date(r.updated_at).getTime()
    serverTs[r.key] = ts
    if (ts > (meta[r.key] ?? 0)) {
      writeFromCloud(r.key, r.value, ts)
      pulled++
    }
  }

  // 2) Push：本機比伺服器新的 key 上傳
  const freshMeta = loadMeta()
  const toPush = allDataKeys()
    .filter((k) => (freshMeta[k] ?? 0) > (serverTs[k] ?? 0))
    .map((k) => ({
      user_id: user.id,
      key: k,
      value: JSON.parse(localStorage.getItem(k)!),
      updated_at: new Date(freshMeta[k] ?? Date.now()).toISOString(),
    }))
  if (toPush.length) {
    const { error: upErr } = await db
      .from('journal')
      .upsert(toPush, { onConflict: 'user_id,key' })
    if (upErr) throw new Error(`上傳失敗：${upErr.message}`)
  }

  return { pulled, pushed: toPush.length }
}

let pushTimer: ReturnType<typeof setTimeout> | null = null

/** 啟動自動同步：登入狀態下，開站先同步一次，之後每次寫入 4 秒後自動推送 */
export const startAutoSync = async (onChange?: (msg: string) => void): Promise<void> => {
  if (!cloudEnabled()) return
  const email = await currentEmail()
  if (!email) return

  try {
    const { pulled } = await syncNow()
    onChange?.(`已同步（${email}）`)
    // 開站時拉到新資料 → 重新整理一次讓畫面吃到（防迴圈旗標）
    if (pulled > 0 && !sessionStorage.getItem('pp:justSynced')) {
      sessionStorage.setItem('pp:justSynced', '1')
      location.reload()
      return
    }
    sessionStorage.removeItem('pp:justSynced')
  } catch {
    onChange?.('自動同步失敗，稍後會再試')
  }

  setOnDataWrite(() => {
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      syncNow()
        .then(() => onChange?.('已自動同步'))
        .catch(() => onChange?.('同步失敗，下次寫入時重試'))
    }, 4000)
  })
}

export const stopAutoSync = () => {
  setOnDataWrite(null)
  if (pushTimer) clearTimeout(pushTimer)
}
