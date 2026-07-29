// iOS Widget 資料橋：把「今天 + 本週」的快照推給原生 WidgetBridge plugin，
// 存進 App Group（group.com.qqchen.inkday）給 WidgetKit 讀。
// 觸發時機：app 進背景／切分頁（visibilitychange → hidden）＋啟動後首次 render。
// 純 web / 桌機下是 no-op。widget 端程式在 ios/YikeWidget/，組裝步驟見 docs/WIDGET-SETUP.md。

import { Capacitor, registerPlugin } from '@capacitor/core'
import { addDays, currentStreak, loadDay, mondayOf, saveDay, toDateKey } from './storage'
import { colorHex, MAX_SEGS, type DayEntry } from './types'

/** widget 互動按鈕（AppIntent）產生的動作，App 回前景時套用到 localStorage */
export type WidgetAction =
  | { type: 'toggleMit'; date: string }
  | { type: 'tick'; date: string; taskIndex?: number }

interface WidgetBridgeNative {
  update(options: { snapshot: string }): Promise<void>
  drainActions(): Promise<{ actions: WidgetAction[]; openIntent?: string }>
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

/** 把單一 widget 動作套到某天的資料上（純函數，可測）。找不到對應任務就原樣回傳。 */
export const applyWidgetAction = (day: DayEntry, action: WidgetAction): DayEntry => {
  const tasks = day.tasks.map((t) => ({ ...t }))
  if (action.type === 'toggleMit') {
    if (tasks[0]) tasks[0] = { ...tasks[0], completed: !tasks[0].completed }
  } else if (action.type === 'tick') {
    const i = action.taskIndex ?? 0
    const t = tasks[i]
    if (t) tasks[i] = { ...t, done: Math.min(t.done + 1, MAX_SEGS), actual: t.done + 1 }
  }
  return { ...day, tasks }
}

/**
 * 吸乾 widget 動作佇列：套用到今天的 localStorage、回推權威快照、通知 UI 重載。
 * openIntent==='writeMit' → 發事件請 App 開到今天並聚焦最重要任務輸入框。
 */
export const drainWidgetActions = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { actions, openIntent } = await native.drainActions()
    const todayKey = toDateKey(new Date())
    const valid = (actions ?? []).filter((a) => a.date === todayKey)
    if (valid.length) {
      let day = loadDay(todayKey)
      for (const a of valid) day = applyWidgetAction(day, a)
      saveDay(todayKey, day)
      window.dispatchEvent(new CustomEvent('yike:external-day-change', { detail: { date: todayKey } }))
      await pushWidgetSnapshot() // 用權威資料覆蓋 widget 端的樂觀值
    }
    if (openIntent === 'writeMit') {
      window.dispatchEvent(new CustomEvent('yike:write-mit'))
    }
  } catch {
    // 原生端沒 drainActions（widget 未組裝或舊版）——靜默
  }
}

// 自初始化：
// - 進背景時「推」快照（剛寫完手帳離開 app 的瞬間，正是 widget 該更新的時刻）
// - 回前景時先「吸」widget 上按過的動作，再撿回別台裝置同步下來的變更
if (Capacitor.isNativePlatform()) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void pushWidgetSnapshot()
    } else {
      void drainWidgetActions()
    }
  })
  window.addEventListener('load', () => {
    setTimeout(() => {
      void drainWidgetActions()
      void pushWidgetSnapshot()
    }, 3000)
  })
}
