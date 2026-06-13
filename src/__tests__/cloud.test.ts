import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the supabase client so we can drive auth behaviour deterministically
const auth = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth }),
}))

import { activateLicense, signInOrUp } from '../cloud'

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
