# 每日生產力手帳 The Productivity Planner

把 Intelligent Change《Productivity Planner》紙本手帳的方法論做成每天可用的 PWA，
週檢視參考無印良品「週間バーチカル」直式時間格。

**線上使用 → https://qqjasonchen.github.io/productivity-planner/**

手機開啟後「加入主畫面」即可當 app 使用（支援離線）。

## 方法論（來自紙本手帳）

1. **最重要任務（MIT）**：「如果今天只完成這件事，我就滿意了」——通常是最不舒服、最常拖延的那件
2. **最多 5 個任務**：1 MIT + 2 次要 + 2 額外，少即是多
3. **Focus Time**：30 分鐘專注時段。先預估 Target 格數 → 做完塗圈 → 記下 Actual
4. **晨間**：感恩 + 今日意圖；**晚間**：亮點 / 學到 / 想記住 + 心情 + 生產力評分 1–5
5. **每週**：週意圖 + 本週五大任務；週末做 Weekly Review（wins / 未完成 / 學到 / 下週行動）

## 功能

- **今天**：完整每日手帳頁 + Google Calendar 式時間軸（點空格新增、拖拉移動、拉把手調長、任務直接拖入排程）
- **內建 Focus 計時器**：點任務旁 ▶ 開始，倒數完自動塗圈、進入休息
- **本週**：無印良品式 7 天直式時間格（點格快速新增）+ 全域搜尋 + 週計劃 / 週回顧
- **回顧**：連續天數、平均評分、近 14 天圖表、所有記錄列表
- **資料**：全部存在裝置 localStorage，可一鍵匯出 / 匯入 JSON 備份

## 開發

```bash
npm install
npm run dev      # 開發
npm run build    # 打包（輸出 dist/）
```

Vite + React + TypeScript，無其他執行期依賴。push 到 main 會自動經 GitHub Actions 部署到 GitHub Pages。

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
