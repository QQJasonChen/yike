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

  it("returns 'up' when account does not exist and public signup is open", async () => {
    auth.signInWithPassword.mockResolvedValueOnce({
      error: { message: 'Invalid login credentials' },
    })
    auth.signUp.mockResolvedValueOnce({ data: { session: {} }, error: null })
    await expect(signInOrUp('new@b.com', 'password123')).resolves.toBe('up')
  })

  it("returns 'up' via the paid whitelist when signup is disabled but email is entitled", async () => {
    // initial sign-in fails (no account), then activateLicense's sign-in succeeds
    auth.signInWithPassword
      .mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } })
      .mockResolvedValueOnce({ error: null })
    auth.signUp.mockResolvedValueOnce({
      data: {},
      error: { message: 'Signups not allowed for this instance' },
    })
    fetchMock.mockResolvedValueOnce(okJson({ ok: true })) // activate succeeds
    await expect(signInOrUp('buyer@b.com', 'password123')).resolves.toBe('up')
  })

  it('throws a friendly 尚未開通 message when email is not entitled', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({
      error: { message: 'Invalid login credentials' },
    })
    auth.signUp.mockResolvedValueOnce({
      data: {},
      error: { message: 'Signups not allowed for this instance' },
    })
    fetchMock.mockResolvedValueOnce(okJson({ error: 'not-entitled' }, false, 403))
    await expect(signInOrUp('stranger@b.com', 'password123')).rejects.toThrow(/尚未開通/)
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

describe('activateWithCode 空序號（買家用購買 Email 開通）', () => {
  it("留空序號時走白名單，開通成功回 'up'", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ ok: true }))
    auth.signInWithPassword.mockResolvedValueOnce({ error: null })
    await expect(activateWithCode('', 'buyer@b.com', 'password123')).resolves.toBe('up')
    // 送給 activate 的 licenseKey 必須是空字串，才會命中 edge function 的白名單路徑
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.licenseKey).toBe('')
    expect(body.email).toBe('buyer@b.com')
  })

  it('只打空白也視為留空', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ ok: true }))
    auth.signInWithPassword.mockResolvedValueOnce({ error: null })
    await expect(activateWithCode('   ', 'buyer@b.com', 'password123')).resolves.toBe('up')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).licenseKey).toBe('')
  })

  it('沒買過時給看得懂的指引，不是丟 not-entitled', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ error: 'not-entitled' }, false, 403))
    await expect(activateWithCode('', 'nobody@b.com', 'password123')).rejects.toThrow(
      /購買時填的那個 Email/
    )
  })

  it('有填序號時照舊走 Gumroad 驗證', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ ok: true }))
    auth.signInWithPassword.mockResolvedValueOnce({ error: null })
    await expect(activateWithCode('QQVIP', 'friend@b.com', 'password123')).resolves.toBe('up')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).licenseKey).toBe('QQVIP')
  })
})
