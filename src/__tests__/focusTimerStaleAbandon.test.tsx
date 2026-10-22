// 放棄的 confirm 框開著時，另一個分頁可能已把這段完成、開了新的一段。
// 確認後必須重新核對是不是同一段，不然會把別人的新計時清掉（Codex 第 5 輪 #2）。
import { act } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FocusTimer, { type TimerState } from '../FocusTimer'

const base = (id: string): TimerState => ({
  id,
  dateKey: '2026-09-03',
  taskIndex: 0,
  taskText: 'x',
  phase: 'focus',
  endsAt: Date.now() + 20 * 60_000,
  pausedRemaining: null,
  totalMs: 25 * 60_000,
  startedAt: Date.now() - 5 * 60_000,
})
let root: Root | null = null
let el: HTMLDivElement
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
})
afterEach(() => {
  act(() => root?.unmount())
  el.remove()
  vi.restoreAllMocks()
})

const render = (timer: TimerState, onUpdate = vi.fn(), onAbandon = vi.fn()) => {
  act(() =>
    root!.render(
      <FocusTimer timer={timer} onUpdate={onUpdate} onSessionDone={vi.fn()} onAbandon={onAbandon}
        treeStyle={false} breakMinutes={5} focusMinutes={25} autoLoop={false} lockApps={false} />
    )
  )
  return { onUpdate, onAbandon }
}
const stopButton = () =>
  [...el.querySelectorAll('button')].find((b) => /✕|放棄|結束/.test(b.textContent ?? '') || b.title?.includes('放棄') || b.getAttribute('aria-label')?.includes('放棄'))

describe('FocusTimer 放棄', () => {
  it('confirm 期間這段被換成新的一段 → 不記枯樹、不清掉新計時', () => {
    const onUpdate = vi.fn()
    const onAbandon = vi.fn()
    render(base('T1'), onUpdate, onAbandon)
    const btn = stopButton()
    expect(btn, '找不到 ✕/放棄按鈕').toBeTruthy()
    vi.spyOn(window, 'confirm').mockImplementation(() => {
      // 另一個分頁：T1 完成、開了 T2 → 這邊的 timer prop 換掉（confirm 是同步的，用 flushSync 逼 React 當場重繪）
      flushSync(() =>
        root!.render(
          <FocusTimer timer={base('T2')} onUpdate={onUpdate} onSessionDone={vi.fn()} onAbandon={onAbandon}
            treeStyle={false} breakMinutes={5} focusMinutes={25} autoLoop={false} lockApps={false} />
        )
      )
      return true
    })
    act(() => btn!.click())
    expect(onAbandon).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalledWith(null)
  })

  it('沒被換掉 → 照常放棄', () => {
    const onUpdate = vi.fn()
    const onAbandon = vi.fn()
    render(base('T1'), onUpdate, onAbandon)
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
    act(() => stopButton()!.click())
    expect(onAbandon).toHaveBeenCalledWith(0)
    expect(onUpdate).toHaveBeenCalledWith(null)
  })
})
