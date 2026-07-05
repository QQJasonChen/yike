# iOS Widget 組裝手冊（v1.1 招牌功能）

> 程式碼已全部寫好：JS 橋 `src/widgetSync.ts`（已接進 main.tsx）、原生橋 `ios/App/App/WidgetBridgePlugin.swift`、widget 本體 `ios/YikeWidget/`（4 個 Swift 檔）。
> 剩下的是 Xcode GUI 操作（簽章/target 只能人做），照下面點，約 15 分鐘。
> 三個 widget：**今天的一刻**（主畫面小格＋鎖定畫面）／**今日時間軸**（中/大）／**本週規劃**（中/大）。

## 運作原理（30 秒版）
你在 app 寫手帳 → 切到背景的瞬間，JS 把「今天＋本週」快照經 WidgetBridge 寫進 **App Group** 共享容器 → WidgetKit 讀快照重畫。widget 端不碰 localStorage、不連網。

---

## 步驟 1：建 Widget Extension target 🙋
1. 開 `ios/App/App.xcworkspace`
2. **File → New → Target…** → 搜 **Widget Extension** → Next
3. Product Name：**`YikeWidget`**（一定要這個名，跟檔案對齊）
4. ✅ Team 選你的（BMWG6W32NK）；**取消勾** "Include Configuration App Intent"（我們用 StaticConfiguration）
5. Finish → 跳出 "Activate scheme?" → **Activate**
6. 選 YikeWidget target → General → **Minimum Deployments 改 iOS 17.0**

## 步驟 2：兩個 target 都掛 App Group 🙋（資料橋的關鍵）
對 **App** 和 **YikeWidget** 兩個 target 各做一次：
1. 選 target → **Signing & Capabilities** → **+ Capability** → **App Groups**
2. 按 App Groups 區塊裡的 **+** → 輸入 **`group.com.qqchen.inkday`**（一字不差）
3. Xcode 會自動幫你到開發者網站註冊並更新 provisioning——需要登入你的 Apple ID
> ⚠️ 名稱打錯 = widget 永遠空白。程式碼裡寫死這個字串（WidgetBridgePlugin.swift 和 Model.swift 各一處）。

## 步驟 3：換上寫好的程式碼 🙋
1. 在 Xcode 左側 Project navigator，展開 **YikeWidget** group → 刪掉 Xcode 生成的範本 `YikeWidget.swift`（其他 Info.plist / Assets 留著）
2. 開 Finder 到 `ios/YikeWidget/`，把 **4 個 .swift 檔**（YikeWidgetBundle / Model / TodayWidget / TimelineWidget / WeekWidget…共 4 檔）拖進 Xcode 的 YikeWidget group
   - 跳出對話框：✅ Copy items if needed 不勾也行（已在 repo 內）、**Target 勾 YikeWidget**（只勾這個）
3. 把 `ios/App/App/WidgetBridgePlugin.swift` 拖進 **App** group（App/App 底下）
   - Target 勾 **App**（只勾這個）

## 步驟 4：重 build web + sync 🙋
```bash
cd ~/Projects/productivity-planner
npm run build:ios     # CAP_BUILD=1 vite build && cap sync ios（把 widgetSync.ts 打進 app）
```

## 步驟 5：真機驗收 🙋
1. Xcode scheme 選 **App**，跑到你的 iPhone
2. 開 app → 寫一個 MIT、排 1-2 個時間塊 → **回主畫面**（觸發推快照）
3. 主畫面長按 → 編輯 → ➕ → 搜「一刻」→ 加「今天的一刻」小格
4. 應該看到你剛寫的 MIT + 塗圈。再加「今日時間軸」（中格）和「本週規劃」試試
5. 鎖定畫面：長按鎖定畫面 → 自訂 → 加 widget → 選「一刻手帳」矩形

**驗收清單**
- [ ] 小格顯示 MIT + 塗圈；app 裡塗一圈 → 回主畫面 → widget 幾秒內更新
- [ ] 時間軸中格顯示接下來的塊、進行中的塊有金點
- [ ] 本週格顯示 7 天 MIT，今天那行金色
- [ ] 鎖定畫面矩形有 MIT
- [ ] 跨日後（隔天早上）widget 顯示空狀態引導語，不是昨天的 MIT

## 步驟 6：上 TestFlight（要發布時）🙋
1. App target → General → **Build 號 +1**（下一個是 6；MARKETING_VERSION 改 1.1）
2. YikeWidget target 的版本號跟主 app 一致
3. Archive → Distribute → Upload（跟之前一樣）

---

## 疑難排解
| 症狀 | 原因 → 解法 |
|------|------------|
| widget 一直是預覽假資料 | app 還沒推過快照 → 開 app 寫點東西再回主畫面 |
| widget 永遠空白 | App Group 名稱打錯或只掛了一個 target → 兩個 target 都檢查 `group.com.qqchen.inkday` |
| 編譯錯 `containerBackground` | YikeWidget target 的 Minimum Deployments 不是 17.0 → 改 |
| JS 呼叫沒反應 | 忘了 `npm run build:ios` 重 sync → 步驟 4 |
| 隔天顯示昨天資料 | 不會——快照帶日期，非今天就顯示空狀態（Model.swift 的 load() 有擋） |
