import {
  DayEntry,
  Settings,
  WeekEntry,
  defaultSettings,
  emptyDay,
  emptyWeek,
} from './types'

const DAY_PREFIX = 'pp:day:'
const WEEK_PREFIX = 'pp:week:'
const SETTINGS_KEY = 'pp:settings'

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

const write = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value))
}

export const loadDay = (dateKey: string): DayEntry => {
  const stored = read<Partial<DayEntry>>(DAY_PREFIX + dateKey)
  // 與 emptyDay 合併，舊資料缺新欄位（如 blocks）時自動補上
  return stored ? { ...emptyDay(), ...stored } : emptyDay()
}

export const saveDay = (dateKey: string, entry: DayEntry) =>
  write(DAY_PREFIX + dateKey, entry)

export const loadWeek = (mondayKey: string): WeekEntry =>
  read<WeekEntry>(WEEK_PREFIX + mondayKey) ?? emptyWeek()

export const saveWeek = (mondayKey: string, entry: WeekEntry) =>
  write(WEEK_PREFIX + mondayKey, entry)

export const loadSettings = (): Settings => ({
  ...defaultSettings(),
  ...(read<Partial<Settings>>(SETTINGS_KEY) ?? {}),
})

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

// ---- 匯出 / 匯入 ----

export const exportAll = (): string => {
  const data: Record<string, unknown> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith('pp:')) data[k] = JSON.parse(localStorage.getItem(k)!)
  }
  return JSON.stringify({ app: 'productivity-planner', version: 1, data }, null, 2)
}

export const importAll = (json: string): number => {
  const parsed = JSON.parse(json) as { data?: Record<string, unknown> }
  if (!parsed.data) throw new Error('格式不正確')
  let count = 0
  for (const [k, v] of Object.entries(parsed.data)) {
    if (k.startsWith('pp:')) {
      write(k, v)
      count++
    }
  }
  return count
}
