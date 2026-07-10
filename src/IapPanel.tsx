// iOS 內購面板：買斷「雲端同步」→ 設帳號 → 自動登入同步。
// 只在原生 iOS 且 RevenueCat 已設定時渲染（web / 未設定 = null，不影響任何現有畫面）。
// Apple 合規：含「恢復購買」；價格用商店在地化字串。

import { useEffect, useState } from 'react'
import { signInOrUp, startAutoSync, syncNow } from './cloud'
import { SyncOffer, activateWithIap, getSyncOffer, hasSyncEntitlement, iapAvailable, purchaseSync, restoreSync } from './iap'

interface Props {
  /** 已登入雲端時不顯示（由父層傳入目前登入狀態） */
  signedIn: boolean
}

export default function IapPanel({ signedIn }: Props) {
  const [offer, setOffer] = useState<SyncOffer | null>(null)
  const [owned, setOwned] = useState(false)
  const [appUserId, setAppUserId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!iapAvailable() || signedIn) return
    void getSyncOffer().then(setOffer)
    void hasSyncEntitlement().then(setOwned)
  }, [signedIn])

  if (!iapAvailable() || signedIn || (!offer && !owned)) return null

  const run = async (act: () => Promise<void>) => {
    setBusy(true)
    setMsg('')
    try {
      await act()
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : '失敗'}`)
    } finally {
      setBusy(false)
    }
  }

  const buy = () =>
    run(async () => {
      const id = await purchaseSync()
      if (!id) return // 使用者取消
      setAppUserId(id)
      setOwned(true)
      setMsg('✓ 購買完成！設一組帳密，開通跨裝置同步：')
    })

  const restore = () =>
    run(async () => {
      const id = await restoreSync()
      if (!id) {
        setMsg('這個 Apple ID 沒有找到先前的購買記錄')
        return
      }
      setAppUserId(id)
      setOwned(true)
      setMsg('✓ 已恢復購買！設定（或輸入原本的）帳密開通：')
    })

  const activate = () =>
    run(async () => {
      if (!appUserId) {
        // 冷啟動時已擁有但還沒拿 id：從恢復流程補
        const id = await restoreSync()
        if (!id) throw new Error('請先點「恢復購買」')
        setAppUserId(id)
      }
      if (!email.includes('@')) throw new Error('請填 Email')
      if (pw.length < 8) throw new Error('密碼至少 8 碼')
      await activateWithIap(appUserId ?? '', email, pw)
      await signInOrUp(email, pw)
      const r = await syncNow()
      await startAutoSync()
      setMsg(`✓ 開通成功，已同步（↓${r.pulled} ↑${r.pushed}）`)
      setTimeout(() => location.reload(), 1200)
    })

  return (
    <div className="sync-box" style={{ marginTop: 10 }}>
      {!owned ? (
        <>
          <p className="sync-help">
            <b>跨裝置雲端同步</b>——手機、電腦、iPad 自動同步你的手帳。買斷制，一次付費、永久使用、含未來更新。
          </p>
          <div className="data-actions" style={{ marginTop: 10 }}>
            <button disabled={busy} onClick={buy}>
              {busy ? '處理中⋯' : `☁️ 解鎖雲端同步 ${offer?.priceString ?? ''}`}
            </button>
            <button className="link-btn" disabled={busy} onClick={restore}>
              恢復購買
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="sync-help">
            <b>雲端同步已解鎖</b>——設一組 Email＋密碼（換裝置就用它登入）：
          </p>
          <div className="line-input sync-token">
            <input
              type="email"
              placeholder="你的 Email"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim())}
            />
          </div>
          <div className="line-input sync-token">
            <input
              type="password"
              placeholder="自設密碼（至少 8 碼，請記好）"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </div>
          <div className="data-actions" style={{ marginTop: 12 }}>
            <button disabled={busy} onClick={activate}>
              {busy ? '處理中⋯' : '開通並登入'}
            </button>
          </div>
        </>
      )}
      {msg && <p className="sync-help">{msg}</p>}
    </div>
  )
}
