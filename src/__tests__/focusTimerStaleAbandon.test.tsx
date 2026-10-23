// 放棄的 confirm 框開著時，另一個分頁可能已把這段完成、開了新的一段。
// 確認後必須重新核對是不是同一段，不然會把別人的新計時清掉（Codex 第 5 輪 #2）。
import { act } from 'react'
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
  localStorage.clear()
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
  it('confirm 期間這段被換成新的一段 → 不記枯樹、不清掉新計時', async () => {
    const onUpdate = vi.fn()
    const onAbandon = vi.fn()
    render(base('T1'), onUpdate, onAbandon)
    const btn = stopButton()
    expect(btn, '找不到 ✕/放棄按鈕').toBeTruthy()
    vi.spyOn(window, 'confirm').mockImplementation(() => {
      // 另一個分頁：T1 完成、開了 T3 → 寫進 ppl:timer。這個分頁的 React prop 還是 T1
      //（原生 confirm 阻塞期間 storage 事件沒處理），所以只能靠讀磁碟
      localStorage.setItem('ppl:timer', JSON.stringify({ ...base('T3'), startedAt: Date.now() }))
      return true
    })
    await act(async () => {
      btn!.click()
      await Promise.resolve()
    })
    expect(onAbandon).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalledWith(null)
  })

  it('配額滿、ppl:timer 根本沒存成 → 還是能放棄（第 7 輪 #1）', async () => {
    const onUpdate = vi.fn()
    const onAbandon = vi.fn()
    render(base('T1'), onUpdate, onAbandon) // 不寫 ppl:timer
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
    await act(async () => {
      stopButton()!.click()
      await Promise.resolve()
    })
    expect(onAbandon).toHaveBeenCalledWith(0)
    expect(onUpdate).toHaveBeenCalledWith(null)
  })

  it('沒被換掉 → 照常放棄', async () => {
    const onUpdate = vi.fn()
    const onAbandon = vi.fn()
    localStorage.setItem('ppl:timer', JSON.stringify(base('T1')))
    render(base('T1'), onUpdate, onAbandon)
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
    await act(async () => {
      stopButton()!.click()
      await Promise.resolve()
    })
    expect(onAbandon).toHaveBeenCalledWith(0)
    expect(onUpdate).toHaveBeenCalledWith(null)
  })
})

describe('FocusTimer 完成（Codex 第 25 輪 #1）', () => {
  const finishButton = () => [...el.querySelectorAll('button')].find((b) => /提前完成/.test(b.textContent ?? '') || (b.title ?? '').includes('提前完成'))
  it('認領失敗（別的分頁已完成／放棄）→ 不進休息，改採磁碟上的狀態', async () => {
    const onUpdate = vi.fn()
    const t = base('T1')
    localStorage.setItem('ppl:owner', 'u1')
    localStorage.setItem('ppl:timer', JSON.stringify({ ...t, owner: 'u1', phase: 'break', rev: 2 }))
    act(() =>
      root!.render(
        <FocusTimer timer={t} onUpdate={onUpdate} onSessionDone={() => Promise.resolve(false)} onAbandon={vi.fn()}
          treeStyle={false} breakMinutes={5} focusMinutes={25} autoLoop={false} lockApps={false} />
      )
    )
    await act(async () => {
      finishButton()!.click()
      await Promise.resolve()
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ id: 'T1', phase: 'break', rev: 2 })
  })
  it('認領成功 → 照常進休息', async () => {
    const onUpdate = vi.fn()
    act(() =>
      root!.render(
        <FocusTimer timer={base('T1')} onUpdate={onUpdate} onSessionDone={() => Promise.resolve(true)} onAbandon={vi.fn()}
          treeStyle={false} breakMinutes={5} focusMinutes={25} autoLoop={false} lockApps={false} />
      )
    )
    await act(async () => {
      finishButton()!.click()
      await Promise.resolve()
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ id: 'T1', phase: 'break' })
  })
})

describe('FocusTimer 放棄要等認領結果（Codex 第 26 輪）', () => {
  it('認領失敗（別的分頁剛完成、休息還沒落盤）→ 不清掉，改採磁碟上的狀態', async () => {
    const onUpdate = vi.fn()
    const t = base('T1')
    localStorage.setItem('ppl:owner', 'u1')
    // 磁碟還是 focus（A 的休息還沒落盤）→ supersededOnDisk 放行；只有認領會說「已經被完成了」
    localStorage.setItem('ppl:timer', JSON.stringify({ ...t, owner: 'u1', rev: 1 }))
    act(() =>
      root!.render(
        <FocusTimer timer={t} onUpdate={onUpdate} onSessionDone={vi.fn()} onAbandon={() => Promise.resolve(false)}
          treeStyle={false} breakMinutes={5} focusMinutes={25} autoLoop={false} lockApps={false} />
      )
    )
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
    await act(async () => {
      stopButton()!.click()
      await Promise.resolve()
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).not.toHaveBeenCalledWith(null)
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ id: 'T1', phase: 'focus', rev: 1 })
  })
})
