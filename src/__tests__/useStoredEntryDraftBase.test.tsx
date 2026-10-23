// hook 的 edit 必須以共用的 failedDrafts 為基準：番茄鐘完成用 editStoredKey 把「含結果的草稿」
// 放進 map 之後（存失敗），畫面上的下一次編輯不能用自己手上的舊草稿整頁回存（Codex 第 3 輪 #2）。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DayEntry, emptyDay, emptyTask } from '../types'
import { loadDay, saveDay, setDataOwner } from '../storage'
import { clearUnsavedDrafts, editStoredKey, useStoredEntry } from '../useStoredEntry'

const BOB = 'bbbbbbbb-2222-2222-2222-222222222222'
const KEY = 'pp:day:2026-09-03'
let api: { edit: (c: (d: DayEntry) => DayEntry) => boolean } | null = null
function Probe() {
  const { edit } = useStoredEntry<DayEntry>(KEY, () => loadDay('2026-09-03'), (v) => saveDay('2026-09-03', v))
  api = { edit }
  return null
}
let root: Root | null = null
beforeEach(() => {
  localStorage.clear()
  clearUnsavedDrafts()
  setDataOwner(BOB)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  api = null
})

describe('useStoredEntry.edit 的基準', () => {
  it('helper 存失敗留下含結果的草稿 → 畫面編輯疊在它上面，不是用舊草稿蓋回去', () => {
    saveDay('2026-09-03', { ...emptyDay(), tasks: [{ ...emptyTask(), text: '任務' }] })
    const el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
    act(() => root!.render(<Probe />))
    // 畫面先存失敗一次（配額滿）→ hook 自己有一份舊草稿（mood 2）
    const orig = Storage.prototype.setItem
    let block = true
    Storage.prototype.setItem = function (k: string, v: string) {
      if (block && k === KEY) throw new DOMException('quota', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
    try {
      act(() => void api!.edit((d) => ({ ...d, mood: 2 })))
      // 番茄鐘完成也存失敗：helper 以 map 裡的草稿為基準加上 done=1，放回 map
      editStoredKey<DayEntry>(KEY, () => loadDay('2026-09-03'), (v) => saveDay('2026-09-03', v),
        (d) => ({ ...d, tasks: [{ ...d.tasks[0], done: 1 }] }), BOB)
    } finally {
      block = false
      Storage.prototype.setItem = orig
    }
    // 空間回來，畫面再編輯一個欄位：基準必須是 map 裡那份（mood 2 ＋ done 1）
    act(() => void api!.edit((d) => ({ ...d, score: 4 })))
    const saved = loadDay('2026-09-03')
    expect(saved.score).toBe(4)
    expect(saved.mood).toBe(2)
    expect(saved.tasks[0].done).toBe(1) // 舊草稿整頁回存的話這裡會是 0
  })
})
