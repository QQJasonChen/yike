import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('../integrations', async () => ({
  ...(await vi.importActual<typeof import('../integrations')>('../integrations')),
  pushToNotion: h.push,
}))
import ExportPanel from '../ExportPanel'
import { loadNotionConfig, saveNotionConfig } from '../integrations'
import { claimDeviceFor, saveDay, setDataOwner, toDateKey } from '../storage'
import { defaultSettings, emptyDay, emptyTask } from '../types'

const A = 'synthetic-owner-a'
const B = 'synthetic-owner-b'
const PAGE_ID = 'aaaaaaaa-1111-2222-3333-444444444444'
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  localStorage.clear(); setDataOwner(A)
  saveDay(toDateKey(new Date()), { ...emptyDay(), tasks: [{ ...emptyTask(), text: 'synthetic journal' }] })
  saveNotionConfig({ token: 'synthetic-notion-A', parentPageId: PAGE_ID, parentUrl: '' })
  h.push.mockReset()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })
const render = () => act(async () => root.render(<ExportPanel settings={defaultSettings()} />))
const button = (text: string) => {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!found) throw new Error(`missing button ${text}`)
  return found
}
const ready = () => window.dispatchEvent(new CustomEvent('yike:local-owner-ready', { detail: { owner: B } }))

describe('Notion credentials remain within the account which supplied them', () => {
  it('a stale export frame cannot send with A cached token after storage already belongs to B', async () => {
    h.push.mockResolvedValue({ url: `https://www.notion.so/${PAGE_ID.replace(/-/g, '')}` })
    await render()
    claimDeviceFor(B)
    await act(async () => button('🚀 送到 Notion').click())
    expect(h.push).not.toHaveBeenCalled()
  })

  it('the local login-ready event removes A token drafts and receipt from the B view', async () => {
    h.push.mockResolvedValue({ url: `https://www.notion.so/${PAGE_ID.replace(/-/g, '')}` })
    await render()
    await act(async () => button('🚀 送到 Notion').click())
    expect(container.querySelector('[role=status]')?.textContent).toContain('已送到你的 Notion')
    await act(async () => { claimDeviceFor(B); ready() })
    expect(container.querySelector('[role=status]')).toBeNull()
    await act(async () => button('⚙ 設定 Notion').click())
    expect(container.querySelector<HTMLInputElement>('input[type=password]')?.value).toBe('')
    await act(async () => button('🚀 送到 Notion').click())
    expect(h.push).toHaveBeenCalledTimes(1)
  })

  it('an A connection test resolving after B login cannot put the old token back in storage', async () => {
    let resolve!: (value: { url: string }) => void
    h.push.mockImplementation(() => new Promise((done) => { resolve = done }))
    await render()
    await act(async () => button('⚙ Notion 設定').click())
    await act(async () => button('測試連線並儲存').click())
    expect(h.push).toHaveBeenCalledOnce()
    await act(async () => { claimDeviceFor(B); ready() })
    await act(async () => resolve({ url: `https://www.notion.so/${PAGE_ID.replace(/-/g, '')}` }))
    expect(loadNotionConfig()).toBeNull()
  })
})
