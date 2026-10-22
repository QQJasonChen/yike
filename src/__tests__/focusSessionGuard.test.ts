// 一段專注屬於「按下開始的那一天」與「按下開始的那個人」。
import { beforeEach, describe, expect, it } from 'vitest'
import { claimTimerCompletion, recordAbandon, recordFocusSession } from '../focusSession'
import { clearUnsavedDrafts, editStoredKey, hasUnsavedDrafts } from '../useStoredEntry'
import { DayEntry, emptyDay, emptyTask } from '../types'
import { loadDay, saveDay, setDataOwner } from '../storage'

const ALICE = 'aaaaaaaa-1111-1111-1111-111111111111'
const BOB = 'bbbbbbbb-2222-2222-2222-222222222222'
const day = (mit: string): DayEntry => ({ ...emptyDay(), tasks: [{ ...emptyTask(), text: mit }] })
const session = (extra: Partial<Parameters<typeof recordFocusSession>[0]> = {}) => {
  const start = Date.parse('2026-09-03T10:00:00')
  return recordFocusSession({
    dateKey: '2026-09-03',
    taskIndex: 0,
    taskText: '今天的任務',
    startMs: start,
    endMs: start + 25 * 60_000,
    focusMinutes: 25,
    ...extra,
  })
}

beforeEach(() => {
  localStorage.clear()
  clearUnsavedDrafts()
  setDataOwner(BOB)
})

describe('寫進計時器自己的那一天', () => {
  it('計時中翻到歷史日期，完成的格數不會記到那一天，也不會覆蓋今天', () => {
    saveDay('2026-09-03', day('今天的任務'))
    saveDay('2026-08-01', day('八月的任務'))
    expect(session()).toBe(true)
    expect(loadDay('2026-09-03').tasks[0].done).toBe(1)
    expect(loadDay('2026-09-03').blocks).toHaveLength(1)
    expect(loadDay('2026-08-01').tasks[0].done).toBe(0)
    expect(loadDay('2026-08-01').tasks[0].text).toBe('八月的任務')
  })

  it('會發兩種事件：DayView 聽 date、期間檢視聽 key', () => {
    saveDay('2026-09-03', day('x'))
    const got: string[] = []
    const h = (e: Event) => got.push(e.type)
    window.addEventListener('yike:external-day-change', h)
    window.addEventListener('yike:external-key-change', h)
    session()
    window.removeEventListener('yike:external-day-change', h)
    window.removeEventListener('yike:external-key-change', h)
    expect(got.sort()).toEqual(['yike:external-day-change', 'yike:external-key-change'])
  })
})

describe('owner 守衛（對齊 useStoredEntry.canWrite）', () => {
  it('另一個分頁換了帳號 → 不寫、回 false，上一個人的任務不會進新帳號的今天', () => {
    saveDay('2026-09-03', day('Alice 的任務'))
    setDataOwner(ALICE) // Alice 按下開始
    const owner = ALICE
    setDataOwner(BOB) // 完成前另一個分頁換成 Bob
    expect(session({ owner })).toBe(false)
    expect(loadDay('2026-09-03').tasks[0].done).toBe(0)
    expect(recordAbandon('2026-09-03', 0, undefined, owner)).toBe(false)
    expect(loadDay('2026-09-03').tasks[0].withered ?? 0).toBe(0)
  })

  it('沒帶 owner（舊的計時狀態）→ 照舊寫入', () => {
    saveDay('2026-09-03', day('x'))
    expect(session({ owner: undefined })).toBe(true)
    expect(loadDay('2026-09-03').tasks[0].done).toBe(1)
  })
})

describe('跟畫面編輯同一套草稿機制（editStoredKey）', () => {
  it('畫面有存不進去的草稿 → 專注結果疊在草稿上，不把草稿蓋掉', () => {
    saveDay('2026-09-03', day('原本的'))
    // 模擬畫面編輯存失敗（配額滿）→ 草稿留在記憶體
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'pp:day:2026-09-03') throw new DOMException('quota', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
    let okDraft: boolean
    try {
      okDraft = editStoredKey(
        'pp:day:2026-09-03',
        () => loadDay('2026-09-03'),
        (v) => saveDay('2026-09-03', v),
        (b) => ({ ...b, tasks: [{ ...b.tasks[0], text: '草稿改的名字' }] }),
        BOB
      )
    } finally {
      Storage.prototype.setItem = orig
    }
    expect(okDraft).toBe(false)
    expect(hasUnsavedDrafts()).toBe(true)
    // 空間釋放後計時完成：結果要包含草稿的內容，而不是用 storage 的舊版當基準
    expect(session()).toBe(true)
    const after = loadDay('2026-09-03')
    expect(after.tasks[0].text).toBe('草稿改的名字')
    expect(after.tasks[0].done).toBe(1)
    expect(hasUnsavedDrafts()).toBe(false)
    clearUnsavedDrafts()
  })

  it('專注結果存不下 → 進草稿等下次成功存檔一起帶上，不是鈴響了一格都沒記', () => {
    saveDay('2026-09-03', day('x'))
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'pp:day:2026-09-03') throw new DOMException('quota', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
    try {
      expect(session()).toBe(false)
    } finally {
      Storage.prototype.setItem = orig
    }
    expect(hasUnsavedDrafts()).toBe(true)
    // 下一次任何成功的編輯會把草稿（含那一格）寫回去
    editStoredKey('pp:day:2026-09-03', () => loadDay('2026-09-03'), (v) => saveDay('2026-09-03', v), (b) => b, BOB)
    expect(loadDay('2026-09-03').tasks[0].done).toBe(1)
    clearUnsavedDrafts()
  })
})

describe('跨分頁只記一次', () => {
  it('同一個 timer id 第二次認領失敗；不同 id 各自可以', () => {
    expect(claimTimerCompletion('t1')).toBe(true)
    expect(claimTimerCompletion('t1')).toBe(false)
    expect(claimTimerCompletion('t2')).toBe(true)
    expect(claimTimerCompletion(undefined)).toBe(true) // 舊計時狀態沒 id：照舊
  })
})
