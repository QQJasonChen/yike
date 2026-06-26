// 帳號制雲端同步（Supabase）
// - Email 驗證碼登入（免密碼）
// - journal 資料表：每個 localStorage key 一列，Row Level Security 隔離每個用戶
// - 同步策略：逐 key 比時間戳，新的贏（pull 先、push 後）
import { Capacitor } from '@capacitor/core'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, cloudEnabled } from './cloudConfig'
import {
  allDataKeys,
  clearAllLocalData,
  clearSupabaseTokens,
  hasCloudArtifact,
  loadMeta,
  markCloudBound,
  openSyncGate,
  setOnDataWrite,
  writeFromCloud,
} from './storage'

let clientPromise: Promise<SupabaseClient> | null = null

// 動態載入：沒啟用雲端的用戶完全不下載 supabase-js。
// 記住「Promise」而非「client」：supa() 是 async，在 null 檢查與賦值之間有 await，
// 若記 client 會讓並發的首次呼叫各自 createClient → 多個 GoTrueClient 實例搶同一個
// storage key（auth/同步未定義行為）。記 Promise 可保證全程只建立一個 client。
export const supa = (): Promise<SupabaseClient> => {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    )
  }
  return clientPromise
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
    if (/signup.*(disabled|not allowed)/i.test(upErr.message)) {
      // 公開註冊已關 → 試付費白名單（Portaly 買家用購買 Email 自動開通）
      try {
        await activateLicense('', email, password)
        return 'up'
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (msg !== 'not-entitled') throw e
        throw new Error(
          Capacitor.isNativePlatform()
            ? '此 Email 尚未開通帳號。雲端同步目前開放給既有帳號，請確認 Email 與密碼是否正確。'
            : '此 Email 尚未開通。請改用「購買時填的那個 Email」登入即可自動開通（Gumroad / Portaly 皆同）。購買後若隔幾分鐘仍無法登入，或想用序號開通，請點下方「我有購買序號」。'
        )
      }
    }
    if (/already registered/i.test(upErr.message))
      throw new Error('這個 Email 已經開通過——請確認密碼是否輸入正確')
    throw new Error(upErr.message)
  }
  if (!data.session)
    throw new Error('一刻手帳採邀請制——請聯繫站方開通帳號，或確認密碼是否輸入正確')
  return 'up'
}

// 朋友共用邀請碼（軟性 gate）。Beta 期間 Supabase 已開放註冊，輸入此碼＝直接建免費帳號。
// Beta 結束把 Supabase 註冊關掉，這條路自然失效，已建好的朋友帳號照常。
export const FRIEND_CODE = 'QQ'

/** 開通：邀請碼 → 直接建免費帳號；其他字串 → 當作 Gumroad 購買序號 */
export const activateWithCode = async (
  code: string,
  email: string,
  password: string
): Promise<'in' | 'up'> => {
  if (code.trim().toUpperCase() === FRIEND_CODE) return signInOrUp(email, password)
  await activateLicense(code, email, password)
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
  if (!email) {
    // 這台有雲端登入殘留（標記或 Supabase token），但目前沒有有效 session
    // （登出 / 過期 / 舊版殘留）→ 清掉本機資料＋token、回到全空白。
    // 資料都在雲端，重新登入即還原。從沒碰過雲端的純本機訪客不受影響。
    if (hasCloudArtifact()) {
      clearSupabaseTokens() // 先清 token，避免重整後又判定為殘留→無限重整
      clearAllLocalData()
      location.reload()
      return
    }
    openSyncGate() // 萬一 main.tsx 關了閘門但這裡判定無 session（race）：放開，避免寫入被卡住不同步
    return
  }
  markCloudBound()

  // 先掛好自動推送，再打開閘門——這樣 openSyncGate flush 的 key 會被排進推送
  setOnDataWrite(() => {
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      syncNow()
        .then(() => onChange?.('已自動同步'))
        .catch(() => onChange?.('同步失敗，下次寫入時重試'))
    }, 4000)
  })

  try {
    // 首次 pull 加逾時保護：就算網路掛了也要在 8 秒內打開閘門，不讓本機寫入永遠卡住
    const { pulled } = (await Promise.race([
      syncNow(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('sync-timeout')), 8000)),
    ])) as { pulled: number; pushed: number }
    onChange?.(`已同步（${email}）`)
    // 開站時拉到新資料 → 重新整理一次讓畫面吃到（防迴圈旗標）
    if (pulled > 0 && !sessionStorage.getItem('pp:justSynced')) {
      sessionStorage.setItem('pp:justSynced', '1')
      openSyncGate()
      location.reload()
      return
    }
    sessionStorage.removeItem('pp:justSynced')
  } catch {
    onChange?.('自動同步失敗，稍後會再試')
  } finally {
    openSyncGate() // 不論成功/失敗/逾時，首次同步後一律打開閘門
  }

  // 切回 app／分頁時立刻拉一次（手機-電腦輪流用時幾乎即時）
  let lastVisPull = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (Date.now() - lastVisPull < 15_000) return
    lastVisPull = Date.now()
    syncNow().catch(() => {})
  })
}

export const stopAutoSync = () => {
  setOnDataWrite(null)
  if (pushTimer) clearTimeout(pushTimer)
}
