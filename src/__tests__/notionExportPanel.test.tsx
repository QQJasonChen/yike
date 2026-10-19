import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ push: vi.fn(), copy: vi.fn() }))
vi.mock('../integrations', async () => ({
  ...(await vi.importActual<typeof import('../integrations')>('../integrations')),
  pushToNotion: h.push,
}))
vi.mock('../storage', () => ({
  toDateKey: () => '2026-10-14', allDayKeys: () => ['2026-10-14'], loadDay: () => ({}),
  getDataOwner: () => localStorage.getItem('ppl:owner'),
  addDays: () => '2026-10-08', mondayOf: () => '2026-10-12',
}))
vi.mock('../exportMd', () => ({ dayToMarkdown: () => 'Synthetic content only' }))
vi.mock('../icsExport', () => ({ rangeToIcs: () => '' }))
import ExportPanel from '../ExportPanel'
import { NotionPushError, saveNotionConfig } from '../integrations'
import { defaultSettings } from '../types'

const ID = '1fd3a2b4-c5d6-7890-abcd-ef1234567890'
const PAGE = `https://www.notion.so/${ID.replace(/-/g, '')}`
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  localStorage.clear()
  saveNotionConfig({ token: 'synthetic-secret', parentPageId: ID, parentUrl: PAGE })
  h.push.mockReset()
  h.copy.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: h.copy } })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const render = () => act(async () => { root.render(<ExportPanel settings={defaultSettings()} />) })
const button = (text: string) => {
  const match = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text)
  if (!match) throw new Error(`Missing button: ${text}`)
  return match
}
const receipt = () => container.querySelector('[role=status]')
const fill = async (selector: string, value: string) => {
  const input = container.querySelector<HTMLInputElement>(selector)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Notion export controls retain receipts and prevent accidental duplicate writes', () => {
  it('keeps the partial-page link through other actions and does not retry automatically', async () => {
    vi.useFakeTimers()
    h.push.mockRejectedValue(new NotionPushError('Synthetic partial: inspect the page', 'partial', PAGE))
    await render()
    await act(async () => button('🚀 送到 Notion').click())
    expect(receipt()?.textContent).toContain('Synthetic partial')
    expect(receipt()?.querySelector('a')?.href).toBe(PAGE)
    await act(async () => button('⧉ 複製給 Heptabase').click())
    await act(async () => vi.advanceTimersByTime(7000))
    expect(receipt()?.querySelector('a')?.href).toBe(PAGE)
    expect(h.push).toHaveBeenCalledOnce()
    expect(h.copy).toHaveBeenCalledWith('Synthetic content only')
  })
  it.each(['partial', 'uncertain'] as const)('canceling manual resend preserves the %s result with no request', async outcome => {
    h.push.mockRejectedValue(new NotionPushError('Synthetic outcome', outcome, outcome === 'partial' ? PAGE : undefined))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await render()
    await act(async () => button('🚀 送到 Notion').click())
    await act(async () => button('🚀 送到 Notion').click())
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0][0]).toContain('可能造成重複')
    expect(h.push).toHaveBeenCalledOnce()
    expect(receipt()?.textContent).toContain('Synthetic outcome')
  })
  it('an explicitly confirmed resend makes exactly one new request and replaces the receipt after completion', async () => {
    h.push.mockRejectedValueOnce(new NotionPushError('Synthetic uncertain', 'uncertain'))
      .mockResolvedValueOnce({ url: PAGE })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await render()
    await act(async () => button('🚀 送到 Notion').click())
    await act(async () => button('🚀 送到 Notion').click())
    expect(h.push).toHaveBeenCalledTimes(2)
    expect(receipt()?.textContent).toContain('已送到你的 Notion')
    expect(receipt()?.querySelector('a')?.rel).toBe('noopener noreferrer')
  })
  it('same-tick double click and clicks while pending cannot create duplicate requests', async () => {
    let resolve!: (value: { url: string }) => void
    h.push.mockImplementation(() => new Promise(r => { resolve = r }))
    await render()
    const send = button('🚀 送到 Notion')
    await act(async () => { send.click(); send.click() })
    expect(h.push).toHaveBeenCalledOnce()
    expect(button('傳送中…').disabled).toBe(true)
    await act(async () => resolve({ url: PAGE }))
    expect(receipt()?.querySelector('a')?.href).toBe(PAGE)
  })
  it('never renders unsafe provider href or a forged successful URL', async () => {
    h.push.mockResolvedValueOnce({ url: `javascript:alert('${ID}')` })
    await render()
    await act(async () => button('🚀 送到 Notion').click())
    expect(receipt()?.querySelector('a')).toBeNull()
    expect(receipt()?.textContent).not.toContain('已送到你的 Notion')
    expect(receipt()?.textContent).toContain('無法確認')
  })
  it('rejects unsafe setup links before connection tests and canonicalizes existing saved hrefs', async () => {
    localStorage.setItem('pp:integrations', JSON.stringify({
      token: 'synthetic-secret', parentPageId: ID, parentUrl: `javascript:alert('${ID}')`,
    }))
    await render()
    await act(async () => button('⚙ Notion 設定').click())
    expect([...container.querySelectorAll('a')].every(a => a.protocol === 'https:')).toBe(true)
    await fill('input[type=text]', `https://evil.example/${ID}`)
    await act(async () => button('測試連線並儲存').click())
    expect(h.push).not.toHaveBeenCalled()
    expect(container.textContent).toContain('看不懂這個頁面連結')
  })
  it('a complete page receipt remains visible after seven seconds', async () => {
    vi.useFakeTimers()
    h.push.mockResolvedValue({ url: PAGE })
    await render()
    await act(async () => button('🚀 送到 Notion').click())
    await act(async () => vi.advanceTimersByTime(7000))
    expect(receipt()?.querySelector('a')?.href).toBe(PAGE)
    expect(h.push).toHaveBeenCalledOnce()
  })
})
