// 帳號制雲端同步（Supabase）
// - 購買序號開通，既有帳號以 Email + 密碼登入
// - journal 資料表：每個 localStorage key 一列，Row Level Security 隔離每個用戶
// - 同步策略：逐 key 比時間戳，新的贏（pull 先、push 後）
import { Capacitor } from '@capacitor/core'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, cloudEnabled } from './cloudConfig'
import {
  allDataKeys,
  clearCloudDataOnSessionLoss,
  clearSupabaseTokens,
  getDataOwner,
  hasCloudArtifact,
  loadDirty,
  loadMeta,
  localDataCount,
  markSynced,
  migrateDirtyOnce,
  markCloudBound,
  openSyncGate,
  setDataOwner,
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

/** 既有帳號登入。新帳號須另走持有購買序號的開通流程。 */
export const signInOrUp = async (email: string, password: string): Promise<'in' | 'up'> => {
  const db = await supa()
  const { error } = await db.auth.signInWithPassword({ email, password })
  if (!error) return 'in'
  if (!/invalid login credentials/i.test(error.message)) throw new Error(error.message)
  throw new Error(
    Capacitor.isNativePlatform()
      ? 'Email 或密碼不正確。請使用開通時的 Email 與密碼登入。'
      : 'Email 或密碼不正確。已有帳號請確認帳密；第一次使用請回「啟用雲端同步」，填購買序號開通。'
  )
}

/** 新帳號開通：購買序號與購買 Email 都交給伺服器驗證。 */
export const activateWithCode = async (
  code: string,
  email: string,
  password: string
): Promise<'in' | 'up'> => {
  const c = code.trim()
  if (!c) throw new Error('請填入購買序號（License Key）；購買信的「檢視內容」裡可以找到。')
  await activateLicense(c, email, password)
  return 'up'
}

export const currentUserId = async (): Promise<string | null> => {
  const { data } = await (await supa()).auth.getSession()
  return data.session?.user.id ?? null
}

export const currentEmail = async (): Promise<string | null> => {
  const { data } = await (await supa()).auth.getSession()
  return data.session?.user.email ?? null
}

export const signOut = async () => (await supa()).auth.signOut()

/** 永久刪除帳號＋雲端資料（App Store 強制）。成功後呼叫端應清本機並重整。 */
export const deleteAccount = async (): Promise<void> => {
  const db = await supa()
  const { data: sess } = await db.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('請先登入')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  })
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  if (!res.ok || !body.ok) throw new Error(body.error ?? `刪除失敗（${res.status}）`)
  await db.auth.signOut().catch(() => {})
}

interface Row {
  key: string
  value: unknown
  updated_at: string
}

/** 雙向同步：回傳 { pulled, pushed } */
// 同步一次只跑一個。自動 timer、visibility handler、手動按鈕都可能同時發動，
// 兩個同步互相超車時：A 送出 revision 1 → 使用者改成 revision 2 → B 送出並先完成、
// 清掉 dirty → A 的舊 upsert 後落庫。伺服器留下 revision 1，而 revision 2 已經
// 沒有 dirty 可以重推，那筆編輯就永遠消失了。版號只保護「單一請求期間又編輯」，
// 保護不了兩個請求交錯（Codex 互審第 2 輪 P1）。序列化最省事也最可靠。
let syncChain: Promise<unknown> = Promise.resolve()
export let syncSlotTimeoutMs = 30_000
/** 測試用：把「佔用同步 queue 的上限」調短，免得單元測試真的等 30 秒。 */
export const __setSyncSlotTimeout = (ms: number) => {
  syncSlotTimeoutMs = ms
}

export const syncNow = (opts?: {
  onUnclaimed?: 'claim' | 'reject'
}): Promise<{ pulled: number; pushed: number }> => {
  const run = syncChain.then(
    () => syncNowInner(opts),
    () => syncNowInner(opts) // 前一次失敗不該卡住後面的同步
  )
  // 佔用 queue 的時間要有上限。只等 run 的話，一個永遠 pending 的請求
  // （網路吊死、fetch 不 reject）會讓 syncChain 永不 settle，之後所有自動推送
  // 與 visibility 同步都排在它後面，這個頁面生命週期內再也不會同步
  //（Codex 互審第 3 輪 P1）。
  // 逾時只釋放「排隊位置」，不假裝那次同步失敗——呼叫端拿到的仍是真實的 run。
  // 舊的同步即使後來才回來也不會造成超車：它推的是自己送出當下的版號，
  // markSynced 比對版號不符就不會清掉後來的編輯。
  syncChain = Promise.race([
    run.catch(() => {}),
    new Promise((res) => setTimeout(res, syncSlotTimeoutMs)),
  ])
  return run
}

const syncNowInner = async (opts?: {
  onUnclaimed?: 'claim' | 'reject'
}): Promise<{ pulled: number; pushed: number }> => {
  const onUnclaimed = opts?.onUnclaimed ?? 'claim'
  const db = await supa()
  const { data: sess } = await db.auth.getSession()
  const user = sess.session?.user
  if (!user) throw new Error('請先登入')

  // 資料歸屬把關：這台裝置的本機資料如果不屬於目前登入者，絕不能推上他的帳號。
  // （共用裝置：A 在本機寫日記 → B 登入 → A 的內容整包進 B 的雲端，還可能覆蓋 B 的記錄。
  //   RLS 擋不到，因為寫入的確實是 B 的 session、B 的 user_id，只是內容不是 B 的。）
  //
  // onUnclaimed 的預設是 'claim'：既有 session 的背景同步照舊，不打擾現有使用者。
  // 「登入」這個動作才是風險點，UI 在那裡改傳 'reject'，由使用者親自決定要不要合併。
  const owner = getDataOwner()
  if (owner && owner !== user.id) throw new Error('device-owner-mismatch')
  if (!owner) {
    if (onUnclaimed === 'reject' && localDataCount() > 0)
      throw new Error('device-unclaimed-data')
    setDataOwner(user.id)
  }

  const beforePull = new Map(allDataKeys().map((key) => [key, localStorage.getItem(key)]))

  // 1) Pull：伺服器比本機新的 key 落地
  const { data: rows, error } = await db.from('journal').select('key,value,updated_at')
  if (error) throw new Error(`下載失敗：${error.message}`)
  const serverTs: Record<string, number> = {}
  let pulled = 0
  migrateDirtyOnce(
    Object.fromEntries(((rows ?? []) as Row[]).map((r) => [r.key, new Date(r.updated_at).getTime()]))
  )
  const dirtyBefore = loadDirty()
  const meta = loadMeta()
  for (const r of (rows ?? []) as Row[]) {
    const ts = new Date(r.updated_at).getTime()
    serverTs[r.key] = ts
    // 有本機未上傳的改動就不要蓋掉它——使用者剛寫的東西不能無聲消失。
    // 這個 key 會在下面的 push 階段上傳，以本機版本為準。
    if (dirtyBefore[r.key]) continue
    const localTs = meta[r.key] ?? 0
    // PostgreSQL preserves microseconds; Date.getTime() keeps only milliseconds.
    // A clean local copy must also refresh when the current server value changed
    // within that same millisecond. Unsynced edits are still protected above.
    const localRaw = localStorage.getItem(r.key)
    const unchangedWhileWaiting = localRaw === (beforePull.get(r.key) ?? null)
    if (ts > localTs || (ts === localTs && unchangedWhileWaiting && JSON.stringify(r.value) !== localRaw)) {
      writeFromCloud(r.key, r.value, ts)
      pulled++
    }
  }

  // 2) Push：只推「本機改過還沒上傳」的 key（髒標記），不比任何時鐘。
  //    updated_at 一律不送——由資料庫 trigger 寫成伺服器的 now()，
  //    這樣客戶端時鐘設錯也污染不了排序基準。
  const dirty = loadDirty()
  const existing = new Set(allDataKeys())
  const pushKeys = Object.keys(dirty).filter((k) => existing.has(k))
  const pushedRevs = Object.fromEntries(pushKeys.map((k) => [k, dirty[k]]))
  const toPush = pushKeys.map((k) => ({
    user_id: user.id,
    key: k,
    value: JSON.parse(localStorage.getItem(k)!),
  }))
  if (toPush.length) {
    const { data: saved, error: upErr } = await db
      .from('journal')
      .upsert(toPush, { onConflict: 'user_id,key' })
      .select('key,updated_at')
    if (upErr) throw new Error(`上傳失敗：${upErr.message}`)
    // 用伺服器回傳的時間戳對齊本機 meta，並清掉髒標記。
    // 沒有這一步，本機 meta 會停在客戶端時鐘，下次 pull 又會誤判。
    // 帶上「送出當下的版號」：markSynced 只清版號沒變的 key，
    // 推送期間又被編輯過的會保留標記，下次同步帶走。
    markSynced((saved ?? []) as { key: string; updated_at: string }[], pushedRevs)
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
    //
    // 但「曾綁定雲端」不等於「所有本機內容都已上雲」。離線編輯後 token 剛好
    // 過期時，那些內容還是 dirty；舊版在這裡無條件清除，連 pp:bk:* 七天備份
    // 都一起刪掉，使用者永遠救不回來（Codex 互審第 3 輪 P0）。
    // 現在：有未同步內容就不清，請使用者重新登入把它帶上去。
    if (hasCloudArtifact()) {
      clearSupabaseTokens() // 先清 token，避免重整後又判定為殘留→無限重整
      if (!clearCloudDataOnSessionLoss()) {
        openSyncGate() // 資料留著，也要讓使用者能繼續寫
        onChange?.('登入已過期，這台還有未同步的記錄——請重新登入把它們同步上去')
        return
      }
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
