// iOS In-App Purchase（RevenueCat）：買斷「雲端同步」。
// 只在原生 iOS、已設定 key 且購買歸屬驗證協定完成後生效；目前安全停用。
// 流程：purchase() 成功 → 拿 appUserId → iap-activate edge function 驗證 entitlement → 建 Supabase 帳號 → 登入同步。
// 設定步驟：docs/IAP-SETUP.md

import { Capacitor } from '@capacitor/core'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './cloudConfig'
import { ENTITLEMENT_SYNC, IAP_ACTIVATION_READY, REVENUECAT_APPLE_API_KEY, iapConfigured } from './iapConfig'

/** A configured SDK alone is insufficient while server activation is closed. */
export const iapAvailable = (): boolean => IAP_ACTIVATION_READY && Capacitor.isNativePlatform() && iapConfigured()
const requireAvailable = (): void => {
  if (!iapAvailable()) throw new Error('App 內購新帳號開通尚未開放。已有 Yike 帳號請直接登入；已付款者請聯絡客服核對，不必重新購買。')
}

type PurchasesModule = typeof import('@revenuecat/purchases-capacitor')

let purchasesPromise: Promise<PurchasesModule['Purchases']> | null = null

/** 動態載入並初始化 RevenueCat（只跑一次） */
const rc = (): Promise<PurchasesModule['Purchases']> => {
  requireAvailable()
  if (!purchasesPromise) {
    purchasesPromise = import('@revenuecat/purchases-capacitor').then(async ({ Purchases, LOG_LEVEL }) => {
      await Purchases.setLogLevel({ level: LOG_LEVEL.WARN })
      await Purchases.configure({ apiKey: REVENUECAT_APPLE_API_KEY })
      return Purchases
    })
  }
  return purchasesPromise
}

export interface SyncOffer {
  priceString: string // 例 "US$11.99"（商店在地化價格）
  title: string
}

/** 讀商店價格（顯示在購買按鈕上）。拿不到回 null（UI 隱藏購買區塊）。 */
export const getSyncOffer = async (): Promise<SyncOffer | null> => {
  if (!iapAvailable()) return null
  try {
    const P = await rc()
    const { current } = await P.getOfferings()
    const pkg = current?.availablePackages?.[0]
    if (!pkg) return null
    return { priceString: pkg.product.priceString, title: pkg.product.title }
  } catch {
    return null
  }
}

/** 是否已擁有 sync entitlement（買過/已恢復） */
export const hasSyncEntitlement = async (): Promise<boolean> => {
  if (!iapAvailable()) return false
  try {
    const P = await rc()
    const { customerInfo } = await P.getCustomerInfo()
    return Boolean(customerInfo.entitlements.active[ENTITLEMENT_SYNC])
  } catch {
    return false
  }
}

/** 發起購買。回傳 RevenueCat appUserId（開通帳號用）；使用者取消回 null，其他錯誤丟出。 */
export const purchaseSync = async (): Promise<string | null> => {
  requireAvailable()
  const P = await rc()
  const { current } = await P.getOfferings()
  const pkg = current?.availablePackages?.[0]
  if (!pkg) throw new Error('商店暫時讀不到商品，請稍後再試')
  try {
    const { customerInfo } = await P.purchasePackage({ aPackage: pkg })
    if (!customerInfo.entitlements.active[ENTITLEMENT_SYNC]) throw new Error('購買未完成')
    return customerInfo.originalAppUserId
  } catch (e) {
    // 使用者主動取消不是錯誤
    const err = e as { userCancelled?: boolean; message?: string }
    if (err.userCancelled) return null
    throw new Error(err.message ?? '購買失敗，請稍後再試')
  }
}

/** 恢復購買（Apple 規定必備）。回傳 appUserId（有 entitlement 時）或 null。 */
export const restoreSync = async (): Promise<string | null> => {
  requireAvailable()
  const P = await rc()
  const { customerInfo } = await P.restorePurchases()
  return customerInfo.entitlements.active[ENTITLEMENT_SYNC] ? customerInfo.originalAppUserId : null
}

/** 購買後開通：edge function 驗 RevenueCat entitlement → 建 Supabase 帳號（冪等，已存在回 409 訊息） */
export const activateWithIap = async (appUserId: string, email: string, password: string): Promise<void> => {
  requireAvailable()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/iap-activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ appUserId, email, password }),
  })
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  if (!res.ok || !body.ok) throw new Error(body.error ?? `開通失敗（${res.status}）`)
}
