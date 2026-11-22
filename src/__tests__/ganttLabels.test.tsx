// 甘特名稱欄：雙擊（或兩下輕觸）展開／收合全部名稱；點名稱不能誤觸第一格。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Gantt, { type GanttRow } from '../Gantt'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cols = ['一', '二', '三', '四', '五', '六', '日'].map((label) => ({ label }))
const rows: GanttRow[] = [
  { i: 0, text: '完成閱讀約翰福音一到五章並寫下心得', done: false, cells: [1, 2] },
  { i: 1, text: '與成功有約4—6', done: false, cells: [] },
]

let host: HTMLDivElement
let root: Root
let onCells: ReturnType<typeof vi.fn<(rowIndex: number, cells: number[]) => void>>

function mount(title = '本週甘特') {
  act(() => {
    root.render(<Gantt title={title} hint="" emptyHint="" cols={cols} rows={rows} onCells={onCells} />)
  })
}

function pointer(el: Element, type: 'pointerdown' | 'pointerup', timeStamp: number) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
  Object.defineProperty(ev, 'timeStamp', { value: timeStamp })
  Object.defineProperty(ev, 'pointerId', { value: 1 })
  act(() => {
    el.dispatchEvent(ev)
  })
}

function tap(el: Element, at: number) {
  pointer(el, 'pointerdown', at)
  pointer(el, 'pointerup', at + 40)
}

const grid = () => host.querySelector('.gantt') as HTMLElement
const label = (k = 0) => host.querySelectorAll('.g-row:not(.g-head) .g-label')[k] as HTMLElement

beforeEach(() => {
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  onCells = vi.fn()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Gantt 名稱欄展開全文', () => {
  it('雙擊任一名稱 → 整張甘特展開；再雙擊 → 收合', () => {
    mount()
    expect(grid().classList.contains('g-expanded')).toBe(false)
    tap(label(1), 1000)
    tap(label(1), 1200)
    expect(grid().classList.contains('g-expanded')).toBe(true)
    tap(label(0), 5000)
    tap(label(0), 5200)
    expect(grid().classList.contains('g-expanded')).toBe(false)
  })

  it('點名稱不會誤觸第一格，也不會開始拖曳', () => {
    mount()
    tap(label(0), 1000)
    tap(label(0), 1200)
    tap(label(0), 9000)
    // 之後在甘特任意處放開，不能因為「點名稱時留下的拖曳狀態」而改到第一格
    pointer(grid(), 'pointerup', 9500)
    expect(onCells).not.toHaveBeenCalled()
  })

  it('單擊或間隔太久的兩下不會展開', () => {
    mount()
    tap(label(0), 1000)
    expect(grid().classList.contains('g-expanded')).toBe(false)
    tap(label(0), 2000)
    expect(grid().classList.contains('g-expanded')).toBe(false)
  })

  it('剛開頁面的第一下不算雙擊（timeStamp 很小時）', () => {
    mount()
    tap(label(0), 50)
    expect(grid().classList.contains('g-expanded')).toBe(false)
  })

  it('展開狀態每張甘特各自記住', () => {
    mount('本週甘特')
    tap(label(0), 1000)
    tap(label(0), 1200)
    act(() => root.unmount())
    root = createRoot(host)
    mount('本週甘特')
    expect(grid().classList.contains('g-expanded')).toBe(true)
    act(() => root.unmount())
    root = createRoot(host)
    mount('本月甘特')
    expect(grid().classList.contains('g-expanded')).toBe(false)
  })

  it('雙擊橫條清除那一段的既有行為不變', () => {
    mount()
    const bar = host.querySelector('.g-bar') as HTMLElement
    act(() => {
      bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(onCells).toHaveBeenCalledWith(0, [])
  })
})
