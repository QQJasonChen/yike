// 同名任務：使用者按的是哪一個？index 是畫面位置、文字在同名時分不出來，
// 只有 id 認得出（Codex 互審第 6 輪 P2-4）。
import { describe, expect, it } from 'vitest'
import { resolveTaskForToday } from '../focusTask'
import { recordAbandon, recordFocusSession } from '../focusSession'
import { DayEntry, emptyDay, emptyTask, newTaskId } from '../types'
import { saveDay, loadDay } from '../storage'

// emptyTask() 刻意不給 id（見 types.ts）；這裡模擬「已經計時過、所以有 id」的列
const withTasks = (...texts: string[]): DayEntry => ({
  ...emptyDay(),
  tasks: texts.map((t) => ({ ...emptyTask(), id: newTaskId(), text: t })),
})

describe('resolveTaskForToday：id 優先於文字', () => {
  it('今天有兩列同名任務 → 解析到「按下去的那一個」，不是第一個', () => {
    const today = withTasks('回信', '回信')
    const second = today.tasks[1].id!
    // index 故意給 0：從別的日期頁按 ▶ 時帶過來的 index 就是這樣不可靠。
    // 只看 index 或只看文字，兩者都會答 0——只有 id 答得出 1。
    const r = resolveTaskForToday(today, 0, '回信', second)
    expect(r.index).toBe(1)
    expect(r.taskId).toBe(second)
    expect(r.changed).toBe(false)
  })

  it('計時中那一列被搬走，而前面還有一列同名的 → 找的是原來那一顆', () => {
    const today = withTasks('回信', '回信', 'C')
    const second = today.tasks[1].id!
    // 使用者把第二列拖到最後
    const moved: DayEntry = { ...today, tasks: [today.tasks[0], today.tasks[2], today.tasks[1]] }
    const r = resolveTaskForToday(moved, 1, '回信', second)
    expect(r.index).toBe(2) // 文字比對會答 0（第一個相符的）
    expect(r.tasks[2].id).toBe(second)
  })

  it('舊資料沒有 id → 退回文字比對，並順手補上 id', () => {
    const today: DayEntry = {
      ...emptyDay(),
      tasks: [{ text: '舊任務', target: null, done: 0, actual: null, completed: false }],
    }
    const r = resolveTaskForToday(today, 0, '舊任務')
    expect(r.index).toBe(0)
    expect(r.taskId).toBeTruthy()
    expect(r.changed).toBe(true) // 呼叫端要把補了 id 的 tasks 存回去
    expect(r.tasks[0].id).toBe(r.taskId)
  })

  it('今天還沒有這件事 → 補進空欄並給 id', () => {
    const today: DayEntry = { ...emptyDay(), tasks: [{ ...emptyTask(), id: newTaskId(), text: '已有的' }, emptyTask()] }
    const r = resolveTaskForToday(today, 4, '從昨天帶過來的', 'id-that-does-not-exist-here')
    expect(r.index).toBe(1)
    expect(r.changed).toBe(true)
    expect(r.tasks[1].text).toBe('從昨天帶過來的')
    expect(r.tasks[1].id).toBe(r.taskId)
  })
})

describe('記錄專注／放棄：id 優先於 index', () => {
  it('同名任務：格數塗在正確那一列', () => {
    const day = withTasks('回信', '回信')
    const second = day.tasks[1].id!
    saveDay('2026-09-03', day)
    const start = Date.parse('2026-09-03T10:00:00')
    expect(
      recordFocusSession({
        dateKey: '2026-09-03',
        taskIndex: 0, // 故意給錯的 index（計時中列被增刪就會這樣）
        taskId: second,
        taskText: '回信',
        startMs: start,
        endMs: start + 25 * 60_000,
        focusMinutes: 25,
      })
    ).toBe(true)
    const after = loadDay('2026-09-03')
    expect(after.tasks[0].done).toBe(0)
    expect(after.tasks[1].done).toBe(1)
    expect(after.blocks[0].taskIndex).toBe(1) // 時間塊也要指向對的那一列
  })

  it('放棄（枯樹）也記在 id 那一列', () => {
    const day = withTasks('回信', '回信')
    const second = day.tasks[1].id!
    saveDay('2026-09-04', day)
    expect(recordAbandon('2026-09-04', 0, second)).toBe(true)
    const after = loadDay('2026-09-04')
    expect(after.tasks[0].withered ?? 0).toBe(0)
    expect(after.tasks[1].withered).toBe(1)
  })

  it('沒有 id（舊的計時狀態）→ 退回 index，行為跟以前一樣', () => {
    const day = withTasks('甲', '乙')
    saveDay('2026-09-05', day)
    const start = Date.parse('2026-09-05T10:00:00')
    recordFocusSession({
      dateKey: '2026-09-05',
      taskIndex: 1,
      taskText: '乙',
      startMs: start,
      endMs: start + 25 * 60_000,
      focusMinutes: 25,
    })
    expect(loadDay('2026-09-05').tasks[1].done).toBe(1)
  })
})

describe('newTaskId', () => {
  it('每次都不一樣', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newTaskId()))
    expect(ids.size).toBe(50)
  })
})
