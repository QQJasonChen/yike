// 帳號制雲端同步（Supabase）
// - 購買序號開通，既有帳號以 Email + 密碼登入
// - journal 資料表：每個 localStorage key 一列，Row Level Security 隔離每個用戶
// - 同步策略：先下載、保留衝突副本，再以 CAS 與裝置版號推送未上傳編輯
import { Capacitor } from '@capacitor/core'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, cloudEnabled } from './cloudConfig'
import {
  allDataKeys,
  clearGate,
  clearCloudSessionArtifacts,
  claimDeviceFor,
  deviceId,
  getDataOwner,
  isGated,
  isSyncDataKey,
  isSyncDataValue,
  isSyncTimestamp,
  nextClientRev,
  saveConflictCopy,
  hasCloudArtifact,
  loadDirty,
  loadMeta,
  pendingGatedKeys,
  localDataCount,
  markSynced,
  migrateDirtyOnce,
  markCloudBound,
  openSyncGate,
  setOnDataWrite,
  writeFromCloud,
} from './storage'

const EXTERNAL_KEY_EVENT = 'yike:external-key-change'

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

/** Server quota failures leave local data and dirty revisions intact for retry/export. */
export const uploadErrorMessage = (error: { message: string }): string => {
  if (/YIKE_JOURNAL_RECORD_LIMIT/.test(error.message)) {
    return '這筆內容超過雲端單筆上限，尚未上傳；資料仍在這台裝置，請先匯出備份或縮小這筆內容'
  }
  if (/YIKE_JOURNAL_ACCOUNT_LIMIT/.test(error.message)) {
    return '雲端帳號儲存已達上限，尚未上傳；資料仍在這台裝置，請先匯出備份並聯絡客服'
  }
  if (/YIKE_JOURNAL_CAPACITY_LIMIT/.test(error.message)) {
    return '雲端容量暫時不足，尚未上傳；資料仍在這台裝置，請先匯出備份並聯絡客服'
  }
  return `上傳失敗：${error.message}`
}

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

export const signOut = async () => {
  const { error } = await (await supa()).auth.signOut()
  if (error) throw new Error(`登出失敗：${error.message}`)
}

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

export interface SyncResult {
  pulled: number
  pushed: number
  rejected: number
  conflicts: number
  held: number
  ignored?: number // untrusted/unsupported download rows; never silently report a complete pull
}

/** UI 必須區分伺服器已接受的版本與仍只在本機的草稿。 */
export const syncStatusMessage = (result: SyncResult): string => {
  const pending = result.rejected + result.held
  const counts = `↓${result.pulled} ↑${result.pushed}`
  const conflicts = result.conflicts ? `；保留 ${result.conflicts} 份雲端衝突副本，請到資料備份檢查` : ''
  if (result.ignored) return `有 ${result.ignored} 筆同步資料格式未支援，已跳過並保留本機內容（${counts}）${pending ? `；尚有 ${pending} 筆未上傳` : ''}${conflicts}；請聯絡客服檢查`
  return pending
    ? `尚有 ${pending} 筆未上傳，資料仍在這台裝置（${counts}）${conflicts}`
    : `已同步（${counts}）${conflicts}`
}

/** 雙向同步：回傳實際落地、接受、拒絕與保留副本的筆數。 */
// 同步一次只跑一個。自動 timer、visibility handler、手動按鈕都可能同時發動，
// 兩個同步互相超車時：A 送出 revision 1 → 使用者改成 revision 2 → B 送出並先完成、
// 清掉 dirty → A 的舊 upsert 後落庫。伺服器留下 revision 1，而 revision 2 已經
// 沒有 dirty 可以重推，那筆編輯就永遠消失了。版號只保護「單一請求期間又編輯」，
// 保護不了兩個請求交錯（Codex 互審第 2 輪 P1）。序列化最省事也最可靠。
let syncChain: Promise<unknown> = Promise.resolve()
let syncSlotTimeoutMs = 30_000
/** 測試用：把「單次同步的上限」調短，免得單元測試真的等 30 秒。 */
export const __setSyncSlotTimeout = (ms: number) => {
  syncSlotTimeoutMs = ms
}

export const syncNow = (opts?: {
  onUnclaimed?: 'claim' | 'reject'
}): Promise<SyncResult> => {
  const run = syncChain.then(
    () => syncNowInner(opts),
    () => syncNowInner(opts) // 前一次失敗不該卡住後面的同步
  )
  syncChain = run.catch(() => {})
  return run
}

/** 逾時要「中止請求」，不能只是「放行下一個」。
 *  我第一版用 Promise.race 讓 queue 在 30 秒後放行，但卡住的那次請求還活著：
 *  A 擷取 rev1 卡住 → 放行 B → B 推 rev2 並清掉 dirty → A 才姍姍完成，
 *  把雲端覆蓋回 rev1，而 A 的 markSynced 看到 dirty 已不存在就不重新標記，
 *  rev2 從此永遠不會再被推送（Codex 互審第 4 輪 P0）。
 *  Abort terminates the browser request, but cannot undo an already running DB write.
 *  The server CAS and client revision checks below protect against late commits. */
const withTimeout = async <T>(
  // PostgREST 的 builder 是 thenable 而不是真的 Promise，所以型別要收 PromiseLike
  fn: (signal: AbortSignal) => PromiseLike<T>,
  label: string
): Promise<T> => {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), syncSlotTimeoutMs)
  try {
    return await fn(ac.signal)
  } catch (e) {
    if (ac.signal.aborted) throw new Error(`${label}逾時`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

const syncNowInner = async (opts?: {
  onUnclaimed?: 'claim' | 'reject'
}): Promise<SyncResult> => {
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
    // 同一個人第一次登入：他自己的快照與衝突副本要跟著轉到這個帳號名下，
    // 不然升級後那些無主快照會變成「誰都看不到」。
    claimDeviceFor(user.id)
  }

  // 這一輪同步從頭到尾都必須是同一個人。owner 只在下載前檢查是不是不夠：
  // 分頁一用 Alice 開始下載、回應還在路上，分頁二完成登出並登入 Bob，
  // Alice 的回應抵達時就寫進 Bob 的 localStorage（Codex 互審第 7 輪 P0-7）。
  // null 也不行。原本放行 null，理由是「未認領裝置」——但上面的認領區塊跑完之後
  // owner 一定等於 user.id，所以走到這裡看到 null 只有一種可能：另一個分頁登出了。
  // 放行 null 就等於「Alice 的日記在她登出後重新落地到這台無主裝置上」
  //（Codex 互審第 8 輪 P0-2）。
  const assertStillMine = () => {
    if (getDataOwner() !== user.id) throw new Error('owner-changed-mid-sync')
  }

  const beforePull = new Map(allDataKeys().map((key) => [key, localStorage.getItem(key)]))

  // 1) Pull：伺服器比本機新的 key 落地。
  //    一定要分頁：PostgREST 預設最多回 1000 列，長期使用或匯入之後超過就會
  //    悄悄少拉，使用者在新裝置上永遠看不到那些日子，而且沒有任何錯誤
  //    （Codex 互審第 5 輪 P1-2）。
  const PAGE = 1000
  const downloaded: unknown[] = []
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await withTimeout(
      (signal) =>
        db
          .from('journal')
          .select('key,value,updated_at')
          // Pin every page to the captured owner. The SDK may use a newer JWT
          // after another tab signs in, before the local owner is switched.
          .eq('user_id', user.id)
          .order('key', { ascending: true })
          .range(from, from + PAGE - 1)
          .abortSignal(signal),
      '下載'
    )
    if (error) throw new Error(`下載失敗：${error.message}`)
    if (page !== null && !Array.isArray(page)) throw new Error('下載資料格式不正確')
    const got = (page ?? []) as unknown[]
    downloaded.push(...got)
    if (got.length < PAGE) break
  }
  // Finish every page before any local migration/write. An own-UID journal row is
  // still untrusted data, never authority to replace local credentials or metadata.
  const rows = downloaded.filter((row): row is Row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false
    const r = row as Partial<Row>
    return isSyncDataKey(r.key) && isSyncDataValue(r.key, r.value) &&
      isSyncTimestamp(r.updated_at)
  })
  let ignored = downloaded.length - rows.length
  const serverTs: Record<string, number> = {}
  // 伺服器回的原始字串，一個字都不能動。
  // 用 new Date(ts).toISOString() 重建會截成毫秒，而 Postgres 的 now() 是微秒
  //（線上實測：2026-09-07 00:23:35.897802+00 → 客戶端送 …35.897Z）。
  // CAS 用 <> 比，截斷後永遠不相等 → trigger 一律 return null → 那個 key
  // 從此推不上去，dirty 永遠清不掉，而且畫面顯示同步成功。
  // 這比它要修的那個 bug 更嚴重（Codex 互審第 7 輪 P1-11，我判 P0）。
  const serverTsRaw: Record<string, string> = {}
  let pulled = 0
  let conflicts = 0
  assertStillMine() // 先確認owner，連dirty搬遷也不能套到另一個人的裝置
  migrateDirtyOnce(
    Object.fromEntries(rows.map((r) => [r.key, new Date(r.updated_at).getTime()]))
  )
  const dirtyBefore = loadDirty()
  const meta = loadMeta()
  // 存不下衝突副本的 key：這一輪不准推，寧可少推一次也不要把雲端那份弄不見。
  const holdBack = new Set<string>()
  for (const r of rows) {
    const ts = new Date(r.updated_at).getTime()
    serverTs[r.key] = ts
    serverTsRaw[r.key] = r.updated_at
    // 有本機未上傳的改動就不要蓋掉它——使用者剛寫的東西不能無聲消失。
    // 這個 key 會在下面的 push 階段上傳，以本機版本為準。
    // 閘門期間寫的也算：那是使用者真的打過的字，只是還沒輪到標 dirty。
    // 少了 isGated 這一半，App 剛開、首次 pull 還在路上時打的字會被雲端舊值蓋掉
    //（Codex 互審第 6 輪 P0-1）。
    if (dirtyBefore[r.key] || isGated(r.key)) {
      // 本機也改過，等一下會用本機那份整包覆蓋雲端。兩台裝置同一天各寫各的時，
      // 這裡就是另一台的內容永久消失的地方——不是「最後編輯者勝」，是「最後上線者勝」
      //（Codex 互審第 5 輪 P0-3）。判不出誰對，就兩份都留著。
      // Different PostgreSQL microsecond versions may share the same JS millisecond.
      // Keep a distinct remote value before replacing it with the local pending edit.
      if (ts > (meta[r.key] ?? 0) ||
          (ts === (meta[r.key] ?? 0) && JSON.stringify(r.value) !== localStorage.getItem(r.key))) {
        if (saveConflictCopy(r.key, r.value, ts)) conflicts++
        else holdBack.add(r.key) // 副本沒存成 → 這一輪不覆蓋雲端
      }
      continue
    }
    const localTs = meta[r.key] ?? 0
    const localRaw = localStorage.getItem(r.key)
    const unchangedWhileWaiting = localRaw === (beforePull.get(r.key) ?? null)
    if (ts > localTs || (ts === localTs && unchangedWhileWaiting && JSON.stringify(r.value) !== localRaw)) {
      writeFromCloud(r.key, r.value, ts)
      pulled++
      // 畫面上開著的那一天必須跟著換。只寫 localStorage 而不通知 React，
      // 使用者接下來打一個字就會用畫面上的舊 state 整包覆蓋剛拉下來的新版
      //（Codex 互審第 6 輪 P0-3）。
      if (r.key.startsWith('pp:day:'))
        window.dispatchEvent(
          new CustomEvent('yike:external-day-change', {
            detail: { date: r.key.slice('pp:day:'.length) },
          })
        )
      // 週／月／季／年的期間總結也一樣會被畫面上的舊 state 蓋回去。
      // 原本只通知日檢視，週計畫背景更新後再編輯就整包覆蓋
      //（Codex 互審第 7 輪 P0-5）。改成每個落地的 key 都通知。
      window.dispatchEvent(
        new CustomEvent(EXTERNAL_KEY_EVENT, { detail: { key: r.key } })
      )
    }
  }

  // 2) Push：只推「本機改過還沒上傳」的 key（髒標記），不比任何時鐘。
  //    updated_at 一律不送——由資料庫 trigger 寫成伺服器的 now()，
  //    這樣客戶端時鐘設錯也污染不了排序基準。
  assertStillMine() // 落地都做完了，推送前再確認一次
  const dirty = loadDirty()
  const existing = new Set(allDataKeys())
  // 記憶體閘門裡的 key 也要推。dirty 寫入失敗（配額滿）那一筆只有記憶體閘門保護，
  // 不推的話它永遠不會上雲，而登出前的「還有沒上傳的東西嗎」檢查也看不到它——
  // 使用者按下登出就沒了（Codex 互審第 8 輪 P1-4）。
  const wanted = new Set([...Object.keys(dirty), ...pendingGatedKeys()])
  const pushKeys = [...wanted].filter((k) => {
    if (!existing.has(k) || holdBack.has(k)) return false
    try {
      if (isSyncDataValue(k, JSON.parse(localStorage.getItem(k)!))) return true
    } catch { /* Invalid local JSON must keep its pending marker for recovery/export. */ }
    ignored++
    return false
  })
  const pushedRevs = Object.fromEntries(pushKeys.map((k) => [k, dirty[k] ?? 0]))
  // client_id + client_rev 是伺服器端的過期寫入護欄。abort() 只取消瀏覽器這邊的等待，
  // 已經進到 PostgREST/Postgres 的那筆仍可能晚一步 commit，把較新的版本蓋回去；
  // 兩個分頁也各有各的記憶體佇列，彼此不互斥（Codex 互審第 5 輪 P0-1／P0-2）。
  // 由 trigger 比對「同一台裝置的版號是否倒退」，倒退就整筆不寫。
  const sentClientRev = Object.fromEntries(pushKeys.map((k) => [k, nextClientRev(k)]))
  const sentRaw = Object.fromEntries(pushKeys.map((k) => [k, localStorage.getItem(k)]))
  const dev = deviceId()
  const row = (k: string) => ({
    user_id: user.id,
    key: k,
    value: JSON.parse(sentRaw[k]!),
    client_id: dev,
    client_rev: sentClientRev[k],
  })

  // 兩條路，因為「雲端已經有這一筆」與「我相信雲端還沒有」需要的護欄不一樣。
  //
  // ① 已經有 → upsert，帶上 base_updated_at＝我上次看到的伺服器版本（原始字串）。
  //    trigger 比對，對不上代表這期間有別台裝置寫過 → 整筆不寫、dirty 留著，
  //    下一輪先 pull 再推（Codex 互審第 6 輪 P0-2）。
  //
  // ② 我相信還沒有 → 直接 insert，讓唯一鍵 (user_id, key) 自己擋。
  //    兩台裝置各自新增同一天時，後到的那筆會撞 23505 而不是無條件覆蓋前一筆
  //    （Codex 互審第 7 輪 P0-10）。
  //
  //    第 8 輪我用的是「送 base_updated_at: '-infinity' 當哨兵」——那是錯的，
  //    而且是資料遺失級的錯：哨兵會**留在那一列裡**。舊版客戶端的 upsert payload
  //    不含這個欄位，ON CONFLICT DO UPDATE 就把 -infinity 原樣帶進 UPDATE，
  //    於是 `-infinity <> old.updated_at` 永遠成立 → 那一列從此再也更新不了。
  //    線上實測過：新版 insert 之後，舊版客戶端的更新被靜默丟掉。
  //    目前部署中的網頁版正是「不送這三個欄位」的舊版，所以這條會真的打到人。
  //    改成走 insert 就不會有任何哨兵落庫。
  const knownKeys = pushKeys.filter((k) => serverTsRaw[k] !== undefined)
  const freshKeys = pushKeys.filter((k) => serverTsRaw[k] === undefined)
  let accepted = 0
  let rejected = 0
  const savedRows: { key: string; updated_at: string; client_rev?: number | string | null }[] = []

  if (freshKeys.length) {
    const { data: ins, error: insErr } = await withTimeout(
      (signal) =>
        db
          .from('journal')
          .insert(freshKeys.map(row))
          .select('key,updated_at,client_rev')
          .abortSignal(signal),
      '上傳（新增）'
    )
    // 23505＝唯一鍵衝突，代表別台裝置在我 pull 之後也新增了同一個 key。
    // 這不是錯誤，是「這一輪先讓對方贏」：dirty 留著，下一輪的 pull 會看到雲端那份，
    // 走衝突副本的路，兩份都留下來。
    // 其他錯誤（RLS、網路、格式）照舊往上丟，不能吞。
    if (insErr && insErr.code !== '23505') throw new Error(uploadErrorMessage(insErr))
    // 撞衝突就什麼都不做：不進 savedRows ⇒ markSynced 看到「有送出版號但沒回任何一列」
    // 就會保留髒標記（第 5 輪 P0-1 立的規則）。rejected 由下面的
    // `pushKeys.length - accepted` 統一算出來，這裡不要再累加（會被覆寫，是死碼）。
    if (!insErr) savedRows.push(...((ins ?? []) as typeof savedRows))
  }

  if (knownKeys.length) {
    const { data: saved, error: upErr } = await withTimeout(
      (signal) =>
        db
          .from('journal')
          .upsert(
            knownKeys.map((k) => ({ ...row(k), base_updated_at: serverTsRaw[k] })),
            { onConflict: 'user_id,key' }
          )
          .select('key,updated_at,client_rev')
          .abortSignal(signal),
      '上傳'
    )
    if (upErr) throw new Error(uploadErrorMessage(upErr))
    savedRows.push(...((saved ?? []) as typeof savedRows))
  }

  if (pushKeys.length) {
    // 用伺服器回傳的時間戳對齊本機 meta，並清掉髒標記。
    // 沒有這一步，本機 meta 會停在客戶端時鐘，下次 pull 又會誤判。
    // 帶上「送出當下的版號」：markSynced 只清版號沒變的 key，
    // 推送期間又被編輯過的會保留標記，下次同步帶走。
    //
    // 回應回來時如果已經換人了，這些 key 屬於上一個人。照著清 dirty／寫 meta 的話
    // 會把新帳號剛寫的髒標記刪掉，那一筆從此不會上傳（Codex 互審第 8 輪 P1-6）。
    assertStillMine()
    const confirmedRows = savedRows.filter((r) => isSyncDataKey(r?.key) && isSyncTimestamp(r.updated_at) && sentClientRev[r.key] !== undefined &&
      (r.client_rev == null || Number(r.client_rev) === sentClientRev[r.key]))
    markSynced(confirmedRows, pushedRevs, sentClientRev)
    // 伺服器確認收下了，就不必再靠記憶體閘門保護（不清的話這個 key 在本次執行期間
    // 每一次 pull 都會被當成髒的，雲端新版永遠只進副本）（第 8 輪 P1-5）。
    for (const r of confirmedRows) {
      // 閘門期間仍可編輯；回應只確認送出的版本，不能解除新版草稿的保護。
      if (localStorage.getItem(r.key) === sentRaw[r.key]) clearGate(r.key)
    }
    // 回報「真的被接受幾筆」。被 trigger 擋下的不算——原本一律回 toPush.length，
    // 使用者會看到「✓ 已同步 ↑3」然後以為換機安全，其實那幾筆還只在本機
    //（Codex 互審第 6 輪 P1-2）。
    accepted = confirmedRows.length
    rejected = pushKeys.length - accepted
  }

  // holdBack 的 key 沒送出去，所以不在 rejected 裡。不回報的話畫面會顯示
  // 「✓ 已同步」，而使用者剛寫的那一天其實兩邊都還沒對上（Codex 互審第 7 輪 P1-13）。
  return { pulled, pushed: accepted, rejected, conflicts, held: holdBack.size, ...(ignored ? { ignored } : {}) }
}

let pushTimer: ReturnType<typeof setTimeout> | null = null

/** 啟動自動同步：登入狀態下，開站先同步一次，之後每次寫入 4 秒後自動推送 */
export const startAutoSync = async (onChange?: (msg: string) => void): Promise<void> => {
  if (!cloudEnabled()) return
  const email = await currentEmail()
  if (!email) {
    // 這台有雲端登入殘留（標記或 Supabase token），但目前沒有有效 session
    // （登出 / 過期 / 舊版殘留）。
    //
    // 舊版在這裡清掉全部本機資料，理由是「資料都在雲端」。那個假設是錯的：
    // 離線編輯後 token 剛好過期時，那些內容還沒上雲，而 pp:bk:* 備份也會被
    // 一起刪掉，永遠救不回來。session 過期只是要重新登入，不該順手毀資料。
    if (hasCloudArtifact()) {
      clearCloudSessionArtifacts() // 只清 token 與綁定標記，資料原封不動
      openSyncGate() // 讓使用者能繼續寫
      onChange?.('登入已過期，資料都還在——重新登入即可繼續同步')
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
        .then((result) => onChange?.(syncStatusMessage(result)))
        .catch(() => onChange?.('同步失敗，下次寫入時重試'))
    }, 4000)
  })

  try {
    // 首次 pull 加逾時保護：就算網路掛了也要在 8 秒內打開閘門，不讓本機寫入永遠卡住
    const result = await Promise.race([
      syncNow(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('sync-timeout')), 8000)),
    ])
    const { pulled } = result
    onChange?.(syncStatusMessage(result))
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
