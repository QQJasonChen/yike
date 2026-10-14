import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecoveryPage, type RecoveryPageProps } from '../PasswordRecoveryPage'
import { RecoveryLinkExpiredError, RecoveryResultUnknownError, type RecoverySession } from '../passwordRecovery'

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
function fixture() {
  const session: RecoverySession = { email: 'qa-recovery@example.invalid', changePassword: vi.fn().mockResolvedValue({ refreshSessionsRevoked: true }), dispose: vi.fn() }
  const api = { requestReset: vi.fn().mockResolvedValue('如果這個 Email 已有帳號，會收到重設連結。'), redeemRecoveryHash: vi.fn().mockResolvedValue(session), dispose: vi.fn() }
  return { session, api, makeApi: vi.fn(() => api) }
}
async function mount(props: RecoveryPageProps) { await act(async () => root.render(<RecoveryPage {...props}/>)) }
async function click() { await act(async () => host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }
async function fill(selector: string, text: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function granted(h = fixture()) {
  let token: string | null = 'abcdef0123456789'.repeat(4)
  await mount({ enabled: true, hadUrlData: true, takeInitialToken: () => { const value = token; token = null; return value }, createRecovery: h.makeApi })
  await click(); return h
}

describe('isolated recovery UI', () => {
  it('disabled build has no submit controls or mail/verify calls', async () => {
    const h = fixture(); await mount({ enabled: false, createRecovery: h.makeApi })
    expect(host.textContent).toContain('尚未開放'); expect(host.querySelectorAll('input,button')).toHaveLength(0)
    expect(h.api.requestReset).not.toHaveBeenCalled(); expect(h.api.redeemRecoveryHash).not.toHaveBeenCalled()
  })
  it('opening a mail link/scanner does not redeem it; double-click still redeems once', async () => {
    const h = fixture(); await mount({ enabled: true, takeInitialToken: () => 'abcdef0123456789'.repeat(4), createRecovery: h.makeApi })
    expect(host.textContent).toContain('繼續重設密碼'); expect(h.api.redeemRecoveryHash).not.toHaveBeenCalled()
    await act(async () => { const button = host.querySelector('button')!; button.dispatchEvent(new MouseEvent('click', { bubbles: true })); button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(h.api.redeemRecoveryHash).toHaveBeenCalledOnce(); expect(host.querySelectorAll('input[type=password]')).toHaveLength(2)
  })
  it('expired/reused link shows a new-request form without a password field', async () => {
    const h = fixture(); h.api.redeemRecoveryHash.mockRejectedValueOnce(new RecoveryLinkExpiredError())
    await granted(h); expect(host.textContent).toContain('已失效或已使用'); expect(host.querySelector('input[type=password]')).toBeNull(); expect(host.querySelector('input[type=email]')).not.toBeNull()
  })
  it('request click shows conditional acknowledgement and local cooldown, never a delivery PASS', async () => {
    const h = fixture(); await mount({ enabled: true, createRecovery: h.makeApi }); await fill('input[type=email]', 'qa-recovery@example.invalid'); await click()
    expect(h.api.requestReset).toHaveBeenCalledOnce(); expect(host.textContent).toContain('如果這個 Email 已有帳號'); expect(host.querySelector('button')!.disabled).toBe(true); expect(host.textContent).toContain('60 秒')
  })
  it('password mismatch never calls the password endpoint', async () => {
    const h = await granted(); await fill('input[type=password]:nth-of-type(1)', 'synthetic-new-password')
    const inputs = host.querySelectorAll<HTMLInputElement>('input[type=password]')
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inputs[1], 'synthetic-other-password'); inputs[1].dispatchEvent(new Event('input', { bubbles: true })) })
    await click(); expect(h.session.changePassword).not.toHaveBeenCalled(); expect(host.textContent).toContain('兩次新密碼不一致')
  })
  it('confirmed password update clears form/session and still shows revocation uncertainty accurately', async () => {
    const h = fixture(); vi.mocked(h.session.changePassword).mockResolvedValueOnce({ refreshSessionsRevoked: false }); await granted(h)
    const inputs = host.querySelectorAll<HTMLInputElement>('input[type=password]')
    for (const input of inputs) await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'synthetic-new-password'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await click(); expect(host.textContent).toContain('密碼已更新，登入續期撤銷的結果未確認'); expect(host.querySelector('input[type=password]')).toBeNull(); expect(h.session.dispose).toHaveBeenCalled()
  })
  it('unknown password update clears credentials and never shows success', async () => {
    const h = fixture(); vi.mocked(h.session.changePassword).mockRejectedValueOnce(new RecoveryResultUnknownError()); await granted(h)
    for (const input of host.querySelectorAll<HTMLInputElement>('input[type=password]')) await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'synthetic-new-password'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await click(); expect(host.textContent).toContain('結果尚未確認'); expect(host.textContent).not.toContain('密碼已更新'); expect(host.querySelector('input[type=password]')).toBeNull()
  })
  it('pagehide destroys active recovery session; bfcache restore uses a clean request-only instance', async () => {
    const h = await granted(); await act(async () => window.dispatchEvent(new PageTransitionEvent('pagehide')))
    expect(h.session.dispose).toHaveBeenCalled(); expect(h.api.dispose).toHaveBeenCalled(); expect(host.querySelector('input[type=password]')).toBeNull()
    await act(async () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    expect(h.makeApi).toHaveBeenCalledTimes(2); expect(host.querySelector('input[type=email]')).not.toBeNull(); expect(h.api.redeemRecoveryHash).toHaveBeenCalledOnce()
  })
  it('late verify after pagehide cannot restore a credential session', async () => {
    const h = fixture(); let resolve!: (session: RecoverySession) => void; h.api.redeemRecoveryHash.mockReturnValueOnce(new Promise<RecoverySession>(done => { resolve = done }))
    await mount({ enabled: true, takeInitialToken: () => 'abcdef0123456789'.repeat(4), createRecovery: h.makeApi })
    await act(async () => host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => window.dispatchEvent(new PageTransitionEvent('pagehide')))
    await act(async () => resolve(h.session)); expect(h.session.dispose).toHaveBeenCalled(); expect(host.querySelector('input[type=password]')).toBeNull()
  })
})
