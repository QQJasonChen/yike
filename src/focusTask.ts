// 「在今天這一頁把這件任務找出來」——番茄鐘一律記在今天，所以任務也必須在今天定位。
//
// 舊版直接把使用者翻到昨天時的陣列 index 帶進今天：在昨天的第 3 列按 ▶，
// 完成後那 25 分鐘會被塗到今天的第 3 列——可能是完全不同的任務，也可能是空白列，
// 時間軸上還會冒出一條叫「專注」的無名區塊（Codex UI/UX 審查 P0）。
// index 是畫面上的位置，不是任務的身分；跨日期時只有文字認得出同一件事。
import { DayEntry, Task, emptyTask, newTaskId } from './types'

export interface ResolvedFocusTask {
  tasks: Task[]
  index: number
  /** 這段專注要記在哪一件事上（跨日期、同名任務都靠它） */
  taskId: string
  /** 今天這頁有沒有被改動（有的話呼叫端要存回去） */
  changed: boolean
}

/** 保證這一列有 id。舊資料沒有 id，第一次為它計時就補上（順手升級，不需要遷移腳本）。 */
const withId = (tasks: Task[], index: number): { tasks: Task[]; taskId: string; changed: boolean } => {
  const t = tasks[index]
  if (t?.id) return { tasks, taskId: t.id, changed: false }
  const id = newTaskId()
  const next = tasks.slice()
  if (t) next[index] = { ...t, id }
  return { tasks: next, taskId: id, changed: !!t }
}

export const resolveTaskForToday = (
  today: DayEntry,
  index: number,
  rawText: string,
  /** 按下 ▶ 那一列的 id（有的話）。同名任務只有它分得出來。 */
  taskId?: string
): ResolvedFocusTask => {
  const text = rawText.trim()
  // ① id 對得上：直接用。今天有兩列同名任務時，這是唯一分得出「使用者按的是哪一個」的依據
  if (taskId) {
    const byId = today.tasks.findIndex((t) => t.id === taskId)
    if (byId >= 0) return { tasks: today.tasks, index: byId, taskId, changed: false }
  }
  // ② 本來就對得上（在今天這頁按的）：只補 id
  if ((today.tasks[index]?.text ?? '').trim() === text) {
    const w = withId(today.tasks, index)
    return { tasks: w.tasks, index, taskId: w.taskId, changed: w.changed }
  }
  // ③ 空任務沒有身分可言，維持原 index，交給呼叫端的「先寫任務」引導
  if (!text) {
    const w = withId(today.tasks, index)
    return { tasks: w.tasks, index, taskId: w.taskId, changed: w.changed }
  }

  // ④ 退回文字比對（舊資料、或跨日期帶過來的任務還沒有 id）
  const found = today.tasks.findIndex((t) => t.text.trim() === text)
  if (found >= 0) {
    const w = withId(today.tasks, found)
    return { tasks: w.tasks, index: found, taskId: w.taskId, changed: w.changed }
  }

  // 今天還沒有這件事：補進第一個空欄，沒有空欄就加一列
  const tasks = today.tasks.slice()
  const blank = tasks.findIndex((t) => !t.text.trim())
  if (blank >= 0) {
    const id = tasks[blank].id ?? newTaskId()
    tasks[blank] = { ...tasks[blank], id, text }
    return { tasks, index: blank, taskId: id, changed: true }
  }
  const fresh = { ...emptyTask(), text }
  tasks.push(fresh)
  return { tasks, index: tasks.length - 1, taskId: fresh.id!, changed: true }
}
