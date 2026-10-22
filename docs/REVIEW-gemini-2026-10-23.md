# 第三方紅隊審查：Gemini 3.8 Flash（2026-10-23）

- 對象：凍結快照 commit 7f003bd（`/tmp/yike-gemini` 分離 worktree），純唯讀、沙箱、零指令；跑完 `git status` 確認 0 個檔被動。
- 工具：Antigravity CLI `agy --model "Gemini 3.8 Flash (High)" --mode plan --sandbox`（Gemini 4 Argon 當天額度用完）。
- Prompt：六個攻擊角度（跨帳號外洩／資料遺失／未授權呼叫／注入與 CSP／供應鏈與機密／文件與事實不符），每條要有檔案:行號＋觸發序列＋為何擋不住＋嚴重度。
- 判決：DO-NOT-SHIP，8 條。下面是 Claude 逐條對原始碼查證的結果，**本次審查沒有改任何程式**（QQ 指示「都不要改」）。

## 查證結果

| # | Gemini 的發現 | 查證 | 說明 |
|---|---|---|---|
| ① | P0 `activate` 先 `createUser` 再 `license_activate_grant`，`cap-reached` 回 403 不刪剛建的帳號 | **成立** | `supabase/functions/activate/index.ts` 189 行建帳號、194 行核銷、212 行回 403，沒有 rollback。攻擊者拿目標 Email＋用完的序號打一次就能用自己的密碼佔住該 Email；真買家之後被 409 擋。10 月 PR #21 的流程；9 月 archive 版有 rollback。需線上確認部署版本。 |
| ② | P0 登出／刪帳不取消 iOS 本地排程通知 | **成立** | `src/notify.ts` 只在重排時取消舊的；`SettingsPanel` 登出與刪帳路徑沒呼叫任何 cancel。archive 版有 `cancelAllReminders` 接在登出路徑，origin 沒有。 |
| ③ | P1 先 `claimTimerCompletion` 再 `recordFocusSession`，存失敗那段永久消失 | **部分成立** | 順序是真的，但「永久消失」不對：`recordFocusSession` 走 `editStoredKey`，存失敗會進 `failedDrafts`，下次成功存檔一起帶上。該修的是順序，不是資料遺失。 |
| ④ | P1 跨午夜 `toMin` 只取時分 | **成立** | 23:45 開始、00:10 結束 → 昨天多一條 22:45–23:00 假時間塊，今天 10 分鐘消失。origin 原本 DayView 版本同樣算法（既有 bug）。 |
| ⑤ | P2 `cloud.ts` 的 `ts === meta && 值不同` 在單機正常編輯也判衝突 | **成立** | 本機改了還沒推、雲端還是舊版 → 條件成立 → 每次編輯多一份「雲端衝突副本」。10 月 PR #16 加的（註解寫為了微秒精度）。 |
| ⑥ | P2 `agent-api` 節流排在查 token 之後 | **成立** | `agent-api/index.ts` 46 行先查 DB、63 行才 bump。亂打 token 不會被節流。 |
| ⑦ | P3 隱私政策「不進行使用者行為追蹤或分析」vs GoatCounter pixel | **成立** | `public/privacy.html` 46 行；`src/analytics.ts` 載 goatcounter；隱私頁自己的 CSP 還放行了它。 |
| ⑧ | P3 `ship-gate.sh` 憑證掃描漏 `yk_`／`secret_`；CI deno test 只跑 `functions/tests/` | **成立** | `agent-api/logic_test.ts` 沒進 CI。 |

## 它說「沒問題」的那段要打折

這段有幻覺，不能當成「已被看過」：
- `journal_entries` 表不存在（表叫 `journal`）。
- `pp:stats:focus`、`pp:cfg:ext` 這種 key 不存在。
- 「CSP 標頭 `frame-ancestors 'none'`」在 GitHub Pages 上設不了（frameGuard 是 JS 層）。
- 「備份用 AES-GCM + PBKDF2」不是事實。

## 跟 Codex 十六輪的差別

Codex 十六輪都在挖計時器的跨分頁競態；Gemini 一輪抓到兩條 Codex 沒碰的 P0（activate 回滾、通知殘留）。第三方視角值回票價，但它的「乾淨清單」不可信。

## 後續

①②④⑤⑥ 待 QQ 點頭後修（另開 PR，不混進搬移批次）。⑦⑧ 同上。
報告原文：本機 scratchpad `gemini-review-out.md`。
