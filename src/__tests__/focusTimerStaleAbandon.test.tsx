// 放棄的 confirm 框開著時，另一個分頁可能已把這段完成、開了新的一段。
// 確認後必須重新核對是不是同一段，不然會把別人的新計時清掉（Codex 第 5 輪 #2）。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FocusTimer, { CLAIM_RETRY_MS, type TimerState } from '../FocusTimer'

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

describe('Codex 第 27 輪', () => {
  const renderWith = (timer: TimerState, props: Partial<React.ComponentProps<typeof FocusTimer>>) =>
    act(() =>
      root!.render(
        <FocusTimer timer={timer} onUpdate={vi.fn()} onSessionDone={vi.fn()} onAbandon={vi.fn()}
          treeStyle={false} breakMinutes={5} focusMinutes={25} autoLoop={false} lockApps={false} {...props} />
      )
    )
  it('#1 等認領時畫面已換成 T2（B 重新開始）→ 舊放棄回來不清掉 T2', async () => {
    const onUpdate = vi.fn()
    let resolve!: (v: boolean) => void
    const onAbandon = () => new Promise<boolean>((r) => { resolve = r })
    localStorage.setItem('ppl:timer', JSON.stringify(base('T1')))
    renderWith(base('T1'), { onUpdate, onAbandon })
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
    act(() => stopButton()!.click())
    renderWith(base('T2'), { onUpdate, onAbandon }) // storage 事件採用了 T2
    await act(async () => {
      resolve(true)
      await Promise.resolve()
    })
    expect(onUpdate).not.toHaveBeenCalled()
  })
  it('#2 等認領時別的分頁把同段 rev 推高 → 進休息用現在的狀態（rev 跟上）', async () => {
    const onUpdate = vi.fn()
    let resolve!: (v: boolean) => void
    const onSessionDone = () => new Promise<boolean>((r) => { resolve = r })
    const t1 = { ...base('T1'), rev: 1 }
    renderWith(t1, { onUpdate, onSessionDone })
    act(() => [...el.querySelectorAll('button')].find((b) => (b.title ?? '').includes('提前完成') || /提前完成/.test(b.textContent ?? ''))!.click())
    renderWith({ ...t1, rev: 3 }, { onUpdate, onSessionDone }) // B 暫停又恢復，storage 事件採用 rev3
    await act(async () => {
      resolve(true)
      await Promise.resolve()
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ id: 'T1', phase: 'break', rev: 3 })
  })
  it('#3 認領失敗改採磁碟走 onAdoptDisk（不加版本），不走 onUpdate', async () => {
    const onUpdate = vi.fn()
    const onAdoptDisk = vi.fn()
    const t = base('T1')
    localStorage.setItem('ppl:owner', 'u1')
    localStorage.setItem('ppl:timer', JSON.stringify({ ...t, owner: 'u1', rev: 1 }))
    renderWith(t, { onUpdate, onAdoptDisk, onAbandon: () => Promise.resolve(false) })
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
    await act(async () => {
      stopButton()!.click()
      await Promise.resolve()
    })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onAdoptDisk).toHaveBeenCalledTimes(1)
    expect(onAdoptDisk.mock.calls[0][0]).toMatchObject({ id: 'T1', rev: 1 })
  })
})

describe('Codex 第 31 輪 #2：完成回報的 taskId 帶進下一段', () => {
  it('onSessionDone 回 { taskId: y } → 進休息的狀態 taskId 變 y', async () => {
    const onUpdate = vi.fn()
    act(() =>
      root!.render(
        <FocusTimer timer={{ ...base('T1'), taskId: 'x' }} onUpdate={onUpdate} onSessionDone={() => Promise.resolve({ taskId: 'y' })} onAbandon={vi.fn()}
          treeStyle={false} breakMinutes={5} focusMinutes={25} autoLoop={false} lockApps={false} />
      )
    )
    await act(async () => {
      ;[...el.querySelectorAll('button')].find((b) => (b.title ?? '').includes('提前完成') || /提前完成/.test(b.textContent ?? ''))!.click()
      await Promise.resolve()
    })
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ id: 'T1', phase: 'break', taskId: 'y' })
  })
})

describe('Codex 第 32 輪：同一段的完成只准一次 in-flight', () => {
  const finishBtn = () => [...el.querySelectorAll('button')].find((b) => (b.title ?? '').includes('提前完成') || /提前完成/.test(b.textContent ?? ''))!
  it('認領還沒回來又按提前完成 → 只認領一次、只排入一次 break', async () => {
    const onUpdate = vi.fn()
    let resolve!: (v: boolean) => void
    const onSessionDone = vi.fn(() => new Promise<boolean>((r) => { resolve = r }))
    act(() =>
      root!.render(
        <FocusTimer timer={base('T1')} onUpdate={onUpdate} onSessionDone={onSessionDone} onAbandon={vi.fn()}
          treeStyle={false} breakMinutes={5} focusMinutes={25} autoLoop={false} lockApps={false} />
      )
    )
    act(() => finishBtn().click())
    act(() => finishBtn().click())
    expect(onSessionDone).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolve(true)
      await Promise.resolve()
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ phase: 'break' })
  })
})

describe('Codex 第 37 輪 #1：同段 focus 但已認領完成 → 自己推進休息，不採回 focus', () => {
  it('B 放棄認領失敗、磁碟是已完成的 T1 focus → onUpdate(break)，不走 onAdoptDisk', async () => {
    const onUpdate = vi.fn()
    const onAdoptDisk = vi.fn()
    const t = base('T1')
    localStorage.setItem('ppl:owner', 'u1')
    localStorage.setItem('ppl:timer', JSON.stringify({ ...t, owner: 'u1', rev: 1 }))
    localStorage.setItem('ppl:timerDone', JSON.stringify(['T1'])) // A 認領完成後關掉，休息沒落盤
    act(() =>
      root!.render(
        <FocusTimer timer={t} onUpdate={onUpdate} onSessionDone={vi.fn()} onAbandon={() => Promise.resolve(false)} onAdoptDisk={onAdoptDisk}
          treeStyle={false} breakMinutes={5} focusMinutes={25} autoLoop={false} lockApps={false} />
      )
    )
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
    await act(async () => {
      stopButton()!.click()
      await Promise.resolve()
    })
    expect(onAdoptDisk).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ id: 'T1', phase: 'break' })
  })
})

describe('Codex 第 38 輪', () => {
  const setup = (done: string[], dayTasks?: { id?: string; text: string }[]) => {
    const onUpdate = vi.fn()
    const onAdoptDisk = vi.fn()
    const t = { ...base('T1'), taskId: 'x', taskText: '同名任務', dateKey: '2026-09-03' }
    localStorage.setItem('ppl:owner', 'u1')
    localStorage.setItem('ppl:timer', JSON.stringify({ ...t, owner: 'u1', rev: 1 }))
    localStorage.setItem('ppl:timerDone', JSON.stringify(done))
    if (dayTasks) localStorage.setItem('pp:day:2026-09-03', JSON.stringify({ tasks: dayTasks.map((x) => ({ done: 0, ...x })), blocks: [] }))
    act(() =>
      root!.render(
        <FocusTimer timer={t} onUpdate={onUpdate} onSessionDone={() => Promise.resolve(false)} onAbandon={() => Promise.resolve(false)} onAdoptDisk={onAdoptDisk}
          treeStyle={false} breakMinutes={5} focusMinutes={25} autoLoop={false} lockApps={false} />
      )
    )
    return { onUpdate, onAdoptDisk }
  }
  it('#1 對方放棄（T1#a）後在清除落盤前關掉 → B 按結束：自己清掉（onUpdate(null)）', async () => {
    const { onUpdate, onAdoptDisk } = setup(['T1#a'])
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
    await act(async () => {
      stopButton()!.click()
      await Promise.resolve()
    })
    expect(onAdoptDisk).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalledWith(null)
  })
  it('#2 對方完成後關掉、同列已換成 id=y → B 推進休息帶 taskId=y', async () => {
    const { onUpdate } = setup(['T1'], [{ id: 'y', text: '同名任務' }])
    await act(async () => {
      ;[...el.querySelectorAll('button')].find((b) => (b.title ?? '').includes('提前完成') || /提前完成/.test(b.textContent ?? ''))!.click()
      await Promise.resolve()
    })
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ id: 'T1', phase: 'break', taskId: 'y' })
  })
})

describe('Codex 第 44 輪：認領存不進去 → 不進休息、不停在 00:00，過一會兒自動再試', () => {
  it("onSessionDone 回 'retry' → 不 onUpdate；CLAIM_RETRY_MS 後到點 effect 再跑一次", async () => {
    vi.useFakeTimers()
    try {
      const onUpdate = vi.fn()
      const onSessionDone = vi.fn((_ti: number, _s: number, _e: number) => Promise.resolve('retry' as const))
      const t = { ...base('T1'), endsAt: Date.now() - 1 } // 已到點
      act(() =>
        root!.render(
          <FocusTimer timer={t} onUpdate={onUpdate} onSessionDone={onSessionDone} onAbandon={vi.fn()}
            treeStyle={false} breakMinutes={5} focusMinutes={25} autoLoop={false} lockApps={false} />
        )
      )
      await act(async () => { await Promise.resolve() })
      expect(onSessionDone).toHaveBeenCalledTimes(1)
      expect(onUpdate).not.toHaveBeenCalled()
      await act(async () => { vi.advanceTimersByTime(CLAIM_RETRY_MS + 600); await Promise.resolve() })
      expect(onSessionDone).toHaveBeenCalledTimes(2)
      expect(onSessionDone.mock.calls[1][2]).toBe(t.endsAt) // 重試仍用原本的 endsAt，不把等待時間算進去
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Codex 第 45 輪：提前完成的重試要用原本的完成時間', () => {
  it("09:20 提前完成遇 'retry' → 10 秒後重送同一次請求，endMs 不變", async () => {
    vi.useFakeTimers()
    try {
      const onUpdate = vi.fn()
      const onSessionDone = vi.fn((_ti: number, _s: number, _e: number) => Promise.resolve('retry' as const))
      const t = { ...base('T1'), endsAt: Date.now() + 5 * 60_000 } // 還剩 5 分鐘
      act(() =>
        root!.render(
          <FocusTimer timer={t} onUpdate={onUpdate} onSessionDone={onSessionDone} onAbandon={vi.fn()}
            treeStyle={false} breakMinutes={5} focusMinutes={25} autoLoop={false} lockApps={false} />
        )
      )
      const pressedAt = Date.now()
      await act(async () => {
        ;[...el.querySelectorAll('button')].find((b) => (b.title ?? '').includes('提前完成') || /提前完成/.test(b.textContent ?? ''))!.click()
        await Promise.resolve()
      })
      expect(onSessionDone).toHaveBeenCalledTimes(1)
      expect(onSessionDone.mock.calls[0][2]).toBe(pressedAt)
      await act(async () => { vi.advanceTimersByTime(CLAIM_RETRY_MS + 100); await Promise.resolve() })
      expect(onSessionDone).toHaveBeenCalledTimes(2)
      expect(onSessionDone.mock.calls[1][2]).toBe(pressedAt) // 不是 10 秒後、也不是 endsAt
      expect(onUpdate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
