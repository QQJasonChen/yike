# Garmin／健康數據整合 — 設定與上線清單

> 程式碼已全部寫好。三條路可以同時開，資料最後都合併成 `pp:health:YYYY-MM-DD`，
> 在「今天」頁顯示成「⌚ 身體狀況」卡片（今日狀態建議＋各項指標＋近 7 天趨勢）。
> 使用者入口：⚙ 設定 →「⌚ Garmin／健康數據」。

| 路線 | 平台 | 自動？ | 需要 QQ 做什麼 | 現在能用？ |
|---|---|---|---|---|
| ③ 匯入 Garmin 匯出檔（zip／JSON／CSV） | 全平台 | 手動、一次補多年 | 無 | ✅ 立即可用 |
| ② Apple 健康（Garmin Connect → Apple 健康 → 一刻） | iOS app | 開 app 自動讀最近 14 天 | Xcode 勾 HealthKit capability（下面步驟 A） | 勾完重編即可 |
| ① Garmin 官方 Health API 直連 | 全平台（需登入雲端帳號） | 手錶一同步就推送 | 申請 Garmin 開發者計畫＋部署（步驟 B） | 等 Garmin 核准 |

---

## 資料能拿到什麼

| 指標 | 匯出檔 | Apple 健康 | 官方直連 |
|---|:-:|:-:|:-:|
| 睡眠時長／深睡／REM／上床起床時間 | ✅ | ✅ | ✅ |
| 睡眠分數 | ✅ | — | ✅ |
| 身體能量（Body Battery） | ✅ | — | ✅ |
| 壓力 | ✅ | — | ✅ |
| 夜間 HRV | ✅ | ✅（SDNN） | ✅ |
| 靜止心率／最高心率 | ✅ | ✅ | ✅ |
| 步數／距離／爬樓／卡路里／熱血時間 | ✅ | ✅ | ✅ |
| 血氧／呼吸／體重／VO₂ max | ✅ | ✅ | ✅ |

同一天有多個來源時，優先序：官方直連 > 匯出檔 > Apple 健康（低優先來源只補空缺，不覆蓋）。
身體能量、壓力、睡眠分數是 Garmin 專有指標，Garmin Connect **不會**寫進 Apple 健康，所以只走 ② 的人看不到這三項。

---

## A. iOS：開啟 Apple 健康（HealthKit）

程式已就緒：`ios/App/App/HealthKitPlugin.swift`（已加進 Xcode 專案的 App target）、
`Info.plist` 已加 `NSHealthShareUsageDescription`、JS 橋 `src/healthKit.ts`。

1. Xcode 開 `ios/App/App.xcworkspace` → App target → **Signing & Capabilities** → **+ Capability** → **HealthKit**
   （Xcode 會自動在 App ID 開 HealthKit 並把 entitlement 加進簽章；不用勾 Clinical Health Records、不用 Background Delivery）
   - ⚠️ 目前 `App.entitlements` 裡有 Family Controls 但沒接上 `CODE_SIGN_ENTITLEMENTS`（等 Apple 核准，見 `src/focusLock.ts`）。
     Xcode 加 HealthKit 時會把 entitlements 檔接上——**記得把 `com.apple.developer.family-controls` 那行先拿掉**，否則 Distribution 簽章會失敗。
2. `npm run build:ios` → 真機 Run
3. 手機上：Garmin Connect → 更多 → 設定 → 連接的應用程式 → Apple 健康 → 全部打開
4. 一刻 → ⚙ 設定 → 「🍎 授權並同步」→ 系統彈出健康權限頁 → 全部允許
5. App Store 審核：上架說明要寫「讀取健康資料用於在手帳顯示每日身體狀況，不寫入、不上傳第三方」；
   隱私權標籤勾「健康與健身 → 與使用者相關聯、不用於追蹤」。`public/privacy.html` 需補一段（見下方待辦）。

未勾 capability 時，授權按鈕會顯示 HealthKit 的錯誤訊息，不會閃退。

---

## B. Garmin 官方 Health API 直連

Garmin 的 Health API 只開放給核准的開發者（免費，審核約 1–3 週）。核准前 UI 會顯示「等待核准」，不影響其他功能。

### 1. 申請
- https://developer.garmin.com/gc-developer-program/ → Apply → 選 **Health API**
- 用途寫：個人專注手帳 app，讀取使用者每日摘要（dailies、sleeps、HRV、stress、user metrics、pulse ox、body composition）在 app 內顯示
- 核准後在開發者後台建立 app，拿到 **Client ID / Client Secret**（OAuth 2.0 PKCE）

### 2. 資料庫
```bash
supabase db push   # 套用 supabase/migrations/20261007000000_garmin_health.sql
```
建立 `garmin_links`（token，只有 service role 讀得到）、`garmin_pkce`（OAuth 暫存）、`health_daily`（RLS：只能讀/刪自己的）、
`health_daily_merge()`（只給 service role 執行）。三張表都 `on delete cascade` 到 `auth.users`，刪帳號會一併清掉。

### 3. Secrets 與部署
```bash
supabase secrets set GARMIN_CLIENT_ID=… GARMIN_CLIENT_SECRET=… GARMIN_WEBHOOK_KEY=$(openssl rand -hex 24)
supabase functions deploy garmin-oauth --no-verify-jwt
supabase functions deploy garmin-webhook --no-verify-jwt
```
（Garmin 若調整端點，可再設 `GARMIN_AUTH_URL`、`GARMIN_TOKEN_URL`、`GARMIN_API_BASE` 覆寫預設值，見 `supabase/functions/_shared/garmin.ts`。）

### 4. Garmin 開發者後台設定
- **Redirect / Callback URL**：`https://ofhupqifavtafiylehkj.supabase.co/functions/v1/garmin-oauth`
- **Endpoint Configuration**（推送網址）：Dailies、Sleeps、HRV、Stress Details、User Metrics、Pulse Ox、Respiration、Body Compositions、Deregistrations
  全部填 `https://ofhupqifavtafiylehkj.supabase.co/functions/v1/garmin-webhook?k=<GARMIN_WEBHOOK_KEY>`，模式選 **Push**（Ping 也支援）。

### 5. 驗收
1. 網頁登入雲端帳號 → ⚙ 設定 → 🔗 連結 Garmin → Garmin 同意頁 → 導回 app，設定頁顯示「已連結」
2. 幾分鐘內 Garmin 會回補最近 30 天 → 設定頁「↻ 立即更新」→ 今天頁出現身體狀況卡片
3. 用 Garmin 後台的 **Data Generator／Backfill** 工具測推送；Supabase → Table editor → `health_daily` 應有資料
4. 「解除連結」→ Garmin 端撤銷授權＋伺服器資料刪除

### 資料流與隱私
```
手錶同步 → Garmin → POST garmin-webhook（驗 ?k=）→ 依 Garmin userId 找 garmin_links → health_daily_merge()
app 開啟 / 回前景 → 讀自己的 health_daily（RLS）→ src/health.ts 解析 → pp:health:*（再經 E2EE 同步到其他裝置）
```
- 這條路的健康數據在伺服器上是**明文**（Garmin 推送無法端對端加密）——UI 已明講；② ③ 兩條路跟日記一樣走 E2EE。
- 伺服器只存原始摘要，解析只有前端一份（`src/health.ts`），Garmin 改欄位只要改一個地方。

---

## 為什麼不用帳密登入 Garmin Connect（garth／python-garminconnect）
社群套件是模擬 Garmin Connect 網頁登入，等於要使用者把 Garmin 帳密交給我們、
違反 Garmin 使用條款、Garmin 一改登入流程就全壞。官方 API＋Apple 健康＋匯出檔三條路已涵蓋所有指標，不走這條。
不過 python-garminconnect 抓下來的 JSON 存檔，③ 的匯入一樣吃得下（欄位名相容）。

## 待辦（需 QQ）
- [ ] 步驟 A（Xcode 勾 HealthKit）＋真機測一次 Apple 健康授權與讀取
- [ ] 申請 Garmin Connect Developer Program（步驟 B）
- [ ] `public/privacy.html`、`manual.html` 補「健康數據」段落
