export interface Task {
  text: string
  target: number | null // 預估 Focus Time 格數
  done: number // 已完成的 30 分鐘時段數（塗圈）
  actual: number | null // 實際格數（任務完成時記下）
  completed: boolean
  withered?: number // 番茄鐘計時中放棄的次數（種樹主題的枯樹格）；舊資料 undefined 視為 0
  grove?: number[] // 種樹主題：每棵已種的樹的專注分鐘數（決定樹種）；長度對齊 done，舊資料 undefined 一律當松樹
}

/** 單一任務的段數上限（done 與 target 共用；16 段 = 8 小時專注，一天的合理天花板） */
export const MAX_SEGS = 16

export interface Block {
  id: string
  start: number // 從 00:00 起算的分鐘數，對齊 30 分鐘
  end: number
  text: string
  taskIndex: number | null // 若由任務拖入，連結回任務
  color?: string // 色彩編碼（routine 帶入時帶上；palette key，見 ROUTINE_COLORS）
  note?: string // 這個時間塊的深度筆記（為什麼做、要點、連結…）
  notify?: boolean // 開始時間到時跳本地通知（iOS 即使關 app 也響；web 僅 app 開著時）
  notifyLead?: number // 提前幾分鐘提醒（0=準時，預設 0）
}

// 時間軸「一鍵快填」的 routine（使用者可自訂，最多 8 個）
export interface RoutineItem {
  emoji: string
  label: string
  start: number // 預設起始（從 00:00 起算的分鐘數）
  dur: number // 長度（分鐘）
  color: string // palette key（見 ROUTINE_COLORS）
}

export const MAX_ROUTINES = 4

// 時間軸色票（存 key、hex 在這裡查；與紙質感調性一致）
export const ROUTINE_COLORS: { key: string; hex: string }[] = [
  { key: 'gold', hex: '#b8923e' },
  { key: 'terra', hex: '#c1632f' },
  { key: 'sage', hex: '#6f8f6a' },
  { key: 'indigo', hex: '#3d5a73' },
  { key: 'plum', hex: '#8a5a7a' },
  { key: 'slate', hex: '#5f6b76' },
  { key: 'rose', hex: '#c2708a' },
  { key: 'teal', hex: '#3f8a86' },
]
export const colorHex = (key?: string): string =>
  ROUTINE_COLORS.find((c) => c.key === key)?.hex ?? '#b8923e'

export interface DayEntry {
  tasks: Task[] // [0] 最重要任務, [1-2] 次要, [3-4] 額外
  blocks: Block[] // 時間軸上的時間塊（Google Calendar 式拖拉）
  /** 晨間/晚間問題的回答，key = 問題 id（m0,m1,…/e0,e1,…） */
  answers: Record<string, string>
  mood: number | null // 1-5
  score: number | null // 生產力評分 1-5
  habit: boolean // (legacy v1) 單一習慣
  habitsDone: Record<string, boolean> // 習慣名 → 今天是否完成
  ink?: { png: string; drawing: string; fmt?: 'pk' | 'web' } // 手寫便箋：png 顯示、drawing 可再編輯、fmt 記錄編輯器（pk=原生 iPad / web=畫布）
  inkAnswers?: Record<string, { png: string; drawing: string; fmt?: 'pk' | 'web' }> // 每題反思的手寫版（key=問題 id m0/e1…）
}

/** 舊版欄位（v1 固定問題）— 僅供載入時遷移 */
export interface LegacyDayFields {
  gratitude?: string
  intention?: string
  highlight?: string
  learned?: string
  remember?: string
}

export interface WeekEntry {
  intention: string
  /** 15 格：5 最重要 + 5 次要 + 5 額外；span = 甘特橫條的起訖日（週一=0 … 週日=6） */
  tasks: { text: string; done: boolean; span?: [number, number] | null; cells?: number[] }[]
  review: {
    wins: string
    notCompleted: string
    learned: string
    nextWeek: string
  }
}

export interface MonthEntry {
  priorities: { text: string; done: boolean; span?: [number, number] | null; cells?: number[] }[] // 本月優先事項（6 格）；span=日 index
  highlights: string // 本月亮點
}

export interface QuarterEntry {
  priorities: { text: string; done: boolean; span?: [number, number] | null; cells?: number[] }[] // 本季優先事項（6 格）；span=季內月 index 0-2
  highlights: string // 本季亮點
}

export interface Settings {
  focusMinutes: number // Focus Time 長度（預設 25，番茄鐘）
  breakMinutes: number // 休息長度（預設 5）
  habitName: string // (legacy v1) 單一習慣名
  habits: string[] // 習慣清單（一週檢視）
  morningQs: string[] // 晨間自訂問題（id 依序為 m0,m1,…）
  eveningQs: string[] // 晚間自訂問題（id 依序為 e0,e1,…）
  focusLock: boolean // 專注時鎖住分心 App（僅原生 iOS 生效）
  showRollover: boolean // 今天頁顯示「昨日未完成 → 帶入今天」提醒（預設開）
  routines: RoutineItem[] // 時間軸快填 routine（可自訂，最多 8）
  autoLoop: boolean // 連續番茄鐘：休息結束自動接下一段專注（預設關）
  reminderEnabled: boolean // 每日提醒（僅原生 iOS 生效）
  reminderTime: string // 提醒時間 HH:MM
  focusStyle: 'tree' | 'grid' // Focus 塗格風格：種樹（Forest 式，預設）／稿紙方格
}

// 預設 routine：精簡 4 個一日骨架（一行剛好放得下；可在設定頁增到 8 個）
export const DEFAULT_ROUTINES: RoutineItem[] = [
  { emoji: '🚇', label: '通勤', start: 8 * 60, dur: 60, color: 'slate' },
  { emoji: '🏢', label: '上班', start: 9 * 60, dur: 180, color: 'indigo' },
  { emoji: '🍱', label: '午餐', start: 12 * 60, dur: 60, color: 'terra' },
  { emoji: '🏃', label: '運動', start: 18 * 60 + 30, dur: 60, color: 'sage' },
]

export interface YearEntry {
  goals: { text: string; done: boolean; span?: [number, number] | null; cells?: number[] }[] // 年度三大目標；span=月 index 0-11
  monthFocus: string[] // 12 個月，每月一個主題
  /** 年曆上的一句話（生日/死線/里程碑），key = YYYY-MM-DD。
   *  存在 year entry 而非 day entry：未來日期寫事件不會「污染」記錄天數統計 */
  notes: Record<string, string>
}

/** 奧德賽計畫的一條路（《做自己的生命設計師》三種五年人生） */
export interface OdysseyPath {
  title: string // 路線名（現在這條路／如果它消失了／不管錢與面子）
  body: string // 這個版本的五年後長什麼樣（自由書寫）
  excitement: number // 興奮度自評 0–5（幫你看出真正想要的）
  // ↓《生命設計師》完整儀表板——後加的可選欄位；loadLife 逐條合併會自動補預設，舊資料原封不動
  resources?: number // 資源 0–5：時間、錢、技能夠走這條路嗎
  confidence?: number // 自信 0–5：我做得成嗎
  coherence?: number // 一致 0–5：跟北極星同一個方向嗎
  questions?: string // 這條路引出的問題（原框架要求每條路記下 2–3 個待解問題）
}

/** 願景維度：北極星 + 十年大目標甘特 + 奧德賽三條路。整個 app 只有一份。 */
export interface LifeEntry {
  northStar: string // 北極星：願景的方向（一句話）
  goals: { text: string; done: boolean; span?: [number, number] | null; cells?: number[] }[] // 願景大目標；span=年 index（0 = startYear）
  startYear: number // 十年甘特的起始年
  odyssey: OdysseyPath[] // 固定 3 條路
  odysseyOpen: boolean // 奧德賽區塊是否展開
}

export const emptyTask = (): Task => ({
  text: '',
  target: null,
  done: 0,
  actual: null,
  completed: false,
})

export const emptyDay = (): DayEntry => ({
  tasks: [emptyTask(), emptyTask(), emptyTask(), emptyTask(), emptyTask()],
  blocks: [],
  answers: {},
  mood: null,
  score: null,
  habit: false,
  habitsDone: {},
})

// 一刻預設問題（可在「回顧」頁自訂）
export const DEFAULT_MORNING_QS = ['我感謝'] // 晨間 30 秒原則：預設只留一問，想加的用範本
export const DEFAULT_EVENING_QS = ['今日亮點', '我今天學到了什麼？', '我想記住今天的什麼？']

export const emptyYear = (): YearEntry => ({
  goals: Array.from({ length: 3 }, () => ({ text: '', done: false })),
  monthFocus: Array.from({ length: 12 }, () => ''),
  notes: {},
})

// 願景大目標預設 5 格（一輩子的畫布，比「年」多一點）
export const emptyLife = (): LifeEntry => ({
  northStar: '',
  goals: Array.from({ length: 5 }, () => ({ text: '', done: false })),
  startYear: new Date().getFullYear(),
  odyssey: [
    { title: '現在這條路', body: '', excitement: 0, resources: 0, confidence: 0, coherence: 0, questions: '' },
    { title: '如果它消失了', body: '', excitement: 0, resources: 0, confidence: 0, coherence: 0, questions: '' },
    { title: '不管錢與面子', body: '', excitement: 0, resources: 0, confidence: 0, coherence: 0, questions: '' },
  ],
  odysseyOpen: true,
})

export const emptyWeek = (): WeekEntry => ({
  intention: '',
  tasks: Array.from({ length: 15 }, () => ({ text: '', done: false })),
  review: { wins: '', notCompleted: '', learned: '', nextWeek: '' },
})

export const emptyMonth = (): MonthEntry => ({
  priorities: Array.from({ length: 6 }, () => ({ text: '', done: false })),
  highlights: '',
})

export const emptyQuarter = (): QuarterEntry => ({
  priorities: Array.from({ length: 6 }, () => ({ text: '', done: false })),
  highlights: '',
})

export const defaultSettings = (): Settings => ({
  focusMinutes: 25,
  breakMinutes: 5,
  habitName: '',
  habits: [],
  morningQs: [...DEFAULT_MORNING_QS],
  eveningQs: [...DEFAULT_EVENING_QS],
  focusLock: false,
  showRollover: true,
  routines: [...DEFAULT_ROUTINES],
  autoLoop: false,
  reminderEnabled: false,
  reminderTime: '20:00',
  focusStyle: 'tree',
})
