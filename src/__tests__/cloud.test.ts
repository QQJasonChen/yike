import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the supabase client so we can drive auth behaviour deterministically
const auth = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth }),
}))

import { activateLicense, activateWithCode, signInOrUp } from '../cloud'

const fetchMock = vi.fn()
beforeEach(() => {
  auth.signInWithPassword.mockReset()
  auth.signUp.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

const okJson = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
})

describe('signInOrUp', () => {
  it("returns 'in' when an existing account signs in", async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: null })
    await expect(signInOrUp('a@b.com', 'password123')).resolves.toBe('in')
  })

  it('invalid credentials do not register an account or use a paid Email whitelist', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } })
    await expect(signInOrUp('buyer@b.com', 'password123')).rejects.toThrow(/Email 或密碼不正確/)
    expect(auth.signUp).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects when sign-in errors for a non-credential reason', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({
      error: { message: 'network down' },
    })
    await expect(signInOrUp('a@b.com', 'password123')).rejects.toThrow(/network down/)
  })
})

describe('activateLicense', () => {
  it('activates then signs in on success', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ ok: true }))
    auth.signInWithPassword.mockResolvedValueOnce({ error: null })
    await expect(activateLicense('LIC-123', 'buyer@b.com', 'password123')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('throws the server error when activation fails', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ error: '序號無效' }, false, 403))
    await expect(activateLicense('BAD', 'buyer@b.com', 'password123')).rejects.toThrow(/序號無效/)
  })
})

describe('activateWithCode 購買證明', () => {
  it.each(['', '   '])('空序號 %j 不得只憑 Email 建立帳號', async (code) => {
    await expect(activateWithCode(code, 'buyer@b.com', 'password123')).rejects.toThrow(/購買序號/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('非空購買序號交給伺服器驗證，不走公開註冊', async () => {
    const code = 'SOME-CODE'
    fetchMock.mockResolvedValueOnce(okJson({ ok: true }))
    auth.signInWithPassword.mockResolvedValueOnce({ error: null })
    await expect(activateWithCode(code, 'friend@b.com', 'password123')).resolves.toBe('up')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).licenseKey).toBe(code)
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('舊共用邀請碼不能繞過伺服器驗證建立帳號', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ error: '共用邀請碼已停止開通新帳號' }, false, 403))
    await expect(activateWithCode('QQ', 'friend@b.com', 'password123')).rejects.toThrow(/停止開通/)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).licenseKey).toBe('QQ')
    expect(auth.signUp).not.toHaveBeenCalled()
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })
})
