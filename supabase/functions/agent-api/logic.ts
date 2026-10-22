// agent-api 的純邏輯：不碰 Deno.serve、不碰網路，`deno test` 測得到。
//
// 這裡決定「什麼拿得到、什麼拿不到」。index.ts 只負責把 HTTP 接進來、把結果送出去。

/** API 能讀的 key。白名單，不是黑名單——新加的 ppl:/pp:sync 之類不會因為忘了列而漏出去。 */
const ALLOWED_SINGLE = new Set(['pp:settings', 'pp:life', 'pp:bizmodel'])
const ALLOWED_PREFIX = ['pp:day:', 'pp:week:', 'pp:month:', 'pp:quarter:', 'pp:year:']

export const isReadableKey = (key: string): boolean => {
  if (ALLOWED_SINGLE.has(key)) return true
  return ALLOWED_PREFIX.some((p) => key.startsWith(p) && key.length > p.length)
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
export const isDateKey = (s: string): boolean => {
  if (!DATE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export const MAX_RANGE_DAYS = 92

export type Route =
  | { kind: 'schema' }
  | { kind: 'me' }
  | { kind: 'keys' }
  | { kind: 'day'; date: string }
  | { kind: 'days'; from: string; to: string }
  | { kind: 'entry'; key: string }
  | { kind: 'bad'; status: number; error: string }

/** 把 /functions/v1/agent-api/<rest>?… 解析成要做的事。 */
export const parseRoute = (url: URL): Route => {
  const parts = url.pathname.split('/').filter(Boolean)
  const i = parts.indexOf('agent-api')
  const rest = i >= 0 ? parts.slice(i + 1) : parts
  const head = rest[0] ?? ''

  if (head === 'schema') return { kind: 'schema' }
  if (head === 'me') return { kind: 'me' }
  if (head === 'keys') return { kind: 'keys' }

  if (head === 'day') {
    const date = rest[1] ?? ''
    if (!isDateKey(date)) return { kind: 'bad', status: 400, error: 'date 要是 YYYY-MM-DD' }
    return { kind: 'day', date }
  }

  if (head === 'days') {
    const from = url.searchParams.get('from') ?? ''
    const to = url.searchParams.get('to') ?? ''
    if (!isDateKey(from) || !isDateKey(to))
      return { kind: 'bad', status: 400, error: 'from 與 to 都要是 YYYY-MM-DD' }
    if (from > to) return { kind: 'bad', status: 400, error: 'from 不能晚於 to' }
    const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
    if (span + 1 > MAX_RANGE_DAYS)
      return { kind: 'bad', status: 400, error: `一次最多 ${MAX_RANGE_DAYS} 天` }
    return { kind: 'days', from, to }
  }

  if (head === 'entry') {
    // key 可能含 ':'，所以把剩下的段落接回去。%FF 這種解不開的要回 400，
    // 不能讓 URIError 從 handler 的 try 外面飛出去（Codex 審查第 4 條）。
    let key: string
    try {
      key = decodeURIComponent(rest.slice(1).join('/'))
    } catch {
      return { kind: 'bad', status: 400, error: 'key 編碼不正確' }
    }
    if (!isReadableKey(key)) return { kind: 'bad', status: 404, error: '沒有這個 key，或這個 key 不開放讀取' }
    return { kind: 'entry', key }
  }

  return { kind: 'bad', status: 404, error: '沒有這個端點。可用：/schema /me /keys /day/:date /days?from&to /entry/:key' }
}

/** Bearer token → 字串；格式不對就 null。 */
export const bearerOf = (authorization: string | null): string | null => {
  if (!authorization) return null
  const m = /^Bearer\s+(yk_[A-Za-z0-9_-]{20,})$/.exec(authorization.trim())
  return m ? m[1] : null
}

export const sha256Hex = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** PostgREST 一次最多回 1000 列（預設上限）。長期使用者的每日 key 會超過，
 *  不分頁的話 /keys 會無聲少給，而回應看起來是完整的（Codex 第 2 輪第 3 條）。
 *  一頁一頁拉到「這一頁不滿」為止。fetchPage 回 null 代表這一頁失敗。 */
export const PAGE = 1000
export const paginate = async <T>(
  fetchPage: (offset: number, limit: number) => Promise<T[] | null>,
  maxPages = 20
): Promise<T[]> => {
  const out: T[] = []
  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchPage(page * PAGE, PAGE)
    if (rows === null) throw new Error('page fetch failed')
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
  throw new Error(`超過 ${maxPages * PAGE} 列，拒絕回傳不完整的清單`)
}

/** 給 /schema 的資料模型（跟 docs/DATA-MODEL.md 同一份內容的機器版）。 */
export const SCHEMA = {
  app: 'yike',
  version: 1,
  docs: 'https://github.com/QQJasonChen/yike/blob/main/docs/DATA-MODEL.md',
  llms: 'https://yikeday.com/llms.txt',
  dates: '所有日期都是使用者裝置的本地日期（YYYY-MM-DD），不是 UTC',
  keys: {
    'pp:day:YYYY-MM-DD': 'DayEntry：一天的手帳',
    'pp:week:YYYY-MM-DD': 'WeekEntry：一週（key 是週一的日期）',
    'pp:month:YYYY-MM': 'MonthEntry',
    'pp:quarter:YYYY-Qn': 'QuarterEntry',
    'pp:year:YYYY': 'YearEntry',
    'pp:life': 'LifeEntry：願景（整個帳號一份）',
    'pp:bizmodel': 'BizModel：個人獲利模式圖（整個帳號一份）',
    'pp:settings': 'Settings：解讀 answers 與 habitsDone 一定要讀它',
  },
  types: {
    DayEntry: {
      tasks: 'Task[]；固定順序 [0] 最重要任務，[1-2] 次要，[3-4] 額外；text 為空＝這一列沒用',
      blocks: 'Block[]；時間軸上的時間塊',
      answers: 'Record<問題id, 回答>；m0,m1… 對應 settings.morningQs[0],[1]…；e0,e1… 對應 settings.eveningQs',
      mood: '心情 1–5；null 沒填',
      score: '生產力自評 1–5；null 沒填',
      habitsDone: 'Record<習慣名, boolean>；習慣清單在 settings.habits',
      ink: '手寫便箋（可選）；png 是圖，drawing 是編輯器內部格式不要解讀',
      inkAnswers: '某題反思的手寫版（可選）',
    },
    Task: {
      id: '穩定身分（可選；舊資料沒有）',
      text: '任務內容',
      target: '預估專注段數；null 沒估',
      done: '已完成的專注段數；一段＝settings.focusMinutes 分鐘（預設 25）；上限 16',
      actual: '實際段數（完成時記下）',
      completed: '打勾完成了嗎',
      withered: '計時中途放棄的次數（可選）',
      grove: '每段專注的分鐘數（可選；長度對齊 done）',
    },
    Block: {
      start: '從 00:00 起算的分鐘數（540＝09:00），對齊 30 分鐘',
      end: '同上，> start',
      text: '內容',
      taskIndex: '連回 tasks[n]；null 不是從任務拖進來的',
      color: '色票 key（gold/terra/sage/indigo/plum/slate/rose/teal）',
      note: '深度筆記（可選）',
    },
    WeekEntry: {
      intention: '本週意圖',
      tasks: '固定 15 格：5 最重要 + 5 次要 + 5 額外；{text, done, span?:[週一=0…週日=6], cells?}',
      review: '{wins, notCompleted, learned, nextWeek}',
    },
    MonthEntry: { priorities: '6 格 {text, done, span?:[日index]}', highlights: '本月亮點' },
    QuarterEntry: { priorities: '6 格 {text, done, span?:[季內月index 0-2]}', highlights: '本季亮點' },
    YearEntry: {
      goals: '年度三大目標 {text, done, span?:[月index 0-11]}',
      monthFocus: '12 個月各一個主題',
      notes: 'Record<YYYY-MM-DD, 一句話>；年曆上的事件',
    },
    LifeEntry: {
      northStar: '一句話的方向',
      goals: '十年大目標 {text, done, span?:[年index，0=startYear]}',
      startYear: '十年甘特起始年',
      odyssey: '固定 3 條路 {title, body, excitement 0-5, resources?, confidence?, coherence?, questions?}',
      reflection: '總心得（可選）',
    },
    BizModel: {
      blocks: 'partners/activities/resources/value/relationships/channels/segments/costs/revenue 各是 {text, tag?}[]',
      tags: '{id, label, color}[]；item.tag 指向 id',
    },
    Settings: {
      focusMinutes: '一個專注段幾分鐘',
      habits: '習慣清單',
      morningQs: '晨間問題；answers 的 m0,m1… 對應 [0],[1]…',
      eveningQs: '晚間問題；answers 的 e0,e1… 對應 [0],[1]…',
      routines: '時間軸快填 routine',
    },
  },
  hints: [
    '今天做了什麼看 tasks[].text 配 done；打算做什麼看 target',
    '專注分鐘數優先加總 task.grove——它是每一段「記錄下來的分鐘數」（通常是那一段開始時的設定值），仍可能含提早完成或手動標記，不是量測值；沒有 grove 才用 done × settings.focusMinutes。兩種都要向使用者標成估算',
    '一天的結構看 blocks 依 start 排序',
    '解讀 answers 前先讀 /entry/pp:settings 把 m0/e0 翻成問題文字',
    '某一天有任何 tasks[].text、blocks、answers 非空就算有記錄',
    '空列、null、缺欄位都正常，舊資料沒有新欄位不是錯誤',
    '這是使用者最私密的東西，只做使用者要你做的事',
  ],
} as const
