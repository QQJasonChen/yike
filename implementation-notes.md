# 施工日誌 — productivity-planner

## 2026-06-10 ~ 06-11 初版

### 來源
QQ 掃描的 Intelligent Change《Productivity Planner》PDF（讀了方法論章節 + 每日頁 / 週計劃 / 週回顧版型）+ 無印良品週間バーチカル手帳照片。

### 設計拍板

1. **平台**：Vite + React + TS 的 PWA，localStorage 存資料，GitHub Pages 部署。
   理由：QQ 要「每天輕鬆打開、快速記錄」——免登入、免後端、手機加入主畫面即 app、離線可用。
2. **資料模型**：`pp:day:YYYY-MM-DD`（每日頁含 tasks[5] + blocks[]）、`pp:week:週一日期`（週計劃+回顧）、`pp:settings`。日期一律本地時區字串 key，避免 UTC 跨日 bug。loadDay 與 emptyDay merge，舊資料自動補新欄位。
3. **視覺**：紙本手帳質感——奶油紙 + 墨黑 + 燙金，Noto Serif TC（標題）/ LXGW WenKai TC（手寫填入感）/ EB Garamond（英文數字）。SVG noise 當紙紋。
4. **Focus Time 追蹤**：完整復刻 Target ▢ + ○○○○○ + Actual ▢。點圈塗墨（actual 自動跟著 done）。內建計時器（預設 30+5，可調），倒數完 Web Audio 鐘聲 + 自動塗圈 + 自動進休息。
5. **時間軸（日）**：Google Calendar 式。桌機拖拉新增/移動/resize；手機點一下生 30 分塊（免拖拉）。任務列 ⠿ 把手可直接拖入時間軸（dropRef 從 Timeline 注入給 DayView）。
6. **時間軸（週）**：無印週間バーチカル。7 直欄 06:00–22:00、虛線半小時格、今日金底、紅色 now-line、week N 標題。點格快速新增 + popover 改名/±30 分鐘/刪除。搜尋框搜全部記錄（任務/時間塊/反思），命中的塊紅框高亮、其餘變淡。
7. **已知取捨**：週格不支援拖拉移動（日檢視才有完整拖拉）；時間軸範圍固定 06:00–22:00；icon 用 qlmanage 從 SVG 轉 PNG。

### 踩坑記錄

- npm 全域 cache 有 root 權限殘檔 → 一律 `--cache /tmp/npm-cache-pp` 繞過。
- `setPointerCapture` 對合成事件會 throw → try/catch 包住（真機也防呆）。
- 拖拉結束瀏覽器補發 click → `suppressClick` ref 吃掉，但「原地點放」不吃（否則點塊開編輯失效）。判斷標準：start/end 有沒有變。
- React 18 批次更新：同一 tick 連發 pointer 事件測不出拖拉，要分 tick 模擬。

## 2026-06-12 03:04 深夜接續任務（自動執行）

- ✅ 驗收：npm run build 通過；app / landing / manual 三頁線上皆 200
- ✅ manual.html 補上 v1.1 六個新章節（自訂問題/日刻三問、昨日帶入、年 One Year at a Glance、AI 教練、帳號制雲端同步、Gist 改列進階），目錄重新編號為 14 章
- ✅ landing.html 功能區更新：五種視角（加「年」）、自訂問題、AI 教練、昨日帶入
- ✅ iOS 驗收：xcodebuild Debug（iOS Simulator）BUILD SUCCEEDED
- 待辦（需 QQ 本人）：① Supabase 專案建立 + cloudConfig.ts 填 key + setup.sql ② Gumroad 商品建立（landing 支持按鈕目前是預留連結）③ iOS 真機跑一次（Xcode 開 ios/App/App.xcworkspace）
