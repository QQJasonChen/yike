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

/** 用 Gumroad 序號自動開通帳號（付費自動開通），成功後直接登入 */
export const activateLicense = async (
  licenseKey: string,
  email: string,
  password: string
): Promise<void> => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ licenseKey, email, password }),
  })
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  if (!res.ok || !body.ok) throw new Error(body.error ?? `開通失敗（${res.status}）`)
  const db = await supa()
  const { error } = await db.auth.signInWithPassword({ email, password })
  if (error) throw new Error('帳號已開通，但自動登入失敗——請直接用帳密登入')
}

/** 登入；帳號不存在時自動註冊（autoconfirm 已開，註冊即用） */
export const signInOrUp = async (email: string, password: string): Promise<'in' | 'up'> => {
  const db = await supa()
  const { error } = await db.auth.signInWithPassword({ email, password })
  if (!error) return 'in'
  if (!/invalid login credentials/i.test(error.message)) throw new Error(error.message)
  // 帳號不存在 → 嘗試註冊（邀請制關閉公開註冊時會被擋下）
  const { data, error: upErr } = await db.auth.signUp({ email, password })
  if (upErr) {
    if (/signup.*(disabled|not allowed)/i.test(upErr.message))
      throw new Error('一刻手帳採邀請制——尚未開通的帳號無法登入。已購買／已索取邀請的話，請聯繫站方開通。')
    if (/already registered/i.test(upErr.message))
      throw new Error('這個 Email 已經開通過——請確認密碼是否輸入正確')
    throw new Error(upErr.message)
  }
  if (!data.session)
    throw new Error('一刻手帳採邀請制——請聯繫站方開通帳號，或確認密碼是否輸入正確')
  return 'up'
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
