import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Session = { user: { id: string } } | null
type Handler = (event: string, session: Session) => unknown
const h = vi.hoisted(() => ({
  enabled: true, supa: vi.fn(), register: vi.fn(), unsubscribe: vi.fn(),
  getSession: vi.fn(), startSync: vi.fn(),
}))
vi.mock('../cloud', () => ({
  cloudEnabled: () => h.enabled, supa: h.supa, startAutoSync: h.startSync,
}))
vi.mock('../DayView', () => ({ default: () => null }))
vi.mock('../WeekView', () => ({ default: () => null }))
vi.mock('../MonthView', () => ({ default: () => null }))
vi.mock('../QuarterView', () => ({ default: () => null }))
vi.mock('../YearView', () => ({ default: () => null }))
vi.mock('../ScheduleView', () => ({ default: () => null }))
vi.mock('../LifeView', () => ({ default: () => null }))
vi.mock('../BizModelView', () => ({ default: () => null }))
vi.mock('../HistoryView', () => ({ default: () => null }))
vi.mock('../SettingsPanel', () => ({ default: () => null }))
vi.mock('../FocusTimer', () => ({ default: () => null }))
vi.mock('../Onboarding', () => ({ default: () => null }))
vi.mock('../notify', () => ({ notify: { setDailyReminder: vi.fn() } }))
vi.mock('../focusLock', () => ({ focusLock: { stop: vi.fn() } }))
vi.mock('../pip', () => ({
  openFloating: vi.fn(), pipAutoEnabled: () => false, pipSupported: () => false,
  setPipTimerSource: vi.fn(),
}))

import App from '../App'
import { useCloudAuthStatus } from '../useCloudAuthStatus'

let container: HTMLDivElement
let root: Root
let handler: Handler
const db = { auth: { onAuthStateChange: h.register, getSession: h.getSession } }
const session: Session = { user: { id: 'synthetic-qa-owner' } }
const Probe = () => <span data-testid="status">{String(useCloudAuthStatus())}</span>

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('pp:onboarded', '1')
  history.replaceState(null, '', '/')
  h.enabled = true
  h.register.mockReset().mockImplementation((callback: Handler) => {
    handler = callback
    return { data: { subscription: { unsubscribe: h.unsubscribe } } }
  })
  h.unsubscribe.mockReset()
  h.getSession.mockReset()
  h.startSync.mockReset().mockResolvedValue(undefined)
  h.supa.mockReset().mockResolvedValue(db)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})
const emit = (event: string, value: Session) => act(async () => {
  // Returning a Promise from this callback would recreate the Auth-lock hazard.
  expect(handler(event, value)).toBeUndefined()
})

describe('cloud Auth status subscription', () => {
  it('the actual App badge updates after sign-in/sign-out without changing tabs', async () => {
    await act(async () => root.render(<App />))
    expect(container.querySelector('.cloud-badge')?.textContent).toBe('☁ 登入')
    await emit('SIGNED_IN', session)
    expect(container.querySelector('.cloud-badge')?.textContent).toBe('☁ 已登入')
    expect(container.querySelector('.cloud-badge')?.getAttribute('title')).toContain('已登入')
    expect(location.hash).toBe('')
    await emit('SIGNED_OUT', null)
    expect(container.querySelector('.cloud-badge')?.textContent).toBe('☁ 登入')
    expect(h.getSession).not.toHaveBeenCalled()
    // Sync remains outside the Auth callback; only App's existing mount starts it.
    expect(h.startSync).toHaveBeenCalledOnce()
  })

  it('INITIAL_SESSION reports an existing session without making another Auth call', async () => {
    await act(async () => root.render(<Probe />))
    await emit('INITIAL_SESSION', session)
    expect(container.textContent).toBe('true')
    expect(h.getSession).not.toHaveBeenCalled()
    expect(h.startSync).not.toHaveBeenCalled()
  })

  it('a late initial session cannot overwrite a newer sign-in or sign-out', async () => {
    await act(async () => root.render(<Probe />))
    await emit('SIGNED_IN', session)
    await emit('INITIAL_SESSION', null)
    expect(container.textContent).toBe('true')
    await emit('SIGNED_OUT', null)
    await emit('INITIAL_SESSION', session)
    expect(container.textContent).toBe('false')
    expect(h.getSession).not.toHaveBeenCalled()
  })

  it('unmount unsubscribes and ignores any stale callback', async () => {
    await act(async () => root.render(<Probe />))
    await act(async () => root.unmount())
    expect(h.unsubscribe).toHaveBeenCalledOnce()
    await emit('SIGNED_IN', session)
    expect(container.textContent).toBe('')
    expect(h.getSession).not.toHaveBeenCalled()
  })

  it('does not register a listener if the client resolves after unmount', async () => {
    let resolve!: (value: typeof db) => void
    h.supa.mockImplementationOnce(() => new Promise<typeof db>(r => { resolve = r }))
    await act(async () => root.render(<Probe />))
    await act(async () => root.unmount())
    await act(async () => resolve(db))
    expect(h.register).not.toHaveBeenCalled()
    expect(h.unsubscribe).not.toHaveBeenCalled()
  })
})
