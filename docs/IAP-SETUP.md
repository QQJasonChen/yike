# iOS 內購（IAP）組裝手冊 — 買斷「雲端同步」

> 目的（QQ 原話）：付費主要不是賺錢，是想知道**有多少人願意付費**。
> 程式碼已全寫好：`src/iap.ts`＋`src/iapConfig.ts`＋`src/IapPanel.tsx`（已接進設定頁）＋`supabase/functions/iap-activate/`。
> 用 RevenueCat（免手刻收據驗證/恢復購買/退款處理；免費額度月營收 $2,500 內）。
> 剩下的是「帳號類」步驟只有你能做，照順序約 40 分鐘。

## 架構一句話
App 內 Apple IAP 買斷（$11.99）→ RevenueCat 驗證收據 → `iap-activate` edge function 確認 entitlement → 建 Supabase 帳號 → 登入同步。跟 Gumroad 序號（web）是**平行的第三條開通路**，互不干擾。

---

## 步驟 1：App Store Connect 建 IAP 商品 🙋
1. App Store Connect → 一刻手帳 → 左側 **In-App Purchases** → ➕
2. 類型選 **Non-Consumable**（非消耗型＝買斷）
3. Product ID：**`yike_sync_lifetime`**（一字不差，跟 iapConfig.ts 一致）
4. Reference Name：`雲端同步買斷`；價格選 **US$11.99** 那階（Tier 對齊 web 的 $12）
5. 填 Display Name（雲端同步）＋描述＋**上一張截圖**（設定頁同步區截圖即可）→ 存檔
   （IAP 商品會跟著下一次 app 送審一起審）

## 步驟 2：RevenueCat 帳號與專案 🙋
1. 註冊 https://app.revenuecat.com（免費）→ New Project「Yike」
2. **Apps → ➕ App Store**：填 Bundle ID `com.qqchen.inkday`；照它指引上傳 **App Store Connect API key**（它要用來讀交易）＋ **In-App Purchase Key**
3. **Entitlements → ➕**：identifier 填 **`sync`**（一字不差）
4. **Products → ➕**：import `yike_sync_lifetime` → attach 到 entitlement `sync`
5. **Offerings**：default offering 加一個 package 裝 `yike_sync_lifetime`
6. 拿兩把 key：
   - **Public API key（appl_ 開頭）**→ 貼進 `src/iapConfig.ts` 的 `REVENUECAT_APPLE_API_KEY`（可進 repo）
   - **Secret key（sk_ 開頭）**→ 只進 Supabase：
     ```bash
     supabase secrets set REVENUECAT_SECRET=sk_xxx
     ```

## 步驟 3：部署 edge function 🙋
```bash
cd ~/Projects/productivity-planner
supabase functions deploy iap-activate --no-verify-jwt
```

## 步驟 4：iOS 打包 🙋
```bash
npm run build:ios   # 會自動 cap sync（RevenueCat pod 一起裝進去）
```
Xcode 開 `ios/App/App.xcworkspace` → 版本 bump（build 6）→ 真機跑。
> 若 pod 沒進來：`cd ios/App && pod install`。

## 步驟 5：Sandbox 測試 🙋
1. App Store Connect → Users and Access → **Sandbox Testers** → 建一個測試 Apple ID
2. iPhone 設定 → App Store → 沙盒帳號 登入那個測試帳號
3. App 設定頁 → 應出現「☁️ 解鎖雲端同步 US$11.99」→ 購買（沙盒不會真扣款）→ 設帳密 → 確認同步開通
4. 刪 app 重裝 → 「恢復購買」→ 應能重新開通

## 步驟 6：送審策略 🙋（配合現在的 2.1(b) hold）
1. **先回覆** Apple 那 5 題（`~/Downloads/yike-上架素材/01_App_Store_文字/05_Apple_2.1b_回覆.txt`），並在結尾加一句：
   > Additionally, to make this even clearer, our next build adds an In-App Purchase option so users can also unlock cloud sync directly inside the app.
2. 上傳 build 6 → 版本頁把 build 換成 6 → IAP 商品勾進這次送審 → Resubmit

## 觀察「多少人願意付費」在哪看
- RevenueCat Dashboard：轉換率、交易數、營收（這就是你要的答案）
- Gumroad 後台：web 端付費數
- 兩邊相加 = 總付費意願訊號

## 已寫好的防呆
- web / 沒填 key：IAP 介面**整個隱藏**，現有網頁與 Gumroad 流程零影響
- 開通冪等：同 email 重複開通回「已開通過，直接登入」
- 伺服器端驗證：edge function 用 secret key 向 RevenueCat 查 entitlement，前端偽造無效
- 恢復購買：Apple 硬性要求，已內建
