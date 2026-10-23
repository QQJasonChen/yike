# Claude×Codex 互審 第 8 輪（2026-09-07）

Codex 審 `6b07f37`，判 `VERDICT: DO-NOT-SHIP`，10 條（3 P0 + 7 P1）。
**其中 4 條是我第 7 輪修正自己帶進來的回歸**（第 1、2、9、10 條）。
這一輪的教訓不是「又有 bug」，而是「每一條修正都要問：這個修法自己有沒有新的外洩/遺失路徑」。

| # | Codex 的說法 | 裁決 | 修法 | 證偽 |
|---|---|---|---|---|
| 1 | **P0** 快照收所有 `ppl:conflict:*` 卻不比對內層 owner → Bob 的快照帶出 Alice 的私密內容，而 Bob 的衝突清單是空的、完全看不出來 | **成立（我上一輪修出來的）** | `autoBackup` 只收 `blob.owner === owner` 的副本；解不開的一律不收 | H1 紅 |
| 2 | **P0** `assertStillMine()` 明確放行 `now === null` → Alice 登出後她的日記還會落地到這台無主裝置 | **成立（我上一輪修出來的）** | 收緊成 `getDataOwner() !== user.id` 就丟。認領區塊跑完後 owner 一定等於 user.id，看到 null 只有一種可能：另一個分頁登出了 | H2 紅 |
| 3 | **P0** `useExternalKey` 只聽同一個 window 的事件；另一個分頁換帳號後，這個分頁改一個字就把 Alice 的內容寫進 Bob | **成立** | App 加 `storage` 事件監聽：`ppl:owner` 一變就 `location.reload()`。不試圖救畫面上的 state——它可能夾著上一個人的內容 | 見下方「未自動化」 |
| 4 | **P1** `markDirty` 失敗補進去的記憶體閘門沒參與 push 與登出檢查 → 那筆永遠不上雲，登出就沒了 | **成立** | 匯出 `pendingGatedKeys()`；push 的 key 集合改成 `dirty ∪ gated` | H3 紅 |
| 5 | **P1** 閘門在成功存檔、成功同步後都不清 → 本次執行期間每次 pull 都當它是髒的，雲端新版永遠只進副本 | **成立** | `markDirty` 成功時 `gatedKeys.delete`；push 被伺服器確認後 `clearGate(key)` | H4 / H5 紅 |
| 6 | **P1** 上一個帳號延遲的 push 回應會清掉新帳號的 dirty | **成立** | `markSynced` 之前先 `assertStillMine()` | H6 紅 |
| 7 | **P1** 蓋章／認領只改 blob 的 owner，key 還是純日期 → 同日的匿名快照照樣蓋掉它 | **成立** | 兩處都改名成 `pp:bk:<date>#<owner8>`；順手修掉「邊走邊 removeItem 會讓索引位移、跳掉後面快照」的問題 | H7 / H8 紅 |
| 8 | **P1** 願景（LifeView）與個人獲利模式（BizModelView）沒訂閱新事件，仍會用舊 state 蓋掉已下載資料 | **成立（第 7 輪我漏了這兩個檢視）** | 兩者接上 `useExternalKey` + `rebase` | 見下方「未自動化」 |
| 9 | **P1** 改用 `loadX()` 當基準之後，配額滿時第二欄編輯會抹掉第一欄的草稿 | **成立（我上一輪修出來的回歸）** | 抽出 `rebase(lastSaveFailed, inMemory, fromStorage)`：存檔失敗過就退回畫面那份。六個檢視統一用它 | H10 紅 |
| 10 | **P1** 快照現在含衝突副本，但 `importAll` 只放 `pp:*` 過 → 從備份檔還原會靜默丟掉它們 | **成立（我上一輪修出來的）** | `importAll` 與 `restoreBackup` 都收 `ppl:conflict:*`，而且用 `setItem` 直接落地（走 `write` 會留下一筆永遠清不掉的髒標記，因為 `ppl:` 被 push 結構性排除） | H9 紅 |

Codex 明確說 `serverTsRaw` 原樣回送 + `-infinity` 沒有新的永久拒寫路徑，
`useExternalKey` 也沒有自發重讀迴圈。

## 測試

`src/__tests__/codexRound8.test.ts` 11 條，對應 8 條可自動化的修正，**全部證偽通過**。
全套：`176 passed`（21 檔）、`tsc` 0、`lint` 0 errors、`build` 0。

第 3 條後來也自動化了：把判斷抽成 `src/ownerWatch.ts` 的 `watchOwnerChange()`，
測試直接對 window 丟 `StorageEvent`——涵蓋「別的分頁登入」「別的分頁登出（newValue 為 null）」
「整個 localStorage 被 clear（key 為 null）」三種形狀，以及兩種**不該**觸發的形狀
（別的 key、同值改寫——後者會造成 reload 迴圈）。證偽通過。
順帶記一個事實：`storage` 事件不會在做出改動的那個分頁觸發，所以同一分頁自己
`setDataOwner()` 不會誤觸。

**仍未自動化**（誠實記錄，不當成已驗證）：第 8 條的 LifeView／BizModelView
只確認 hook 與 `rebase` 已接上，沒有元件層測試（repo 沒有 @testing-library/react）。
它們用的是跟另外四個檢視同一支 `rebase`，而那支有測試。

## 第 9 輪：Codex 額度用完

`codex exec` 回 `You've hit your usage limit`，要到 **2026-09-10 19:00** 才恢復（或加購額度）。
互審迴圈到 SHIP 才放行 TestFlight，所以 **IPA 維持不上傳**。
在那之前我自己審了第 8 輪修正的六個高風險點（原本要問 Codex 的那幾條）：

| 自審點 | 結論 |
|---|---|
| `pushedRevs[k] = dirty[k] ?? 0` 對閘門 key 的影響 | 安全。`clear()` 會因為 `d[k]`（undefined）≠ 0 而提早 return——本來就沒有 dirty 可清；`m[r.key]` 仍會對齊伺服器時間戳，正是我們要的 |
| 被 CAS 擋下的閘門 key | 不在 `savedRows` 裡 → 不 `clearGate` → 仍受保護、下一輪仍在 `wanted` 裡。正確 |
| 快照 key 改名對 `pruneBackups` 排序 | 安全。排序前先按 owner 過濾，同一個 owner 的 id 後綴相同，排序等於按日期。**唯一殘留**：第 6/7 輪那兩個未發佈的建置產生過「owner 已設定但 key 沒後綴」的快照，同一天可能被列兩次。只影響我的開發機（那兩版沒有發佈給任何人），不寫程式處理 |
| `importAll` 直接 `setItem` 寫 `ppl:conflict:*` 的風險 | 沒有新增攻擊面：動過手腳的備份檔本來就能塞任意 `pp:day:*`（直接偽造日記），比塞副本嚴重。副本還受 owner 過濾才列得出來 |
| `rebase` 的 `saveFailed` 卡在 true | 每次 update 都重算 `!save(next)`，一成功就清。若空間永久不足而一直 true，基準就一直是記憶體那份——這正是要的行為（草稿不能被抹掉） |
| `storage` 事件誤觸／reload 迴圈 | 已自動化擋住（見上）。`storage` 不在改動者自己的分頁觸發，同值改寫也被過濾 |

## 這一輪的結構性教訓

第 7 輪我修了 14 條，其中 4 條各自開了新洞：
- 把副本收進快照 → 收到了別人的副本（外洩）
- 收緊 owner 檢查 → 放行了 null（外洩）
- 把基準改成 storage → 抹掉了未存成的草稿（遺失）
- 把副本收進快照 → 匯入端吃不下（遺失）

共同形狀是：**修 A 路徑時沒有去看 A 的資料會流到哪些其他出口**（快照→匯出→匯入、
owner 檢查→登出、基準→配額滿）。下一輪自審要先畫出口清單再改。
