import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ activate: vi.fn(), login: vi.fn(), sync: vi.fn(), start: vi.fn() }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}),
}))
vi.mock('../cloud', () => ({
  activateWithCode: h.activate, cloudEnabled: () => true,
  currentEmail: async () => null, currentUserId: async () => 'synthetic-owner',
  deleteAccount: vi.fn(), signInOrUp: h.login, signOut: vi.fn(),
  startAutoSync: h.start, stopAutoSync: vi.fn(), syncNow: h.sync,
}))
vi.mock('../notify', () => ({ notify: { available: () => false } }))
vi.mock('../focusLock', () => ({ focusLock: { available: () => false } }))
vi.mock('../IapPanel', () => ({ default: () => null }))

import SettingsPanel from '../SettingsPanel'
import { defaultSettings } from '../types'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  localStorage.clear()
  h.activate.mockReset().mockResolvedValue('up')
  h.login.mockReset().mockResolvedValue('in')
  h.sync.mockReset().mockResolvedValue({ pulled: 0, pushed: 0 })
  h.start.mockReset().mockResolvedValue(undefined)
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
const render = () => act(async () => {
  root.render(<SettingsPanel settings={defaultSettings()} onSettingsChange={() => {}} onClose={() => {}} />)
})
const button = (text: string): HTMLButtonElement => {
  const match = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text)
  if (!match) throw new Error(`Missing button: ${text}`)
  return match
}
const fill = async (selector: string, value: string) => {
  const input = container.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error(`Missing input: ${selector}`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('actual Settings activation and login controls', () => {
  it('Email and password alone cannot submit activation', async () => {
    await render()
    await fill('.sync-box input[type=email]', 'qa@example.com')
    await fill('.sync-box input[type=password]', 'synthetic-password')
    expect(button('開通並登入').disabled).toBe(true)
    await act(async () => button('開通並登入').click())
    expect(h.activate).not.toHaveBeenCalled()
    expect(container.querySelector('a[href="/activate.html"]')).not.toBeNull()
    expect(container.textContent).not.toContain('買過的人免填')
  })

  it('submits the purchase key and Email, then waits for sync before reporting completion', async () => {
    await render()
    await fill('input[aria-label="購買序號（License Key，必填）"]', 'SYNTHETIC-LICENSE')
    await fill('.sync-box input[type=email]', 'qa@example.com')
    await fill('.sync-box input[type=password]', 'synthetic-password')
    let release!: () => void
    h.sync.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ pulled: 0, pushed: 1 }) }))
    expect(button('開通並登入').disabled).toBe(false)
    await act(async () => button('開通並登入').click())
    expect(h.activate).toHaveBeenCalledWith('SYNTHETIC-LICENSE', 'qa@example.com', 'synthetic-password')
    expect(container.textContent).not.toContain('開通成功，已同步')
    await act(async () => release())
    expect(container.textContent).toContain('開通成功，已同步（↓0 ↑1）')
    expect(h.start).toHaveBeenCalledOnce()
  })

  it('an existing account signs in without resubmitting a license', async () => {
    await render()
    await act(async () => button('已經有帳號？直接登入').click())
    await fill('.sync-box input[type=email]', 'qa@example.com')
    await fill('.sync-box input[type=password]', 'synthetic-password')
    expect(button('登入').disabled).toBe(false)
    await act(async () => button('登入').click())
    expect(h.login).toHaveBeenCalledWith('qa@example.com', 'synthetic-password')
    expect(h.activate).not.toHaveBeenCalled()
    expect(container.textContent).toContain('登入成功，已同步')
  })
})
