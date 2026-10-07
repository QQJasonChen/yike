// 身體狀況自動同步：開 app／回到前景時，從已開啟的來源拉最新資料，寫進 pp:health:*。
// 寫完發 yike:health-updated 事件，今天頁的身體狀況卡片會自己重讀。
import { appleHealth, appleHealthEnabled } from './healthKit'
import { garminLinkedCached, pullGarminHealth } from './garminCloud'
import { saveHealthRecords } from './storage'
import type { HealthRecord, HealthSource } from './health'

export const HEALTH_EVENT = 'yike:health-updated'

export const applyHealthRecords = (records: HealthRecord[], src: HealthSource): number => {
  const n = saveHealthRecords(records, src)
  if (n > 0) window.dispatchEvent(new Event(HEALTH_EVENT))
  return n
}

let running: Promise<void> | null = null
let lastRun = 0

/** 背景同步所有已開啟的來源；失敗一律靜默（設定頁有手動按鈕會顯示錯誤） */
export const syncHealthSources = (force = false): Promise<void> => {
  if (running) return running
  if (!force && Date.now() - lastRun < 10 * 60_000) return Promise.resolve()
  lastRun = Date.now()
  running = (async () => {
    if (appleHealthEnabled() && (await appleHealth.available())) {
      try {
        applyHealthRecords(await appleHealth.read(14), 'apple-health')
      } catch {
        /* 授權被收回等：設定頁再處理 */
      }
    }
    if (garminLinkedCached()) {
      try {
        applyHealthRecords(await pullGarminHealth(14), 'garmin-api')
      } catch {
        /* 沒網路／登出：下次再試 */
      }
    }
  })().finally(() => {
    running = null
  })
  return running
}

/** App 掛載時呼叫：開站同步一次，之後每次回到前景再同步（10 分鐘節流） */
export const startHealthAutoSync = (): (() => void) => {
  void syncHealthSources(true)
  const onVis = () => {
    if (document.visibilityState === 'visible') void syncHealthSources()
  }
  document.addEventListener('visibilitychange', onVis)
  return () => document.removeEventListener('visibilitychange', onVis)
}
