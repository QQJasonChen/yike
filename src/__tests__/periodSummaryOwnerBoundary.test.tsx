import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('../ai', async () => ({
  ...(await vi.importActual<typeof import('../ai')>('../ai')),
  generateInsight: h.generate,
}))
import PeriodSummary from '../PeriodSummary'
import { claimDeviceFor, setDataOwner, setOpenAIKey } from '../storage'
import { emptyDay, emptyTask } from '../types'

const A = 'synthetic-summary-owner-a'
const B = 'synthetic-summary-owner-b'
const DAY = '2026-10-18'
const NEXT_DAY = '2026-10-19'
const days = [DAY]
const BLOCKED_STATUS = '資料尚未確認，期間總結暫停顯示。若登入失敗，請重新整理後再試。'
let container: HTMLDivElement, root: Root
let clipboard: ReturnType<typeof vi.fn>
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const seed = (text: string, day = DAY) => localStorage.setItem(`pp:day:${day}`, JSON.stringify({
  ...emptyDay(), tasks: [{ ...emptyTask(), text, done: 1 }], answers: { e0: `${text} highlight` },
}))
const ready = (owner: string | null) => window.dispatchEvent(new CustomEvent('yike:local-owner-ready', { detail: { owner } }))
const switchTo = async (owner: string, text: string, key = true) => act(async () => {
  claimDeviceFor(owner)
  seed(text)
  if (key) setOpenAIKey(`synthetic-key-${owner}`)
  ready(owner)
})
const render = (keys = days, periodLabel = 'synthetic week') => act(async () => root.render(
  <PeriodSummary title="本週總結" dayKeys={keys} periodLabel={periodLabel} />
))
const button = (text: string) => {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!found) throw new Error(`missing button ${text}`)
  return found
}
const click = (text: string) => act(async () => button(text).click())
const aiButton = () => container.querySelector<HTMLButtonElement>('[title="用 AI 直接生成這段期間的回顧與洞察"]')

beforeEach(() => {
  localStorage.clear(); setDataOwner(A); setOpenAIKey('synthetic-key-A'); seed('A private task')
  h.generate.mockReset()
  clipboard = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks()
})

describe('period summary owner and operation boundaries', () => {
  it('shows a private-data-free status when ownership changed but login never became ready', async () => {
    const old = deferred<string>(); h.generate.mockReturnValue(old.promise)
    await render(); await click('🤖 AI 寫總結')
    // The login sync can change the local owner before throwing, with no ready event.
    claimDeviceFor(B); seed('B unconfirmed private task'); await render()
    const blockedStatus = () => container.querySelector('[role="status"]')?.textContent
    expect(blockedStatus()).toContain('資料尚未確認')
    expect(blockedStatus()).toContain('若登入失敗，請重新整理後再試')
    expect(container.querySelector('.psum')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
    for (const privateValue of [A, B, 'A private task', 'B unconfirmed private task'])
      expect(container.textContent).not.toContain(privateValue)
    await act(async () => old.reject(new Error('A stale private provider error')))
    expect(container.textContent).not.toContain('A stale private provider error')
    await act(async () => ready(A))
    expect(blockedStatus()).toContain('資料尚未確認')
    await act(async () => ready(B))
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.textContent).toContain('B unconfirmed private task')
    expect(container.querySelector('.ai-result')).toBeNull()
  })

  it('allows only one same-frame AI request and permits retry after current failure', async () => {
    const first = deferred<string>()
    h.generate.mockReturnValueOnce(first.promise).mockResolvedValueOnce('retried current result')
    await render()
    await act(async () => { aiButton()!.click(); aiButton()!.click() })
    expect(h.generate).toHaveBeenCalledTimes(1)
    await act(async () => first.reject(new Error('current provider error')))
    expect(container.querySelector('.ai-status.err')?.textContent).toContain('current provider error')
    expect(aiButton()?.disabled).toBe(false)
    await click('🤖 AI 寫總結')
    expect(h.generate).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.ai-status.err')).toBeNull()
    expect(container.querySelector('.ai-result-body')?.textContent).toBe('retried current result')
  })

  it('invalidates A even when A → B → A owner-ready events share a React batch', async () => {
    const old = deferred<string>(), current = deferred<string>()
    h.generate.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await render(); await click('🤖 AI 寫總結')
    await act(async () => {
      claimDeviceFor(B); seed('B intermediate task'); ready(B)
      claimDeviceFor(A); seed('A newest session task'); setOpenAIKey('synthetic-newest-key-A'); ready(A)
    })
    expect(container.textContent).toContain('A newest session task')
    expect(aiButton()?.disabled).toBe(false)
    await click('🤖 AI 寫總結')
    await act(async () => old.reject(new Error('A previous batch private error')))
    expect(container.querySelector('.ai-status.err')).toBeNull()
    expect(aiButton()?.disabled).toBe(true)
    await act(async () => current.resolve('A newest session result'))
    expect(container.querySelector('.ai-result-body')?.textContent).toBe('A newest session result')
  })

  it('blocks late AI success without an owner event, then accepts only the ready account', async () => {
    const old = deferred<string>(); h.generate.mockReturnValue(old.promise)
    await render(); await click('🤖 AI 寫總結')
    claimDeviceFor(B); seed('B ready task'); setOpenAIKey('synthetic-key-B')
    await act(async () => old.resolve('A stale secret before event'))
    expect(container.textContent).toBe(BLOCKED_STATUS)
    await act(async () => ready(A))
    expect(container.textContent).toBe(BLOCKED_STATUS)
    await act(async () => ready(B))
    expect(container.textContent).toContain('B ready task')
    expect(container.querySelector('.ai-result')).toBeNull()
    expect(aiButton()?.disabled).toBe(false)
  })

  it('clears displayed AI state when period metadata changes with the same days', async () => {
    h.generate.mockResolvedValue('old label insight')
    await render(); await click('🤖 AI 寫總結'); await click('⧉ 複製總結 MD')
    await render(days, 'relabelled period')
    expect(container.querySelector('.ai-result')).toBeNull()
    expect(container.textContent).not.toContain('✓ 已複製')
    await click('⧉ 複製總結 MD')
    expect(clipboard).toHaveBeenLastCalledWith(expect.stringContaining('relabelled period'))
  })

  it('a late old-period rejection cannot clear the new period request busy state', async () => {
    const old = deferred<string>(), current = deferred<string>()
    h.generate.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    seed('next period task', NEXT_DAY)
    await render(); await click('🤖 AI 寫總結'); await render([NEXT_DAY], 'next period')
    await click('🤖 AI 寫總結')
    expect(h.generate.mock.calls[1][1]).toContain('next period task')
    await act(async () => old.reject(new Error('old period private provider error')))
    expect(container.querySelector('.ai-status.err')).toBeNull()
    expect(aiButton()?.disabled).toBe(true)
    await act(async () => current.resolve('next period insight'))
    expect(aiButton()?.disabled).toBe(false)
    expect(container.querySelector('.ai-result-body')?.textContent).toBe('next period insight')
  })

  it('does not revive a request when returning to the original period', async () => {
    const old = deferred<string>(); h.generate.mockReturnValue(old.promise)
    seed('next period task', NEXT_DAY)
    await render(); await click('🤖 AI 寫總結')
    await render([NEXT_DAY], 'next period'); await render()
    await act(async () => old.resolve('previous visit result'))
    expect(container.textContent).toContain('A private task')
    expect(container.querySelector('.ai-result')).toBeNull()
    expect(aiButton()?.disabled).toBe(false)
  })

  it('ignores late old-period clipboard failure and lets current copy feedback expire', async () => {
    vi.useFakeTimers()
    const old = deferred<void>()
    clipboard.mockReturnValueOnce(old.promise).mockResolvedValueOnce(undefined)
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    seed('next period task', NEXT_DAY)
    await render(); await click('⧉ 複製總結 MD'); await render([NEXT_DAY], 'next period')
    await click('⧉ 複製總結 MD')
    await act(async () => old.reject(new Error('old period clipboard error')))
    expect(alert).not.toHaveBeenCalled()
    expect(container.textContent).toContain('✓ 已複製')
    await act(async () => vi.advanceTimersByTime(2000))
    expect(container.textContent).not.toContain('✓ 已複製')
  })

  it('ignores an insight-copy rejection after owner change', async () => {
    const old = deferred<void>()
    h.generate.mockResolvedValue('A copied insight')
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await render(); await click('🤖 AI 寫總結')
    clipboard.mockReturnValueOnce(old.promise)
    await click('複製'); await switchTo(B, 'B current task')
    await act(async () => old.reject(new Error('A insight clipboard error')))
    expect(alert).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('A copied insight')
  })

  it.each(['success', 'failure'] as const)('drops AI %s after unmount without blocking a later account', async (settlement) => {
    const old = deferred<string>(); h.generate.mockReturnValue(old.promise)
    await render(); await click('🤖 AI 寫總結')
    await act(async () => root.unmount())
    claimDeviceFor(B); seed('B remounted task'); setOpenAIKey('synthetic-remounted-key-B')
    root = createRoot(container); await render()
    const blocked = vi.fn()
    window.addEventListener('yike:owner-change-blocked', blocked)
    try {
      await act(async () => settlement === 'success'
        ? old.resolve('A unmounted private result') : old.reject(new Error('A unmounted private error')))
      expect(blocked).not.toHaveBeenCalled()
      expect(container.textContent).toContain('B remounted task')
      expect(container.querySelector('.ai-status.err')).toBeNull()
      expect(container.querySelector('.ai-result')).toBeNull()
      expect(aiButton()?.disabled).toBe(false)
    } finally {
      window.removeEventListener('yike:owner-change-blocked', blocked)
    }
  })

  it('cleans copy timers and ignores clipboard failures after unmount', async () => {
    vi.useFakeTimers()
    const old = deferred<void>(), alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await render(); await click('⧉ 複製總結 MD')
    expect(vi.getTimerCount()).toBe(1)
    clipboard.mockReturnValueOnce(old.promise)
    await click('或複製給自己的 AI')
    await act(async () => root.unmount())
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => old.reject(new Error('unmounted clipboard error')))
    expect(alert).not.toHaveBeenCalled()
    root = createRoot(container)
  })

  it('keeps owner invalidation working under React StrictMode effect replay', async () => {
    const old = deferred<string>(); h.generate.mockReturnValue(old.promise)
    await act(async () => root.render(<StrictMode>
      <PeriodSummary title="本週總結" dayKeys={days} periodLabel="strict period" />
    </StrictMode>))
    await click('🤖 AI 寫總結'); await switchTo(B, 'B strict task')
    await act(async () => old.resolve('A strict old result'))
    expect(container.textContent).toContain('B strict task')
    expect(container.querySelector('.ai-result')).toBeNull()
    expect(aiButton()?.disabled).toBe(false)
  })

  it('keeps the current account BYOK generation and copy workflow available', async () => {
    h.generate.mockResolvedValue('current account insight')
    await render(); await click('🤖 AI 寫總結')
    expect(h.generate).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('A private task'))
    expect(container.querySelector('.ai-result-body')?.textContent).toBe('current account insight')
    await click('複製')
    expect(clipboard).toHaveBeenCalledWith('current account insight')
  })

  it('drops an A success arriving after local B login and reloads B statistics', async () => {
    const old = deferred<string>(); h.generate.mockReturnValue(old.promise)
    await render(); await click('🤖 AI 寫總結')
    await switchTo(B, 'B current task')
    await act(async () => old.resolve('A private AI result'))
    expect(container.textContent).not.toContain('A private')
    expect(container.textContent).toContain('B current task')
    expect(container.querySelector('.ai-result')).toBeNull()
  })

  it('drops an A rejection arriving after local B login', async () => {
    const old = deferred<string>(); h.generate.mockReturnValue(old.promise)
    await render(); await click('🤖 AI 寫總結'); await switchTo(B, 'B current task')
    await act(async () => old.reject(new Error('A private provider error')))
    expect(container.querySelector('.ai-status.err')).toBeNull()
    expect(container.textContent).not.toContain('A private')
  })

  it('does not revive the original A result after an A → B → A transition', async () => {
    const old = deferred<string>(); h.generate.mockReturnValue(old.promise)
    await render(); await click('🤖 AI 寫總結')
    await switchTo(B, 'B task'); await switchTo(A, 'A new session task')
    await act(async () => old.resolve('A previous session secret'))
    expect(container.querySelector('.ai-result')).toBeNull()
    expect(container.textContent).toContain('A new session task')
  })

  it('an old finally cannot unlock the next owner request or replace its result', async () => {
    const old = deferred<string>(), current = deferred<string>()
    h.generate.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await render(); await click('🤖 AI 寫總結'); await switchTo(B, 'B task')
    expect(aiButton()?.disabled).toBe(false)
    await click('🤖 AI 寫總結')
    await act(async () => old.resolve('A old result'))
    expect(aiButton()?.disabled).toBe(true)
    expect(container.querySelector('.ai-result')).toBeNull()
    await act(async () => current.resolve('B current result'))
    expect(aiButton()?.disabled).toBe(false)
    expect(container.querySelector('.ai-result-body')?.textContent).toBe('B current result')
  })

  it('removes already displayed text, errors and copied feedback on owner-ready', async () => {
    h.generate.mockResolvedValue('A already displayed insight')
    await render(); await click('🤖 AI 寫總結'); await click('⧉ 複製總結 MD')
    expect(container.textContent).toContain('✓ 已複製')
    await switchTo(B, 'B task')
    expect(container.textContent).not.toContain('A already displayed insight')
    expect(container.textContent).not.toContain('✓ 已複製')
    h.generate.mockRejectedValue(new Error('B displayed error'))
    await click('🤖 AI 寫總結')
    expect(container.textContent).toContain('B displayed error')
    await switchTo(A, 'A fresh task')
    expect(container.querySelector('.ai-status.err')).toBeNull()
  })

  it('rechecks the new owner key instead of offering A BYOK access', async () => {
    await render(); expect(aiButton()).not.toBeNull()
    await switchTo(B, 'B task', false)
    expect(aiButton()).toBeNull()
    expect(container.textContent).toContain('B task')
  })

  it('blocks stale copy and AI actions before an owner event arrives', async () => {
    await render()
    const oldAI = aiButton()!, oldCopy = button('⧉ 複製總結 MD')
    claimDeviceFor(B); seed('B current task'); setOpenAIKey('synthetic-key-B')
    await act(async () => { oldCopy.click(); oldAI.click() })
    expect(clipboard).not.toHaveBeenCalled()
    expect(h.generate).not.toHaveBeenCalled()
    expect(container.textContent).toBe(BLOCKED_STATUS)
  })

  it('masks old content on another-tab owner change and waits for valid local owner-ready', async () => {
    h.generate.mockResolvedValue('A displayed insight')
    await render(); await click('🤖 AI 寫總結')
    await act(async () => {
      claimDeviceFor(B); seed('B task')
      window.dispatchEvent(new StorageEvent('storage', { key: 'ppl:owner', oldValue: A, newValue: B }))
    })
    expect(container.textContent).toBe(BLOCKED_STATUS)
    await act(async () => ready(A))
    expect(container.textContent).toBe(BLOCKED_STATUS)
    await act(async () => ready(B))
    expect(container.textContent).toContain('B task')
    expect(container.querySelector('.ai-result')).toBeNull()
  })

  it('invalidates the epoch when blocked even if the same owner is later ready', async () => {
    const old = deferred<string>(); h.generate.mockReturnValue(old.promise)
    await render(); await click('🤖 AI 寫總結')
    await act(async () => window.dispatchEvent(new Event('yike:owner-change-blocked')))
    expect(container.textContent).toBe(BLOCKED_STATUS)
    await act(async () => ready(A))
    await act(async () => old.resolve('A invalidated result'))
    expect(container.querySelector('.ai-result')).toBeNull()
    expect(aiButton()?.disabled).toBe(false)
  })

  it('ignores a delayed clipboard success from A after B login', async () => {
    const old = deferred<void>(); clipboard.mockReturnValue(old.promise)
    await render(); await click('⧉ 複製總結 MD'); await switchTo(B, 'B task')
    await act(async () => old.resolve())
    expect(container.textContent).not.toContain('✓ 已複製')
  })

  it('ignores a delayed clipboard failure from A after B login', async () => {
    const old = deferred<void>(); clipboard.mockReturnValue(old.promise)
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await render(); await click('⧉ 複製總結 MD'); await switchTo(B, 'B task')
    await act(async () => old.reject(new Error('synthetic denied clipboard')))
    expect(alert).not.toHaveBeenCalled()
  })

  it('an A copied timer cannot clear a B copied receipt', async () => {
    vi.useFakeTimers()
    await render(); await click('⧉ 複製總結 MD')
    await act(async () => vi.advanceTimersByTime(1000))
    await switchTo(B, 'B task'); await click('⧉ 複製總結 MD')
    await act(async () => vi.advanceTimersByTime(1000))
    expect(container.textContent).toContain('✓ 已複製')
    await act(async () => vi.advanceTimersByTime(1000))
    expect(container.textContent).not.toContain('✓ 已複製')
  })

  it('clears result and copied state when period keys change and rejects a late old-period result', async () => {
    const old = deferred<string>(); h.generate.mockReturnValue(old.promise)
    seed('next period task', NEXT_DAY)
    await render(); await click('⧉ 複製總結 MD'); await click('🤖 AI 寫總結')
    await render([NEXT_DAY], 'next period')
    expect(container.textContent).toContain('next period task')
    expect(container.textContent).not.toContain('A private task')
    expect(container.textContent).not.toContain('✓ 已複製')
    expect(aiButton()?.disabled).toBe(false)
    await act(async () => old.resolve('old period private result'))
    expect(container.querySelector('.ai-result')).toBeNull()
  })
})
