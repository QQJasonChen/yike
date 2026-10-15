import { useEffect, useRef, useState } from 'react'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './cloudConfig'
import {
  passwordRecovery, RECOVERY_REDIRECT_URL,
  RecoveryLinkExpiredError, RecoveryResultUnknownError, RecoveryThrottleError, type RecoverySession,
} from './passwordRecovery'

export interface RecoveryPageProps {
  enabled: boolean
  requestEnabled?: boolean
  hadUrlData?: boolean
  takeInitialToken?: () => string | null
  createRecovery?: () => ReturnType<typeof passwordRecovery>
}
export function RecoveryPage({ enabled, requestEnabled = true, hadUrlData = false, takeInitialToken, createRecovery }: RecoveryPageProps) {
  const makeApi = () => createRecovery?.() ?? passwordRecovery({ enabled, url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, redirectTo: RECOVERY_REDIRECT_URL })
  const [api, setApi] = useState(makeApi)
  const [pendingProof] = useState(() => ({ value: takeInitialToken?.() ?? null }))
  const currentSession = useRef<RecoverySession | null>(null)
  const acting = useRef(false)
  const [phase, setPhase] = useState<'request' | 'link' | 'password'>(pendingProof.value ? 'link' : 'request')
  const [session, setSession] = useState<RecoverySession | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [message, setMessage] = useState(hadUrlData && !pendingProof.value && enabled ? '這個連結不是有效的密碼重設連結，請重新申請。' : '')
  const alive = useRef(true)
  const epoch = useRef(0)
  const clearSession = () => { currentSession.current?.dispose(); currentSession.current = null; setSession(null); setPassword(''); setConfirm(''); setPhase('request') }

  useEffect(() => {
    alive.current = true
    const clear = () => { epoch.current++; acting.current = false; setBusy(false); pendingProof.value = null; currentSession.current?.dispose(); currentSession.current = null; api.dispose(); setSession(null); setEmail(''); setPassword(''); setConfirm(''); setPhase('request'); setMessage('重設工作階段已結束。若剛送出密碼更新，請先嘗試新密碼登入；否則請重新申請連結。') }
    const restore = (event: PageTransitionEvent) => { if (event.persisted) setApi(makeApi()) }
    window.addEventListener('pagehide', clear)
    window.addEventListener('pageshow', restore)
    return () => { alive.current = false; pendingProof.value = null; currentSession.current?.dispose(); api.dispose(); window.removeEventListener('pagehide', clear); window.removeEventListener('pageshow', restore) }
  // The provider is fixed for this page; bfcache creates a clean request-only instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, pendingProof])
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown(c => Math.max(0, c - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])
  const act = async () => {
    if (!enabled || acting.current || (phase === 'request' && (!requestEnabled || cooldown > 0))) return
    const operationEpoch = epoch.current
    acting.current = true; setBusy(true); setMessage('')
    try {
      if (phase === 'link') {
        const proof = pendingProof.value; pendingProof.value = null
        if (!proof) throw new RecoveryLinkExpiredError()
        const granted = await api.redeemRecoveryHash(proof)
        if (!alive.current || epoch.current !== operationEpoch) { granted.dispose(); return }
        currentSession.current = granted; setSession(granted); setPhase('password')
      } else if (phase === 'password' && session) {
        if (password !== confirm) throw new Error('兩次新密碼不一致，請重新確認。')
        const result = await session.changePassword(password)
        if (!alive.current || epoch.current !== operationEpoch) return
        clearSession()
        setMessage(result.refreshSessionsRevoked ? '密碼已更新。請回一刻手帳，以同一帳號和新密碼登入。' : '密碼已更新，登入續期撤銷的結果未確認。請以新密碼登入；如有帳號疑慮，請聯絡客服。')
      } else {
        setCooldown(60)
        const text = await api.requestReset(email)
        if (alive.current && epoch.current === operationEpoch) setMessage(text)
      }
    } catch (error) {
      if (!alive.current || epoch.current !== operationEpoch) return
      if (error instanceof RecoveryThrottleError) setCooldown(error.retryAfterSeconds)
      if (phase === 'link' || error instanceof RecoveryLinkExpiredError || error instanceof RecoveryResultUnknownError) clearSession()
      setMessage(error instanceof Error ? error.message : '目前無法完成，請稍後再試')
    } finally { if (epoch.current === operationEpoch) { acting.current = false; if (alive.current) setBusy(false) } }
  }
  return <main>
    <a className="brand" href="/">一刻手帳 Yike</a><h1>重設密碼</h1>
    {!enabled ? <p>自助密碼重設尚未開放。請聯絡客服協助核對帳號，不用重新購買，也不用提供密碼。</p> :
      phase === 'link' ? <p>這個連結只用於重設密碼。請按「繼續重設密碼」驗證連結；不要把連結轉寄給其他人。</p> :
      phase === 'password' && session ? <>
        <p>已驗證重設連結：{session.email}</p><p>此重設流程不會修改或刪除手帳。完成後請以同一帳號登入。</p>
        <label>新密碼<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} maxLength={128} disabled={busy}/></label>
        <label>再輸入一次新密碼<input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} maxLength={128} disabled={busy}/></label>
      </> : !requestEnabled ? <p>這次重設流程已結束。一般自助申請尚未開放；請回原信或由本人驗收人員確認下一步。</p> : <><p>填寫開通帳號的 Email，到自己的信箱開啟重設連結。</p>
        <label>Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} disabled={busy}/></label></>}
    {enabled && (phase !== 'request' || requestEnabled) && <button disabled={busy || cooldown > 0 || (phase === 'request' && !email.includes('@')) || (phase === 'password' && (password.length < 8 || !confirm))} onClick={() => void act()}>
      {busy ? '處理中⋯' : cooldown > 0 ? `請等待 ${cooldown} 秒` : phase === 'link' ? '繼續重設密碼' : phase === 'password' ? '更新密碼' : '寄送重設連結'}
    </button>}
    <p role="status">{message}</p>
    {enabled && <p className="note">更改密碼後，其他裝置目前的登入可能在登入期限到期前仍有效。</p>}
    <p><a href="mailto:qqleveragelearning@gmail.com">聯絡客服</a> · <a href="/">回一刻手帳</a></p>
  </main>
}
