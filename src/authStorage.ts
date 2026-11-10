// Supabase 登入 session 的儲存介面（取代預設的 window.localStorage）。
//
// 事故（2026-11-10 用戶回報）：localStorage 被日記＋每日快照塞滿後，
// supabase-js 呼叫 localStorage.setItem('sb-…-auth-token') 直接丟 QuotaExceededError，
// 登入、重設密碼後登入全部失敗，畫面只剩一行英文錯誤。
//
// 這裡的策略（由輕到重，任何一步都不刪使用者資料）：
//   1. 照舊寫 localStorage（既有已登入的使用者 session 不受影響）。
//   2. 配額滿 → 先把本機快照搬到 IndexedDB 封存區釋放空間（驗證後才移除），再試一次。
//   3. 還是不行 → 把 token 寫進 IndexedDB 備援區，並留在記憶體，登入照樣成功。
// 讀取順序：記憶體 → localStorage → IndexedDB。移除時三處一起清。
import { STORE_AUTH, idbAvailable, idbDelete, idbGet, idbSet } from './idb'
import { archiveLocalBackups } from './storage'

const memory = new Map<string, string>()

const isQuotaError = (e: unknown): boolean => {
  if (!(e instanceof Error) && !(typeof DOMException !== 'undefined' && e instanceof DOMException)) return false
  const err = e as { name?: string; code?: number; message?: string }
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014 ||
    /quota/i.test(err.message ?? '')
  )
}

const tryLocalSet = (key: string, value: string): unknown => {
  try {
    localStorage.setItem(key, value)
    return null
  } catch (e) {
    return e ?? new Error('localStorage-set-failed')
  }
}

const localGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const localRemove = (key: string) => {
  try {
    localStorage.removeItem(key)
  } catch { /* 拒絕存取：沒東西可清 */ }
}

export const authStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const mem = memory.get(key)
    if (mem !== undefined) return mem
    const local = localGet(key)
    if (local !== null) return local
    if (!idbAvailable()) return null
    try {
      const v = await idbGet<string>(STORE_AUTH, key)
      if (typeof v !== 'string') return null
      memory.set(key, v)
      return v
    } catch {
      return null
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    memory.set(key, value) // 不論落地在哪，這次執行期間一定拿得到
    let err = tryLocalSet(key, value)
    if (err && isQuotaError(err)) {
      try { await archiveLocalBackups() } catch { /* 搬不動就走備援 */ }
      err = tryLocalSet(key, value)
    }
    if (!err) {
      // 已回到 localStorage：舊的 IndexedDB 備援一定要清，否則之後讀到過期 token
      if (idbAvailable()) await idbDelete(STORE_AUTH, key).catch(() => {})
      return
    }
    // localStorage 仍寫不進去：舊值也得拿掉，不然重開 app 會讀到上一個（已失效的）session
    localRemove(key)
    if (!idbAvailable()) return // 只剩記憶體：本次可用，重開要重新登入，但不會報錯擋住登入
    try {
      await idbSet(STORE_AUTH, key, value)
    } catch {
      /* IndexedDB 也拒絕：仍保留記憶體 session，不讓登入流程失敗 */
    }
  },

  removeItem: async (key: string): Promise<void> => {
    memory.delete(key)
    localRemove(key)
    if (idbAvailable()) await idbDelete(STORE_AUTH, key).catch(() => {})
  },
}

/** 測試用 */
export const __resetAuthMemoryForTests = () => memory.clear()
