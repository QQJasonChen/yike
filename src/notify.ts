// 每日提醒（iOS 本地通知）。非原生平台一律 no-op，桌機/PWA 零影響。
import { Capacitor } from '@capacitor/core'

const REMINDER_ID = 4021

export const notifyAvailable = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'

export const notify = {
  available: notifyAvailable,

  /** 設定/更新每日提醒；enabled=false 取消。回傳 true 表成功（權限被拒回 false）。 */
  async setDailyReminder(enabled: boolean, time: string): Promise<boolean> {
    if (!notifyAvailable()) return false
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] })
      if (!enabled) return true
      const perm = await LocalNotifications.requestPermissions()
      if (perm.display !== 'granted') return false
      const [h, m] = time.split(':').map(Number)
      await LocalNotifications.schedule({
        notifications: [
          {
            id: REMINDER_ID,
            title: '一刻手帳',
            body: '今天的最重要任務是什麼？花一刻寫下來。',
            schedule: { on: { hour: h || 20, minute: m || 0 }, repeats: true, allowWhileIdle: true },
          },
        ],
      })
      return true
    } catch {
      return false
    }
  },
}
