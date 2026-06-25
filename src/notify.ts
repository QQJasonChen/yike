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

// ---- 時間塊提醒（iOS 本地通知，在塊的開始時間響）----

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// 由日期+塊 id 推出穩定的數字通知 id（避開每日提醒的 4021，落在 5000+ 區段）
const blockNotifId = (dateKey: string, blockId: string): number => {
  let h = 0
  const s = `${dateKey}#${blockId}`
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return 5000 + (Math.abs(h) % 900000)
}

// 本 session 內每個日期排了哪些通知 id（重排前先取消舊的）
const dayBlockIds = new Map<string, number[]>()

export interface BlockReminder {
  id: string
  start: number // 從 00:00 起算分鐘
  text: string
}

/** 重排某一天所有「要提醒」的時間塊通知（先取消該日舊的、再排新的）。非 iOS no-op。 */
export const syncBlockReminders = async (
  dateKey: string,
  items: BlockReminder[]
): Promise<void> => {
  if (!notifyAvailable()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const prev = dayBlockIds.get(dateKey) ?? []
    if (prev.length) {
      await LocalNotifications.cancel({ notifications: prev.map((id) => ({ id })) })
    }
    if (!items.length) {
      dayBlockIds.delete(dateKey)
      return
    }
    const perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return
    const [y, mo, d] = dateKey.split('-').map(Number)
    const now = Date.now()
    const notifs = []
    const ids: number[] = []
    for (const it of items) {
      const at = new Date(y, (mo || 1) - 1, d, Math.floor(it.start / 60), it.start % 60, 0, 0)
      if (at.getTime() <= now) continue // 過去的不排
      const id = blockNotifId(dateKey, it.id)
      ids.push(id)
      notifs.push({
        id,
        title: '一刻手帳',
        body: `${hhmm(it.start)} ${it.text || '時間到了'}`,
        schedule: { at, allowWhileIdle: true },
      })
    }
    if (notifs.length) await LocalNotifications.schedule({ notifications: notifs })
    dayBlockIds.set(dateKey, ids)
  } catch {
    /* 權限或排程失敗：靜默略過 */
  }
}
