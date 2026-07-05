// iOS Widget 資料橋：把「今天 + 本週」的快照推給原生 WidgetBridge plugin，
// 存進 App Group（group.com.qqchen.inkday）給 WidgetKit 讀。
// 觸發時機：app 進背景／切分頁（visibilitychange → hidden）＋啟動後首次 render。
// 純 web / 桌機下是 no-op。widget 端程式在 ios/YikeWidget/，組裝步驟見 docs/WIDGET-SETUP.md。

import { Capacitor, registerPlugin } from '@capacitor/core'
import { addDays, currentStreak, loadDay, mondayOf, toDateKey } from './storage'
import { colorHex } from './types'

interface WidgetBridgeNative {
  update(options: { snapshot: string }): Promise<void>
}

const native = registerPlugin<WidgetBridgeNative>('WidgetBridge')

/** widget 快照 schema（跟 ios/YikeWidget/Model.swift 的 Codable 一一對應，改這裡要同步改那邊） */
export interface WidgetSnapshot {
  date: string // YYYY-MM-DD（widget 用來判斷快照是不是今天的，過期就顯示空狀態）
  mit: string
  mitDone: boolean
  /** 今天的任務（含 MIT，最多 5），塗圈進度 done/target */
  tasks: { text: string; done: number; target: number | null; completed: boolean }[]
  /** 今天的時間軸（依開始時間排序），color 已轉 hex */
  blocks: { start: number; end: number; text: string; color: string }[]
  streak: number
  /** 週一起算 7 天：每天的 MIT 與時間塊數（給週規劃 widget） */
  week: { date: string; weekday: string; mit: string; mitDone: boolean; blockCount: number }[]
}

const WD = ['日', '一', '二', '三', '四', '五', '六']

/** 組快照（純函數，可測）。today 傳入以便測試固定日期。 */
export const buildWidgetSnapshot = (todayKey: string): WidgetSnapshot => {
  const day = loadDay(todayKey)
  const tasks = day.tasks
    .filter((t) => t.text.trim())
    .map((t) => ({ text: t.text, done: t.done, target: t.target, completed: t.completed }))
  const blocks = [...day.blocks]
    .sort((a, b) => a.start - b.start)
    .map((b) => ({ start: b.start, end: b.end, text: b.text || '（未命名）', color: colorHex(b.color) }))
  const monday = mondayOf(todayKey)
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i)
    const e = loadDay(d)
    return {
      date: d,
      weekday: WD[new Date(`${d}T12:00:00`).getDay()],
      mit: e.tasks[0]?.text ?? '',
      mitDone: e.tasks[0]?.completed ?? false,
      blockCount: e.blocks.length,
    }
  })
  return {
    date: todayKey,
    mit: day.tasks[0]?.text ?? '',
    mitDone: day.tasks[0]?.completed ?? false,
    tasks,
    blocks,
    streak: currentStreak(todayKey),
    week,
  }
}

/** 推快照給原生（失敗靜默——widget 是加值功能，不能影響手帳本體） */
export const pushWidgetSnapshot = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return
  try {
    const snapshot = buildWidgetSnapshot(toDateKey(new Date()))
    await native.update({ snapshot: JSON.stringify(snapshot) })
  } catch {
    // 原生端還沒裝 plugin（widget 未組裝）或序列化失敗——一律靜默
  }
}

// 自初始化：進背景時推（使用者剛寫完手帳離開 app 的瞬間，正是 widget 該更新的時刻）
if (Capacitor.isNativePlatform()) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void pushWidgetSnapshot()
  })
  // 啟動後也推一次（撿回「上次在別台裝置改的、剛同步下來」的變更）
  window.addEventListener('load', () => {
    setTimeout(() => void pushWidgetSnapshot(), 3000)
  })
}
