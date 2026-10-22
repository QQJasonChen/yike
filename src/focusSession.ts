// 一段專注完成／放棄 → 塗圈 ＋ 把真實時段寫進時間軸。
//
// 為什麼抽出來、直接對 storage 操作：
//   1. 原本這段邏輯活在 DayView 註冊給 App 的 callback 裡。使用者計時中切到「週」或「月」
//      分頁時 DayView 沒有 mount，callback 是 null——鈴響了、慶祝動畫跑了，但那 25 分鐘
//      一格都沒記到。
//   2. 完成時間原本用 Date.now()：App 被 iOS 睡著、隔一小時才回前景，25 分鐘會被記成
//      84 分鐘。改用計時器自己的 endsAt（由 App 傳入）。
// 一段專注屬於「按下開始的那一天」，跟畫面上正在看哪一天無關。
//
// owner 守衛對齊 useStoredEntry 的 canWrite：按下開始時記下資料主人，完成時不一樣
//（另一個分頁換了帳號）就不寫，否則上一個人的任務會被記進新帳號的今天。
import { syncGrove } from './plantCells'
import { getDataOwner, loadDay, saveDay } from './storage'

export interface FocusSession {
  dateKey: string
  taskIndex: number
  /** 有 id 就以 id 為準：計時中如果使用者插入/刪除了一列，index 已經指到別人身上；
   *  今天有兩列同名任務時，文字也分不出來。 */
  taskId?: string
  /** 按下開始時這台裝置的資料主人（undefined＝不檢查，給舊的計時狀態用） */
  owner?: string | null
  taskText: string
  startMs: number
  endMs: number
  focusMinutes: number
}

const toMin = (ms: number) => {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

const ownerStillSame = (owner: string | null | undefined): boolean =>
  owner === undefined || getDataOwner() === owner

/** 這段專注／放棄要記在哪一列？id 優先，退回 index。 */
const locate = (tasks: { id?: string }[], taskId: string | undefined, index: number): number => {
  if (taskId) {
    const byId = tasks.findIndex((t) => t.id === taskId)
    if (byId >= 0) return byId
  }
  return index
}

const announce = (dateKey: string) => {
  // DayView 聽 external-day-change（date）；週/月等期間檢視與 useStoredEntry 聽 external-key-change（key）
  window.dispatchEvent(new CustomEvent('yike:external-day-change', { detail: { date: dateKey } }))
  window.dispatchEvent(new CustomEvent('yike:external-key-change', { detail: { key: `pp:day:${dateKey}` } }))
}

export const recordFocusSession = (s: FocusSession): boolean => {
  if (!ownerStillSame(s.owner)) return false
  const prev = loadDay(s.dateKey)
  const tasks = prev.tasks.slice()
  const at = locate(tasks, s.taskId, s.taskIndex)
  const t = tasks[at]
  if (t) {
    const done = Math.min(t.done + 1, 16)
    tasks[at] = { ...t, done, actual: done, grove: syncGrove(t.grove, done, s.focusMinutes) }
  }
  // 真實起訖 → 分鐘（夾在時間軸 06:00–23:00 範圍內，最短 15 分鐘）
  const bStart = Math.max(6 * 60, Math.min(23 * 60 - 15, toMin(s.startMs)))
  const bEnd = Math.max(bStart + 15, Math.min(23 * 60, toMin(s.endMs)))
  const blocks = prev.blocks.slice()
  // 同任務、上一塊結尾相距 ≤6 分鐘 → 直接接長（連續番茄變一條）
  const tail = blocks.filter((b) => b.taskIndex === at).sort((x, y) => y.end - x.end)[0]
  if (tail && Math.abs(bStart - tail.end) <= 6) {
    tail.end = bEnd
  } else {
    blocks.push({
      id: `f${Date.now().toString(36)}`,
      start: bStart,
      end: bEnd,
      text: t?.text ?? s.taskText ?? '專注',
      taskIndex: at,
    })
  }
  // 存不下就不要慶祝：配額滿時原本鈴響、動畫跑、進入休息，那 25 分鐘一格都沒記
  const ok = saveDay(s.dateKey, { ...prev, tasks, blocks })
  announce(s.dateKey)
  return ok
}

/** 計時中放棄（✕）→ 該任務記一棵枯樹。 */
export const recordAbandon = (
  dateKey: string,
  taskIndex: number,
  taskId?: string,
  owner?: string | null
): boolean => {
  if (!ownerStillSame(owner)) return false
  const prev = loadDay(dateKey)
  const tasks = prev.tasks.slice()
  const at = locate(tasks, taskId, taskIndex)
  const t = tasks[at]
  if (!t) return true
  tasks[at] = { ...t, withered: (t.withered ?? 0) + 1 }
  const ok = saveDay(dateKey, { ...prev, tasks })
  announce(dateKey)
  return ok
}
