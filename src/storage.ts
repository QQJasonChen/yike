import {
  DayEntry,
  MonthEntry,
  Settings,
  WeekEntry,
  defaultSettings,
  emptyDay,
  emptyMonth,
  emptyWeek,
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
    if (k?.startsWith('pp:') && k !== SYNC_KEY) data[k] = JSON.parse(localStorage.getItem(k)!)
  }
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
    if (k.startsWith('pp:') && k !== SYNC_KEY) {
      write(k, v)
      count++
    }
  }
  return count
}

// ---- 跨裝置同步（GitHub 私人 Gist 當免費雲端） ----

export interface SyncConfig {
  token: string
  gistId: string
  lastSync: string // ISO 時間
}

export const loadSync = (): SyncConfig =>
  read<SyncConfig>(SYNC_KEY) ?? { token: '', gistId: '', lastSync: '' }

export const saveSync = (c: SyncConfig) => write(SYNC_KEY, c)

const GIST_FILE = 'inkday-planner-backup.json'

const gistHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
})

/** 上傳：第一次自動建立私人 gist，之後更新同一個 */
export const syncUpload = async (): Promise<SyncConfig> => {
  const cfg = loadSync()
  if (!cfg.token) throw new Error('請先貼上 GitHub token')
  const body = JSON.stringify({
    description: 'InkDay 手帳備份（自動同步）',
    public: false,
    files: { [GIST_FILE]: { content: exportAll() } },
  })
  const url = cfg.gistId ? `https://api.github.com/gists/${cfg.gistId}` : 'https://api.github.com/gists'
  const res = await fetch(url, {
    method: cfg.gistId ? 'PATCH' : 'POST',
    headers: gistHeaders(cfg.token),
    body,
  })
  if (!res.ok) throw new Error(`上傳失敗（${res.status}）：請確認 token 有 gist 權限`)
  const json = (await res.json()) as { id: string }
  const next = { ...cfg, gistId: json.id, lastSync: new Date().toISOString() }
  saveSync(next)
  return next
}

/** 在新裝置上只憑 token 找回備份 gist */
const findBackupGist = async (token: string): Promise<string | null> => {
  const res = await fetch('https://api.github.com/gists?per_page=100', {
    headers: gistHeaders(token),
  })
  if (!res.ok) return null
  const list = (await res.json()) as { id: string; files: Record<string, unknown> }[]
  return list.find((g) => GIST_FILE in g.files)?.id ?? null
}

/** 下載：把雲端資料合併進本機（同 key 以雲端覆蓋） */
export const syncDownload = async (): Promise<number> => {
  const cfg = loadSync()
  if (!cfg.token) throw new Error('請先貼上 GitHub token')
  if (!cfg.gistId) {
    const found = await findBackupGist(cfg.token)
    if (!found) throw new Error('還沒有雲端備份，請先在另一台裝置上傳一次')
    cfg.gistId = found
    saveSync(cfg)
  }
  const res = await fetch(`https://api.github.com/gists/${cfg.gistId}`, {
    headers: gistHeaders(cfg.token),
  })
  if (!res.ok) throw new Error(`下載失敗（${res.status}）`)
  const json = (await res.json()) as { files: Record<string, { content: string }> }
  const file = json.files[GIST_FILE]
  if (!file) throw new Error('雲端備份檔不存在')
  const count = importAll(file.content)
  saveSync({ ...cfg, lastSync: new Date().toISOString() })
  return count
}
