// Recovery is isolated from App/cloud/storage, normal cached Auth sessions and journal sync.
import { SUPABASE_URL } from './cloudConfig'

export const RECOVERY_REDIRECT_URL = 'https://yikeday.com/recover.html'
export const recoveryEnabled = () => import.meta.env.VITE_ACCOUNT_RECOVERY_ENABLED === 'true'
export interface RecoveryConfig {
  enabled: boolean
  url: string
  anonKey: string
  redirectTo: string
  fetcher?: typeof fetch
  now?: () => number
}
export interface RecoverySession {
  email: string
  changePassword: (password: string) => Promise<{ refreshSessionsRevoked: boolean }>
  dispose: () => void
}
export class RecoveryLinkExpiredError extends Error {
  constructor() { super('重設連結已失效或已使用，請重新申請。這次連結驗證沒有更新密碼。') }
}
export class RecoveryResultUnknownError extends Error {
  constructor() { super('密碼更新結果尚未確認。請先用新密碼登入；若無法登入，再重新申請重設連結。') }
}
export class RecoveryThrottleError extends Error {
  readonly retryAfterSeconds: number
  constructor(seconds: number) {
    super(`請等待 ${seconds} 秒後再試；請勿連續申請重設郵件。`)
    this.retryAfterSeconds = seconds
  }
}
const unavailable = () => new Error('自助密碼重設目前無法使用，請稍後再試或聯絡客服；不用重新購買。')
const HASH = /^[a-zA-Z0-9_-]{20,1024}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const validEmail = (s: string) => new TextEncoder().encode(s).byteLength <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

/** Remove all URL credentials before returning a single typed token. Never accept cached JWT/code. */
export function consumeRecoveryHash(hash: string, clearUrl: () => void, search = ''): string | null {
  clearUrl()
  if (search || hash.length > 4096) return null
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const keys = [...params.keys()]
  if (keys.some(k => k !== 'token_hash' && k !== 'type') || params.getAll('type').length !== 1 || params.get('type') !== 'recovery') return null
  const hashes = params.getAll('token_hash')
  return hashes.length === 1 && HASH.test(hashes[0]) ? hashes[0] : null
}
async function responseJson(res: Response): Promise<Record<string, unknown> | null> {
  if (!res.body) return null
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 256 * 1024) { await reader.cancel(); return null }
      text += decoder.decode(part.value, { stream: true })
    }
    text += decoder.decode()
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
  finally { reader.releaseLock() }
}

function verifiedUser(value: unknown): { id: string; email: string } | null {
  if (!value || typeof value !== 'object') return null
  const user = value as { id?: unknown; email?: unknown }
  if (typeof user.id !== 'string' || !UUID.test(user.id) || typeof user.email !== 'string' || !validEmail(user.email)) return null
  return { id: user.id, email: user.email }
}
function retryDelay(res: Response): number {
  const header = res.headers.get('Retry-After')
  const seconds = header && /^\d+$/.test(header) ? Number(header) : 60
  return Math.max(1, Math.min(Number.isSafeInteger(seconds) ? seconds : 60, 3600))
}

export function passwordRecovery(config: RecoveryConfig) {
  const fetcher = config.fetcher ?? fetch
  const now = config.now ?? Date.now
  const base = config.url.replace(/\/$/, '')
  const headers = { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}`, 'Content-Type': 'application/json' }
  let disposed = false
  let resetBusy = false
  let requestAfter = 0
  let verifyAttempted = false
  const disposers = new Set<() => void>()
  const ready = () => {
    if (disposed || !config.enabled || base !== SUPABASE_URL || config.redirectTo !== RECOVERY_REDIRECT_URL || !config.anonKey) throw unavailable()
  }
  const request = (path: string, init: RequestInit) => fetcher(`${base}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) })
  return {
    dispose: () => {
      disposed = true
      for (const dispose of disposers) dispose()
      disposers.clear()
    },
    requestReset: async (email: string): Promise<string> => {
      ready()
      const normalized = email.trim().toLowerCase()
      if (!validEmail(normalized)) throw new Error('請填寫開通帳號的 Email。')
      if (resetBusy || now() < requestAfter) throw new RecoveryThrottleError(Math.max(1, Math.ceil((requestAfter - now()) / 1000)))
      resetBusy = true
      // Local cooldown only prevents accidental repeated clicks; server/provider limits remain required.
      requestAfter = now() + 60_000
      try {
        const res = await request(`/auth/v1/recover?redirect_to=${encodeURIComponent(config.redirectTo)}`, {
          method: 'POST', headers, body: JSON.stringify({ email: normalized }),
        }).catch(() => { throw unavailable() })
        if (res.status === 429) {
          const seconds = retryDelay(res)
          requestAfter = Math.max(requestAfter, now() + seconds * 1000)
          throw new RecoveryThrottleError(seconds)
        }
        if (!res.ok) throw unavailable()
        return '如果這個 Email 已有帳號，會收到重設連結；請檢查開通時使用的信箱與垃圾郵件。'
      } finally { resetBusy = false }
    },
    redeemRecoveryHash: async (tokenHash: string): Promise<RecoverySession> => {
      ready()
      if (!HASH.test(tokenHash)) throw new Error('重設連結不完整，請重新申請。')
      if (verifyAttempted) throw new RecoveryLinkExpiredError()
      verifyAttempted = true // No automatic retry: timeout may already have consumed the one-time proof.
      const res = await request('/auth/v1/verify', {
        method: 'POST', headers, body: JSON.stringify({ token_hash: tokenHash, type: 'recovery' }),
      }).catch(() => { throw new Error('重設連結驗證結果尚未確認，連結可能已使用；請重新申請。') })
      if (res.status === 429) throw new RecoveryThrottleError(retryDelay(res))
      if ([400, 401, 403, 422].includes(res.status)) throw new RecoveryLinkExpiredError()
      if (!res.ok) throw unavailable()
      const result = await responseJson(res)
      const owner = verifiedUser(result?.user)
      if (!owner || typeof result?.access_token !== 'string' || !result.access_token || result.access_token.length > 16 * 1024) throw unavailable()
      let accessToken = result.access_token
      let state: 'ready' | 'busy' | 'closed' = 'ready'
      let changeAfter = 0
      const dispose = () => { accessToken = ''; state = 'closed'; disposers.delete(dispose) }
      disposers.add(dispose)
      if (disposed) { dispose(); throw unavailable() }
      const authHeaders = () => ({ ...headers, Authorization: `Bearer ${accessToken}` })
      // Bind the granted token to the same server user without loading a normal client/session.
      const current = await request('/auth/v1/user', { method: 'GET', headers: authHeaders() }).catch(() => null)
      const currentOwner = current?.ok ? verifiedUser(await responseJson(current)) : null
      if (!currentOwner || currentOwner.id !== owner.id || currentOwner.email.toLowerCase() !== owner.email.toLowerCase() || disposed) {
        dispose(); throw unavailable()
      }
      return {
        email: owner.email,
        dispose,
        changePassword: async (password: string) => {
          ready()
          if (state === 'closed' || !accessToken) throw new RecoveryLinkExpiredError()
          if (state === 'busy') throw new Error('正在更新密碼，請勿重複送出。')
          if (password.length < 8 || password.length > 128) throw new Error('新密碼需為 8–128 碼。')
          if (now() < changeAfter) throw new RecoveryThrottleError(Math.ceil((changeAfter - now()) / 1000))
          state = 'busy'
          const oneRequestHeaders = authHeaders()
          let changed: Response
          try {
            changed = await request('/auth/v1/user', { method: 'PUT', headers: oneRequestHeaders, body: JSON.stringify({ password }) })
          } catch { dispose(); throw new RecoveryResultUnknownError() }
          if (changed.status >= 500) { dispose(); throw new RecoveryResultUnknownError() }
          if (!changed.ok) {
            const detail = await responseJson(changed)
            if (changed.status === 429) { state = 'ready'; const seconds = retryDelay(changed); changeAfter = now() + seconds * 1000; throw new RecoveryThrottleError(seconds) }
            if (detail?.code === 'weak_password' || detail?.code === 'same_password') { state = 'ready'; throw new Error('新密碼未符合帳號安全規則，或與原密碼相同；請換一組新密碼再試。') }
            dispose(); throw new RecoveryLinkExpiredError()
          }
          const changedOwner = verifiedUser(await responseJson(changed))
          if (!changedOwner || changedOwner.id !== owner.id || changedOwner.email.toLowerCase() !== owner.email.toLowerCase()) {
            dispose(); throw new RecoveryResultUnknownError()
          }
          // Success and refresh-session revocation are separate. Old access JWTs expire normally.
          const loggedOut = await request('/auth/v1/logout?scope=global', { method: 'POST', headers: oneRequestHeaders }).catch(() => null)
          dispose()
          return { refreshSessionsRevoked: Boolean(loggedOut?.ok) }
        },
      }
    },
  }
}
