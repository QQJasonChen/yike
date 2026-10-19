import { SUPABASE_URL, SUPABASE_ANON_KEY } from './cloudConfig'
import { passwordRecovery, RECOVERY_REDIRECT_URL } from './passwordRecovery'

/** A canary may redeem mail proof, never request mail or touch a normal session. */
export function proofOnlyFetch(fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    const sameProject = url.origin === SUPABASE_URL && !url.hash
    const allowed = !url.search && (
      (url.pathname === '/auth/v1/verify' && method === 'POST') ||
      (url.pathname === '/auth/v1/user' && (method === 'GET' || method === 'PUT'))
    ) || (url.pathname === '/auth/v1/logout' && url.search === '?scope=global' && method === 'POST')
    if (!sameProject || !allowed) throw new Error('這個受控頁面不能申請或寄送重設郵件。')
    return fetcher(input, init)
  }
}
export function makeProofOnlyRecovery(enabled: boolean, fetcher: typeof fetch = fetch) {
  const api = passwordRecovery({ enabled, url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY,
    redirectTo: RECOVERY_REDIRECT_URL, fetcher: proofOnlyFetch(fetcher) })
  return { dispose: api.dispose, redeemRecoveryHash: api.redeemRecoveryHash,
    requestReset: async () => { throw new Error('一般自助申請尚未開放。') } }
}
