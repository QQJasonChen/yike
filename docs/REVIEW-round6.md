# Claude×Codex 互審 第 6 輪（2026-09-07）

Codex 判決：`VERDICT: DO-NOT-SHIP`，9 條 P0＋若干 P1/P2。以下逐條裁決與修法。
規則同前幾輪：**每一條都要證偽**——把原本的 bug 放回去，對應的斷言必須變紅。

## P0（全部已修，9/9 證偽通過）

| # | Codex 的說法 | 裁決 | 修法 | 證偽 |
|---|---|---|---|---|
| P0-1 | 同步閘門只擋「下一次」pull，正在飛行中的那一次還是會蓋掉閘門期間打的字 | **成立** | `cloud.ts` pull 判斷改成 `dirtyBefore[r.key] \|\| isGated(r.key)`，閘門期間的 key 一律走衝突副本 | F1 紅 |
| P0-2 | 兩台裝置同時改同一天，後推的直接蓋掉前一台（rev 只擋同一台） | **成立** | push payload 帶 `base_updated_at`，DB 端 `journal_set_updated_at` 做 compare-and-set，不符就 `return null`（RETURNING 不回該列，client 保留 dirty） | F2 紅 + 線上 6/6 情境 |
| P0-4 | 衝突副本存不下就靜默丟掉；換帳號留給下一個人；登出被一起清掉 | **成立（三個）** | `saveConflictCopy` 回傳布林，存不下就 `holdBack` 該 key 這一輪不推；`discardLocalForNewOwner` 刪掉副本；`clearForLogout` 保留副本（副本綁 owner，留著不外洩） | F3/F4/F5 紅 |
| P0-5 | 升級前產生的無主快照，登出後會被下一個登入的人列出來 | **成立** | 新增 `stampLegacyBackupOwners()`，App 啟動時（任何清 owner 的動作之前）一次性蓋章 | F6 紅 |
| P0-7 | DB 還是舊的非原子計數器 | **不成立** | 查 `pg_proc`：線上只有新版。Codex 第 6 輪已自行撤回 | — |
| P0-8 | 一段專注被記到「畫面正在看的那一天」，計時中翻歷史日期會蓋掉今天；切到週/月分頁時 callback 是 null，整段不記 | **成立** | 抽出 `src/focusSession.ts` 直接對 storage 寫入計時器自己的 `dateKey`，完成時間用 `timer.endsAt` 不用 `Date.now()` | F9 紅 |

## P1

| # | 說法 | 裁決 | 修法 | 證偽 |
|---|---|---|---|---|
| P1-1 | 新兌換表把序號的既有用量歸零，用過 2 次的還能再開 3 個 | **成立** | `license_redeem` 加 `seed`＋`seed_at_insert` 固定基線，判準 `pre + n > cap`。不用 `greatest(n, seed)`——Gumroad 的 `uses` 每次成功都加，兩個計數會互相追 | 線上 6/6 情境（含 Gumroad 計數器卡住） |
| P1-4 | 換帳號沒清上一個人的 Notion token 與計時狀態 | **成立** | `discardLocalForNewOwner` 加清 `pp:integrations`、`ppl:timer` | F7 紅 |
| P1-5 | 每日快照的「今天備過了嗎」不分帳號，Bob 的輪替會刪掉承諾留給 Alice 的那份 | **成立** | `pp:lastBackup` 改成 per-owner map；`pruneBackups(owner)` 只輪替那個人的 | F8 紅 |
| P1-9 | 已有使用者的 `pp:integrations` 被同步上雲 | **線上不成立** | 查 `journal where key='pp:integrations'` → 0 列 / 0 人。程式面仍已把它排除在 `importAll` 之外 | — |

## 證偽時反過來抓到的一條

F4（換帳號清副本）第一次跑**沒有變紅**。原因是斷言只看 `listConflicts()`，而它本身有 owner 過濾——
「列不出來」不等於「不在了」。上一個人的日記明文其實還躺在同一個 origin 的 localStorage。
把斷言改成直接數 `ppl:conflict:` 原始 key 之後才紅。
**教訓：用「有過濾的讀取 API」寫斷言，會證明不了儲存層真的清乾淨。**

## 線上驗證（不是宣稱，是跑過的）

- `license_redeem` 只存在 4 參數版（`pronargdefaults=1`），舊 3 參數版已 drop。
- 部署中的 v16 用 3 參數呼叫 → PostgREST 仍解析成功（HTTP 200 / `true`），`seed_at_insert=0`。
  所以**啟用沒有壞掉**，壞掉的是「Gumroad 既有用量的基線遺失」。測試列已刪除。
- 4 參數 + `seed=2, cap=3`：第一個 email `true`、第二個 `false`，被拒的那個沒有留下列。測試列已刪除。
- `activate` 重新部署 → **version 17 / ACTIVE / verify_jwt=false**（Docker 沒開，走 Management API multipart）。
- v17 兩條非破壞路徑 smoke test：無白名單 → 403 `not-entitled`；假序號 → 403 序號無效。
- 全套測試 `155 passed`（19 檔），`npm run build` exit 0。

## 尚未處理（Codex 第 6 輪 P2，刻意留到下一版）

- P2-1 BYOK：驗證有 15 秒逾時但 body 讀取沒有；型號清單沒濾掉 tts/realtime/image；真正那次 AI 呼叫沒有逾時。
- P2-2 浮動計時器 `z-index: 62` 現在蓋在 modal/menu（60/61）之上。
- P2-3 搜尋鈕與 ⚙ 的 44px 命中區互相重疊。
- P2-4 同名任務會解析到第一個相符的——要根治得給任務穩定 ID。
