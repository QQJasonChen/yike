import {
  DayEntry,
  LegacyDayFields,
  LifeEntry,
  MonthEntry,
  QuarterEntry,
  Settings,
  WeekEntry,
  YearEntry,
  defaultSettings,
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
const SYNC_KEY = 'pp:sync' // 同步設定（含 token）——絕不進匯出檔
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

const META_KEY = 'pp:meta' // 每個 key 的最後修改時間（雲端同步用）

/** 寫入後通知（雲端同步 debounce push 用） */
export let onDataWrite: ((key: string) => void) | null = null
export const setOnDataWrite = (fn: ((key: string) => void) | null) => {
  onDataWrite = fn
}

export const loadMeta = (): Record<string, number> => read<Record<string, number>>(META_KEY) ?? {}

const touchMeta = (key: string) => {
  const m = loadMeta()
  m[key] = Date.now()
  localStorage.setItem(META_KEY, JSON.stringify(m))
}

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
export const clearAllLocalData = () => {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith('pp:')) keys.push(k)
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
      k !== META_KEY &&
      k !== CLOUD_BOUND_KEY &&
      k !== HABITS_RESTORED_KEY &&
      k !== LAST_BACKUP_KEY &&
      !k.startsWith(BACKUP_PREFIX)
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
export const autoBackup = (todayKey: string): void => {
  try {
    if (localStorage.getItem(LAST_BACKUP_KEY) === todayKey) return // 今天已備份
    const data: Record<string, string> = {}
    let has = false
    for (const k of allDataKeys()) {
      const raw = localStorage.getItem(k)
      if (raw) {
        data[k] = raw // 存原始 JSON 字串，還原時精確還原
        has = true
      }
    }
    if (!has) return // 全空（新裝置同步前/已清空）：先不備份也不標記，等資料載入後再試
    localStorage.setItem(BACKUP_PREFIX + todayKey, JSON.stringify(data))
    localStorage.setItem(LAST_BACKUP_KEY, todayKey)
    pruneBackups()
  } catch {
    /* 配額或序列化失敗：靜默略過，不影響 app */
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
