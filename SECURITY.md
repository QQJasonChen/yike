# 一刻手帳 Yike — 安全基準與部署狀態

更新：2026-10-14。供開發、審查與維運使用；下列「正式已核實」來自本次管理者回讀與驗收。來源檔、測試通過或候選 build 不代表已部署；後續變更須重新核對並更新狀態。

正式 Web 是 GitHub Pages 的 Vite／React 靜態 SPA，伺服器端驗證、Auth、PostgreSQL 與 Edge Functions 由 Supabase 提供。瀏覽器與 Capacitor app 都是不可信的客戶端，不能自行授予付費權益或繞過資料庫限制。Web 部署不代表 iOS 原生版本已更新或完成真機驗收。

## 目前狀態

| 項目 | 已核實範圍／尚待完成 |
|---|---|
| 正式開通 | `activate` v19 已部署並回讀。新帳號必須提供 Gumroad 每筆訂單的序號，伺服器核對商品、有效購買與購買 Email；沒有空序號或共用邀請碼 bypass。既有帳號使用原帳密登入。 |
| Auth 與資料隔離 | 公開 signup 維持關閉。journal 的四種 row 操作依 `auth.uid() = user_id` 隔離；匿名查詢不回傳 journal。這不限制持有受控高權限伺服器憑證的營運者。 |
| 正式 DB 保護 | CAS function 固定 `search_path`，已撤應用角色的 journal `TRUNCATE`／`REFERENCES`／`TRIGGER`。journal quota 已部署；166 筆資料的完整內容、RLS 與 CAS 在套用前後核對相等，計帳一致。 |
| 備份格式 2 | 專用 TLS 唯讀 reader、`REPEATABLE READ` snapshot 與 AES-256-GCM 已驗收：19 個 Auth 身分 metadata、166 筆 journal、4 筆 entitlement、1 筆 license ledger；原生 PostgreSQL 17.6 隔離還原的內容 hash 相等，時間比較固定 UTC。**新版每日 GitHub workflow 尚待部署及首次排程回讀**；不能以這次演練代替後續每日成功證據。 |
| 此輪 Web 候選 | 更嚴格的第一方 CSP／analytics、local backup／owner／同步與 Notion UI 修補尚待本輪部署及正式回讀。已存在 CSP 的頁面不等於所有候選 policy 都已上線。 |
| 自助密碼重設 | recovery 程式預設 OFF。SMTP、正式郵件模板／callback、專用 QA 寄達與重設登入驗收完成前，不宣稱自助重設可用。 |
| 其他營運條件 | 付費主機／方案、管理帳號 MFA 與完整 Auth 災難復原仍待核實或完成；此文件不保證 PITR、可用性 SLA 或立即撤銷既有 access JWT。 |

## 必須維持的不變條件

1. **Journal row 權限在資料庫判斷。** 使用者只能讀寫自己 UID 的 journal；不能依賴前端隱藏按鈕、Email 或客戶端聲稱的 UID。service role 繞過 RLS，必須隔離保管與限制用途；刪帳必須由伺服器驗證 JWT 的 UID，只處理本人，不接受請求 body 自選帳號。
2. **公開 signup 保持關閉。** 新帳號只由已核實的伺服器付款流程建立；不能恢復前端 signup、空序號 Email 白名單或共用邀請碼捷徑。只知道買家 Email 不是設定其密碼的授權。
3. **付款 proof 在伺服器重新驗證。** Gumroad 序號須屬於指定商品且請求 Email 等於訂單購買 Email；無效、測試、停用、退款或爭議購買不能開通。不能用與購買 Email 不符的序號替另一個 Email 設定密碼；序號持有與訂單欄位一致，不等於已驗證信箱控制權。webhook 的 entitlement 記錄不是獨立身分證明。
4. **永久授權紀錄不得因刪帳或重試消失。** `license_redemptions` 與原子 RPC 執行目前每序號 cap 3 的上限；這不是三台裝置限制。開通失敗不得假稱成功，帳號刪除不得重新釋放付款額度，備份合併不得降低歷史 seed。webhook 必須核對 secret／商品／退款爭議，重複送達不得重複增發權益。
5. **節流／計帳失敗要拒絕。** 原子 RPC 缺失、錯誤或無法判定時 fail closed，不可「先查再扣」或 RPC 出錯就放行。activate 先限制來訪 IP，只有有效序號與購買 Email proof 通過後才消耗該 Email 額度，避免假碼鎖住買家。IP header 不是可信身分 proof。
6. **同步時間與並發由伺服器守門。** `updated_at` 由資料庫產生；保留 CAS／device revision 與 dirty 編輯保護。失敗的 CAS 不得計入新增 quota，失敗寫入不得被前端標成已同步。
7. **本機資料不得混進另一帳號。** `ppl:owner` 與同步閘門用來防止帳號切換／共享裝置的誤送；候選修補的 owner／legacy quarantine／匯入確認須保留。這是 app 邏輯保護，localStorage 沒有因此成為加密或 OS 帳號隔離。
8. **本機憑證不進一般同步、匯出或備份。** 排除 Auth session、OpenAI key、Notion token、`pp:sync`／`pp:integrations` 與 `ppl:` 的內部敏感狀態。候選可明確匯出目前 owner 的結構化 `ppl:conflict:` 內容作復原，但不能因此開放任意 `ppl:` key 或他人的副本。使用者主動執行 Notion／AI 時，所需 token 與選取內容會透過 TLS 傳到對應服務流程。
9. **備份落地與上傳前必須加密。** 未加密資料不能寫入暫存 dump、log、artifact 或上傳備份庫；TLS 傳輸及受控 process memory 中可以存在明文。明文 offline 檢視只能在明確授權、私有檔案權限與隔離環境中進行，不能成為每日備份捷徑。
10. **功能啟用前須具備完整安全與復原條件。** 暫缺商戶 OpenAI／RevenueCat 憑證的入口不得僅因補 secret 就視為可商用。商戶 AI 要有 Auth、原子用量、請求大小／timeout／總成本限制；IAP 要有真實交易驗證與永久購買 owner 綁定。原型、舊端點或 HTTP 200／OPTIONS 不足以證明付款與同步可用。

## Journal 容量與失敗處理

版本化設定目前為：key 最多 1,024 bytes、JSON value 最多 512 KiB、`client_id` 最多 256 bytes；每帳號最多 40,000 rows／100 MiB，全站 250 MiB 的**邏輯 key＋JSON 文字用量**。這不是 PostgreSQL 實體磁碟、索引／WAL、網路、Auth、Edge Functions 或供應商帳單的上限，亦不是每位買家的容量承諾。

quota tables／functions 不允許一般使用者修改；journal accepted rows 與衍生 counters 在同一 transaction 更新。TRUNCATE 被拒絕，不能繞過 DELETE 計帳。擴容前應核對總量、provider 容量與預算，保留核對過的 rollback，不能只提高前端數字。

真 PostgreSQL 17.6 多連線測試已覆蓋同帳號／跨帳號容量競爭、CAS 拒絕、Auth cascade 與 counter 一致性。管理者多 statement 的不同鎖順序仍可能發生 `40P01` 或 `40001`；必須整個 transaction 回滾，不把前批視為完成。還原工具先取得相關 table locks；失敗後重新只讀 preview。COMMIT 回應遺失屬於結果不明，須 readback 後才決定下一步，不能自動重送或保證「一定沒寫入」。

## 憑證與備份權限

| 資產 | 保護要求 |
|---|---|
| Supabase service-role key | 只在受控伺服器／明確授權管理流程；不進 client bundle、公開 repo、測試或一般 CI log。 |
| Supabase Management token | 可能管理多個專案；不得放進產品 CI，不能用它當每日 reader。 |
| 專用 backup reader | LOGIN、BYPASSRLS，但無 superuser／create／write 或 authenticated membership。Auth metadata 由固定 `search_path`、postgres-owned SECURITY DEFINER 函數只回傳 UID／Email／created_at／last_sign_in_at；EXECUTE 僅授 reader，PUBLIC／anon／authenticated／service_role 無權。建立與收回預設權限須在同一 transaction。 |
| Backup passphrase 與加密 archive | 密語與 archive 分開保管；密語遺失會妨礙復原，兩者同時外洩可解密內容。不得印在 argv、stdout、CI log 或公開 artifact。reader 與 passphrase 僅給專用私有備份 job，不授予網站 PR CI。 |
| Gumroad／webhook／Notion／AI 憑證 | 不印原始上游 body、序號前綴或帳號個資；只記錄必要 status／aggregate。測試只能用合成憑證或明確授權的專用 QA 資料。 |

新版加密檔是 AES-256-GCM authenticated envelope；tag 驗證後才解析內容。既有 AES-CBC 檔不能因 checksum 正確就當成已防篡改來源，只能走明確授權的 legacy 唯讀與演練流程。私有 GitHub 儲存加密 archive，不等於 GitHub 完全看不到備份檔名／大小等 metadata。

備份包含 journal、entitlements、license ledger 與指定 Auth 身分 metadata；**不含 Auth 密碼、OAuth／MFA 設定、登入 sessions 或整套 Supabase 系統資料**。現有帳號的 UID／Email 必須核對；跨專案還原需獨立身分證據，不可只憑相同 Email 猜歸屬。尚未同步的純本機資料，伺服器備份不到。

## 已知限制與發版閘門

- **不是 E2EE。** 雲端 journal 可由具有適當權限的營運者讀取；TLS 與備份加密不能改稱「只有本人能看」。本機匯出通常是明文，使用者須自行保管。
- 刪帳處理目前 Auth／journal；合法購買與永久授權紀錄、歷史加密 archive 有不同保存範圍。不能宣稱所有歷史副本立即永久刪除；新增恢復流程也不得自動復活已刪帳號。
- 既有 webhook query secret 有存取 log 外洩風險，需最小權限、遮罩及輪替規劃；不能把尚未部署的 header 改造寫成現況。
- 目前使用者自帶 OpenAI key 的 AI 費用由其 provider 帳戶負擔。商戶 AI 的缺 secret 拒絕不是完整成本防護，沒有「付費使用者已含每日 15 次 AI」的產品承諾。
- Web 候選發版須通過 locked dependency install／audit、lint、App／Auth／owner／DB／Notion regression、static CSP、Deno activation tests 與 build；部署後回讀實際 artifact、CSP 與必要 QA。iOS／真機另驗，不以 Web 通過替代。
- 新版每日備份接線後，必須保留首個實際成功 run、完整分頁與 count／decrypt roundtrip 的無敏感 metadata；持續監看失敗、容量與 retention。演練不等於日後每次排程都成功。
- Recovery 開旗標前需確認正式 SMTP／寄件網域、固定 callback 與 fragment token_hash 郵件模板，以及專用 QA 寄達、同 owner 重設、新密碼登入、舊密碼與已使用連結拒絕。頁面載入不自動 verify；舊 access JWT 可能到期前仍有效。
- 付費方案／PITR／host 可用性與管理帳號 MFA 是待完成的營運 gate。不能宣稱「零漏洞」、「不可能被攻擊」或保證永不遺失資料。

審查時應同時看實際部署 metadata、source diff 與有意義的回歸證據；migration 存在、build 通過或端點 HTTP 200 都不是正式安全條件已生效的證明。發現疑似漏洞時先提供可重現的最小合成案例與影響範圍，避免讀取或附上使用者日記、序號、token 或密碼。
