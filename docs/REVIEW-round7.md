# Claude×Codex 互審 第 7 輪（2026-09-07）

Codex 審的是 `0ffaa3c`，判 `VERDICT: DO-NOT-SHIP`，14 條。
**最重要的一條是我自己上一輪修出來的洞**：第 6 輪加的 CAS 護欄把時間戳截成毫秒，
而伺服器是微秒——每個已同步過的 key 從此永遠推不上去，而畫面顯示「✓ 已同步」。
比它要修的那個 bug 更嚴重。

## 裁決總表

| # | Codex 的說法 | 裁決 | 修法 | 證偽 |
|---|---|---|---|---|
| 11 | CAS 時間戳精度流失，部分 key 永遠推不上去（他報 P1） | **成立，我判 P0** | 保留伺服器回的原始字串 `serverTsRaw`，原封不動送回。不再用 `new Date(ts).toISOString()` 重建 | G1 紅 + 線上 5/5 |
| 10 | 兩台同時新增「雲端還沒有的那一天」，CAS 直接放行 | **成立** | 沒看到該 key 就送 `base_updated_at: '-infinity'`（而非 `null`——trigger 對 null 跳過 CAS）。純客戶端修正，不動 migration | G2 紅 + 線上 |
| 7 | 另一分頁在途的 pull 能跨過登出與換帳號 | **成立** | `assertStillMine()`：下載回來後、推送前各複查一次 owner，變了就整輪中止 | G3 紅 |
| 1 | 首次登入選「合併」沒轉移無主快照 → 登出後對下一個人公開 | **成立** | 合併路徑改走 `claimDeviceFor(uid)`（原本只 `setDataOwner`） | G4 紅 |
| 2 | 同日換帳號，Bob 的快照直接覆蓋 Alice 的唯一救援 | **成立** | 快照 key 綁 owner：`pp:bk:<date>#<owner8>`。輪替分帳號救不了，因為丟失發生在 pruneBackups 之前 | G5 紅 |
| 3 | 換帳號前的快照不含衝突副本，接著又刪副本＝那個版本永久消失 | **成立** | `autoBackup` 一併收 `ppl:conflict:*`；還原時回得來 | G6 紅 |
| 9 | 本體寫得進去、dirty 寫不進去 → 之後被 pull 靜默覆蓋 | **成立** | `markDirty` 失敗時把 key 加進記憶體 `gatedKeys`（配額滿也寫得進去），pull 端把 `isGated` 當 dirty 看 → 走衝突副本 | G7 紅 |
| 4 | 「放棄專注」仍有第 6 輪的跨日期覆寫 | **成立** | 新增 `recordAbandon(dateKey, taskIndex)`，由 App 直接寫計時器自己的那一天；DayView 的 callback 整條拆掉 | G8 紅 |
| 5 | 週頁的舊 state 會把剛落地的專注／雲端更新整包蓋回去 | **成立，而且是一整類** | 新增 `src/useExternalKey.ts`；cloud.ts 對每個落地的 key 發 `yike:external-key-change`；週/月/季/年/時程六個檢視全部訂閱＋寫入時以 `loadX()` 現況為基準 | 見下方 |
| 6 | 換帳號後下載失敗，上一人的畫面還在、還寫得回去 | **成立** | `location.reload()` 移進 `finally` | — |
| 8 | 換帳號路徑沒取消上一個人的行程通知 | **成立** | 該路徑加 `cancelAllReminders()` | — |
| 12 | 專注結果存不下仍慶祝、仍進休息 | **成立** | `recordFocusSession` 回傳布林；存不下改顯示「⚠ 這段專注沒存進去」 | G9 紅 |
| 13 | `holdBack` 的 key 沒推卻顯示「已同步」 | **成立** | `syncNow` 多回 `held`，訊息合併進「有 N 筆沒推上去」並說明是空間不足 | G10 紅 |
| 14 | seed 遷移可能重複計算既有兌換 | **邏輯成立，線上無資料** | 線上 `license_redemptions` 共 0 列（`null_seed=0`），碰不到。migration 仍補上 `update … set seed_at_insert = 0 where seed_at_insert is null` 把缺口關掉 | — |

`analytics.ts` Codex 判無問題。

## 線上驗證（分開的交易，不是同一個 DO block）

第一次跑在單一交易裡，第 4 步「過期 base 應被擋」卻通過了——因為 `now()` 是**交易**時間戳，
同一個交易裡所有 `updated_at` 都相同，過期的 base 剛好對得上。改成一次 API 一個交易後：

| 步驟 | 期望 | 實際 |
|---|---|---|
| A 新增（送 `-infinity`） | 落地 | `A-first` ✓ |
| B 併發新增同一個 key（也送 `-infinity`） | 擋下 | 仍是 `A-first` ✓ |
| B 用原樣微秒字串推 | 接受 | `B-after-pull` ✓ |
| A 用過期 base 推 | 擋下 | 仍是 `B-after-pull` ✓ |
| A 重新 pull 後再推 | 接受，且 `base_updated_at` 不落庫 | `A-retry` / `null` ✓ |

截斷驗證（第 11 條的證據）：伺服器 `2026-09-07 00:23:35.897802+00`，
客戶端原本會送 `2026-09-07T00:23:35.897Z` → 該筆更新**被擋**，值停在舊版；
送原樣字串則成功。線上 125 列裡有 10 列帶次毫秒精度，而那 10 列正是最近由 `now()` 寫的
——也就是「以後每一列都是」。

## 測試

`src/__tests__/codexRound7.test.ts` 10 條，對應上表 10 條可自動化的修正，
**全部證偽通過**（把 bug 放回去，對應斷言變紅；還原後全綠）。

證偽時又抓到一條測試自己的問題：P0-1 那條第一次沒紅，因為我在斷言前先 `setDataOwner(BOB)`，
而洩漏的真實形狀是「Alice 登出後 owner 變回 null，下一個人**不用登入**就打開備份頁」。
把斷言改成登出後直接數 `listBackups()` 才擋得住。
**跟上一輪同一個教訓：斷言的前置條件要長得像真實的攻擊路徑，不是像方便測的路徑。**

全套：`165 passed`（20 檔）、`tsc --noEmit` 0、`npm run lint` 0 errors、`npm run build` 0。

## 仍未處理

- Codex 第 6 輪 P2-1～P2-4（BYOK 逾時、計時器 z-index、44px 命中區重疊、同名任務要穩定 ID）
- `frame-ancestors` 要在 Pages/CDN 層加 HTTP header
- 舊版客戶端（已部署的網頁版）新增 key 時仍送 `base_updated_at: null`，會跳過 CAS。
  部署後就自然收斂，但在那之前併發新增仍可能覆蓋。
