# 一刻手帳 Yike — 資料模型（給人、也給 AI agent 看）

這份文件描述一刻手帳的每一筆資料長什麼樣、每個欄位是什麼意思。
它是 `src/types.ts` 的白話版；兩邊若有出入，以 `src/types.ts` 為準，並回來修這份。

同一份資訊也以機器可讀的形式放在：
- `GET https://ofhupqifavtafiylehkj.supabase.co/functions/v1/agent-api/schema`（JSON，不需要 token）
- `https://yikeday.com/llms.txt`（給 AI 助理的入口）

## 一句話

一刻手帳是一本「一天一頁」的手帳：每天先寫**一件最重要的任務**（MIT），用 25 分鐘的專注段把它做完，
晚上回答幾個反思問題、給今天打分。週／月／季／年各有一頁計畫與回顧；另有一頁「願景」與一張「個人獲利模式圖」。

## 儲存方式：一個 key 一筆

所有資料都是 **key → JSON 物件**。本機存在瀏覽器 localStorage，開啟雲端同步後每個 key 是資料庫 `journal` 表的一列。

| key 格式 | 內容 | 型別 |
|---|---|---|
| `pp:day:YYYY-MM-DD` | 某一天的手帳 | `DayEntry` |
| `pp:week:YYYY-MM-DD` | 某一週（key 是**週一**的日期） | `WeekEntry` |
| `pp:month:YYYY-MM` | 某一月 | `MonthEntry` |
| `pp:quarter:YYYY-Qn` | 某一季（n = 1–4） | `QuarterEntry` |
| `pp:year:YYYY` | 某一年 | `YearEntry` |
| `pp:life` | 願景（整個帳號只有一份） | `LifeEntry` |
| `pp:bizmodel` | 個人獲利模式圖（整個帳號只有一份） | `BizModel` |
| `pp:settings` | 設定——**解讀反思回答一定要讀它**（見 `answers`） | `Settings` |

以 `ppl:` 開頭的 key（計時狀態、金鑰、衝突副本…）是裝置本機專用，**從不同步、不匯出、API 也拿不到**。
`pp:sync`、`pp:integrations`、`pp:bk:*`、`pp:meta`、`pp:lastBackup`、`pp:cloudBound` 是裝置／同步機制用的，同樣拿不到。

日期一律是使用者裝置的**本地日期**，不是 UTC。

## DayEntry（一天）

```jsonc
{
  "tasks": [ /* Task，見下；固定順序：[0] 最重要任務，[1-2] 次要，[3-4] 額外。空列也會在，text 為空字串 */ ],
  "blocks": [ /* Block，時間軸上的時間塊 */ ],
  "answers": { "m0": "…", "e1": "…" },  // 反思問題的回答。key 是問題 id：m0,m1,… 對應 settings.morningQs[0],[1]…；e0,e1,… 對應 settings.eveningQs
  "mood": 3,          // 心情 1–5，null = 沒填
  "score": 4,         // 今天的生產力自評 1–5，null = 沒填
  "habitsDone": { "運動": true, "早睡": false },  // 習慣名 → 今天有沒有做；習慣清單在 settings.habits
  "habit": false,     // 舊版單一習慣欄位，忽略
  "ink": { "png": "data:…", "drawing": "…", "fmt": "web" },           // 手寫便箋（可選）。png 是圖；drawing 是編輯器內部格式，不要解讀
  "inkAnswers": { "m0": { "png": "…", "drawing": "…" } }            // 某題反思的手寫版（可選）
}
```

### Task（一件任務）

```jsonc
{
  "id": "uuid",         // 穩定身分（可選；舊資料沒有）。同名任務要靠它分辨
  "text": "寫完提案",    // 任務內容；空字串 = 這一列沒用
  "target": 4,          // 預估要幾個專注段（null = 沒估）
  "done": 2,            // 已完成的專注段數。**一段 = 一個 25 分鐘番茄鐘**（settings.focusMinutes 可改）；上限 16
  "actual": 2,          // 實際段數（完成任務時記下），通常等於 done
  "completed": false,   // 任務打勾完成了嗎
  "withered": 1,        // 計時中途放棄的次數（可選；種樹主題的「枯樹」）
  "grove": [25, 25]     // 每一段專注的分鐘數（可選；長度對齊 done；決定種樹主題的樹種）
}
```

**怎麼讀一天的專注量**：`sum(task.done)` 是今天完成的段數。
分鐘數**優先加總 `grove`**：它是每一段「記錄下來的分鐘數」——通常是那一段**開始時**的設定值，
計時中改設定、提早完成、手動補標都會讓它跟真實時長有出入，所以它是記錄值，不是量測值。
沒有 `grove` 的舊資料才用 `done × settings.focusMinutes`，而設定是會變的，更不能代表歷史。
**兩種算法都要向使用者標成估算。**

### Block（時間軸上的時間塊）

```jsonc
{
  "id": "b…",
  "start": 540,          // 從 00:00 起算的分鐘數（540 = 09:00），對齊 30 分鐘
  "end": 600,            // 同上；end > start
  "text": "寫提案",
  "taskIndex": 0,        // 連回 tasks[n]（null = 不是從任務拖進來的）
  "color": "gold",       // 色票 key（gold/terra/sage/indigo/plum/slate/rose/teal），可選
  "note": "…",           // 這個時間塊的深度筆記，可選
  "notify": true,        // 開始時要不要通知，可選
  "notifyLead": 5        // 提前幾分鐘，可選
}
```

專注計時完成時會自動在時間軸加一個 `text` 等於任務名的 block；**連續番茄鐘會接成一條**（相鄰 ≤6 分鐘）。

## WeekEntry（一週，key 用週一日期）

```jsonc
{
  "intention": "本週想成為怎樣的人／做到什麼",
  "tasks": [ { "text": "…", "done": false, "span": [0, 2], "cells": [0,1,2] } ],  // 固定 15 格：5 最重要 + 5 次要 + 5 額外
  "review": { "wins": "…", "notCompleted": "…", "learned": "…", "nextWeek": "…" }
}
```

`span` 是甘特橫條的起訖（週一 = 0 … 週日 = 6），`cells` 是實際塗了哪幾天；兩者都可選。

## MonthEntry / QuarterEntry

```jsonc
{ "priorities": [ { "text": "…", "done": false, "span": [3, 10] } ], "highlights": "本月（季）亮點" }
```

6 格優先事項。月的 `span` 是日 index（0 = 1 號）；季的 `span` 是季內月 index（0–2）。

## YearEntry

```jsonc
{
  "goals": [ { "text": "…", "done": false, "span": [0, 11] } ],   // 年度三大目標；span 是月 index 0–11
  "monthFocus": ["1 月主題", "…", "…"],                              // 固定 12 個
  "notes": { "2026-03-15": "生日" }                                  // 年曆上的一句話（生日、死線、里程碑）
}
```

`notes` 故意存在年而不是日：未來日期寫事件不會被算成「有記錄的一天」。

## LifeEntry（願景）

```jsonc
{
  "northStar": "一句話的方向",
  "goals": [ { "text": "…", "done": false, "span": [0, 4] } ],   // 十年大目標；span 是年 index，0 = startYear
  "startYear": 2026,
  "odyssey": [                                                    // 固定 3 條路（《做自己的生命設計師》奧德賽計畫）
    { "title": "現在這條路", "body": "五年後長什麼樣", "excitement": 4,
      "resources": 3, "confidence": 4, "coherence": 5, "questions": "待解的問題" }   // 後四個可選，0–5
  ],
  "odysseyOpen": true,
  "reflection": "願景頁最底的一句總心得（可選）"
}
```

## BizModel（個人獲利模式圖，Business Model You 九宮格）

```jsonc
{
  "partners": [ { "text": "…", "tag": "job" } ], "activities": [], "resources": [], "value": [],
  "relationships": [], "channels": [], "segments": [], "costs": [], "revenue": [],
  "tags": [ { "id": "job", "label": "正職", "color": "#…" }, { "id": "side", "label": "副業", "color": "#…" } ]
}
```

每一格是一串項目；`tag` 指向 `tags[].id`（正職／副業／現在／未來，使用者可改）。

## Settings（解讀其他資料時要用到的部分）

```jsonc
{
  "focusMinutes": 25,            // 一個專注段幾分鐘
  "breakMinutes": 5,
  "habits": ["運動", "早睡"],      // 習慣清單；DayEntry.habitsDone 的 key 來自這裡
  "morningQs": ["今天最重要的一件事是？", "…"],   // DayEntry.answers 的 m0, m1… 對應這裡的 [0], [1]…
  "eveningQs": ["今天學到什麼？", "…"],          // e0, e1… 同理
  "routines": [ { "emoji": "🚇", "label": "通勤", "start": 480, "dur": 60, "color": "slate" } ],
  "focusStyle": "tree"           // 'tree' 種樹主題 / 'grid' 稿紙方格；只影響畫面
}
```

其餘欄位（提醒時間、專注鎖、自動連續等）是裝置行為設定，對解讀手帳內容沒有意義。

## 給 agent 的解讀提示

- 「今天做了什麼」看 `tasks[].text` 配 `done`；「打算做什麼」看 `target`。
- 「一天的結構」看 `blocks` 依 `start` 排序。
- 「心情與回顧」看 `mood`、`score`、`answers`（**先讀 settings 把 m0/e0 翻成問題文字**）。
- 「連續紀錄」：某一天有任何 `tasks[].text`、`blocks`、`answers` 非空，就算有記錄。
- 空列、null、缺欄位都很常見——舊資料沒有新欄位是正常的，不要當成錯誤。
- 資料是使用者最私密的東西。拿到之後只做使用者要你做的事。
