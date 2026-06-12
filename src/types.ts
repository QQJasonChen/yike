export interface Task {
  text: string
  target: number | null // 預估 Focus Time 格數
  done: number // 已完成的 30 分鐘時段數（塗圈）
  actual: number | null // 實際格數（任務完成時記下）
  completed: boolean
}

export interface Block {
  id: string
  start: number // 從 00:00 起算的分鐘數，對齊 30 分鐘
  end: number
  text: string
  taskIndex: number | null // 若由任務拖入，連結回任務
}

export interface DayEntry {
  tasks: Task[] // [0] 最重要任務, [1-2] 次要, [3-4] 額外
  blocks: Block[] // 時間軸上的時間塊（Google Calendar 式拖拉）
  /** 晨間/晚間問題的回答，key = 問題 id（m0,m1,…/e0,e1,…） */
  answers: Record<string, string>
  mood: number | null // 1-5
  score: number | null // 生產力評分 1-5
  habit: boolean // 今日習慣是否完成
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
  tasks: { text: string; done: boolean }[] // 15 格：5 最重要 + 5 次要 + 5 額外
  review: {
    wins: string
    notCompleted: string
    learned: string
    nextWeek: string
  }
}

export interface MonthEntry {
  priorities: { text: string; done: boolean }[] // 本月優先事項（6 格）
  highlights: string // 本月亮點
}

export interface Settings {
  focusMinutes: number // Focus Time 長度（預設 30）
  breakMinutes: number // 休息長度（預設 5）
  habitName: string // 追蹤的每日習慣名稱
  morningQs: string[] // 晨間自訂問題（id 依序為 m0,m1,…）
  eveningQs: string[] // 晚間自訂問題（id 依序為 e0,e1,…）
}

export interface YearEntry {
  goals: { text: string; done: boolean }[] // 年度三大目標
  monthFocus: string[] // 12 個月，每月一個主題
  /** 年曆上的一句話（生日/死線/里程碑），key = YYYY-MM-DD。
   *  存在 year entry 而非 day entry：未來日期寫事件不會「污染」記錄天數統計 */
  notes: Record<string, string>
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
})

// 日刻法預設問題（可在「回顧」頁自訂）
export const DEFAULT_MORNING_QS = ['我感謝', '今天的意圖（我是一個＿＿的人）', '今天，我玩什麼不一樣的玩法？']
export const DEFAULT_EVENING_QS = ['今日亮點', '我今天學到了什麼？', '我想記住今天的什麼？']

export const emptyYear = (): YearEntry => ({
  goals: Array.from({ length: 3 }, () => ({ text: '', done: false })),
  monthFocus: Array.from({ length: 12 }, () => ''),
  notes: {},
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

export const defaultSettings = (): Settings => ({
  focusMinutes: 30,
  breakMinutes: 5,
  habitName: '',
  morningQs: [...DEFAULT_MORNING_QS],
  eveningQs: [...DEFAULT_EVENING_QS],
})
