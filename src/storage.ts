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
const LAST_BACKUP_KEY = 'pp:lastBackup' // 上次自動備份的日期（一天只備一次）
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

/** 寫入後通知（雲端同步 debounce push 用） */
export let onDataWrite: ((key: string) => void) | null = null
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
  localStorage.setItem(DIRTY_KEY, JSON.stringify(d))
}

/** push 成功後：清掉髒標記，並把 meta 對齊伺服器回傳的時間戳（讓兩邊用同一個時鐘）。
 *  pushedKeys 是「這次確實送出去的 key」；rows 是伺服器回傳的結果。
 *  兩者分開的原因：upsert 成功但 .select() 沒回內容時（RLS/PostgREST 設定差異），
 *  只靠 rows 會讓髒標記永遠清不掉 → 那些 key 每次同步都重推一遍。
 *  這時仍要清髒標記（東西確實上去了），但不動 meta——留給下次 pull 從伺服器補正。 */
export const markSynced = (
  rows: { key: string; updated_at: string }[],
  pushedRevs: Record<string, number> = {}
): void => {
  const d = loadDirty()
  const m = loadMeta()
  // 只清「推送期間沒再被改過」的 key。版號對不上代表使用者在等回應時又編輯了，
  // 那筆更新的內容還沒上去，標記必須留著讓下次同步帶走。
  const clear = (k: string) => {
    if (pushedRevs[k] !== undefined && d[k] !== pushedRevs[k]) return
    delete d[k]
  }
  for (const k of Object.keys(pushedRevs)) clear(k)
  for (const r of rows) {
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
export const closeSyncGate = () => {
  syncGateClosed = true
}
export const openSyncGate = () => {
  if (!syncGateClosed && gatedKeys.size === 0) return
  syncGateClosed = false
  const keys = [...gatedKeys]
  gatedKeys.clear()
  for (const k of keys) {
    touchMeta(k)
    onDataWrite?.(k)
  }
}

const write = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value))
  if (key !== SYNC_KEY && key !== META_KEY) {
    if (syncGateClosed) {
      gatedKeys.add(key) // 閘門關閉：先記下，等 openSyncGate 再 bump+推送
      return
    }
    touchMeta(key)
    onDataWrite?.(key)
  }
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

// ---- 匯出 / 匯入 ----

/** 清掉這台裝置上所有本機資料（pp:*，含 settings/meta/sync）。
 *  登出時用：雲端帳號的資料不受影響，重新登入即可從雲端還原。 */
/** session 失效時的清理：保留每日快照，且有未同步內容時拒絕清除。
 *  舊版直接呼叫 clearAllLocalData，註解寫「資料都在雲端，重新登入即還原」——
 *  那個假設是錯的：dirty 的內容正是「還沒上雲」的那些。離線寫了日記、token
 *  剛好過期，開 app 就會連同 pp:bk:* 七天備份一起刪光，無法復原
 *  （Codex 上架前互審第 3 輪 P0）。
 *  回傳 false = 有未同步資料，呼叫端不該清、應該請使用者重新登入。 */
export const clearCloudDataOnSessionLoss = (): boolean => {
  if (Object.keys(loadDirty()).length > 0) return false
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k) continue
    if (k.startsWith(BACKUP_PREFIX)) continue // 備份是最後一道安全網，不能跟著清
    if (k.startsWith('pp:') || k.startsWith(LOCAL_ONLY_PREFIX)) keys.push(k)
  }
  for (const k of keys) localStorage.removeItem(k)
  return true
}

export const clearAllLocalData = () => {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    // ppl: 也要清。使用者按「清空這台裝置」時，最不該留下的就是他的 OpenAI
    // 金鑰（綁著信用卡）——留著等於下一個用這台裝置的人可以直接刷他的帳單。
    if (k?.startsWith('pp:') || k?.startsWith(LOCAL_ONLY_PREFIX)) keys.push(k)
  }
  for (const k of keys) localStorage.removeItem(k)
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
  return JSON.stringify(
    { app: 'inkday-planner', version: 1, exportedAt: new Date().toISOString(), data },
    null,
    2
  )
}

export const importAll = (json: string): number => {
  const parsed = JSON.parse(json) as { data?: Record<string, unknown> }
  if (!parsed.data) throw new Error('格式不正確')
  let count = 0
  for (const [k, v] of Object.entries(parsed.data)) {
    if (k.startsWith('pp:') && k !== SYNC_KEY && k !== META_KEY && !k.startsWith(BACKUP_PREFIX)) {
      write(k, v)
      count++
    }
  }
  return count
}

// ---- 本機每日備份（安全網：就算同步出錯/資料被清，也能在這台還原）----

export interface BackupMeta {
  date: string // pp:bk:<date> 的 date
  keys: number // 快照了幾個 key
  bytes: number // 快照大小
}

const pruneBackups = () => {
  const dates: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(BACKUP_PREFIX)) dates.push(k.slice(BACKUP_PREFIX.length))
  }
  dates.sort() // 舊→新
  while (dates.length > BACKUP_KEEP) {
    const d = dates.shift()!
    localStorage.removeItem(BACKUP_PREFIX + d)
  }
}

/** 每天自動快照一次本機所有資料到 pp:bk:<today>，保留最近 7 份。純本機、不同步、不匯出。
 *  寫入型操作、不碰既有資料；空資料不備份。配額/序列化失敗一律靜默。 */
export const autoBackup = (todayKey: string, force = false): boolean => {
  try {
    // force：要清資料之前必須無條件重照一張。原本「今天備過就 return」會讓
    // 早上那張快照之後寫的東西完全沒進備份，而呼叫端以為有得後悔。
    if (!force && localStorage.getItem(LAST_BACKUP_KEY) === todayKey) return true
    const data: Record<string, string> = {}
    let has = false
    for (const k of allDataKeys()) {
      const raw = localStorage.getItem(k)
      if (raw) {
        data[k] = raw // 存原始 JSON 字串，還原時精確還原
        has = true
      }
    }
    if (!has) return true // 全空（新裝置同步前/已清空）：沒東西可備份，不算失敗
    localStorage.setItem(BACKUP_PREFIX + todayKey, JSON.stringify(data))
    localStorage.setItem(LAST_BACKUP_KEY, todayKey)
    pruneBackups()
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
    let keys = 0
    try {
      keys = Object.keys(JSON.parse(raw) as Record<string, string>).length
    } catch {
      /* 壞掉的快照算 0 */
    }
    out.push({ date: k.slice(BACKUP_PREFIX.length), keys, bytes: raw.length })
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
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
  if (!autoBackup(toDateKey(new Date()), true))
    throw new Error('backup-failed-before-discard')
  for (const k of allDataKeys()) localStorage.removeItem(k)
  localStorage.removeItem(META_KEY)
  // dirty 也要清。沒清的話：pull 會因為「這個 key 是髒的」而跳過新帳號的雲端版本，
  // push 又因為本機檔案已刪而排除它——那些 key 從此兩邊都拉不到也推不上。
  localStorage.removeItem(DIRTY_KEY)
  localStorage.removeItem(DIRTY_MIGRATED_KEY)
  setDataOwner(uid)
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
export const exportBackupAsFile = (date: string): string => {
  const raw = localStorage.getItem(BACKUP_PREFIX + date)
  if (!raw) throw new Error('找不到該備份')
  const snap = JSON.parse(raw) as Record<string, string>
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(snap)) {
    try {
      data[k] = JSON.parse(v)
    } catch {
      /* 單筆壞掉：跳過，不要讓一筆爛資料害整份匯不出來 */
    }
  }
  return JSON.stringify(
    { app: 'inkday-planner', version: 1, exportedAt: new Date().toISOString(), backupOf: date, data },
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

/** 還原某份快照：清掉目前資料 key（不動 sync/meta/backup），寫回快照並 bump meta（讓它同步上雲）。
 *  回傳還原的 key 數。這是使用者明確觸發的還原動作。 */
export const restoreBackup = (date: string): number => {
  const raw = localStorage.getItem(BACKUP_PREFIX + date)
  if (!raw) throw new Error('找不到該備份')
  const data = JSON.parse(raw) as Record<string, string>
  for (const k of allDataKeys()) localStorage.removeItem(k) // 先清現有資料（保留 sync/meta/backup）
  let n = 0
  for (const [k, v] of Object.entries(data)) {
    try {
      write(k, JSON.parse(v)) // write 會 bump meta + 觸發同步推送
      n++
    } catch {
      /* 單筆壞掉：跳過 */
    }
  }
  return n
}
