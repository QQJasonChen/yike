import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loaded: vi.fn(), configure: vi.fn(), log: vi.fn(), offers: vi.fn(), info: vi.fn(),
  purchase: vi.fn(), restore: vi.fn(), fetch: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
// Simulate a future configured native build, preserving the real protocol-readiness gate.
vi.mock('../iapConfig', async () => ({
  ...(await vi.importActual<typeof import('../iapConfig')>('../iapConfig')),
  REVENUECAT_APPLE_API_KEY: 'appl_synthetic_public_key', iapConfigured: () => true,
}))
vi.mock('@revenuecat/purchases-capacitor', () => {
  h.loaded()
  return { LOG_LEVEL: { WARN: 'WARN' }, Purchases: {
    setLogLevel: h.log, configure: h.configure, getOfferings: h.offers,
    getCustomerInfo: h.info, purchasePackage: h.purchase, restorePurchases: h.restore,
  } }
})
import { activateWithIap, getSyncOffer, hasSyncEntitlement, iapAvailable, purchaseSync, restoreSync } from '../iap'
import IapPanel from '../IapPanel'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  for (const mock of [h.configure, h.log, h.offers, h.info, h.purchase, h.restore, h.fetch]) mock.mockReset()
  h.configure.mockResolvedValue(undefined); h.log.mockResolvedValue(undefined)
  const customerInfo = { originalAppUserId: 'synthetic-public-identifier', entitlements: { active: { sync: {} } } }
  h.offers.mockResolvedValue({ current: { availablePackages: [{ product: { priceString: 'Synthetic $1', title: 'Synthetic sync' } }] } })
  h.info.mockResolvedValue({ customerInfo }); h.purchase.mockResolvedValue({ customerInfo }); h.restore.mockResolvedValue({ customerInfo })
  h.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', h.fetch)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
const noPurchaseOrNetwork = () => {
  expect(h.loaded).not.toHaveBeenCalled()
  for (const fn of [h.configure, h.log, h.offers, h.info, h.purchase, h.restore, h.fetch]) expect(fn).not.toHaveBeenCalled()
}

describe('IAP unavailable until receipt ownership protocol is implemented', () => {
  it('a configured native build still reports unavailable without loading the SDK', () => {
    expect(iapAvailable()).toBe(false)
    noPurchaseOrNetwork()
  })
  it('offer and entitlement queries remain no-op while activation is closed', async () => {
    expect(await getSyncOffer()).toBeNull()
    expect(await hasSyncEntitlement()).toBe(false)
    noPurchaseOrNetwork()
  })
  it.each([purchaseSync, restoreSync])('direct %s call is rejected before SDK or payment activity', async (invoke) => {
    await expect(invoke()).rejects.toThrow('尚未開放')
    noPurchaseOrNetwork()
  })
  it('direct activation call is rejected before sending account or purchase data', async () => {
    await expect(activateWithIap('synthetic-id', 'synthetic@example.invalid', 'synthetic-password')).rejects.toThrow('尚未開放')
    noPurchaseOrNetwork()
  })
  it('the native panel offers no purchase or restore controls while activation is closed', async () => {
    await act(async () => root.render(<IapPanel signedIn={false} />))
    expect(container.querySelector('button')).toBeNull()
    expect(container.textContent).toBe('')
    noPurchaseOrNetwork()
  })
})
