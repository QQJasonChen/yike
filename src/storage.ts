import {
  BizModel,
  DayEntry,
  LegacyDayFields,
  LifeEntry,
  MonthEntry,
  QuarterEntry,
  Settings,
  WeekEntry,
  YearEntry,
  defaultSettings,
  emptyBizModel,
  emptyDay,
  emptyLife,
  emptyMonth,
  emptyQuarter,
  emptyWeek,
  emptyYear,
} from './types'

const DAY_PREFIX = 'pp:day:'
const WEEK_PREFIX = 'pp:week:'
const MONTH_PREFIX = 'pp:month:'
const SETTINGS_KEY = 'pp:settings'
const LIFE_KEY = 'pp:life' // 願景維度——整個 app 只有一份
const BIZ_KEY = 'pp:bizmodel' // 個人獲利模式九宮格——整個 app 只有一份
const SYNC_KEY = 'pp:sync' // 同步設定（含 token）——絕不進匯出檔
// Notion integration token（對用戶 Notion 有寫入權）——只留本機，絕不上雲、不進匯出檔
const INTEGRATIONS_KEY = 'pp:integrations'
const CLOUD_BOUND_KEY = 'pp:cloudBound' // 此裝置曾登入雲端帳號的標記（裝置本地，不同步）
const BACKUP_PREFIX = 'pp:bk:' // 每日本機快照（pp:bk:<date>）——純本機、不同步、不匯出
// 上次自動備份的日期。**要分帳號**：共用裝置上 Alice 早上備過之後，
// Bob 當天登入會被判定「今天備過了」而整天沒有自己的快照
//（Codex 互審第 6 輪 P1-5）。存成 { owner: date }。
const LAST_BACKUP_KEY = 'pp:lastBackup'
const BACKUP_KEEP = 7 // 保留最近幾份每日快照

/** 標記此裝置曾綁定雲端帳號（登入成功時呼叫） */
export const markCloudBound = () => localStorage.setItem(CLOUD_BOUND_KEY, '1')
/** 此裝置是否曾登入過雲端帳號 */
export const isCloudBound = (): boolean => localStorage.getItem(CLOUD_BOUND_KEY) === '1'

/** 殘留的 Supabase session token（key 形如 sb-xxxxx-auth-token） */
const supabaseTokenKeys = (): string[] => {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('sb-') && k.includes('auth-token')) keys.push(k)
  }
  return keys
}
/** 這台是否殘留任何雲端登入痕跡（標記或 Supabase token） */
export const hasCloudArtifact = (): boolean => isCloudBound() || supabaseTokenKeys().length > 0
/** 清掉殘留的 Supabase session token（登出/孤兒清除時，連 token 一起清，避免重整迴圈） */
export const clearSupabaseTokens = () => supabaseTokenKeys().forEach((k) => localStorage.removeItem(k))

// ---- 日期工具（一律使用本地時區） ----

export const toDateKey = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const fromDateKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (key: string, n: number): string => {
  const d = fromDateKey(key)
  d.setDate(d.getDate() + n)
  return toDateKey(d)
}

/** ISO 週數（避開 DST 用天數四捨五入） */
export const isoWeekOf = (d: Date): number => {
  const dow = (d.getDay() + 6) % 7
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow)
  const jan4 = new Date(monday.getFullYear(), 0, 4)
  const jan4Mon = new Date(jan4.getFullYear(), 0, 4 - ((jan4.getDay() + 6) % 7))
  const week = Math.round((monday.getTime() - jan4Mon.getTime()) / 86400000) / 7 + 1
  if (week < 1) return isoWeekOf(new Date(monday.getFullYear() - 1, 11, 28))
  return week
}

/** 該日期所屬週的星期一（週為 一 ~ 日） */
export const mondayOf = (key: string): string => {
  const d = fromDateKey(key)
  const dow = (d.getDay() + 6) % 7 // Mon=0 ... Sun=6
  d.setDate(d.getDate() - dow)
  return toDateKey(d)
}

// ---- 讀寫 ----

const read = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

// ppl: 前綴 = 只屬於這台裝置，絕不同步上雲、絕不進匯出檔。
// 用前綴而不是逐一加白名單：allDataKeys() 預設收錄所有 pp: 開頭的 key，
// 忘記把新 key 加進排除清單就會被同步出去——把它做成結構保證，不靠人記得。
const LOCAL_ONLY_PREFIX = 'ppl:'

const META_KEY = 'pp:meta' // 每個 key 的最後修改時間（雲端同步用）
const DIRTY_KEY = 'ppl:dirty' // 有本機改動、還沒推上雲端的 key → 版號
const DIRTY_MIGRATED_KEY = 'ppl:dirtyMigrated' // 舊制搬遷是否跑過（獨立旗標）
const GATED_KEY = 'ppl:gated' // 同步閘門關閉期間寫過的 key（必須落地，見 closeSyncGate）
const DEVICE_KEY = 'ppl:deviceId' // 這台裝置的隨機識別碼（伺服器端擋「同裝置的過期寫入」用）
const REVSEQ_KEY = 'ppl:revSeq' // 每個 key 的單調遞增版號，永不重置
const CONFLICT_PREFIX = 'ppl:conflict:' // 雲端與本機同時改過時保留的雲端副本

/** 這台裝置的識別碼。只用來讓伺服器分辨「同一台裝置的舊寫入」，不含任何個資。 */
export const deviceId = (): string => {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

/** 取這個 key 的下一個單調版號。
 *  dirty 的版號在 markSynced 之後會歸零重數，不能拿去跟伺服器比大小；
 *  這個序列永不重置，而且用 Date.now() 當地板，換裝置、清 dirty 都不會倒退。 */
export const nextClientRev = (key: string): number => {
  const seq = read<Record<string, number>>(REVSEQ_KEY) ?? {}
  const v = Math.max((seq[key] ?? 0) + 1, Date.now())
  seq[key] = v
  localStorage.setItem(REVSEQ_KEY, JSON.stringify(seq))
  return v
}

/** 寫入後通知（雲端同步 debounce push 用） */
export let onDataWrite: ((key: string) => void) | null = null
/** 本機儲存失敗時的通知（配額滿、Safari 私密模式拒寫）。
 *  沒有這個回報，使用者會以為每一字都即時存好了，實際上一個字都沒進去
 *  ——手寫塗鴉把 localStorage 撐爆時特別容易發生（Codex UI/UX 審查 P0）。 */
let onWriteError: ((key: string) => void) | null = null
export const setOnWriteError = (fn: ((key: string) => void) | null) => {
  onWriteError = fn
}

export const setOnDataWrite = (fn: ((key: string) => void) | null) => {
  onDataWrite = fn
}

export const loadMeta = (): Record<string, number> => read<Record<string, number>>(META_KEY) ?? {}

/** 從「比時間戳」升級到「髒標記」的一次性搬遷：
 *  既有裝置沒有 pp:dirty，若直接改用髒標記，還沒推上去的本機改動會永遠不再上傳。
 *  所以第一次跑到這裡時，用舊規則（本機 meta 比伺服器新）補標一次。 */
export const migrateDirtyOnce = (serverTs: Record<string, number>): void => {
  // 用獨立旗標，不是「ppl:dirty 存不存在」。後者的問題（Codex 互審 #3）：
  // 使用者升級後先編輯一筆就建立了 ppl:dirty，之後首次登入時搬遷直接跳過，
  // 升級前就存在、從沒上傳過的歷史日記從此永遠不會上雲。
  if (localStorage.getItem(DIRTY_MIGRATED_KEY) === '1') return
  const meta = loadMeta()
  const d = loadDirty()
  for (const k of allDataKeys()) {
    if (d[k] !== undefined) continue // 升級後已編輯過的，標記已經在了
    // 伺服器根本沒有這個 key = 純本機資料，一定要上傳（純本機使用者首次登入的情況）
    if (serverTs[k] === undefined) d[k] = 1
    // 伺服器有但本機看起來較新：沿用舊演算法的判斷。這是舊規則能提供的最好訊號，
    // 全部標記反而危險——pull 會跳過髒的 key，落後的裝置會用舊內容蓋掉雲端新版。
    else if ((meta[k] ?? 0) > serverTs[k]) d[k] = 1
  }
  localStorage.setItem(DIRTY_KEY, JSON.stringify(d))
  localStorage.setItem(DIRTY_MIGRATED_KEY, '1')
}

// 為什麼要有髒標記，而不是比時間戳決定要不要 push：
// 舊做法是「本機時間戳 > 伺服器時間戳就上傳」，等於信任裝置的時鐘。
// 裝置時鐘快了（手動設錯、時區、電池沒電重置）→ 它寫的資料拿到未來時間戳 →
// 之後正常裝置的編輯永遠推不上去（本機時間 > 未來時間恆為假），使用者會看到
// 自己寫的東西一直消失，而且沒有任何錯誤訊息。時鐘慢了則是反過來一直重複推。
// 改成髒標記後，push 只問「這個 key 改過了嗎」，跟任何時鐘都無關。
// 時間戳只留給 pull 用，而且兩邊都是伺服器時鐘（見 writeFromCloud / markSynced）。
// 值是「版號」不是 boolean。理由（Codex 互審 #1 抓到）：
// syncNow 讀值 → 送出 → 等回應，這中間使用者可能又改了同一個 key。
// 用 boolean 的話第二次修改只是把 true 設成 true，舊的 upsert 回來就把它清掉，
// 那筆較新的內容從此沒有標記、永遠不會上傳。改成每次修改就 +1，
// 清除時比對版號：版號變了代表推送期間又被改過，髒標記要留著。
export const loadDirty = (): Record<string, number> => {
  const raw = read<Record<string, unknown>>(DIRTY_KEY) ?? {}
  const out: Record<string, number> = {}
  // 舊格式是 boolean（2026-09-01 當天的中間版本），一併正規化
  for (const [k, v] of Object.entries(raw)) out[k] = typeof v === 'number' ? v : 1
  return out
}

const markDirty = (key: string) => {
  const d = loadDirty()
  d[key] = (d[key] ?? 0) + 1
  try {
    localStorage.setItem(DIRTY_KEY, JSON.stringify(d))
    // 標成 dirty 就不需要記憶體閘門了。不清的話這個 key 在本次執行期間每一次 pull
    // 都被當成「本機改過」→ 雲端新版永遠只進副本、現用資料不更新
    //（Codex 互審第 8 輪 P1-5）。
    gatedKeys.delete(key)
  } catch (e) {
    // 日記本體寫得進去、待上傳標記寫不進去，是最陰險的組合：畫面看起來存好了，
    // 但那筆改動永遠不會上雲，之後還會被 pull 蓋掉（Codex 互審第 6 輪 P1-3）。
    console.error('待上傳標記寫入失敗', key, e)
    // 光是警告救不了資料：本體存進去了、dirty 沒有，pull 的保護條件看不到這筆修改，
    // 下一次同步就把雲端較舊（或別台較新）的版本蓋上來，連衝突副本都不會留
    //（Codex 互審第 7 輪 P0-9）。gatedKeys 只在記憶體，配額滿也寫得進去，
    // 而 pull 端把 isGated 當成 dirty 看——這一輪至少不會被覆蓋。
    gatedKeys.add(key)
    onWriteError?.(key)
  }
}

/** push 成功後：清掉髒標記，並把 meta 對齊伺服器回傳的時間戳（讓兩邊用同一個時鐘）。
 *  pushedKeys 是「這次確實送出去的 key」；rows 是伺服器回傳的結果。
 *  兩者分開的原因：upsert 成功但 .select() 沒回內容時（RLS/PostgREST 設定差異），
 *  只靠 rows 會讓髒標記永遠清不掉 → 那些 key 每次同步都重推一遍。
 *  這時仍要清髒標記（東西確實上去了），但不動 meta——留給下次 pull 從伺服器補正。 */
export const markSynced = (
  rows: { key: string; updated_at: string; client_rev?: number | string | null }[],
  pushedRevs: Record<string, number> = {},
  sentClientRev: Record<string, number> = {}
): void => {
  const d = loadDirty()
  const m = loadMeta()
  // 只清「推送期間沒再被改過」的 key。版號對不上代表使用者在等回應時又編輯了，
  // 那筆更新的內容還沒上去，標記必須留著讓下次同步帶走。
  const clear = (k: string) => {
    if (pushedRevs[k] !== undefined && d[k] !== pushedRevs[k]) return
    delete d[k]
  }
  if (rows.length === 0 && Object.keys(sentClientRev).length === 0) {
    // 沒帶版號的舊路徑（測試/舊版）：伺服器沒回內容時無從驗證，沿用舊行為清標記。
    // 有帶版號時**不能**這樣做——rows 空有可能代表「整批都被過期護欄擋下」，
    // 這時清掉 dirty 會讓本機這份永遠不再被推上去。
    for (const k of Object.keys(pushedRevs)) clear(k)
  }
  for (const r of rows) {
    // 伺服器端的單調版號護欄可能「靜默拒絕」這次寫入（同一台裝置的過期請求
    // 晚到、或另一個分頁已經寫過更新的版本）。回來的 client_rev 不是我送的那個，
    // 就代表雲端沒有吃下我的內容——這時絕不能清 dirty，否則本機這份永遠不會再被推
    //（Codex 互審第 5 輪 P0-1／P0-2）。
    const sent = sentClientRev[r.key]
    if (sent !== undefined && r.client_rev != null && Number(r.client_rev) !== sent) continue
    clear(r.key)
    if (d[r.key] === undefined) m[r.key] = new Date(r.updated_at).getTime()
  }
  localStorage.setItem(DIRTY_KEY, JSON.stringify(d))
  localStorage.setItem(META_KEY, JSON.stringify(m))
}

// 本機編輯只做一件事：標記「這個 key 改過了」。
// 絕不寫 meta——meta 的語意是「我上次看到的伺服器版本時間」，只能由伺服器的值填。
// 兩個時鐘寫同一個欄位正是資料消失的根因：本機編輯把 meta 蓋成裝置時間後，
// pull 就會拿「伺服器時間 vs 裝置時間」比大小，時鐘一偏就判錯。
const touchMeta = (key: string) => markDirty(key)

// 同步閘門（拉取優先）：雲端裝置開站時「先把雲端 pull 下來、再讓本機寫入影響同步」。
// 閘門關閉期間，write() 照常落地 localStorage（畫面不受影響），但**不 bump meta、不觸發 push**——
// 這樣「pull 前的空白/預設寫入」絕不會拿到較新的時間戳去反蓋雲端的正確資料（資料消失的根因）。
// 首次 pull 完成後 openSyncGate()：此時雲端基準已就位，才把這期間寫過的 key 補上時間戳並推送。
let syncGateClosed = false
const gatedKeys = new Set<string>()

const persistGated = () => {
  try {
    if (gatedKeys.size === 0) localStorage.removeItem(GATED_KEY)
    else localStorage.setItem(GATED_KEY, JSON.stringify([...gatedKeys]))
  } catch (e) {
    console.error('閘門清單寫入失敗', e)
    onWriteError?.(GATED_KEY)
  }
}

export const closeSyncGate = () => {
  // 上一次啟動如果在閘門開啟前就被 iOS 殺掉，那些編輯只活在記憶體的 gatedKeys，
  // 重開後沒有 dirty，會被 pull 直接蓋掉（Codex 互審第 5 輪 P0）。
  // 落地的 gated 清單在這裡先轉成 dirty：使用者真的打過的字一律當成待上傳，
  // 而 pull 遇到 dirty 會保留雲端版本成衝突副本，兩邊都不會消失。
  const leftover = read<string[]>(GATED_KEY)
  if (Array.isArray(leftover) && leftover.length) {
    for (const k of leftover) if (localStorage.getItem(k) !== null) markDirty(k)
    localStorage.removeItem(GATED_KEY)
  }
  syncGateClosed = true
}
export const openSyncGate = () => {
  if (!syncGateClosed && gatedKeys.size === 0) return
  syncGateClosed = false
  const keys = [...gatedKeys]
  gatedKeys.clear()
  persistGated()
  for (const k of keys) {
    touchMeta(k)
    onDataWrite?.(k)
  }
}

/** 閘門關閉期間被改過的 key（含上次啟動殘留的）。pull 必須把它們當成 dirty，
 *  否則同一次還在飛行中的首次 pull 會直接用雲端舊值蓋掉使用者剛打的字
 *  ——上一輪我只修了「被殺再開」，沒修「同一次 pull 還沒回來」（Codex 互審第 6 輪 P0-1）。 */
export const isGated = (key: string): boolean => gatedKeys.has(key)

/** 目前被記憶體閘門保護、但沒有（或還沒）落地成 dirty 的 key。
 *  push 一定要把它們一起帶走：dirty 寫入失敗的那筆只靠 pull 保護的話，
 *  它永遠不會上雲，而登出的「還有沒上傳的東西嗎」檢查也看不到它，
 *  使用者按登出就沒了（Codex 互審第 8 輪 P1-4）。 */
export const pendingGatedKeys = (): string[] => [...gatedKeys]

/** push 被伺服器確認之後，這個 key 不必再靠記憶體閘門保護。 */
export const clearGate = (key: string): void => {
  gatedKeys.delete(key)
}

const write = (key: string, value: unknown): boolean => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error('本機儲存失敗', key, e)
    onWriteError?.(key)
    return false // 呼叫端的畫面照舊（草稿還在），但使用者必須被告知「這次沒存進去」
  }
  if (key !== SYNC_KEY && key !== META_KEY) {
    if (syncGateClosed) {
      gatedKeys.add(key) // 閘門關閉：先記下，等 openSyncGate 再 bump+推送
      persistGated() // 只記在記憶體的話，App 被殺就等於這次編輯從未發生
      return true
    }
    touchMeta(key)
    onDataWrite?.(key)
  }
  return true
}

/** 雲端拉下來的資料直接落地（不觸發 push 迴圈），並記下伺服器時間戳 */
export const writeFromCloud = (key: string, value: unknown, serverTs: number) => {
  localStorage.setItem(key, JSON.stringify(value))
  const m = loadMeta()
  m[key] = serverTs
  localStorage.setItem(META_KEY, JSON.stringify(m))
  // 剛用雲端版本覆蓋本機，這個 key 就不再是「本機有未上傳的改動」
  const d = loadDirty()
  if (d[key]) {
    delete d[key]
    localStorage.setItem(DIRTY_KEY, JSON.stringify(d))
  }
}

export const loadDay = (dateKey: string): DayEntry => {
  const stored = read<Partial<DayEntry> & LegacyDayFields>(DAY_PREFIX + dateKey)
  if (!stored) return emptyDay()
  const entry = { ...emptyDay(), ...stored }
  // v1 固定欄位 → v2 自訂問題 answers 遷移
  if (!entry.habitsDone) entry.habitsDone = {}
  if (!stored.answers) {
    entry.answers = {}
    if (stored.gratitude) entry.answers.m0 = stored.gratitude
    if (stored.intention) entry.answers.m1 = stored.intention
    if (stored.highlight) entry.answers.e0 = stored.highlight
    if (stored.learned) entry.answers.e1 = stored.learned
    if (stored.remember) entry.answers.e2 = stored.remember
  }
  return entry
}

export const saveDay = (dateKey: string, entry: DayEntry) =>
  write(DAY_PREFIX + dateKey, entry)

export const loadWeek = (mondayKey: string): WeekEntry =>
  read<WeekEntry>(WEEK_PREFIX + mondayKey) ?? emptyWeek()

export const saveWeek = (mondayKey: string, entry: WeekEntry) =>
  write(WEEK_PREFIX + mondayKey, entry)

export const monthOf = (dateKey: string): string => dateKey.slice(0, 7) // YYYY-MM

export const addMonths = (monthKey: string, n: number): string => {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const loadMonth = (monthKey: string): MonthEntry =>
  read<MonthEntry>(MONTH_PREFIX + monthKey) ?? emptyMonth()

export const saveMonth = (monthKey: string, entry: MonthEntry) =>
  write(MONTH_PREFIX + monthKey, entry)

const QUARTER_PREFIX = 'pp:quarter:'

/** 該日期所屬季 key（YYYY-Qn） */
export const quarterOf = (dateKey: string): string => {
  const [y, m] = dateKey.split('-').map(Number)
  return `${y}-Q${Math.ceil(m / 3)}`
}

export const addQuarters = (quarterKey: string, n: number): string => {
  const [y, q] = quarterKey.split('-Q').map(Number)
  const total = y * 4 + (q - 1) + n
  return `${Math.floor(total / 4)}-Q${(((total % 4) + 4) % 4) + 1}`
}

export const loadQuarter = (quarterKey: string): QuarterEntry =>
  read<QuarterEntry>(QUARTER_PREFIX + quarterKey) ?? emptyQuarter()

export const saveQuarter = (quarterKey: string, entry: QuarterEntry) =>
  write(QUARTER_PREFIX + quarterKey, entry)

const YEAR_PREFIX = 'pp:year:'

export const loadYear = (yearKey: string): YearEntry => {
  const stored = read<Partial<YearEntry>>(YEAR_PREFIX + yearKey)
  return stored ? { ...emptyYear(), ...stored } : emptyYear()
}

export const saveYear = (yearKey: string, entry: YearEntry) =>
  write(YEAR_PREFIX + yearKey, entry)

export const loadLife = (): LifeEntry => {
  const stored = read<Partial<LifeEntry>>(LIFE_KEY)
  if (!stored) return emptyLife()
  const base = emptyLife()
  return {
    ...base,
    ...stored,
    // odyssey 一定要 3 條（防舊資料缺格）
    odyssey: base.odyssey.map((d, i) => ({ ...d, ...(stored.odyssey?.[i] ?? {}) })),
  }
}

export const saveLife = (entry: LifeEntry) => write(LIFE_KEY, entry)

export const loadBizModel = (): BizModel => {
  const stored = read<Partial<BizModel>>(BIZ_KEY)
  if (!stored) return emptyBizModel()
  const base = emptyBizModel()
  return {
    ...base,
    ...stored,
    // 標籤盤缺就補預設（舊資料/半殘資料防呆）
    tags: stored.tags?.length ? stored.tags : base.tags,
  }
}

export const saveBizModel = (model: BizModel) => write(BIZ_KEY, model)

const HABITS_RESTORED_KEY = 'pp:habitsAutoRestored'

/** 從所有日記的打勾紀錄（habitsDone 的 key）反推曾經存在過的習慣名單。
 *  習慣清單只存 settings.habits，但每天的完成紀錄用習慣名當 key 散在各日——
 *  所以就算 settings 被清空，只要日記還在就能把名單撿回來。 */
const habitsFromHistory = (): string[] => {
  const names = new Set<string>()
  for (const dk of allDayKeys()) {
    const done = loadDay(dk).habitsDone
    if (done) for (const n of Object.keys(done)) names.add(n)
  }
  return [...names]
}

export const loadSettings = (): Settings => {
  const s = { ...defaultSettings(), ...(read<Partial<Settings>>(SETTINGS_KEY) ?? {}) }
  // v1 單一習慣 → v2 習慣清單
  if (s.habits.length === 0 && s.habitName) s.habits = [s.habitName]
  // 一次性救援：習慣清單空了但歷史有打勾紀錄 → 從歷史重建。
  // 只跑一次（記旗標），才不會跟「使用者刻意刪光習慣」打架。
  if (s.habits.length === 0 && !localStorage.getItem(HABITS_RESTORED_KEY)) {
    const recovered = habitsFromHistory()
    if (recovered.length) {
      s.habits = recovered
      saveSettings(s) // 持久化 + bump meta → 同步把名單推回雲端/其他裝置
    }
    localStorage.setItem(HABITS_RESTORED_KEY, '1')
  }
  return s
}

export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s)

/** 所有已記錄的日期 key，新到舊 */
export const allDayKeys = (): string[] => {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(DAY_PREFIX)) keys.push(k.slice(DAY_PREFIX.length))
  }
  return keys.sort().reverse()
}

/** 連續記錄天數（從今天或昨天往回算） */
export const currentStreak = (todayKey: string): number => {
  const recorded = new Set(allDayKeys())
  let streak = 0
  let cursor = recorded.has(todayKey) ? todayKey : addDays(todayKey, -1)
  while (recorded.has(cursor)) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}

// ---- 活動名稱統計（自動完成＋總結用） ----

export interface NameStat {
  name: string
  days: number
  sessions: number // 專注段數（任務塗格）
  minutes: number // 時間軸累計分鐘
  plans: number // 出現在週/月/年計畫的次數
}

/** 列出 localStorage 中指定前綴的所有 key 後綴 */
const keysWithPrefix = (prefix: string): string[] => {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(prefix)) keys.push(k.slice(prefix.length))
  }
  return keys
}

/** from/to 為 YYYY-MM-DD（含），省略 = 全部時間 */
export const nameStats = (from?: string, to?: string): NameStat[] => {
  const inDay = (k: string) => (!from || k >= from) && (!to || k <= to)
  const inMonth = (k: string) => (!from || k >= from.slice(0, 7)) && (!to || k <= to.slice(0, 7))
  const inYear = (k: string) => (!from || k >= from.slice(0, 4)) && (!to || k <= to.slice(0, 4))
  const map = new Map<string, { days: Set<string>; sessions: number; minutes: number; plans: number }>()
  const touch = (n: string) => {
    if (!map.has(n)) map.set(n, { days: new Set(), sessions: 0, minutes: 0, plans: 0 })
    return map.get(n)!
  }
  for (const k of allDayKeys()) {
    if (!inDay(k)) continue
    const d = loadDay(k)
    for (const task of d.tasks) {
      const n = task.text.trim()
      if (!n) continue
      const e = touch(n)
      e.days.add(k)
      e.sessions += task.done
    }
    for (const b of d.blocks) {
      const n = b.text.trim()
      if (!n) continue
      const e = touch(n)
      e.days.add(k)
      e.minutes += b.end - b.start
    }
  }
  // 週/月/年計畫項目也納入同一份名稱統計（讓計畫與每日記錄用同一套詞）
  for (const k of keysWithPrefix(WEEK_PREFIX)) {
    if (!inDay(k)) continue // 週 key 是週一日期
    for (const t of loadWeek(k).tasks) {
      const n = t.text.trim()
      if (n) touch(n).plans++
    }
  }
  for (const k of keysWithPrefix(MONTH_PREFIX)) {
    if (!inMonth(k)) continue
    for (const p of loadMonth(k).priorities) {
      const n = p.text.trim()
      if (n) touch(n).plans++
    }
  }
  for (const k of keysWithPrefix(QUARTER_PREFIX)) {
    if (!inYear(k.slice(0, 4))) continue // quarter key = YYYY-Qn
    for (const p of loadQuarter(k).priorities) {
      const n = p.text.trim()
      if (n) touch(n).plans++
    }
  }
  for (const k of keysWithPrefix(YEAR_PREFIX)) {
    if (!inYear(k)) continue
    for (const g of loadYear(k).goals) {
      const n = g.text.trim()
      if (n) touch(n).plans++
    }
  }
  // 願景大目標是長期、無日期；只在「全部」時納入計畫
  if (!from)
    for (const g of loadLife().goals) {
      const n = g.text.trim()
      if (n) touch(n).plans++
    }
  return [...map.entries()]
    .map(([name, e]) => ({
      name,
      days: e.days.size,
      sessions: e.sessions,
      minutes: e.minutes,
      plans: e.plans,
    }))
    .sort(
      (a, b) =>
        b.minutes + b.sessions * 30 + b.plans * 15 - (a.minutes + a.sessions * 30 + a.plans * 15)
    )
}

/** 常用名稱（自動完成清單），頻率排序，最多 40 個 */
export const recentNames = (): string[] => nameStats().slice(0, 40).map((s) => s.name)

// ---- 衝突副本 ----
// 兩台裝置同一天都改過同一個 key 時，pull 會因為本機是 dirty 而跳過雲端版本，
// 接著把本機整包推上去——另一台下午寫的東西就這樣沒了，而且不會有人知道
//（Codex 互審第 5 輪 P0-3）。判不出誰對的時候，正確做法是兩份都留著。

export interface ConflictMeta {
  id: string // 完整的 localStorage key
  key: string // 衝突的資料 key（例如 pp:day:2026-09-03）
  at: number // 雲端那份的伺服器時間戳
}

/** 把雲端版本另存成本機衝突副本。同帳號、時間與內容相同才去重。 */
export const saveConflictCopy = (key: string, value: unknown, serverTs: number): boolean => {
  try {
    if (!Number.isSafeInteger(serverTs) || serverTs < 0) throw new Error('invalid-conflict-time')
    const owner = getDataOwner()
    const serialized = JSON.stringify(value)
    // PG 微秒版本與不同帳號可能共用同一毫秒 ID；不能把碰撞當作副本已保存。
    // 保留既有數字 ID 格式，另存原始時間供顯示，且搜尋有上限。
    for (let slot = 0; slot < 1024; slot++) {
      const id = `${CONFLICT_PREFIX}${serverTs + slot}:${key}`
      const raw = localStorage.getItem(id)
      if (raw !== null) {
        const existing = parseConflict(raw)
        if (existing.owner === owner &&
            (existing.at ?? serverTs + slot) === serverTs &&
            JSON.stringify(existing.value) === serialized) return true
        continue
      }
      localStorage.setItem(id, JSON.stringify({ __yike: 2, owner, at: serverTs, value }))
      return true
    }
    throw new Error('conflict-slots-exhausted')
  } catch (e) {
    // 存不下就要讓呼叫端知道。原本吞掉錯誤、呼叫端照樣把 conflicts 加一並覆蓋雲端，
    // 等於告訴使用者「另一份幫你留著了」而那一份其實已經沒了（Codex 互審第 6 輪 P0-4）。
    console.error('衝突副本存檔失敗', key, e)
    onWriteError?.(key)
    return false
  }
}

const parseConflict = (raw: string): { owner: string | null | undefined; value: unknown; at?: number } => {
  try {
    const p = JSON.parse(raw) as { __yike?: number; owner?: string | null; value?: unknown; at?: number }
    if (p && typeof p === 'object' && p.__yike === 2)
      return { owner: p.owner === null || typeof p.owner === 'string' ? p.owner : undefined, value: p.value,
        at: Number.isSafeInteger(p.at) && p.at! >= 0 ? p.at : undefined }
    return { owner: undefined, value: p } // legacy（這個機制上線當天產生的）
  } catch {
    return { owner: undefined, value: null }
  }
}

export const listConflicts = (): ConflictMeta[] => {
  const out: ConflictMeta[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const id = localStorage.key(i)
    if (!id?.startsWith(CONFLICT_PREFIX)) continue
    const rest = id.slice(CONFLICT_PREFIX.length)
    const sep = rest.indexOf(':')
    if (sep < 0) continue
    const c = parseConflict(localStorage.getItem(id) ?? '')
    if (c.owner === undefined || c.owner !== getDataOwner()) continue // 無主或不是你的，不列
    out.push({ id, key: rest.slice(sep + 1), at: c.at ?? (Number(rest.slice(0, sep)) || 0) })
  }
  return out.sort((a, b) => b.at - a.at)
}

/** 把一份衝突副本打包成可下載的 JSON（格式跟匯出檔一致，importAll 吃得下）。 */
export const exportConflictAsFile = (id: string): string => {
  const raw = localStorage.getItem(id)
  if (!raw) throw new Error('找不到該副本')
  const parsed = parseConflict(raw)
  if (parsed.owner === undefined || parsed.owner !== getDataOwner())
    throw new Error('這份副本不屬於目前登入的帳號')
  const meta = listConflicts().find((c) => c.id === id)
  return JSON.stringify(
    {
      app: 'inkday-planner',
      version: 1,
      owner: getDataOwner(),
      exportedAt: new Date().toISOString(),
      conflictOf: meta?.key ?? id,
      data: { [meta?.key ?? id]: parsed.value },
    },
    null,
    2
  )
}

export const dismissConflict = (id: string): void => localStorage.removeItem(id)

// ---- 匯出 / 匯入 ----

/** 清掉這台裝置上所有本機資料（pp:*，含 settings/meta/sync）。
 *  登出時用：雲端帳號的資料不受影響，重新登入即可從雲端還原。 */
/** session 失效時：清掉雲端 token 與綁定標記，但**絕不刪使用者資料**。
 *
 *  舊版直接 clearAllLocalData()，註解寫「資料都在雲端，重新登入即還原」——
 *  那個假設是錯的，而且錯得無法復原（連 pp:bk:* 七天備份一起刪）。
 *  我第一版改成「有 dirty 就拒絕清除」，但那還是要猜對「什麼算未同步」：
 *  開站時 sync gate 關閉期間的編輯只進記憶體的 gatedKeys 不寫 dirty；
 *  還沒跑過 migrateDirtyOnce 的舊資料也不在 dirty 裡。看到空的 dirty 就刪，
 *  一樣會刪掉沒上雲的東西（Codex 互審第 4 輪 P0）。
 *
 *  這種「猜錯就永久毀資料」的判斷不值得做。session 過期只是要重新登入，
 *  沒有任何理由順手刪使用者的日記。想清空的人有「清空這台裝置」那顆按鈕。
 */
export const clearCloudSessionArtifacts = (): void => {
  clearSupabaseTokens()
  localStorage.removeItem(CLOUD_BOUND_KEY)
}

export const clearAllLocalData = () => {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    // ppl: 也要清。使用者按「清空這台裝置」時，最不該留下的就是他的 OpenAI
    // 金鑰（綁著信用卡）——留著等於下一個用這台裝置的人可以直接刷他的帳單。
    if (k === REVSEQ_KEY) continue // 版號序列不能倒退，否則之後的寫入會被伺服器當成過期請求擋掉
    if (k?.startsWith('pp:') || k?.startsWith(LOCAL_ONLY_PREFIX)) keys.push(k)
  }
  for (const k of keys) localStorage.removeItem(k)
  gatedKeys.clear()
}

/** 所有要同步/備份的資料 key（排除裝置本地的 sync 設定與 meta） */
export const allDataKeys = (): string[] => {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (
      k?.startsWith('pp:') &&
      k !== SYNC_KEY &&
      k !== INTEGRATIONS_KEY && // Notion token 只留本機：不上雲同步、不進匯出檔
      k !== META_KEY &&
      k !== CLOUD_BOUND_KEY &&
      k !== HABITS_RESTORED_KEY &&
      k !== LAST_BACKUP_KEY &&
      !k.startsWith(BACKUP_PREFIX) &&
      !k.startsWith(LOCAL_ONLY_PREFIX)
    )
      keys.push(k)
  }
  return keys
}

export const exportAll = (): string => {
  const data: Record<string, unknown> = {}
  for (const k of allDataKeys()) data[k] = JSON.parse(localStorage.getItem(k)!)
  // 衝突副本可能是另一裝置版本的唯一一份；匯出要一起帶走目前owner的副本。
  // 它們仍不在 allDataKeys，絕不上雲，也不收別人或owner不明的副本。
  for (const c of listConflicts()) data[c.id] = JSON.parse(localStorage.getItem(c.id)!)
  return JSON.stringify(
    { app: 'inkday-planner', version: 1, owner: getDataOwner(), exportedAt: new Date().toISOString(), data },
    null,
    2
  )
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const stringMap = (v: unknown): boolean =>
  isRecord(v) && Object.values(v).every((x) => typeof x === 'string')
const textItems = (v: unknown): boolean =>
  Array.isArray(v) && v.every((x) => isRecord(x) && typeof x.text === 'string')
const optional = (v: Record<string, unknown>, k: string, check: (x: unknown) => boolean): boolean =>
  v[k] === undefined || check(v[k])

/** 匯入只收已知的使用者資料；裝置標記、憑證與未知 pp:* 都不能進來。 */
const validateDataEntry = (key: string, value: unknown): void => {
  const bad = () => { throw new Error(`備份資料格式不正確：${key}`) }
  if (key.startsWith(CONFLICT_PREFIX)) {
    const match = key.match(/^ppl:conflict:\d+:(pp:.+)$/)
    if (!match || !isRecord(value) || value.__yike !== 2 ||
        (value.owner !== null && typeof value.owner !== 'string')) return bad()
    validateDataEntry(match[1], value.value)
    return
  }
  if (key === 'pp:pipAuto') {
    if (typeof value !== 'boolean') bad()
    return
  }
  if (!isRecord(value)) return bad()
  if (/^pp:day:\d{4}-\d{2}-\d{2}$/.test(key)) {
    if (!textItems(value.tasks) ||
        !optional(value, 'blocks', (x) => Array.isArray(x) && x.every((b) => isRecord(b) && typeof b.text === 'string' && typeof b.start === 'number' && typeof b.end === 'number')) ||
        !optional(value, 'answers', stringMap) ||
        !optional(value, 'habitsDone', (x) => isRecord(x) && Object.values(x).every((b) => typeof b === 'boolean'))) bad()
    return
  }
  if (/^pp:week:\d{4}-\d{2}-\d{2}$/.test(key)) {
    if (!textItems(value.tasks) || !optional(value, 'review', stringMap)) bad()
    return
  }
  if (/^pp:month:\d{4}-\d{2}$/.test(key) || /^pp:quarter:\d{4}-Q[1-4]$/.test(key)) {
    if (!textItems(value.priorities) || !optional(value, 'highlights', (x) => typeof x === 'string')) bad()
    return
  }
  if (/^pp:year:\d{4}$/.test(key)) {
    if (!textItems(value.goals) || !optional(value, 'notes', stringMap) ||
        !optional(value, 'monthFocus', (x) => Array.isArray(x) && x.every((t) => typeof t === 'string'))) bad()
    return
  }
  if (key === LIFE_KEY) {
    if (!textItems(value.goals) || !optional(value, 'northStar', (x) => typeof x === 'string') ||
        !optional(value, 'odyssey', (x) => Array.isArray(x) && x.every((p) => isRecord(p) && typeof p.title === 'string' && typeof p.body === 'string'))) bad()
    return
  }
  if (key === BIZ_KEY) {
    if (!['partners','activities','resources','value','relationships','channels','segments','costs','revenue'].every((k) => textItems(value[k])) ||
        !optional(value, 'tags', (x) => Array.isArray(x) && x.every((t) => isRecord(t) && typeof t.id === 'string' && typeof t.label === 'string' && typeof t.color === 'string'))) bad()
    return
  }
  if (key === SETTINGS_KEY) {
    for (const [k, v] of Object.entries(value)) {
      if (['focusMinutes','breakMinutes'].includes(k) && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) bad()
      if (['habits','morningQs','eveningQs'].includes(k) && (!Array.isArray(v) || !v.every((t) => typeof t === 'string'))) bad()
      if (['habitName','reminderTime'].includes(k) && typeof v !== 'string') bad()
      if (['focusLock','showRollover','autoLoop','reminderEnabled'].includes(k) && typeof v !== 'boolean') bad()
      if (k === 'focusStyle' && v !== 'tree' && v !== 'grid') bad()
      if (k === 'routines' && (!Array.isArray(v) || !v.every((r) => isRecord(r) && typeof r.label === 'string' && typeof r.emoji === 'string' && typeof r.start === 'number' && typeof r.dur === 'number' && typeof r.color === 'string'))) bad()
    }
    return
  }
  bad()
}

interface ImportEnvelope {
  data: Record<string, unknown>
  owner?: string | null
}
const parseImport = (json: string): ImportEnvelope => {
  const parsed: unknown = JSON.parse(json)
  if (!isRecord(parsed) || parsed.app !== 'inkday-planner' || parsed.version !== 1 || !isRecord(parsed.data))
    throw new Error('格式不正確：需要一刻手帳 version 1 備份檔')
  if (parsed.owner !== undefined && parsed.owner !== null && typeof parsed.owner !== 'string')
    throw new Error('備份帳號資訊格式不正確')
  for (const [k, v] of Object.entries(parsed.data)) validateDataEntry(k, v)
  if (Object.keys(parsed.data).length === 0) throw new Error('備份檔沒有可還原的資料')
  return { data: parsed.data, owner: parsed.owner as string | null | undefined }
}

export interface ImportPreview {
  count: number
  sourceOwner: string | null | undefined
  currentOwner: string | null
  requiresOwnerConfirmation: boolean
}
export const inspectImport = (json: string): ImportPreview => {
  const parsed = parseImport(json)
  const currentOwner = getDataOwner()
  return {
    count: Object.keys(parsed.data).length,
    sourceOwner: parsed.owner,
    currentOwner,
    requiresOwnerConfirmation: currentOwner !== null && parsed.owner !== currentOwner,
  }
}

/** 保存 before-image 後整批寫入；失敗回復原值，不把部分寫入宣稱成功或觸發同步。
 * localStorage 沒有多 key transaction。安全快照與暫存都寫不下時，完全不改現用資料。 */
const mergeBackupData = (data: Record<string, unknown>, action: string): number => {
  const entries = Object.entries(data)
  const owner = getDataOwner()
  const normalKeys = entries.filter(([k]) => !k.startsWith(CONFLICT_PREFIX)).map(([k]) => k)
  const dirty = loadDirty()
  const gates = new Set(gatedKeys)
  for (const k of normalKeys) {
    if (syncGateClosed) gates.add(k)
    else dirty[k] = (dirty[k] ?? 0) + 1
  }
  const updates = new Map(entries.map(([k, v]) => [k, JSON.stringify(v)]))
  if (syncGateClosed) updates.set(GATED_KEY, JSON.stringify([...gates]))
  else updates.set(DIRTY_KEY, JSON.stringify(dirty))
  const before = new Map([...updates.keys()].map((k) => [k, localStorage.getItem(k)]))
  const stage = 'ppl:restoreStaging'
  if (localStorage.getItem(stage) !== null)
    throw new Error('尚有未完成的復原暫存；請勿清除瀏覽器資料，並聯絡客服')
  // 新增 key 的空間與 overwritten key 的 before-image 先保留在一個持久化暫存中。
  localStorage.setItem(stage, JSON.stringify({ owner, before: Object.fromEntries(before), data }))
  const written: string[] = []
  try {
    for (const [k, raw] of updates) {
      localStorage.setItem(k, raw)
      written.push(k)
    }
  } catch {
    let rolledBack = true
    // 先移除剛新增的 key，釋放容量，再回復原本的 key。
    for (const k of written) if (before.get(k) === null) localStorage.removeItem(k)
    for (const k of written.reverse()) {
      const raw = before.get(k)
      if (raw === null || raw === undefined) continue
      try { localStorage.setItem(k, raw) } catch { rolledBack = false }
    }
    if (rolledBack) localStorage.removeItem(stage)
    throw new Error(rolledBack
      ? `${action}失敗，原資料已保留；請檢查儲存空間後再試`
      : `${action}失敗，安全快照與復原暫存已保留；請勿清除瀏覽器資料，並聯絡客服`)
  }
  localStorage.removeItem(stage)
  if (syncGateClosed) {
    for (const k of normalKeys) gatedKeys.add(k)
  } else {
    for (const k of normalKeys) gatedKeys.delete(k)
    for (const k of normalKeys) onDataWrite?.(k)
  }
  return entries.length
}

export const importAll = (json: string, options?: { confirmOwnerChange?: boolean }): number => {
  const parsed = parseImport(json)
  const preview = inspectImport(json)
  if (preview.requiresOwnerConfirmation && !options?.confirmOwnerChange)
    throw new Error('backup-owner-confirmation-required')
  if (!autoBackup(toDateKey(new Date()), true, undefined, true))
    throw new Error('匯入前的安全快照存不下（儲存空間不足），沒有動任何資料')
  const data = { ...parsed.data }
  // 使用者明確同意轉入現在的帳號後，衝突副本也歸到這個帳號；它們仍不會上雲。
  for (const [k, v] of Object.entries(data))
    if (k.startsWith(CONFLICT_PREFIX)) data[k] = { ...(v as Record<string, unknown>), owner: getDataOwner() }
  return mergeBackupData(data, '匯入')
}

// ---- 本機每日備份（安全網：就算同步出錯/資料被清，也能在這台還原）----

export interface BackupMeta {
  id: string // pp:bk:<id> 的 id（日期＋完整owner，可含~pre）；舊owner8 ID仍可讀
  date: string // 給人看的日期
  /** 這一份是「還原／匯入之前」自動照的安全快照，不是每日快照 */
  pre: boolean
  keys: number // 快照了幾個 key
  bytes: number // 快照大小
}

/** 破壞性操作（還原備份、從檔案匯入）之前的安全快照，key 後綴 ~pre。
 *  每日快照一天只照一張，早上照過之後寫的東西都不在裡面——使用者下午按「還原昨天」，
 *  今天寫的就沒了，而且還原完會標 dirty 推上雲端把雲端那份也蓋掉。
 *  跟換帳號同一條規則：照不成就不准動（Codex 互審後自審）。
 *  用獨立的 key，不然「還原今天的快照」會先把今天那份快照用現況覆蓋掉——
 *  等於把要還原的東西先毀掉。 */
const PRE_SUFFIX = '~pre'

/** 快照 key 的 id：同一天、不同帳號必須是不同的 key。
 *  原本一律 pp:bk:<date>：Alice 的內容被備份起來、Bob 接手同一天再開站，
 *  他的 setItem 直接蓋掉 Alice 那份——而她在換帳號的對話框裡被告知「可還原」。
 *  輪替分帳號救不了這條，因為丟失發生在 pruneBackups 之前（Codex 互審第 7 輪 P0-2）。 */
const backupId = (date: string, owner: string | null): string =>
  owner ? `${date}#${owner}` : date
const idDate = (id: string): string => id.split('#')[0].replace(PRE_SUFFIX, '')

/** 快照的兩種格式：
 *  - v2（現行）：{ __yike: 2, owner, data }。owner 是拍這張快照時這台裝置的歸屬帳號。
 *  - legacy：直接就是 { key: rawJSON }，未記錄 owner。原 owner 還在時可遷移；
 *    無法確認歸屬時保留原檔並隔離，不能猜成目前使用者的。
 *
 *  為什麼要綁 owner：共用裝置上 B 登入後選「取消（改用雲端那份）」，
 *  discardLocalForNewOwner 會把 A 的日記整包存成 pp:bk:今天。沒有 owner 欄位時
 *  B 的備份頁列得出來、載得下、還原得了 A 的明文日記——這正是 SECURITY.md
 *  第 9 條宣稱不會發生的事（Codex 互審第 5 輪 P0-6）。 */
interface BackupBlob {
  __yike: 2
  owner: string | null
  data: Record<string, string>
}

const parseBackup = (
  raw: string
): { owner: string | null | undefined; data: Record<string, string> } | null => {
  try {
    const parsed = JSON.parse(raw) as BackupBlob | Record<string, string>
    if (parsed && typeof parsed === 'object' && (parsed as BackupBlob).__yike === 2) {
      const b = parsed as BackupBlob
      return { owner: b.owner === null || typeof b.owner === 'string' ? b.owner : undefined, data: b.data ?? {} }
    }
    return { owner: undefined, data: parsed as Record<string, string> } // legacy
  } catch {
    return null
  }
}

/** 這份快照是不是「現在這個人」的。
 *
 *  第一版寫成「legacy（沒有 owner 欄位）一律放行」，Codex 第 6 輪指出那等於留了一道
 *  後門：Alice 升級前的無主快照在她登出（登出會清掉 owner、保留快照）之後，
 *  下一個人不必登入就能列出、下載、還原。改成「無主快照在升級當下就蓋上目前的 owner」，
 *  之後 undefined 一律視為別人的。 */
const backupIsMine = (owner: string | null | undefined): boolean => owner === getDataOwner()

const BACKUP_OWNER_MIGRATED = 'ppl:bkOwnerMigrated'
const BACKUP_QUARANTINED = 'ppl:backupQuarantined'
const CONFLICT_OWNER_MIGRATED = 'ppl:conflictOwnerMigrated'
const CONFLICT_QUARANTINED = 'ppl:conflictQuarantined'

/** 原 owner 已遺失的 legacy 快照保留原檔並逐筆隔離，不能猜成匿名或下一個帳號的。 */
const quarantineLegacyBackups = (): boolean => {
  const ids = new Set(read<string[]>(BACKUP_QUARANTINED) ?? [])
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k?.startsWith(BACKUP_PREFIX)) continue
    const raw = localStorage.getItem(k)
    if (raw && parseBackup(raw)?.owner === undefined) ids.add(k)
  }
  try {
    if (ids.size) localStorage.setItem(BACKUP_QUARANTINED, JSON.stringify([...ids]))
    return true
  } catch { return false }
}

/** 在舊 owner 還在的啟動階段認領 legacy 副本；沒有 owner 的副本先隔離，不刪除。 */
const stampLegacyConflictOwners = (): boolean => {
  const owner = getDataOwner()
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(CONFLICT_PREFIX)) keys.push(k)
  }
  const quarantined = new Set(read<string[]>(CONFLICT_QUARANTINED) ?? [])
  // 原 owner 已不在時持久化逐筆隔離。否則新帳號下一次啟動就會誤認領這些副本。
  if (owner === null) {
    for (const k of keys) {
      const raw = localStorage.getItem(k)
      if (raw && parseConflict(raw).owner === undefined) quarantined.add(k)
    }
    try {
      if (quarantined.size) localStorage.setItem(CONFLICT_QUARANTINED, JSON.stringify([...quarantined]))
      return true
    } catch { return false }
  }
  if (localStorage.getItem(CONFLICT_OWNER_MIGRATED) === '1') return true
  for (const k of keys) {
    if (quarantined.has(k)) continue
    const raw = localStorage.getItem(k)
    if (!raw) continue
    const parsed = parseConflict(raw)
    if (parsed.owner !== undefined || parsed.value === null) continue
    try {
      localStorage.setItem(k, JSON.stringify({ __yike: 2, owner, value: parsed.value }))
    } catch {
      return false // 原始 blob 保留，下一次啟動可重試；旗標不設。
    }
  }
  localStorage.setItem(CONFLICT_OWNER_MIGRATED, '1')
  return true
}

/** 一次性：把這一版之前產生的無主快照蓋上「目前這台裝置的歸屬」。
 *  必須在任何「清掉 owner」的動作（登出）之前跑過，所以放在 App 啟動時。
 *  也用在「無主裝置被新帳號認領」時——同一個人，快照要跟著他走。 */
export const stampLegacyBackupOwners = (force = false): void => {
  stampLegacyConflictOwners()
  if (getDataOwner() === null) {
    quarantineLegacyBackups()
    return
  }
  if (!force && localStorage.getItem(BACKUP_OWNER_MIGRATED) === '1') return
  const owner = getDataOwner()
  const quarantined = new Set(read<string[]>(BACKUP_QUARANTINED) ?? [])
  // 一定要先把 key 蒐集起來。迴圈裡 removeItem 會讓 localStorage 的索引位移，
  // 邊走邊刪會跳掉後面的快照。
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(BACKUP_PREFIX)) keys.push(k)
  }
  for (const k of keys) {
    if (quarantined.has(k)) continue
    const raw = localStorage.getItem(k)
    if (!raw) continue
    const parsed = parseBackup(raw)
    if (!parsed || parsed.owner !== undefined) continue
    try {
      const blob: BackupBlob = { __yike: 2, owner, data: parsed.data }
      // key 也要改名。只改 blob 的 owner、key 還是純日期的話，之後有人以純本機
      // 模式在同一天建快照，就用同一個 key 蓋掉這一份（Codex 互審第 8 輪 P1-7）。
      const want = BACKUP_PREFIX + backupId(k.slice(BACKUP_PREFIX.length), owner)
      localStorage.setItem(want, JSON.stringify(blob))
      if (want !== k) localStorage.removeItem(k)
    } catch {
      /* 配額滿：下次啟動再試，旗標不設 */
      return
    }
  }
  localStorage.setItem(BACKUP_OWNER_MIGRATED, '1')
}

/** 只輪替「這個人」的快照。不分帳號的話，Bob 的第 8 天會把 Alice 被保證留著的
 *  那份刪掉——她登出時明明被告知快照會留給她（Codex 互審第 6 輪 P1-5）。 */
const pruneBackups = (owner: string | null) => {
  const dates: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k?.startsWith(BACKUP_PREFIX)) continue
    const parsed = parseBackup(localStorage.getItem(k) ?? '')
    if (!parsed || parsed.owner !== owner) continue
    if (k.endsWith(PRE_SUFFIX)) continue // 安全快照只有一份、自己覆蓋自己，不佔 7 份的名額
    dates.push(k.slice(BACKUP_PREFIX.length))
  }
  dates.sort() // 舊→新
  while (dates.length > BACKUP_KEEP) {
    const d = dates.shift()!
    localStorage.removeItem(BACKUP_PREFIX + d)
  }
}

/** 每天自動快照一次本機所有資料到 pp:bk:<today>，保留最近 7 份。純本機、不同步、不匯出。
 *  寫入型操作、不碰既有資料；空資料不備份。配額/序列化失敗一律靜默。 */
export const autoBackup = (
  todayKey: string,
  force = false,
  /** 明確指定這張快照屬於誰。換帳號時要記成「原本那個人」，不是即將接手的新帳號。 */
  ownerOverride?: string | null,
  /** 安全快照用：寫到 <date>#<owner>~pre，不動每日那一份、也不更新 lastBackup */
  pre = false
): boolean => {
  try {
    // force：要清資料之前必須無條件重照一張。原本「今天備過就 return」會讓
    // 早上那張快照之後寫的東西完全沒進備份，而呼叫端以為有得後悔。
    const owner = ownerOverride ?? getDataOwner()
    const ownerTag = owner ?? '_local'
    const last = read<Record<string, string>>(LAST_BACKUP_KEY) ?? {}
    if (!pre && !force && last[ownerTag] === todayKey) return true
    const data: Record<string, string> = {}
    let has = false
    for (const k of allDataKeys()) {
      const raw = localStorage.getItem(k)
      if (raw) {
        data[k] = raw // 存原始 JSON 字串，還原時精確還原
        has = true
      }
    }
    // 衝突副本不在 allDataKeys() 裡（ppl: 前綴結構性排除同步），但它是「另一台裝置
    // 那個版本」的唯一一份。換帳號時先備份再刪副本＝那個版本永久消失，
    // 而備份裡救不回來（Codex 互審第 7 輪 P0-3）。所以快照要一起收。
    //
    // 只收「這張快照的主人」的。副本刻意活過登出，所以 Bob 建快照時 Alice 的副本
    // 還在同一個 localStorage 裡；不比對內層 owner 的話，Bob 按「存成檔案」
    // 就把 Alice 的私密內容帶出裝置——而他的衝突清單是空的，完全看不出來
    //（Codex 互審第 8 輪 P0-1，這是我上一輪修出來的洞）。
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith(CONFLICT_PREFIX)) continue
      const raw = localStorage.getItem(k)
      if (!raw) continue
      try {
        const parsed = parseConflict(raw)
        if (parsed.owner === undefined || parsed.owner !== owner) continue
      } catch {
        continue // 解不開的副本不進快照（寧可不收，也不要收到別人的）
      }
      data[k] = raw
      has = true
    }
    if (!has) return true // 全空（新裝置同步前/已清空）：沒東西可備份，不算失敗
    const blob: BackupBlob = { __yike: 2, owner, data }
    let id = backupId(todayKey, owner) + (pre ? PRE_SUFFIX : '')
    // 同日的舊無主快照必須原封保留；新的匿名快照另取 id，不覆蓋隔離原檔。
    const existing = localStorage.getItem(BACKUP_PREFIX + id)
    if (existing && parseBackup(existing)?.owner === undefined)
      id = backupId(todayKey + '#local', owner) + (pre ? PRE_SUFFIX : '')
    localStorage.setItem(BACKUP_PREFIX + id, JSON.stringify(blob))
    if (pre) return true // 安全快照不算「今天備過了」，也不參與輪替（下一次破壞性操作會覆蓋它）
    last[ownerTag] = todayKey
    localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify(last))
    pruneBackups(owner)
    return true
  } catch {
    // 配額滿、Safari 拒絕寫入、序列化失敗。平常靜默略過不影響 app，
    // 但呼叫端如果是「備份完就要刪資料」，必須知道這次其實沒備到。
    return false
  }
}

/** 列出現有的每日快照（新→舊）。 */
export const listBackups = (): BackupMeta[] => {
  const out: BackupMeta[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k?.startsWith(BACKUP_PREFIX)) continue
    const raw = localStorage.getItem(k) ?? '{}'
    const parsed = parseBackup(raw)
    if (!parsed || !backupIsMine(parsed.owner)) continue // 別人的快照不列給你看
    out.push({
      id: k.slice(BACKUP_PREFIX.length),
      date: idDate(k.slice(BACKUP_PREFIX.length)),
      pre: k.endsWith(PRE_SUFFIX),
      keys: Object.keys(parsed.data).length,
      bytes: raw.length,
    })
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

const OWNER_KEY = 'ppl:owner' // 這台裝置的本機資料屬於哪個雲端帳號（uid）

/** 這台裝置的資料目前歸屬於誰。null = 還沒跟任何帳號綁定（純本機使用者）。
 *  存在的理由：共用裝置上，A 先在本機寫了日記、B 接著登入自己的帳號，
 *  同步會把 A 的日記當成「本機比較新」整包上傳進 B 的帳號——
 *  A 的私密內容跑進 B 的雲端，還可能覆蓋掉 B 原本的記錄。
 *  RLS 擋不到這種事：寫入的確實是 B 的 session、B 的 user_id，只是內容是 A 的。 */
export const getDataOwner = (): string | null => localStorage.getItem(OWNER_KEY)
export const setDataOwner = (uid: string) => localStorage.setItem(OWNER_KEY, uid)

/** 這台裝置上有幾個資料 key（用來判斷「登入前就有東西」）。 */
export const localDataCount = (): number => allDataKeys().length

/** 放棄這台裝置的本機資料改用雲端那份。先存一份快照再清，才有得後悔。 */
export const discardLocalForNewOwner = (uid: string): void => {
  // 備份失敗就不准刪。原本吞掉 autoBackup 的錯誤直接往下刪，
  // localStorage 滿了或 Safari 拒寫時，使用者的資料會在沒有任何備份的情況下消失
  //（Codex 互審第 2 輪 P1）。寧可讓登入失敗，也不要無聲刪掉別人的日記。
  // 快照要記在「原本那個人」名下。記成新帳號的話，接手的人打開備份頁
  // 就能列出、下載、還原上一個人的明文日記（Codex 互審第 5 輪 P0-6）。
  if (!autoBackup(toDateKey(new Date()), true, getDataOwner()))
    throw new Error('backup-failed-before-discard')
  for (const k of allDataKeys()) localStorage.removeItem(k)
  localStorage.removeItem(META_KEY)
  // dirty 也要清。沒清的話：pull 會因為「這個 key 是髒的」而跳過新帳號的雲端版本，
  // push 又因為本機檔案已刪而排除它——那些 key 從此兩邊都拉不到也推不上。
  localStorage.removeItem(DIRTY_KEY)
  localStorage.removeItem(DIRTY_MIGRATED_KEY)
  localStorage.removeItem(GATED_KEY)
  gatedKeys.clear() // 記憶體保護也屬於上一個人的資料，不能擋住新owner的pull
  // 上一個人的 OpenAI 金鑰綁著他的信用卡。換人了還留著，等於新使用者的每一次
  // AI 分析都在刷前一個人的帳單，而且他從同 origin 的 localStorage 就讀得到完整金鑰。
  localStorage.removeItem(OPENAI_KEY_KEY)
  localStorage.removeItem(OPENAI_MODEL_KEY)
  // Notion token 一併清掉。留著的話新使用者按「送到 Notion」，日記會送進
  // 上一個人的 workspace（Codex 互審第 6 輪 P1-4）。
  localStorage.removeItem(INTEGRATIONS_KEY)
  // 計時狀態也是上一個人的：會顯示他的任務名稱，完成後還會寫進新使用者的今天。
  localStorage.removeItem('ppl:timer')
  // 未處理的衝突副本屬於上一個人，不能留給接手的人看
  for (const c of listConflicts()) localStorage.removeItem(c.id)
  setDataOwner(uid)
}

/** 無主裝置被帳號認領（同一個人第一次登入）：把他自己的快照與副本一起轉過去。 */
export const claimDeviceFor = (uid: string): void => {
  const before = getDataOwner()
  if (before === null && (!stampLegacyConflictOwners() || !quarantineLegacyBackups()))
    throw new Error('舊副本隔離標記存不下，沒有變更資料歸屬；請先釋放儲存空間')
  setDataOwner(uid)
  if (before !== null) return
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(BACKUP_PREFIX)) keys.push(k) // 同上：先蒐集再改名/刪除
  }
  for (const k of keys) {
    const raw = localStorage.getItem(k)
    if (!raw) continue
    const parsed = parseBackup(raw)
    if (!parsed || parsed.owner !== null) continue
    try {
      // 同上：認領要連 key 一起改名，否則同日的匿名快照會蓋掉它
      const want = BACKUP_PREFIX + backupId(k.slice(BACKUP_PREFIX.length), uid)
      localStorage.setItem(want, JSON.stringify({ __yike: 2, owner: uid, data: parsed.data }))
      if (want !== k) localStorage.removeItem(k)
    } catch {
      /* 配額滿：快照留著，只是暫時看不到 */
    }
  }
  // 新格式、明確屬於本機使用者的副本可一起認領；無主 legacy blob 仍隔離。
  const conflictIds: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(CONFLICT_PREFIX)) conflictIds.push(k)
  }
  for (const id of conflictIds) {
    const raw = localStorage.getItem(id)
    if (!raw) continue
    const parsed = parseConflict(raw)
    if (parsed.owner !== null) continue
    try {
      localStorage.setItem(id, JSON.stringify({ __yike: 2, owner: uid, at: parsed.at, value: parsed.value }))
    } catch { /* 原本副本留著，不刪資料 */ }
  }
}

/** 登出：清掉這台裝置上的現用資料與憑證，但**保留每日快照**。
 *
 *  舊版直接呼叫 clearAllLocalData()，而 BACKUP_PREFIX 是 'pp:bk:'——'pp:' 開頭，
 *  於是七天備份跟著一起沒了。這正是互審第 3 輪那條 P0 的同一個坑，只是換到登出這條路
 *  （Codex 互審第 5 輪 P0-5）。快照現在綁 owner，留著也不會被下一個登入的人看到。 */
export const clearForLogout = (): void => {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k) continue
    if (k.startsWith(BACKUP_PREFIX) || k === LAST_BACKUP_KEY) continue // 備份留著
    // 衝突副本是「另一台裝置那個版本」的唯一一份救援，而且不在每日快照裡。
    // 登出把它刪掉＝那個版本永久消失（Codex 互審第 6 輪 P0-4）。它們綁 owner，留著不會外洩。
    if (k.startsWith(CONFLICT_PREFIX) || k === BACKUP_OWNER_MIGRATED || k === BACKUP_QUARANTINED || k === CONFLICT_OWNER_MIGRATED || k === CONFLICT_QUARANTINED) continue
    if (k === DEVICE_KEY || k === REVSEQ_KEY) continue // 裝置身分/版號序列必須單調，清了會倒退
    if (k.startsWith('pp:') || k.startsWith(LOCAL_ONLY_PREFIX)) keys.push(k)
  }
  for (const k of keys) localStorage.removeItem(k)
  gatedKeys.clear()
}

const OPENAI_KEY_KEY = LOCAL_ONLY_PREFIX + 'openaiKey'

/** 使用者自己的 OpenAI 金鑰。只存在這台裝置：
 *  不同步上雲、不進匯出檔、不經過站方任何伺服器——瀏覽器直接打 OpenAI。
 *  站方因此完全碰不到你的金鑰，也不會替你付任何費用。 */
const OPENAI_MODEL_KEY = LOCAL_ONLY_PREFIX + 'openaiModel'

export const getOpenAIKey = (): string => localStorage.getItem(OPENAI_KEY_KEY) ?? ''
/** 存金鑰時一併記下當時查到的可用型號（型號會汰換，不寫死在程式裡）。 */
export const setOpenAIKey = (k: string, model?: string) => {
  const v = k.trim()
  if (v) {
    localStorage.setItem(OPENAI_KEY_KEY, v)
    if (model) localStorage.setItem(OPENAI_MODEL_KEY, model)
  } else {
    localStorage.removeItem(OPENAI_KEY_KEY)
    localStorage.removeItem(OPENAI_MODEL_KEY)
  }
}
export const getOpenAIModel = (): string =>
  localStorage.getItem(OPENAI_MODEL_KEY) ?? 'gpt-4o-mini'

/** 把某份每日快照打包成可下載的 JSON 文字（跟 exportAll 同格式，importAll 吃得下）。
 *  存在的理由：pp:bk:* 只活在 localStorage，跟本體同一個籃子——清瀏覽器資料、
 *  換手機、或 Safari 的儲存清理一來，備份會跟資料一起消失。備份要離開這台裝置才算數。 */
export const exportBackupAsFile = (id: string): string => {
  const raw = localStorage.getItem(BACKUP_PREFIX + id)
  if (!raw) throw new Error('找不到該備份')
  const parsed = parseBackup(raw)
  if (!parsed) throw new Error('備份已損毀')
  if (!backupIsMine(parsed.owner)) throw new Error('這份備份不屬於目前登入的帳號')
  const snap = parsed.data
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(snap)) {
    try {
      data[k] = JSON.parse(v)
    } catch {
      /* 單筆壞掉：跳過，不要讓一筆爛資料害整份匯不出來 */
    }
  }
  return JSON.stringify(
    { app: 'inkday-planner', version: 1, owner: parsed.owner, exportedAt: new Date().toISOString(), backupOf: idDate(id), data },
    null,
    2
  )
}

const LAST_EXPORT_KEY = 'ppl:lastExport' // 最後一次把資料帶離這台裝置的日期

export const markExported = () => localStorage.setItem(LAST_EXPORT_KEY, toDateKey(new Date()))
export const lastExportDate = (): string | null => localStorage.getItem(LAST_EXPORT_KEY)
/** 距上次匯出幾天（從沒匯出過回 null）。UI 用它決定要不要提醒。 */
export const daysSinceExport = (): number | null => {
  const d = lastExportDate()
  if (!d) return null
  return Math.floor((Date.parse(toDateKey(new Date())) - Date.parse(d)) / 86400000)
}

/** 還原某份快照：更新快照內的 key，保留現有額外記錄，成功後才標 dirty 同步。 */
export const restoreBackup = (id: string): number => {
  const raw = localStorage.getItem(BACKUP_PREFIX + id)
  if (!raw) throw new Error('找不到該備份')
  const parsed = parseBackup(raw)
  if (!parsed) throw new Error('備份已損毀')
  // 還原會把內容標成 dirty 推上目前登入的雲端帳號。不是自己的快照還原下去，
  // 等於把上一個人的日記推進你的帳號——擋在這裡。
  if (!backupIsMine(parsed.owner)) throw new Error('這份備份不屬於目前登入的帳號')
  const data: Record<string, unknown> = {}
  // 先檢查整份快照，任何一筆壞掉都不開始寫，不能靜默跳過後回報「成功」。
  for (const [k, rawValue] of Object.entries(parsed.data)) {
    const value: unknown = JSON.parse(rawValue)
    validateDataEntry(k, value)
    data[k] = value
  }
  if (Object.keys(data).length === 0) throw new Error('備份沒有可還原的資料')
  // 先把「現在」照下來，包含早上每日快照之後寫的東西。
  if (!autoBackup(toDateKey(new Date()), true, undefined, true))
    throw new Error('還原前的安全快照存不下（儲存空間不足），沒有動任何資料')
  return mergeBackupData(data, '還原')
}
