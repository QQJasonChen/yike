import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ activate: vi.fn(), login: vi.fn(), sync: vi.fn(), start: vi.fn(), email: vi.fn(), uid: vi.fn(), logout: vi.fn(), verify: vi.fn() }))
vi.mock('../ai', () => ({ OPENAI_KEY_HELP_URL: 'https://platform.openai.com/api-keys', verifyKeyAndPickModel: h.verify }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}),
}))
vi.mock('../cloud', async () => ({
  ...(await vi.importActual<typeof import('../cloud')>('../cloud')),
  activateWithCode: h.activate, cloudEnabled: () => true,
  currentEmail: h.email, currentUserId: h.uid,
  deleteAccount: vi.fn(), signInOrUp: h.login, signOut: h.logout,
  startAutoSync: h.start, stopAutoSync: vi.fn(), syncNow: h.sync,
}))
vi.mock('../notify', () => ({ notify: { available: () => false } }))
vi.mock('../focusLock', () => ({ focusLock: { available: () => false } }))
vi.mock('../IapPanel', () => ({ default: () => null }))

import SettingsPanel from '../SettingsPanel'
import { defaultSettings, emptyDay, emptyTask } from '../types'
import { autoBackup, claimDeviceFor, exportBackupAsFile, getDataOwner, getOpenAIKey, listBackups, loadDay, loadDirty, saveConflictCopy, saveDay, setDataOwner } from '../storage'
import { clearUnsavedDrafts, useStoredEntry } from '../useStoredEntry'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  localStorage.clear()
  clearUnsavedDrafts()
  h.email.mockReset().mockResolvedValue(null)
  h.uid.mockReset().mockResolvedValue('synthetic-owner')
  h.logout.mockReset().mockResolvedValue(undefined)
  h.activate.mockReset().mockResolvedValue('up')
  h.login.mockReset().mockResolvedValue('in')
  h.sync.mockReset().mockResolvedValue({ pulled: 0, pushed: 0, rejected: 0, held: 0, conflicts: 0 })
  h.start.mockReset().mockResolvedValue(undefined)
  h.verify.mockReset().mockResolvedValue({ ok: true, model: 'synthetic-model' })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  clearUnsavedDrafts()
  vi.clearAllTimers()
  vi.useRealTimers()
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
    h.sync.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ pulled: 0, pushed: 1, rejected: 0, held: 0, conflicts: 0 }) }))
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

describe('OpenAI verification keeps the initiating account boundary', () => {
  const keyInput = '.backup-box input[placeholder="sk-..."]'
  it('the same account can verify and save its own key', async () => {
    setDataOwner('synthetic-owner-a')
    await render(); await fill(keyInput, 'sk-synthetic-owner-a')
    await act(async () => button('驗證並儲存').click())
    expect(getOpenAIKey()).toBe('sk-synthetic-owner-a')
  })
  it('a late A verification response cannot restore A key after B login', async () => {
    let resolve!: (value: { ok: true; model: string }) => void
    h.verify.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    setDataOwner('synthetic-owner-a')
    await render(); await fill(keyInput, 'sk-synthetic-owner-a')
    await act(async () => button('驗證並儲存').click())
    await act(async () => {
      claimDeviceFor('synthetic-owner-b')
      window.dispatchEvent(new CustomEvent('yike:local-owner-ready', { detail: { owner: 'synthetic-owner-b' } }))
    })
    await act(async () => resolve({ ok: true, model: 'synthetic-model' }))
    expect(getOpenAIKey()).toBe('')
    expect(container.querySelector<HTMLInputElement>(keyInput)?.value).toBe('')
  })
  it('a stale settings frame cannot verify an A key after the owner already became B', async () => {
    setDataOwner('synthetic-owner-a')
    await render(); await fill(keyInput, 'sk-synthetic-owner-a')
    claimDeviceFor('synthetic-owner-b')
    await act(async () => button('驗證並儲存').click())
    expect(h.verify).not.toHaveBeenCalled()
    expect(getOpenAIKey()).toBe('')
  })
})


const testDay = (text: string) => ({ ...emptyDay(), tasks: [{ ...emptyTask(), text }] })
const uploadFile = (json: string) => act(async () => {
  const input = container.querySelector<HTMLInputElement>('.backup-box input[type=file]')!
  Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => json }] })
  input.dispatchEvent(new Event('change', { bubbles: true }))
})
const sourceFile = () => JSON.stringify({ app: 'inkday-planner', version: 1, owner: 'other-owner', data: { 'pp:day:2026-09-01': testDay('file from other owner') } })

describe('actual Settings backup, owner and sync safety controls', () => {
  it('owned daily backup restores by its full ID and keeps later records', async () => {
    vi.useFakeTimers(); setDataOwner('synthetic-owner')
    saveDay('2026-09-01', testDay('snapshot')); autoBackup('2026-09-01')
    saveDay('2026-09-01', testDay('current')); saveDay('2026-09-02', testDay('later retained'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await render(); await act(async () => button('還原').click())
    expect(loadDay('2026-09-01').tasks[0].text).toBe('snapshot')
    expect(loadDay('2026-09-02').tasks[0].text).toBe('later retained')
    expect(container.textContent).toContain('還原前安全快照')
    expect(container.textContent).toContain('已還原')
  })
  it('restore refreshes real mounted views and never reloads a later failed draft', async () => {
    vi.useFakeTimers(); setDataOwner('synthetic-owner')
    saveDay('2026-09-01', testDay('snapshot')); autoBackup('2026-09-01')
    saveDay('2026-09-01', testDay('current'))
    const Probe = () => {
      const { entry, edit } = useStoredEntry('pp:day:2026-09-01', () => loadDay('2026-09-01'), (value) => saveDay('2026-09-01', value))
      return <><span data-current>{entry.tasks[0].text}</span><button data-draft onClick={() => edit((base) => ({ ...base, tasks: [{ ...emptyTask(), text: 'new failed draft' }] }))}>new draft</button></>
    }
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => root.render(<><SettingsPanel settings={defaultSettings()} onSettingsChange={() => {}} onClose={() => {}} /><Probe /></>))
    const scheduled = vi.spyOn(globalThis, 'setTimeout')
    await act(async () => button('還原').click())
    expect(container.querySelector('[data-current]')!.textContent).toBe('snapshot')
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) {
      if (key === 'pp:day:2026-09-01') throw new DOMException('quota', 'QuotaExceededError')
      original.call(this, key, value)
    })
    await act(async () => container.querySelector<HTMLButtonElement>('[data-draft]')!.click())
    expect(container.querySelector('[data-current]')!.textContent).toBe('new failed draft')
    expect(scheduled.mock.calls.some(([, ms]) => ms === 900)).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(container.querySelector('[data-current]')!.textContent).toBe('new failed draft')
    expect(loadDay('2026-09-01').tasks[0].text).toBe('snapshot')
    scheduled.mockRestore()
  })
  it('cancel importing another owner changes no records and sets no dirty flags', async () => {
    setDataOwner('synthetic-owner'); saveDay('2026-09-01', testDay('my current'))
    const dirty = JSON.stringify(loadDirty())
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await render(); await uploadFile(sourceFile())
    expect(loadDay('2026-09-01').tasks[0].text).toBe('my current')
    expect(JSON.stringify(loadDirty())).toBe(dirty)
    expect(container.textContent).not.toContain('已從檔案還原')
  })
  it('explicit confirmation imports other-owner file into current owner without changing owner', async () => {
    vi.useFakeTimers(); setDataOwner('synthetic-owner'); vi.spyOn(window, 'confirm').mockReturnValue(true)
    await render(); await uploadFile(sourceFile())
    expect(loadDay('2026-09-01').tasks[0].text).toBe('file from other owner')
    expect(getDataOwner()).toBe('synthetic-owner')
    expect(loadDirty()['pp:day:2026-09-01']).toBeGreaterThan(0)
  })
  it('owner changing during import confirmation invalidates the consent', async () => {
    setDataOwner('synthetic-owner'); saveDay('2026-09-01', testDay('retained'))
    vi.spyOn(window, 'confirm').mockImplementation(() => { setDataOwner('new-owner'); return true })
    await render(); await uploadFile(sourceFile())
    expect(loadDay('2026-09-01').tasks[0].text).toBe('retained')
    expect(container.textContent).toContain('帳號已變更')
  })
  it.each([{ rejected: 1, held: 0 }, { rejected: 0, held: 1 }])('rejected/held sync blocks logout and keeps local records', async (pending) => {
    h.email.mockResolvedValue('qa@example.com'); setDataOwner('synthetic-owner')
    saveDay('2026-09-01', testDay('local still here'))
    h.sync.mockResolvedValue({ pulled: 0, pushed: 0, conflicts: 0, ...pending })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await render(); await act(async () => button('登出').click())
    expect(h.logout).not.toHaveBeenCalled()
    expect(loadDay('2026-09-01').tasks[0].text).toBe('local still here')
    expect(container.textContent).toContain('已取消登出')
  })
  it('Auth logout failure preserves records and backups instead of wiping the device', async () => {
    h.email.mockResolvedValue('qa@example.com'); setDataOwner('synthetic-owner')
    saveDay('2026-09-01', testDay('retained')); autoBackup('2026-09-01')
    localStorage.removeItem('ppl:dirty')
    h.logout.mockRejectedValueOnce(new Error('logout unavailable'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await render(); await act(async () => button('登出').click())
    expect(loadDay('2026-09-01').tasks[0].text).toBe('retained')
    expect(listBackups()).toHaveLength(1)
    expect(container.textContent).toContain('logout unavailable')
  })
  it('manual rejected sync reports pending local data instead of completion', async () => {
    h.email.mockResolvedValue('qa@example.com')
    h.sync.mockResolvedValue({ pulled: 0, pushed: 0, rejected: 1, held: 0, conflicts: 0 })
    await render(); await act(async () => button('⟳ 立即同步').click())
    expect(container.textContent).toContain('尚有 1 筆未上傳')
    expect(container.textContent).not.toContain('✓ 已同步')
  })
  it('explicit first-login merge claims anonymous daily backups for the buyer', async () => {
    saveDay('2026-09-01', testDay('local own')); autoBackup('2026-09-01')
    h.sync.mockRejectedValueOnce(new Error('device-unclaimed-data'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await render(); await act(async () => button('已經有帳號？直接登入').click())
    await fill('.sync-box input[type=email]', 'qa@example.com'); await fill('.sync-box input[type=password]', 'synthetic-password')
    await act(async () => button('登入').click())
    expect(getDataOwner()).toBe('synthetic-owner')
    expect(listBackups()).toHaveLength(1)
    expect(JSON.parse(exportBackupAsFile(listBackups()[0].id)).owner).toBe('synthetic-owner')
  })
  it('conflict UI offers an owned backup file and never automatically imports it', async () => {
    setDataOwner('synthetic-owner'); saveDay('2026-09-01', testDay('local'))
    saveConflictCopy('pp:day:2026-09-01', testDay('remote copy'), 123)
    await render()
    expect(container.textContent).toContain('雲端衝突副本（1 份）')
    expect(container.textContent).toContain('尚未套回記錄')
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => button('刪除副本').click())
    expect(container.textContent).toContain('雲端衝突副本（1 份）')
    expect(loadDay('2026-09-01').tasks[0].text).toBe('local')
  })
})
