import {
  DayEntry,
  LegacyDayFields,
  MonthEntry,
  Settings,
  WeekEntry,
  YearEntry,
  defaultSettings,
  emptyDay,
  emptyMonth,
  emptyWeek,
  emptyYear,
} from './types'

const DAY_PREFIX = 'pp:day:'
const WEEK_PREFIX = 'pp:week:'
const MONTH_PREFIX = 'pp:month:'
const SETTINGS_KEY = 'pp:settings'
const SYNC_KEY = 'pp:sync' // 同步設定（含 token）——絕不進匯出檔

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

const write = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value))
  if (key !== SYNC_KEY && key !== META_KEY) {
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

const YEAR_PREFIX = 'pp:year:'

export const loadYear = (yearKey: string): YearEntry => {
  const stored = read<Partial<YearEntry>>(YEAR_PREFIX + yearKey)
  return stored ? { ...emptyYear(), ...stored } : emptyYear()
}

export const saveYear = (yearKey: string, entry: YearEntry) =>
  write(YEAR_PREFIX + yearKey, entry)

export const loadSettings = (): Settings => {
  const s = { ...defaultSettings(), ...(read<Partial<Settings>>(SETTINGS_KEY) ?? {}) }
  // v1 單一習慣 → v2 習慣清單
  if (s.habits.length === 0 && s.habitName) s.habits = [s.habitName]
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

export const nameStats = (): NameStat[] => {
  const map = new Map<string, { days: Set<string>; sessions: number; minutes: number; plans: number }>()
  const touch = (n: string) => {
    if (!map.has(n)) map.set(n, { days: new Set(), sessions: 0, minutes: 0, plans: 0 })
    return map.get(n)!
  }
  for (const k of allDayKeys()) {
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
  for (const k of keysWithPrefix(WEEK_PREFIX))
    for (const t of loadWeek(k).tasks) {
      const n = t.text.trim()
      if (n) touch(n).plans++
    }
  for (const k of keysWithPrefix(MONTH_PREFIX))
    for (const p of loadMonth(k).priorities) {
      const n = p.text.trim()
      if (n) touch(n).plans++
    }
  for (const k of keysWithPrefix(YEAR_PREFIX))
    for (const g of loadYear(k).goals) {
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

/** 所有要同步/備份的資料 key（排除裝置本地的 sync 設定與 meta） */
export const allDataKeys = (): string[] => {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith('pp:') && k !== SYNC_KEY && k !== META_KEY) keys.push(k)
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
    if (k.startsWith('pp:') && k !== SYNC_KEY && k !== META_KEY) {
      write(k, v)
      count++
    }
  }
  return count
}
