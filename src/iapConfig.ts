// RevenueCat 設定（iOS In-App Purchase）
// ⚠️ 這是「公開」SDK key（apple 平台的 public API key，rcb_ 開頭）——可以進 repo，
//    跟 Supabase anon key 同性質。「秘密」key（sk_）只放 Supabase secrets，絕不進前端。
// 填法見 docs/IAP-SETUP.md 步驟 2。留空 = IAP 功能整個隱藏（web / 還沒設定時安全）。

export const REVENUECAT_APPLE_API_KEY = '' // TODO: 貼 RevenueCat 的 Apple 平台 Public API key（appl_ 開頭）

/** RevenueCat 上定義的「買斷雲端同步」entitlement 識別碼（跟 dashboard 一致） */
export const ENTITLEMENT_SYNC = 'sync'

/** App Store Connect 上的 IAP 商品 ID（非消耗型） */
export const PRODUCT_SYNC_LIFETIME = 'yike_sync_lifetime'

export const iapConfigured = (): boolean => REVENUECAT_APPLE_API_KEY.startsWith('appl_')
