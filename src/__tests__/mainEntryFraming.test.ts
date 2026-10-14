import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ framed: false, order: [] as string[], render: vi.fn(), root: vi.fn(),
  stamp: vi.fn(), close: vi.fn(), artifact: vi.fn(), count: vi.fn(), warning: vi.fn(),
  appLoad: vi.fn(), storageLoad: vi.fn(), widgetLoad: vi.fn(), analyticsLoad: vi.fn(), register: vi.fn() }))
vi.mock('react-dom/client', () => ({ createRoot: h.root }))
vi.mock('../App', () => { h.appLoad(); return { default: () => null } })
vi.mock('../cloudConfig', () => ({ cloudEnabled: () => true }))
vi.mock('../storage', () => { h.storageLoad(); return { stampLegacyBackupOwners: h.stamp, closeSyncGate: h.close, hasCloudArtifact: h.artifact } })
vi.mock('../widgetSync', () => { h.widgetLoad(); return {} })
vi.mock('../analytics', () => { h.analyticsLoad(); return { countPageview: h.count } })
vi.mock('../frameGuard', () => ({ guardFraming: () => h.framed, renderFrameWarning: h.warning }))
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); h.order = []; h.framed = false
  document.body.innerHTML = '<div id="root"></div>'
  Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: h.register } })
  vi.stubEnv('PROD', true)
  h.root.mockImplementation(() => { h.order.push('createRoot'); return { render: h.render } })
  h.stamp.mockImplementation(() => { h.order.push('stamp') })
  h.close.mockImplementation(() => { h.order.push('gate') })
  h.artifact.mockReturnValue(true)
  h.register.mockResolvedValue({})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); document.body.replaceChildren() })

describe('actual main module startup', () => {
  it('framed entry imports no App/storage/widget/analytics, mounts no App and registers no SW', async () => {
    h.framed = true
    const listener = vi.spyOn(window, 'addEventListener')
    const entry = await import('../main')
    await entry.startup
    window.dispatchEvent(new Event('load'))
    expect(h.warning).toHaveBeenCalledWith(document.getElementById('root'))
    for (const action of [h.root, h.render, h.stamp, h.close, h.artifact, h.count, h.register,
      h.appLoad, h.storageLoad, h.widgetLoad, h.analyticsLoad]) expect(action).not.toHaveBeenCalled()
    expect(listener.mock.calls.some(([name]) => name === 'load')).toBe(false)
  })
  it('normal entry preserves legacy stamp/gate/mount order, counts and registers after load', async () => {
    const entry = await import('../main')
    await entry.startup
    expect(h.order).toEqual(['stamp', 'gate', 'createRoot'])
    expect(h.render).toHaveBeenCalledOnce()
    expect(h.widgetLoad).toHaveBeenCalledOnce()
    expect(h.count).toHaveBeenCalledOnce()
    expect(h.register).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('load'))
    await Promise.resolve()
    expect(h.register).toHaveBeenCalledOnce()
  })
  it('normal async startup registers SW when document load already completed', async () => {
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' })
    const entry = await import('../main'); await entry.startup
    expect(h.register).toHaveBeenCalledOnce()
    expect(h.render).toHaveBeenCalledOnce()
  })
})
