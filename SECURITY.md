# 一刻手帳 Yike — 安全基準

給人與 AI 共用的資安依據。做 code review、安全掃描（Codex Security / Claude security-review）
或新增功能前先讀這份：AI 看得懂程式怎麼寫，但不知道這個產品的規矩，
沒有這份文件它只會檢查「有沒有登入」，抓不到真正會讓站方賠錢或洩漏使用者日記的漏洞。

架構：Vite + React SPA（GitHub Pages，純靜態）＋ Capacitor iOS ＋ Supabase
（Postgres / Auth / Edge Functions）。**沒有自有後端伺服器**，所有伺服器端邏輯都在
Supabase Edge Functions 裡；因此「前端」＝完全不可控。

---

## 1. 資產（外洩或被偷會出大事的東西）

| 資產 | 在哪 | 出事的後果 |
|---|---|---|
| 使用者的每日日記與反思 | `public.journal` | 最私密的內容。外洩＝產品信譽歸零，且無法挽回 |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function secrets、`~/.yike-supabase-service-key` | 繞過所有 RLS，等於整個資料庫 |
| `OPENAI_KEY` | Edge Function secrets | 綁著信用卡，外洩＝帳單失控 |
| `BACKUP_PASSPHRASE` | GitHub secret、`~/.yike-backup-passphrase` | 掉了不會外洩資料，但備份會變成解不開的亂碼 |
| 付費白名單 | `public.entitlements` | 被寫入＝任何人自助開通付費功能 |
| Supabase Management token (`sbp_`) | 本機 keychain | **整個帳號六個專案**，比 service role key 更嚴重。永遠不要放進任何 CI |

## 2. 角色與權限

| 角色 | 可以 | 不可以 |
|---|---|---|
| 未登入訪客 | 用全部本機功能（資料只在瀏覽器） | 讀寫任何雲端資料 |
| 已開通使用者 | 讀寫**自己的** journal、每天 15 次 AI | 讀寫他人 journal、繞過每日上限 |
| Edge Function（service role） | 全庫存取 | — |

- **身分驗證**：Supabase Auth JWT。**公開註冊必須保持關閉**（已驗證 `signup_disabled`）——
  這是最強的一道門，開了等於任何人自助拿到雲端同步＋AI 額度。
- **授權**：靠 RLS，不是靠前端。見第 4 節。

## 3. 信任邊界

```
[瀏覽器 / iOS app]  ← 完全不可控，使用者能改任何數值、偽造任何請求
        │
    ════╪════  信任邊界
        │
[Edge Functions] → [Postgres + RLS]   ← 可控
```

**鐵律：任何跟權限、付費狀態、用量額度有關的判斷，一律在邊界內重算，
絕不相信前端送來的任何數字。** 前端的隱藏/停用按鈕只是 UX，不是安全機制。

## 4. 安全不變條件（最高憲法，任何情況都不能被打破）

1. **使用者只能讀寫自己的 journal。** 由 `public.journal` 的 RLS 保證，
   不是由前端或 Edge Function 保證——假設外圍全被繞過，資料庫自己必須守住最後一道。
2. **公開註冊永遠關閉。** 帳號只能經 `activate` / `iap-activate` 建立。
3. **AI 每人每日不超過 `DAILY_CAP`。** 計數必須原子遞增後再判斷（先加再比），
   不能「先查再扣」——中間的時間差會被同一毫秒的並行請求放大成免費算力。
4. **付費驗證只在伺服器端做。** Gumroad 序號向 Gumroad 驗、IAP 向 RevenueCat 驗；
   前端送來的「我已付費」一律不採信。
5. **同一筆付款只能開通一次。** webhook 以 email 為主鍵 upsert，重複送達不得重複給權益。
6. **節流故障時要擋，不是要放行。** 計數器查不到或出錯 → 拒絕，不能 fail-open。
7. **備份不得以明文離開 Supabase。** 落地前先 AES-256 加密。

> 條 3 和條 6 都是踩過才寫進來的：`ai_usage` 的 migration 一度沒跑到 production，
> 而判斷寫成 `if (bump.ok && ...)`，RPC 不存在時短路放行 → 上限完全沒生效。
> **「migration 檔案存在」不等於「production 跑過」，要實際查 `pg_tables`。**

## 5. 攻擊面與現有防禦

| 入口 | 風險 | 防禦 |
|---|---|---|
| `POST /functions/v1/activate` | 無限開帳號、暴力猜序號、email 列舉 | 節流 IP 20/時、email 5/時（`rate_limit_bump`，fail-closed） |
| `POST /functions/v1/ai-insight` | 燒 OpenAI 帳單 | 需 JWT ＋ 每日 15 次（原子遞增）＋ 輸入截斷 6000 字 ＋ `max_tokens: 700` |
| `POST /functions/v1/gumroad-ping`、`portaly-webhook` | 偽造付款通知自助開通 | query 的 `?secret=`；退款/爭議不開通 |
| `POST /functions/v1/delete-account` | 刪別人的帳號 | 驗 JWT 取 uid，只刪自己的 |
| `/rest/v1/journal` | 讀別人的日記 | RLS `auth.uid() = user_id`（四種操作都有 policy） |
| 共用邀請碼 `INVITE_CODES` | **流出去就收不回來，永久有效** | 目前只有節流。應定期輪替，並在自動開通修好後移除 |

## 已知缺口（誠實記錄，不要假裝沒有）

- **journal 在 Supabase 是明文。** 持有 service role key 的人（站方）能讀所有人的日記。
  端對端加密尚未完成（`src/e2ee.ts` 有核心但未接上主流程）。
  隱私政策必須誠實反映這一點，不能寫成「只有你看得到」。
- **共用邀請碼是永久有效的單一字串**，已寄給過買家。屬於「已知會慢慢外流」的資產。
- **webhook 的 secret 放在 query string**，會進各種存取紀錄。改 header 較好。
- **Supabase 免費方案**：無自動備份、無 PITR、閒置會暫停。備份靠 `yike-backups` private repo
  每日快照（AES-256，附還原演練 `restore.sh --verify`）。
- **未設 CSP**。

## 掃描前要告訴 AI 的話

> 這是我的最高安全憲法（SECURITY.md 第 4 節），請據此審查所有程式碼，
> 找出任何會打破這些規則的漏洞。特別檢查：權限判斷是否有落在信任邊界外的、
> 額度計算是否存在先查再扣的時間差、以及 migration 是否真的跑到 production。
