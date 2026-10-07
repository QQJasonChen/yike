import { beforeEach, describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import {
  extractRecord,
  importHealthFiles,
  mergeHealthDay,
  parseGarminJson,
  parseHealthCsv,
  readZip,
  readiness,
} from '../health'
import { allHealthKeys, allDataKeys, loadHealth, saveHealthRecords } from '../storage'

// Garmin「匯出你的資料」裡 DI_CONNECT/DI-Connect-Aggregator/UDSFile_*.json 的一筆
const UDS = {
  calendarDate: '2026-10-06',
  totalSteps: 9120,
  totalDistanceMeters: 6830,
  totalKilocalories: 2310,
  activeKilocalories: 540,
  moderateIntensityMinutes: 20,
  vigorousIntensityMinutes: 10,
  floorsAscendedInMeters: 30.48,
  restingHeartRate: 54,
  minHeartRate: 49,
  maxHeartRate: 151,
  allDayStress: { aggregatorList: [{ type: 'TOTAL', averageStressLevel: 31, maxStressLevel: 92 }] },
  bodyBattery: {
    chargedValue: 62,
    drainedValue: 58,
    bodyBatteryStatList: [
      { bodyBatteryStatType: 'HIGHEST', statsValue: 88 },
      { bodyBatteryStatType: 'LOWEST', statsValue: 21 },
    ],
  },
  respiration: { avgWakingRespirationValue: 14.2 },
}

// DI-Connect-Wellness/*_sleepData.json
const SLEEP = {
  calendarDate: '2026-10-07',
  deepSleepSeconds: 5400,
  lightSleepSeconds: 14400,
  remSleepSeconds: 6000,
  awakeSleepSeconds: 600,
  sleepScores: { overallScore: 83 },
  sleepStartTimestampLocal: Date.UTC(2026, 9, 6, 23, 40),
  sleepEndTimestampLocal: Date.UTC(2026, 9, 7, 7, 12),
}

describe('Garmin 匯出檔解析', () => {
  it('UDSFile 每日摘要：巢狀壓力／身體能量／熱血時間／樓層都抓得到', () => {
    const r = extractRecord(UDS)!
    expect(r.date).toBe('2026-10-06')
    expect(r.m).toMatchObject({
      steps: 9120,
      restingHr: 54,
      stressAvg: 31,
      stressMax: 92,
      bodyBatteryHigh: 88,
      bodyBatteryLow: 21,
      intensityMin: 40, // 20 + 2×10
      floors: 10,
      respirationAvg: 14.2,
      totalKcal: 2310,
    })
  })

  it('sleepData：總睡眠＝深＋淺＋REM，分數與上床／起床時間', () => {
    const r = extractRecord(SLEEP)!
    expect(r.m.sleepSec).toBe(5400 + 14400 + 6000)
    expect(r.m.sleepScore).toBe(83)
    expect(r.m.bedtime).toBe('23:40')
    expect(r.m.wakeTime).toBe('07:12')
  })

  it('Health API 推送格式（dailies／sleeps／hrv／stressDetails）', () => {
    const recs = parseGarminJson({
      dailies: [
        {
          calendarDate: '2026-10-07',
          steps: 3000,
          activeKilocalories: 200,
          bmrKilocalories: 1600,
          restingHeartRateInBeatsPerMinute: 52,
          moderateIntensityDurationInSeconds: 600,
          vigorousIntensityDurationInSeconds: 300,
        },
      ],
      sleeps: [
        {
          calendarDate: '2026-10-07',
          durationInSeconds: 27000,
          deepSleepDurationInSeconds: 5000,
          lightSleepDurationInSeconds: 15000,
          remSleepInSeconds: 6000,
          awakeDurationInSeconds: 1000,
          startTimeInSeconds: Date.UTC(2026, 9, 6, 15, 30) / 1000,
          startTimeOffsetInSeconds: 8 * 3600,
          overallSleepScore: { value: 77, qualifierKey: 'FAIR' },
        },
      ],
      hrv: [{ calendarDate: '2026-10-07', lastNightAvg: 61 }],
      stressDetails: [{ calendarDate: '2026-10-07', timeOffsetBodyBatteryValues: { 0: 40, 300: 75, 600: 30 } }],
    })
    expect(recs).toHaveLength(4)
    const merged = Object.assign({}, ...recs.map((r) => r.m))
    expect(merged).toMatchObject({
      steps: 3000,
      totalKcal: 1800,
      restingHr: 52,
      intensityMin: 20,
      sleepSec: 26000,
      sleepScore: 77,
      bedtime: '23:30',
      hrv: 61,
      bodyBatteryHigh: 75,
      bodyBatteryLow: 30,
    })
  })

  it('python-garminconnect 的巢狀 dailySleepDTO／hrvSummary 也認得', () => {
    const recs = parseGarminJson([
      { dailySleepDTO: { calendarDate: '2026-10-05', sleepTimeSeconds: 25200, sleepScores: { overall: { value: 90 } } } },
      { hrvSummary: { calendarDate: '2026-10-05', lastNightAvg: 70 }, hrvReadings: [{ hrvValue: 66 }] },
    ])
    expect(recs.map((r) => r.m)).toEqual([{ sleepSec: 25200, sleepScore: 90 }, { hrv: 70 }])
  })

  it('Garmin 用負數表示沒資料 → 丟掉', () => {
    expect(extractRecord({ calendarDate: '2026-10-01', restingHeartRate: -1, totalSteps: 10 })!.m).toEqual({ steps: 10 })
    expect(extractRecord({ calendarDate: '2026-10-01', restingHeartRate: -1 })).toBeNull()
  })

  it('日期各種寫法', () => {
    expect(extractRecord({ calendarDate: { date: 'Oct 3, 2026 12:00:00 AM' }, totalSteps: 1 })!.date).toBe('2026-10-03')
    expect(extractRecord({ calendarDate: '2026-10-03T00:00:00.0', totalSteps: 1 })!.date).toBe('2026-10-03')
  })
})

describe('CSV', () => {
  it('Garmin Connect 報告匯出／自製表格', () => {
    const csv = ['Date,Steps,Resting Heart Rate,Sleep,Body Battery High', '2026/10/01,"8,421",55,7h 30m,80', '2026-10-02,500,,6:45,'].join('\n')
    expect(parseHealthCsv(csv)).toEqual([
      { date: '2026-10-01', m: { steps: 8421, restingHr: 55, sleepSec: 27000, bodyBatteryHigh: 80 } },
      { date: '2026-10-02', m: { steps: 500, sleepSec: 24300 } },
    ])
  })
})

// 用 node zlib 組一個最小的 zip（一個 deflate、一個 stored）
const makeZip = (files: { name: string; data: string; deflate: boolean }[]): ArrayBuffer => {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const raw = enc.encode(f.data)
    const body = f.deflate ? new Uint8Array(deflateRawSync(raw)) : raw
    const name = enc.encode(f.name)
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true)
    lh.setUint16(8, f.deflate ? 8 : 0, true)
    lh.setUint32(18, body.length, true)
    lh.setUint32(22, raw.length, true)
    lh.setUint16(26, name.length, true)
    const local = new Uint8Array([...new Uint8Array(lh.buffer), ...name, ...body])
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true)
    ch.setUint16(10, f.deflate ? 8 : 0, true)
    ch.setUint32(20, body.length, true)
    ch.setUint32(24, raw.length, true)
    ch.setUint16(28, name.length, true)
    ch.setUint32(42, offset, true)
    centrals.push(new Uint8Array([...new Uint8Array(ch.buffer), ...name]))
    locals.push(local)
    offset += local.length
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0)
  const eocd = new DataView(new ArrayBuffer(22))
  eocd.setUint32(0, 0x06054b50, true)
  eocd.setUint16(8, files.length, true)
  eocd.setUint16(10, files.length, true)
  eocd.setUint32(12, cdSize, true)
  eocd.setUint32(16, offset, true)
  const all = [...locals, ...centrals, new Uint8Array(eocd.buffer)]
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0))
  let p = 0
  for (const a of all) {
    out.set(a, p)
    p += a.length
  }
  return out.buffer
}

describe('zip 匯入', () => {
  it('讀 Garmin 匯出 zip：只解相關檔、同日合併', async () => {
    const buf = makeZip([
      { name: 'DI_CONNECT/DI-Connect-Aggregator/UDSFile_2026.json', data: JSON.stringify([UDS]), deflate: true },
      { name: 'DI_CONNECT/DI-Connect-Wellness/x_sleepData.json', data: JSON.stringify([SLEEP, { ...SLEEP, calendarDate: '2026-10-06' }]), deflate: false },
      { name: 'DI_CONNECT/DI-Connect-Fitness/summarizedActivities.json', data: '[]', deflate: true },
    ])
    const entries = readZip(buf)
    expect(entries.map((e) => e.name)).toHaveLength(3)
    const file = new File([buf], 'garmin.zip')
    // jsdom 的 File 沒有 arrayBuffer() 時補上
    if (!file.arrayBuffer) Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
    const res = await importHealthFiles([file])
    expect(res.files).toBe(2)
    expect(res.records.map((r) => r.date)).toEqual(['2026-10-06', '2026-10-07'])
    expect(res.records[0].m).toMatchObject({ steps: 9120, sleepScore: 83 })
  })

  it('不是 zip 會丟人話錯誤', () => {
    expect(() => readZip(new ArrayBuffer(40))).toThrow('不是有效的 zip 檔')
  })
})

describe('合併與儲存', () => {
  beforeEach(() => localStorage.clear())

  it('低優先來源（Apple 健康）只補空缺、不蓋 Garmin 的值', () => {
    const a = mergeHealthDay(null, { steps: 9000, hrv: 60 }, 'garmin-file', 1)!
    const b = mergeHealthDay(a, { steps: 8800, weightKg: 70 }, 'apple-health', 2)!
    expect(b.m).toEqual({ steps: 9000, hrv: 60, weightKg: 70 })
    expect(b.src).toEqual(['garmin-file', 'apple-health'])
    // 高優先來源可以覆蓋
    const c = mergeHealthDay(b, { steps: 9100 }, 'garmin-api', 3)!
    expect(c.m.steps).toBe(9100)
  })

  it('沒變化就回 null（避免每次自動同步都把資料標成待上傳）', () => {
    const a = mergeHealthDay(null, { steps: 1 }, 'apple-health')!
    expect(mergeHealthDay(a, { steps: 1 }, 'apple-health')).toBeNull()
  })

  it('存成 pp:health:*：會同步、會備份；重複匯入不重寫', () => {
    const recs = [
      { date: '2026-10-06', m: { steps: 1 } },
      { date: '2026-10-07', m: { steps: 2 } },
    ]
    expect(saveHealthRecords(recs, 'garmin-file')).toBe(2)
    expect(saveHealthRecords(recs, 'garmin-file')).toBe(0)
    expect(loadHealth('2026-10-07')?.m.steps).toBe(2)
    expect(allHealthKeys()).toEqual(['2026-10-07', '2026-10-06'])
    expect(allDataKeys()).toContain('pp:health:2026-10-07')
  })
})

describe('今日狀態', () => {
  it('睡得好、身體能量高 → 精神充沛', () => {
    const r = readiness({ sleepScore: 88, bodyBatteryHigh: 90 }, [])!
    expect(r.level).toBe('high')
  })

  it('HRV 掉、靜止心率升、睡眠差 → 需要恢復，並說出原因', () => {
    const hist = Array.from({ length: 6 }, () => ({ hrv: 65, restingHr: 52 }))
    const r = readiness({ sleepSec: 5 * 3600, bodyBatteryHigh: 35, hrv: 45, restingHr: 59 }, hist)!
    expect(r.level).toBe('low')
    expect(r.reasons).toContain('HRV 低於平常')
    expect(r.reasons.some((x) => x.startsWith('靜止心率比平常高'))).toBe(true)
  })

  it('只有步數 → 不評估', () => {
    expect(readiness({ steps: 5000 }, [])).toBeNull()
  })
})
