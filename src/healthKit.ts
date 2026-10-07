// Apple 健康 JS 橋接：對應原生 HealthKitPlugin（ios/App/App/HealthKitPlugin.swift）。
// Garmin Connect app 打開「Apple 健康」同步後，步數、睡眠、靜止心率、HRV、體重…
// 會自動寫進 Apple 健康；這裡讀出每日彙總，存成 apple-health 來源。
// 非原生 iOS 一律回「不可用」，呼叫端不必另外判斷平台。
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { HealthMetrics, HealthRecord } from './health'

interface HealthKitNative {
  isAvailable(): Promise<{ available: boolean }>
  requestAuthorization(): Promise<{ granted: boolean; error?: string }>
  queryDays(opts: { days: number }): Promise<{ days: ({ date: string } & HealthMetrics)[] }>
}

const native = registerPlugin<HealthKitNative>('HealthKit')

const ENABLED_KEY = 'ppl:appleHealth' // 這台裝置是否開啟 Apple 健康同步（裝置本地，不同步）
const LAST_KEY = 'ppl:appleHealthLast' // 上次同步的時間（ms）

export const appleHealthPlatform = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'

export const appleHealthEnabled = (): boolean => localStorage.getItem(ENABLED_KEY) === '1'
export const setAppleHealthEnabled = (on: boolean) =>
  on ? localStorage.setItem(ENABLED_KEY, '1') : localStorage.removeItem(ENABLED_KEY)
export const appleHealthLastSync = (): number | null => {
  const v = Number(localStorage.getItem(LAST_KEY))
  return v > 0 ? v : null
}

export const appleHealth = {
  async available(): Promise<boolean> {
    if (!appleHealthPlatform()) return false
    try {
      return (await native.isAvailable()).available
    } catch {
      return false // 原生端還沒編進這支 plugin（舊版 app）
    }
  },

  async authorize(): Promise<void> {
    let r: { granted: boolean; error?: string }
    try {
      r = await native.requestAuthorization()
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : '無法開啟 Apple 健康授權')
    }
    if (!r.granted) throw new Error(r.error ?? '沒有取得 Apple 健康的讀取權限')
  },

  /** 讀最近 N 天的每日彙總 */
  async read(days = 30): Promise<HealthRecord[]> {
    const { days: rows } = await native.queryDays({ days })
    localStorage.setItem(LAST_KEY, String(Date.now()))
    return rows
      .map(({ date, ...m }) => {
        const clean: HealthMetrics = {}
        for (const [k, v] of Object.entries(m))
          if (v !== null && v !== undefined && v !== '') (clean as Record<string, unknown>)[k] = v
        return { date, m: clean }
      })
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Object.keys(r.m).length > 0)
  },
}
