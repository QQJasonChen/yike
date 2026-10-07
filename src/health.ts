// 身體狀況（Garmin／Apple 健康）——資料模型、解析、合併、今日狀態評估。
//
// 三條資料來源，最後都匯流成同一份「每日健康指標」存在 pp:health:YYYY-MM-DD：
//   1. garmin-file  ：Garmin Connect 匯出檔（官方「匯出你的資料」zip、單一 JSON、CSV）
//   2. apple-health ：iOS app 讀 Apple 健康（Garmin Connect 開啟「Apple 健康」同步後自動流入）
//   3. garmin-api   ：Garmin 官方 Health API（OAuth 連結帳號後由 Garmin 主動推送，見 garminCloud.ts）
// 用 pp: 前綴＝跟日記一樣自動跨裝置同步、進備份與匯出檔；登入雲端時同樣走 E2EE。
//
// 解析器刻意寫成「認欄位名、不認檔案結構」：Garmin 匯出檔、Health API 推送、
// 社群工具（python-garminconnect）的 JSON 欄位名大同小異，結構卻常變。
// 只要物件身上有 calendarDate 就當一筆日紀錄，再按別名表抓指標。

export type HealthSource = 'garmin-file' | 'apple-health' | 'garmin-api'

export const SOURCE_LABEL: Record<HealthSource, string> = {
  'garmin-file': 'Garmin 匯出檔',
  'apple-health': 'Apple 健康',
  'garmin-api': 'Garmin 直連',
}

export interface HealthMetrics {
  steps?: number
  distanceM?: number
  floors?: number
  activeKcal?: number
  totalKcal?: number
  intensityMin?: number // Garmin 熱血時間（中強度 + 2×高強度）
  restingHr?: number
  minHr?: number
  maxHr?: number
  avgHr?: number
  hrv?: number // 夜間 HRV（ms）
  stressAvg?: number // 0–100
  stressMax?: number
  bodyBatteryHigh?: number // 0–100
  bodyBatteryLow?: number
  bodyBatteryCharged?: number
  bodyBatteryDrained?: number
  sleepSec?: number
  deepSec?: number
  lightSec?: number
  remSec?: number
  awakeSec?: number
  sleepScore?: number // 0–100
  bedtime?: string // HH:MM（當地時間）
  wakeTime?: string // HH:MM
  spo2Avg?: number // %
  respirationAvg?: number // 每分鐘呼吸次數
  weightKg?: number
  vo2max?: number
  trainingReadiness?: number // 0–100（Garmin 訓練準備度）
}

export type MetricKey = keyof HealthMetrics

export interface HealthDay {
  m: HealthMetrics
  src: HealthSource[]
  at: number // 最後更新（ms）
}

export interface HealthRecord {
  date: string // YYYY-MM-DD
  m: HealthMetrics
}

// ---------------- 小工具 ----------------

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/,/g, ''))
    if (Number.isFinite(n)) return n
  }
  return undefined
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const pad = (n: number) => String(n).padStart(2, '0')

const localKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** 各種 Garmin 日期寫法 → YYYY-MM-DD。
 *  "2026-10-07"、"2026-10-07T00:00:00.0"、{ date: "Oct 7, 2026 12:00:00 AM" }、毫秒時間戳都吃。 */
export const normDate = (v: unknown): string | null => {
  if (isObj(v)) return normDate(v.date ?? v.calendarDate)
  if (typeof v === 'number' && v > 1e11) return localKey(new Date(v))
  if (typeof v !== 'string') return null
  const s = v.trim()
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${pad(+iso[2])}-${pad(+iso[3])}`
  const slash = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/)
  if (slash) return `${slash[1]}-${pad(+slash[2])}-${pad(+slash[3])}`
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : localKey(new Date(t))
}

/** 「把 UTC 欄位當當地時間」的毫秒時間戳 → HH:MM（Garmin 的 *TimestampLocal 就是這種） */
const hhmmFromLocalMs = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

const first = (o: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const k of keys) {
    const v = num(o[k])
    if (v !== undefined) return v
  }
  return undefined
}

// 每個指標可能的欄位名（Garmin 匯出檔 UDSFile／sleepData、Health API 推送、garminconnect 套件）
const ALIASES: Partial<Record<MetricKey, string[]>> = {
  steps: ['totalSteps', 'steps', 'stepCount'],
  distanceM: ['totalDistanceMeters', 'distanceInMeters', 'totalDistance'],
  floors: ['floorsClimbed', 'floorsAscended'],
  activeKcal: ['activeKilocalories', 'activeCalories'],
  totalKcal: ['totalKilocalories', 'totalCalories'],
  restingHr: [
    'restingHeartRate',
    'restingHeartRateInBeatsPerMinute',
    'currentDayRestingHeartRate',
    'restingHR',
  ],
  minHr: ['minHeartRate', 'minHeartRateInBeatsPerMinute'],
  maxHr: ['maxHeartRate', 'maxHeartRateInBeatsPerMinute'],
  avgHr: ['averageHeartRate', 'averageHeartRateInBeatsPerMinute'],
  hrv: ['lastNightAvg', 'hrvLastNightAvg', 'avgOvernightHrv'],
  stressAvg: ['averageStressLevel', 'avgStressLevel'],
  stressMax: ['maxStressLevel'],
  bodyBatteryHigh: ['bodyBatteryHighestValue', 'bodyBatteryHigh', 'bodyBatteryMostRecentHighValue'],
  bodyBatteryLow: ['bodyBatteryLowestValue', 'bodyBatteryLow'],
  bodyBatteryCharged: ['bodyBatteryChargedValue'],
  bodyBatteryDrained: ['bodyBatteryDrainedValue'],
  sleepSec: ['sleepTimeSeconds', 'sleepingSeconds', 'sleepDurationInSeconds'],
  deepSec: ['deepSleepSeconds', 'deepSleepDurationInSeconds'],
  lightSec: ['lightSleepSeconds', 'lightSleepDurationInSeconds'],
  remSec: ['remSleepSeconds', 'remSleepInSeconds', 'remSleepDurationInSeconds'],
  awakeSec: ['awakeSleepSeconds', 'awakeDurationInSeconds'],
  spo2Avg: ['averageSpo2', 'averageSpO2Value', 'averageSPO2', 'averageSpo2Value', 'avgSpo2'],
  respirationAvg: [
    'avgWakingRespirationValue',
    'averageRespirationValue',
    'averageRespiration',
    'avgRespirationValue',
  ],
  vo2max: ['vo2MaxPreciseValue', 'vo2MaxValue', 'vo2Max', 'vo2max'],
  trainingReadiness: ['trainingReadinessScore'],
}

/** 一個帶 calendarDate 的物件 → 一筆日紀錄（抓不到任何指標回 null） */
export const extractRecord = (o: Record<string, unknown>): HealthRecord | null => {
  const date = normDate(o.calendarDate ?? o.calendar_date)
  if (!date) return null
  const m: HealthMetrics = {}
  for (const [k, keys] of Object.entries(ALIASES) as [MetricKey, string[]][]) {
    const v = first(o, keys)
    if (v !== undefined) (m as Record<string, number>)[k] = v
  }

  // 熱血時間：分鐘或秒兩種寫法；Garmin 定義＝中強度 + 2×高強度
  const mod = num(o.moderateIntensityMinutes) ?? (num(o.moderateIntensityDurationInSeconds) ?? NaN) / 60
  const vig = num(o.vigorousIntensityMinutes) ?? (num(o.vigorousIntensityDurationInSeconds) ?? NaN) / 60
  if (Number.isFinite(mod) || Number.isFinite(vig))
    m.intensityMin = Math.round((Number.isFinite(mod) ? mod : 0) + 2 * (Number.isFinite(vig) ? vig : 0))

  // 樓層：匯出檔只給「爬升公尺」→ 一層樓約 3 公尺
  if (m.floors === undefined) {
    const fm = num(o.floorsAscendedInMeters)
    if (fm !== undefined) m.floors = Math.round(fm / 3.048)
  }
  // 總熱量：Health API 拆成 active + bmr
  if (m.totalKcal === undefined && m.activeKcal !== undefined) {
    const bmr = num(o.bmrKilocalories)
    if (bmr !== undefined) m.totalKcal = m.activeKcal + bmr
  }
  // Health API 的 sleeps：durationInSeconds 是整段（含清醒），扣掉清醒才是睡著
  if (m.sleepSec === undefined && 'deepSleepDurationInSeconds' in o) {
    const dur = num(o.durationInSeconds)
    if (dur !== undefined) m.sleepSec = dur - (m.awakeSec ?? 0)
  }
  // 匯出檔的 sleepData 沒給總睡眠：深＋淺＋REM
  if (m.sleepSec === undefined && (m.deepSec !== undefined || m.lightSec !== undefined))
    m.sleepSec = (m.deepSec ?? 0) + (m.lightSec ?? 0) + (m.remSec ?? 0)

  // 睡眠分數：{ overall: { value } }、{ overallScore }、overallSleepScore: { value } 都有人用
  const scores = o.sleepScores
  if (isObj(scores)) {
    const ov = scores.overall
    m.sleepScore = (isObj(ov) ? num(ov.value) : undefined) ?? num(scores.overallScore) ?? m.sleepScore
  }
  const oss = o.overallSleepScore
  if (m.sleepScore === undefined) m.sleepScore = isObj(oss) ? num(oss.value) : num(oss)
  if (m.sleepScore === undefined) delete m.sleepScore

  // 上床／起床時間
  const startLocal = num(o.sleepStartTimestampLocal)
  const endLocal = num(o.sleepEndTimestampLocal)
  if (startLocal !== undefined) m.bedtime = hhmmFromLocalMs(startLocal)
  if (endLocal !== undefined) m.wakeTime = hhmmFromLocalMs(endLocal)
  const startSec = num(o.startTimeInSeconds)
  const offset = num(o.startTimeOffsetInSeconds) ?? 0
  if (m.bedtime === undefined && startSec !== undefined && 'deepSleepDurationInSeconds' in o) {
    m.bedtime = hhmmFromLocalMs((startSec + offset) * 1000)
    const dur = num(o.durationInSeconds)
    if (dur !== undefined) m.wakeTime = hhmmFromLocalMs((startSec + offset + dur) * 1000)
  }

  // 巢狀結構：壓力（allDayStress）、身體能量（bodyBattery）、呼吸（respiration）
  const ads = o.allDayStress
  if (isObj(ads) && Array.isArray(ads.aggregatorList)) {
    const total = ads.aggregatorList.find((a) => isObj(a) && a.type === 'TOTAL')
    if (isObj(total)) {
      m.stressAvg ??= num(total.averageStressLevel)
      m.stressMax ??= num(total.maxStressLevel)
    }
  }
  const bb = o.bodyBattery
  if (isObj(bb)) {
    m.bodyBatteryCharged ??= num(bb.chargedValue)
    m.bodyBatteryDrained ??= num(bb.drainedValue)
    if (Array.isArray(bb.bodyBatteryStatList))
      for (const s of bb.bodyBatteryStatList) {
        if (!isObj(s)) continue
        if (s.bodyBatteryStatType === 'HIGHEST') m.bodyBatteryHigh ??= num(s.statsValue)
        if (s.bodyBatteryStatType === 'LOWEST') m.bodyBatteryLow ??= num(s.statsValue)
      }
  }
  // Health API stressDetails：身體能量是 { 秒偏移: 值 } 的時間序列
  const bbMap = o.timeOffsetBodyBatteryValues
  if (isObj(bbMap)) {
    const vals = Object.values(bbMap).map(num).filter((v): v is number => v !== undefined)
    if (vals.length) {
      m.bodyBatteryHigh ??= Math.max(...vals)
      m.bodyBatteryLow ??= Math.min(...vals)
    }
  }
  const spo2Map = o.spo2ValuesMap ?? o.timeOffsetSpo2Values
  if (m.spo2Avg === undefined && isObj(spo2Map)) {
    const vals = Object.values(spo2Map).map(num).filter((v): v is number => v !== undefined)
    if (vals.length) m.spo2Avg = vals.reduce((a, b) => a + b, 0) / vals.length
  }
  const resp = o.respiration
  if (isObj(resp)) m.respirationAvg ??= num(resp.avgWakingRespirationValue)
  const spo2Sleep = o.spo2SleepSummary
  if (isObj(spo2Sleep)) m.spo2Avg ??= num(spo2Sleep.averageSPO2 ?? spo2Sleep.averageSpO2)

  // 體重：克或公斤都有（> 500 視為克）
  const w = first(o, ['weightInGrams', 'weight', 'weightKg'])
  if (w !== undefined && w > 0) m.weightKg = w > 500 ? w / 1000 : w

  // 收尾：清掉 undefined
  for (const k of Object.keys(m) as MetricKey[]) if (m[k] === undefined) delete m[k]
  // 不合理值丟掉：Garmin 用 -1／-2 表示「沒資料」
  for (const k of Object.keys(m) as MetricKey[]) {
    const v = m[k]
    if (typeof v === 'number' && v < 0) delete m[k]
  }
  return Object.keys(m).length ? { date, m } : null
}

/** 遞迴走過任意 JSON，收集所有日紀錄（同一天多筆會在 mergeRecords 合併） */
export const parseGarminJson = (data: unknown): HealthRecord[] => {
  const out: HealthRecord[] = []
  const walk = (v: unknown, depth: number) => {
    if (depth > 8) return
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1)
      return
    }
    if (!isObj(v)) return
    const rec = 'calendarDate' in v || 'calendar_date' in v ? extractRecord(v) : null
    if (rec) out.push(rec)
    // 就算這層已是紀錄，子物件（dailySleepDTO、hrvSummary…）也可能各自帶日期
    for (const [k, child] of Object.entries(v)) {
      if (rec && (k === 'sleepScores' || k === 'bodyBattery' || k === 'allDayStress')) continue
      if (typeof child === 'object' && child !== null) walk(child, depth + 1)
    }
  }
  walk(data, 0)
  return out
}

// ---------------- CSV（Garmin Connect 網頁「報告」匯出、或自己整理的表） ----------------

const CSV_COLS: [RegExp, MetricKey, number?][] = [
  [/^(steps|步數|total steps|actual)$/i, 'steps'],
  [/resting.*heart|靜止心率|安靜心率/i, 'restingHr'],
  [/^hrv|心率變異/i, 'hrv'],
  [/body ?battery.*(high|max)|身體能量.*(最高|高)/i, 'bodyBatteryHigh'],
  [/body ?battery.*(low|min)|身體能量.*(最低|低)/i, 'bodyBatteryLow'],
  [/stress|壓力/i, 'stressAvg'],
  [/sleep score|睡眠分數/i, 'sleepScore'],
  [/^(sleep|睡眠)( ?(hours|時數|duration))?$/i, 'sleepSec', 3600],
  [/calories|卡路里|熱量/i, 'totalKcal'],
  [/intensity|熱血/i, 'intensityMin'],
  [/weight|體重/i, 'weightKg'],
  [/spo2|血氧/i, 'spo2Avg'],
  [/respiration|呼吸/i, 'respirationAvg'],
  [/floors|樓層/i, 'floors'],
]

const splitCsvLine = (line: string): string[] => {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/** 「7h 32m」「7:32」「7.5」→ 秒（睡眠欄位用） */
const durToSec = (s: string, unit: number): number | undefined => {
  const hm = s.match(/(\d+)\s*h\D*(\d+)?\s*m?/i)
  if (hm) return +hm[1] * 3600 + (hm[2] ? +hm[2] * 60 : 0)
  const colon = s.match(/^(\d+):(\d{2})$/)
  if (colon) return +colon[1] * 3600 + +colon[2] * 60
  const n = num(s)
  return n === undefined ? undefined : n * unit
}

export const parseHealthCsv = (text: string): HealthRecord[] => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const head = splitCsvLine(lines[0])
  const dateCol = head.findIndex((h) => /date|日期|day/i.test(h))
  if (dateCol < 0) return []
  const cols = head.map((h, i) => {
    if (i === dateCol) return null
    const hit = CSV_COLS.find(([re]) => re.test(h))
    return hit ? { key: hit[1], unit: hit[2] ?? 1 } : null
  })
  const out: HealthRecord[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const date = normDate(cells[dateCol])
    if (!date) continue
    const m: HealthMetrics = {}
    cols.forEach((c, i) => {
      if (!c || m[c.key] !== undefined) return
      const raw = cells[i] ?? ''
      const v = c.key === 'sleepSec' ? durToSec(raw, c.unit) : num(raw.replace(/[^\d.-]/g, ''))
      if (v !== undefined && v >= 0) (m as Record<string, number>)[c.key] = v
    })
    if (Object.keys(m).length) out.push({ date, m })
  }
  return out
}

// ---------------- ZIP（Garmin「匯出你的資料」是一個大 zip） ----------------

export interface ZipEntry {
  name: string
  size: number
  read: () => Promise<Uint8Array>
}

const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  const ds = new DecompressionStream('deflate-raw')
  const writer = ds.writable.getWriter()
  // 不 await 寫入：要邊寫邊讀，否則大檔會卡在背壓
  void writer.write(data).then(() => writer.close()).catch(() => {})
  return new Uint8Array(await new Response(ds.readable).arrayBuffer())
}

/** 讀 zip 目錄（零相依，用瀏覽器內建 DecompressionStream 解壓） */
export const readZip = (buf: ArrayBuffer): ZipEntry[] => {
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)
  // 從尾端找 End of Central Directory（簽名 0x06054b50）
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 檔')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  if (p === 0xffffffff) throw new Error('zip 太大（ZIP64）——請先解壓縮，再選取裡面的 JSON 檔')
  const td = new TextDecoder()
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break
    const method = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const size = dv.getUint32(p + 24, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOff = dv.getUint32(p + 42, true)
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    entries.push({
      name,
      size,
      read: async () => {
        const lnLen = dv.getUint16(localOff + 26, true)
        const lxLen = dv.getUint16(localOff + 28, true)
        const start = localOff + 30 + lnLen + lxLen
        const raw = u8.subarray(start, start + compSize)
        if (method === 0) return raw
        if (method === 8) return inflateRaw(raw)
        throw new Error(`不支援的壓縮方式（${method}）`)
      },
    })
  }
  return entries
}

// 只讀跟每日健康有關的檔案；活動 GPS、FIT 原始檔等大檔略過
const RELEVANT = /(UDSFile|sleep|hrv|stress|bodybattery|biometric|weight|respiration|spo2|pulse|metrics|readiness|health|wellness|daily)/i
const MAX_FILE = 40 * 1024 * 1024

export interface ImportResult {
  records: HealthRecord[]
  files: number
  skipped: number
}

const parseText = (name: string, text: string): HealthRecord[] => {
  if (/\.csv$/i.test(name)) return parseHealthCsv(text)
  try {
    return parseGarminJson(JSON.parse(text))
  } catch {
    return []
  }
}

/** 使用者選的檔案（zip／json／csv，可多選）→ 日紀錄 */
export const importHealthFiles = async (files: File[]): Promise<ImportResult> => {
  const records: HealthRecord[] = []
  let used = 0
  let skipped = 0
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const entries = readZip(await f.arrayBuffer())
      const td = new TextDecoder()
      for (const e of entries) {
        if (!/\.(json|csv)$/i.test(e.name) || !RELEVANT.test(e.name) || e.size > MAX_FILE) {
          skipped++
          continue
        }
        const recs = parseText(e.name, td.decode(await e.read()))
        if (recs.length) used++
        records.push(...recs)
      }
    } else if (/\.(json|csv)$/i.test(f.name)) {
      const recs = parseText(f.name, await f.text())
      if (recs.length) used++
      else skipped++
      records.push(...recs)
    } else skipped++
  }
  return { records: mergeRecords(records), files: used, skipped }
}

/** 同一天的多筆紀錄合併成一筆（後來的非空值覆蓋） */
export const mergeRecords = (recs: HealthRecord[]): HealthRecord[] => {
  const map = new Map<string, HealthMetrics>()
  for (const r of recs) map.set(r.date, { ...(map.get(r.date) ?? {}), ...r.m })
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, m]) => ({ date, m }))
}

/** 把新來源的指標疊到既有那天上。回傳 null = 沒有任何變化（不必寫入，免得觸發同步）。 */
export const mergeHealthDay = (
  prev: HealthDay | null,
  incoming: HealthMetrics,
  src: HealthSource,
  now = Date.now()
): HealthDay | null => {
  // 優先序：官方直連 > 匯出檔 > Apple 健康（Apple 健康是 Garmin 的二手轉存，欄位較少）
  const rank: Record<HealthSource, number> = { 'garmin-api': 3, 'garmin-file': 2, 'apple-health': 1 }
  const base: HealthMetrics = { ...(prev?.m ?? {}) }
  const prevTop = Math.max(0, ...(prev?.src ?? []).map((s) => rank[s]))
  let changed = false
  for (const [k, v] of Object.entries(incoming) as [MetricKey, number | string][]) {
    if (v === undefined || v === null) continue
    // 低優先來源不覆蓋高優先來源已經有的值，只補空缺
    if (base[k] !== undefined && rank[src] < prevTop) continue
    if (base[k] !== v) {
      ;(base as Record<string, number | string>)[k] = v
      changed = true
    }
  }
  const srcs = prev?.src.includes(src) ? prev.src : [...(prev?.src ?? []), src]
  if (!changed && srcs === prev?.src) return null
  return { m: base, src: srcs, at: now }
}

// ---------------- 今日狀態（給手帳用的一句話建議） ----------------

export type ReadinessLevel = 'high' | 'mid' | 'low'

export interface Readiness {
  score: number // 0–100
  level: ReadinessLevel
  label: string
  advice: string
  reasons: string[]
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** 根據睡眠、身體能量、HRV／靜止心率（對比近 7 天基準）估一個今日狀態分數。
 *  不是醫療判斷，只是把「今天適不適合硬拚最重要任務」講白。資料不夠回 null。 */
export const readiness = (today: HealthMetrics, history: HealthMetrics[]): Readiness | null => {
  const parts: { w: number; v: number }[] = []
  const reasons: string[] = []
  if (today.trainingReadiness !== undefined) {
    parts.push({ w: 2, v: today.trainingReadiness })
    reasons.push(`Garmin 準備度 ${Math.round(today.trainingReadiness)}`)
  }
  if (today.sleepScore !== undefined) {
    parts.push({ w: 2, v: today.sleepScore })
    reasons.push(`睡眠分數 ${Math.round(today.sleepScore)}`)
  } else if (today.sleepSec !== undefined) {
    const h = today.sleepSec / 3600
    parts.push({ w: 2, v: Math.max(0, Math.min(100, 100 - Math.abs(8 - h) * 18 - (h < 6 ? 15 : 0))) })
    reasons.push(`睡了 ${h.toFixed(1)} 小時`)
  }
  if (today.bodyBatteryHigh !== undefined) {
    parts.push({ w: 2, v: today.bodyBatteryHigh })
    reasons.push(`身體能量最高 ${Math.round(today.bodyBatteryHigh)}`)
  }
  const hrvBase = history.map((h) => h.hrv).filter((v): v is number => v !== undefined)
  if (today.hrv !== undefined && hrvBase.length >= 3) {
    const r = today.hrv / avg(hrvBase)
    parts.push({ w: 1, v: Math.max(0, Math.min(100, 70 + (r - 1) * 200)) })
    if (r < 0.9) reasons.push('HRV 低於平常')
    else if (r > 1.08) reasons.push('HRV 高於平常')
  }
  const rhrBase = history.map((h) => h.restingHr).filter((v): v is number => v !== undefined)
  if (today.restingHr !== undefined && rhrBase.length >= 3) {
    const d = today.restingHr - avg(rhrBase)
    parts.push({ w: 1, v: Math.max(0, Math.min(100, 75 - d * 8)) })
    if (d >= 4) reasons.push(`靜止心率比平常高 ${Math.round(d)}`)
  }
  if (!parts.length) return null
  const score = Math.round(parts.reduce((s, p) => s + p.w * p.v, 0) / parts.reduce((s, p) => s + p.w, 0))
  if (score >= 70)
    return {
      score,
      level: 'high',
      label: '精神充沛',
      advice: '狀態很好——把最重要任務排在上午，用連續番茄鐘一口氣推進。',
      reasons,
    }
  if (score >= 45)
    return {
      score,
      level: 'mid',
      label: '狀態尚可',
      advice: '照計畫走，最重要任務放在精神最好的時段，中間記得起身休息。',
      reasons,
    }
  return {
    score,
    level: 'low',
    label: '需要恢復',
    advice: '身體在討休息——把目標縮小成一件最重要的事，少排幾段專注，今晚早點睡。',
    reasons,
  }
}

// ---------------- 顯示格式 ----------------

export const fmtDur = (sec: number): string => {
  const m = Math.round(sec / 60)
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US')
