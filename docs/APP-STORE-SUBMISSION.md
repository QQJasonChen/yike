# 一刻手帳 Yike — App Store 上架超詳細教學

> 給 QQ 的逐步 runbook。✅ = 我已幫你寫好的程式；🙋 = 需要你親手做的（簽章/帳號/GUI 只能你來）。
> 照順序做。每一步都有「為什麼」「指令/點哪裡」「怎麼確認成功」。
> App 資訊：bundle `com.qqchen.inkday`・團隊 BMWG6W32NK・App Store Connect app id **6782070273**（名稱「一刻手帳」）・Supabase 專案 `ofhupqifavtafiylehkj`。

---

## 階段 0：我已經幫你寫好的（程式部分）✅

- ✅ **帳號刪除**：edge function `supabase/functions/delete-account/`、`cloud.ts > deleteAccount()`、設定頁「永久刪除帳號」按鈕（輸入 Email 二次確認 → 刪雲端+本機）
- ✅ **隱私政策頁**：`public/privacy.html`（上線後網址 = https://yikeday.com/privacy.html）

這兩個 commit 推上去後，**網頁端的隱私政策頁會自動部署**。但 edge function 要你跑一行指令部署（見階段 1），因為部署需要你的 Supabase 登入權限。

---

## 階段 1：部署帳號刪除 edge function 🙋

**為什麼**：刪帳號要用 service role 權限刪 auth 使用者，只能跑在雲端 function，且部署要你的帳號權限。

**指令**（在專案根目錄 `~/Projects/productivity-planner`，終端機輸入；登入會開瀏覽器）：
```bash
# 1. 安裝 Supabase CLI（若還沒裝）
brew install supabase/tap/supabase

# 2. 登入（會開瀏覽器授權）
supabase login

# 3. 連到你的專案
supabase link --project-ref ofhupqifavtafiylehkj

# 4. 部署刪帳號 function
supabase functions deploy delete-account
```

> 不用另外設 secret——`SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY` 是 Supabase 平台自動注入的。

**怎麼確認成功**：終端機顯示 `Deployed Function delete-account`。
或到 Supabase Dashboard → Edge Functions，看到 `delete-account` 在列表。

**端到端驗證（強烈建議做一次）**：
1. 用一個測試 Email 在 app 註冊登入
2. 寫幾筆資料 → 確認有同步
3. 設定 → 「永久刪除帳號」→ 輸入該 Email 確認
4. 應該回到空白頁，且該 Email **無法再用舊密碼登入**（帳號真的被刪了）
5. 到 Supabase Dashboard → Authentication → Users，確認該使用者消失

---

## 階段 2：確認隱私政策頁上線 🙋（很快）

**為什麼**：App Store Connect 要填「Privacy Policy URL」，網址必須真的打得開。

**怎麼做**：階段 0 的 commit push 後，GitHub Actions 會自動部署。等幾分鐘後打開：
```
https://yikeday.com/privacy.html
```
**怎麼確認成功**：頁面正常顯示「隱私政策」全文。把這個網址記下來，階段 5 要填。

---

## 階段 3：打包新的 iOS build（build 5）🙋

**為什麼**：手機現在跑 build 4（舊），這波所有新功能（同步閘門/備份/通知/筆記/提醒/新編輯器/帳號刪除）都還沒進可送審的 build。

**步驟**：
1. 先確認最新程式已進原生（我每次都有 `npx cap copy ios`，但保險起見再跑一次）：
   ```bash
   cd ~/Projects/productivity-planner
   CAP_BUILD=1 npm run build && npx cap copy ios
   ```
2. 開 Xcode：
   ```bash
   npx cap open ios
   ```
3. Xcode 裡：
   - 左側點 **App** target → **General** → 把 **Build** 從 4 改成 **5**（Version 維持 1.0）
   - 上方裝置選單選 **Any iOS Device (arm64)**（不是模擬器）
   - 選單 **Product → Archive**（會跑幾分鐘）
4. Archive 完成 → Organizer 視窗自動跳出 → 選最新那個 archive → **Distribute App** → **App Store Connect** → **Upload** → 一路 Next（簽章選自動）→ Upload。

**怎麼確認成功**：Organizer 顯示上傳成功；約 10–30 分鐘後 App Store Connect → TestFlight 會看到 build 5「處理中→可用」。

> 若跳「DistributionAppRecordProviderError」：通常是 Xcode 驗證競態，重試一次 Upload 即可。

**建議**：先把 build 5 丟 **TestFlight**，自己手機裝起來，把階段 6 的測試清單跑過一遍，沒問題再送審。

---

## 階段 4：準備上架素材 🙋

審核前要備齊這些（在 App Store Connect → 你的 app → 左側）：

### 4.1 截圖（必備）
- **iPhone 6.7"**（1290 × 2796 px）：至少 **3 張**，最多 10 張 ← 一定要
- 若有支援 iPad，也要一組 iPad 13" 截圖
- 內容：今天頁、週/月、回顧、時程或願景——挑最有質感的
- （我這邊機器負載降下來後可以幫你把網頁版截圖拍好、裁成手機比例給你，或你直接用手機截圖最真實）

### 4.2 文字素材
- **App 名稱**：一刻手帳 Yike（已定）
- **副標題**（30 字內）：例「每天，刻下一件最重要的事」
- **描述**（可直接用下面這版）：

```
一刻手帳 Yike — 紙本手帳質感的每日專注手帳。

待辦清單永遠做不完，是因為什麼都「重要」。一刻手帳每天先讓你選一件最重要的事，專注、塗圈、反思——其他的，等它做完再說。

• 最重要任務（MIT）：每天先回答「就算只做成這件也值得」
• Focus 計時器：番茄鐘 + 稿紙式塗圈，計畫 vs 實際自動對照
• 彩色時間軸：拖拉排程，每個時間塊可寫筆記、設開始前提醒
• 七個尺度：日 → 週 → 月 → 季 → 年 → 願景 → 回顧，層層向上對齊
• 手寫：用 Apple Pencil 或手指，在反思與便箋上手寫
• 全域搜尋：一鍵搜遍所有記錄，複製給 AI 分析
• 資料屬於你：本機優先，可選雲端同步，每日自動備份

從今天到十年，一天一刻，刻下你真正重要的事。
```

- **關鍵字**（100 字內，逗號分隔）：例
  `手帳,專注,番茄鐘,待辦,日記,習慣,計畫,生產力,反思,時間管理,journal,focus`
- **分類**：主要 = 生產力工具（Productivity）；次要 = 健康與健身 或 生活風格
- **Support URL**：`https://yikeday.com`
- **Privacy Policy URL**：`https://yikeday.com/privacy.html`（階段 2 那個）

---

## 階段 5：App Store Connect 填寫（審核必過的關鍵）🙋

### 5.1 App Privacy（資料蒐集宣告）← 不填會被退
左側 **App Privacy** → Get Started，照這樣填：

- **Data Types 勾選**：
  - **Contact Info → Email Address**（因為雲端同步用 Email 當帳號）
  - **User Content → Other User Content**（你的手帳內容）
- 每一項的用途都選：
  - Purpose：**App Functionality**（只用於功能，不是廣告/分析）
  - Linked to the user：**Yes**（綁在帳號上）
  - Used for tracking：**No**（我們完全不追蹤）
- 其餘類別（位置、聯絡人、相機、廣告 ID…）：**全部不勾**

> 誠實依據：本服務預設純本機；只有開雲端同步才收 Email + 內容，且只用於同步，不追蹤、不販售（已寫進隱私政策）。

### 5.2 App Review Information（給審核員）← 不給帳號會被退
- **Sign-in required**：是
- 提供 **demo 帳號**：建一個測試帳號（Email + 密碼）填進去；或在 Notes 寫：
  ```
  本 app 預設免帳號即可使用所有功能（資料存本機）。
  雲端同步為選配。測試帳號：
  Email: <你建的測試帳號>
  Password: <密碼>
  邀請碼（如需自建帳號）：QQ
  ```
- **Notes** 補一句：「日記資料預設只存在裝置本機；雲端同步為使用者選配功能。」

### 5.3 其他
- 上傳階段 4 的截圖、描述、關鍵字、分類、兩個 URL
- **Build**：選階段 3 上傳的 build 5
- **Age Rating**：照問卷填（大多選「無」→ 4+）
- **Export Compliance / 加密**：選「不使用非豁免加密」（程式已設 ITSAppUsesNonExemptEncryption=false，通常不會再問）

---

## 階段 6：送審前自我測試清單 🙋

用 TestFlight build 5 在**真機**跑一遍，全過再送審：

- [ ] 不登入也能正常用（寫任務、塗圈、反思、時間軸）
- [ ] 登入 → 寫資料 → 另一台/網頁登入同帳號 → 資料同步出現
- [ ] **資料消失情境**：兩台都登入、其中一台清掉重開 → 從雲端拉回、另一台資料還在（驗證同步閘門）
- [ ] 時間塊設提醒 → 關 app → 到點有通知
- [ ] 設定 →「資料備份」看得到每日快照，能還原
- [ ] **設定 →「永久刪除帳號」→ 帳號真的被刪、登不回去**（這條審核員會測）
- [ ] 打中文不會跳到下一欄
- [ ] 隱私政策 URL 打得開

---

## 階段 7：送審
App Store Connect → 你的 app 版本頁 → 右上 **Add for Review / Submit for Review**。
審核通常 1–3 天。被退會收信說原因，對照下面常見退件原因修。

---

## 常見退件原因 & 對策

| 退件原因 | 對策 |
|---|---|
| 沒有帳號刪除功能（5.1.1(v)） | ✅ 已做。確認階段 1 function 有部署、按鈕能用 |
| 沒填/填錯 App Privacy | 照 5.1 填，誠實對應隱私政策 |
| 審核員進不去（無 demo 帳號） | 照 5.2 給測試帳號 |
| 隱私政策 URL 打不開 | 確認 yikeday.com/privacy.html 正常 |
| 功能不完整/崩潰 | 先 TestFlight 真機測（階段 6） |
| 截圖不符規格 | 用 6.7" 1290×2796，至少 3 張 |
| 提到其他付費管道（Gumroad） | iOS 端不得提 Gumroad；app 內只走登入（已處理） |

---

## 一頁速覽：你要親手做的事
1. `supabase login && supabase link --project-ref ofhupqifavtafiylehkj && supabase functions deploy delete-account`
2. 確認 https://yikeday.com/privacy.html 打得開
3. Xcode：build 改 5 → Archive → Upload
4. TestFlight 真機跑階段 6 清單
5. App Store Connect：填 App Privacy（5.1）+ demo 帳號（5.2）+ 截圖/描述/URL
6. Submit for Review

有任何一步卡住，把畫面或錯誤訊息貼給我，我幫你看。
