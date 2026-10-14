import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SUPABASE_URL } from '../cloudConfig'
import {
  consumeRecoveryHash, passwordRecovery, RECOVERY_REDIRECT_URL,
  RecoveryLinkExpiredError, RecoveryResultUnknownError, RecoveryThrottleError, recoveryEnabled,
} from '../passwordRecovery'
const proof = 'abcdef0123456789'.repeat(4)
const owner = { id: '00000000-0000-4000-8000-000000000001', email: 'qa-recovery@example.invalid' }
const other = { id: '00000000-0000-4000-8000-000000000002', email: 'other@example.invalid' }
const config = { enabled: true, url: SUPABASE_URL, anonKey: 'PUBLIC_SYNTHETIC', redirectTo: RECOVERY_REDIRECT_URL }
const reply = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), { status, headers })
const verified = { access_token: 'SYNTHETIC_RECOVERY_SESSION', user: owner }
const granted = () => vi.fn().mockResolvedValueOnce(reply(verified)).mockResolvedValueOnce(reply(owner))
beforeEach(() => localStorage.clear())

describe('isolated password recovery protocol', () => {
  it('build flag is disabled unless explicitly true', () => {
    for (const value of [undefined, 'false', 'TRUE']) { vi.stubEnv('VITE_ACCOUNT_RECOVERY_ENABLED', value); expect(recoveryEnabled()).toBe(false) }
    vi.stubEnv('VITE_ACCOUNT_RECOVERY_ENABLED', 'true'); expect(recoveryEnabled()).toBe(true); vi.unstubAllEnvs()
  })
  it('oversized upstream body cannot supply a recovery session', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ ...verified, padding: 'x'.repeat(256 * 1024) }))
    await expect(passwordRecovery({ ...config, fetcher }).redeemRecoveryHash(proof)).rejects.toThrow('目前無法使用')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('concurrent password changes send only one update and close after completion', async () => {
    let finish!: (value: Response) => void
    const fetcher = granted().mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve })).mockResolvedValueOnce(reply({}))
    const session = await passwordRecovery({ ...config, fetcher }).redeemRecoveryHash(proof)
    const first = session.changePassword('new-synthetic-password')
    await expect(session.changePassword('second-synthetic-password')).rejects.toThrow('正在更新')
    expect(fetcher).toHaveBeenCalledTimes(3); finish(reply(owner)); expect(await first).toEqual({ refreshSessionsRevoked: true })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it('default/disabled or wrong project/callback cannot send any Auth request', async () => {
    for (const changed of [{ enabled: false }, { url: 'https://other.invalid' }, { redirectTo: 'https://other.invalid' }]) {
      const fetcher = vi.fn(); const api = passwordRecovery({ ...config, ...changed, fetcher })
      await expect(api.requestReset(owner.email)).rejects.toThrow('目前無法使用')
      await expect(api.redeemRecoveryHash(proof)).rejects.toThrow('目前無法使用')
      expect(fetcher).not.toHaveBeenCalled()
    }
  })
  it('clears URL before exposing exactly one typed recovery proof', () => {
    let cleared = false
    expect(consumeRecoveryHash('#token_hash=' + proof + '&type=recovery', () => { cleared = true })).toBe(proof)
    expect(cleared).toBe(true)
  })
  it.each([
    '#access_token=SYNTHETIC_NORMAL&type=recovery', '#refresh_token=SYNTHETIC_NORMAL&type=recovery',
    '#token_hash=' + proof, '#token_hash=' + proof + '&type=signup',
    '#token_hash=' + proof + '&type=recovery&type=recovery', '#token_hash=' + proof + '&token_hash=' + proof + '&type=recovery',
    '#token_hash=short&type=recovery', '#code=pkce&type=recovery',
  ])('ordinary, PKCE or ambiguous %s cannot be used', fragment => {
    const clear = vi.fn(); expect(consumeRecoveryHash(fragment, clear)).toBeNull(); expect(clear).toHaveBeenCalledOnce()
  })
  it('rejects query credentials and oversized fragment and still clears URL', () => {
    expect(consumeRecoveryHash('#token_hash=' + proof + '&type=recovery', vi.fn(), '?code=PKCE')).toBeNull()
    expect(consumeRecoveryHash('#' + 'a'.repeat(4096), vi.fn())).toBeNull()
  })
  it('request acknowledgement is conditional, normalizes Email and never prints upstream SMTP errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({}))
    const api = passwordRecovery({ ...config, fetcher })
    expect(await api.requestReset(' QA-Recovery@Example.Invalid ')).toContain('如果這個 Email 已有帳號')
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toContain(encodeURIComponent(RECOVERY_REDIRECT_URL)); expect(JSON.parse(init.body)).toEqual({ email: owner.email })
    expect(init.redirect).toBe('error')
    const bad = passwordRecovery({ ...config, fetcher: vi.fn().mockResolvedValue(reply({ error: 'PRIVATE_SMTP_BODY' }, 403)) })
    await expect(bad.requestReset(owner.email)).rejects.toThrow('目前無法使用')
  })
  it('local cooldown and server 429 block accidental retries, without pretending to replace server controls', async () => {
    let time = 0
    const fetcher = vi.fn().mockResolvedValueOnce(reply({}, 429, { 'Retry-After': '120' })).mockResolvedValue(reply({}))
    const api = passwordRecovery({ ...config, fetcher, now: () => time })
    await expect(api.requestReset(owner.email)).rejects.toMatchObject({ retryAfterSeconds: 120 })
    time = 60_000
    await expect(api.requestReset(owner.email)).rejects.toBeInstanceOf(RecoveryThrottleError)
    expect(fetcher).toHaveBeenCalledOnce()
    time = 120_000; await expect(api.requestReset(owner.email)).resolves.toContain('如果')
  })
  it.each([400, 401, 403, 422])('expired/reused link HTTP%s never reaches password endpoint', async status => {
    const fetcher = vi.fn().mockResolvedValue(reply({}, status)); const api = passwordRecovery({ ...config, fetcher })
    await expect(api.redeemRecoveryHash(proof)).rejects.toBeInstanceOf(RecoveryLinkExpiredError)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('consumes proof once and verifies the granted token belongs to the same server UID', async () => {
    localStorage.setItem('sb-normal-session', 'SYNTHETIC_OTHER_NORMAL_SESSION')
    const fetcher = granted().mockResolvedValueOnce(reply(owner)).mockResolvedValueOnce(reply({}))
    const api = passwordRecovery({ ...config, fetcher }); const session = await api.redeemRecoveryHash(proof)
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ token_hash: proof, type: 'recovery' })
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer SYNTHETIC_RECOVERY_SESSION')
    expect(await session.changePassword('new-synthetic-password')).toEqual({ refreshSessionsRevoked: true })
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ password: 'new-synthetic-password' })
    expect(fetcher.mock.calls[3][0]).toMatch(/logout\?scope=global$/)
    expect(localStorage.getItem('sb-normal-session')).toBe('SYNTHETIC_OTHER_NORMAL_SESSION')
    await expect(api.redeemRecoveryHash(proof)).rejects.toBeInstanceOf(RecoveryLinkExpiredError)
    await expect(session.changePassword('second-synthetic-password')).rejects.toBeInstanceOf(RecoveryLinkExpiredError)
  })
  it('verify token with wrong server owner cannot change any password', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(verified)).mockResolvedValueOnce(reply(other))
    await expect(passwordRecovery({ ...config, fetcher }).redeemRecoveryHash(proof)).rejects.toThrow('目前無法使用')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it.each([{}, other, { id: owner.id, email: other.email }])('password 200 wrong/ambiguous owner %j is UNKNOWN and never reports success/revocation', async returned => {
    const fetcher = granted().mockResolvedValueOnce(reply(returned)); const session = await passwordRecovery({ ...config, fetcher }).redeemRecoveryHash(proof)
    await expect(session.changePassword('new-synthetic-password')).rejects.toBeInstanceOf(RecoveryResultUnknownError)
    expect(fetcher).toHaveBeenCalledTimes(3)
    await expect(session.changePassword('retry-synthetic-password')).rejects.toBeInstanceOf(RecoveryLinkExpiredError)
  })
  it.each(['network', 'server'])('ambiguous %s password result does not claim unchanged password or automatically retry', async failure => {
    const fetcher = granted()
    if (failure === 'network') fetcher.mockRejectedValueOnce(Error('PRIVATE_NETWORK_DETAIL'))
    else fetcher.mockResolvedValueOnce(reply({}, 503))
    const session = await passwordRecovery({ ...config, fetcher }).redeemRecoveryHash(proof)
    await expect(session.changePassword('new-synthetic-password')).rejects.toBeInstanceOf(RecoveryResultUnknownError)
    await expect(session.changePassword('retry-synthetic-password')).rejects.toBeInstanceOf(RecoveryLinkExpiredError)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('weak-password can be corrected but terminal authorization expiry clears session', async () => {
    const fetcher = granted().mockResolvedValueOnce(reply({ code: 'weak_password', message: 'PRIVATE_BODY' }, 422)).mockResolvedValueOnce(reply({}, 401))
    const session = await passwordRecovery({ ...config, fetcher }).redeemRecoveryHash(proof)
    await expect(session.changePassword('synthetic-password')).rejects.toThrow('安全規則')
    await expect(session.changePassword('another-synthetic-password')).rejects.toBeInstanceOf(RecoveryLinkExpiredError)
    await expect(session.changePassword('retry-synthetic-password')).rejects.toBeInstanceOf(RecoveryLinkExpiredError)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it('logout failure does not hide same-owner password update success', async () => {
    const fetcher = granted().mockResolvedValueOnce(reply(owner)).mockRejectedValueOnce(Error('PRIVATE_LOGOUT_DETAIL'))
    const session = await passwordRecovery({ ...config, fetcher }).redeemRecoveryHash(proof)
    expect(await session.changePassword('new-synthetic-password')).toEqual({ refreshSessionsRevoked: false })
  })
  it('dispose clears token, prevents password and rejects a late verify result', async () => {
    const fetcher = granted(); const api = passwordRecovery({ ...config, fetcher }); const session = await api.redeemRecoveryHash(proof)
    api.dispose(); await expect(session.changePassword('new-synthetic-password')).rejects.toThrow('目前無法使用'); expect(fetcher).toHaveBeenCalledTimes(2)
    let finish!: (value: Response) => void
    const pending = vi.fn().mockReturnValue(new Promise<Response>(resolve => { finish = resolve }))
    const second = passwordRecovery({ ...config, fetcher: pending }); const promise = second.redeemRecoveryHash(proof)
    second.dispose(); finish(reply(verified)); await expect(promise).rejects.toThrow('目前無法使用'); expect(pending).toHaveBeenCalledOnce()
  })
})
