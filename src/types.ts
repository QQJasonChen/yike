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
  gratitude: string
  intention: string
  tasks: Task[] // [0] 最重要任務, [1-2] 次要, [3-4] 額外
  blocks: Block[] // 時間軸上的時間塊（Google Calendar 式拖拉）
  highlight: string
  learned: string
  remember: string
  mood: number | null // 1-5
  score: number | null // 生產力評分 1-5
  habit: boolean // 今日習慣是否完成
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
}

export const emptyTask = (): Task => ({
  text: '',
  target: null,
  done: 0,
  actual: null,
  completed: false,
})

export const emptyDay = (): DayEntry => ({
  gratitude: '',
  intention: '',
  tasks: [emptyTask(), emptyTask(), emptyTask(), emptyTask(), emptyTask()],
  blocks: [],
  highlight: '',
  learned: '',
  remember: '',
  mood: null,
  score: null,
  habit: false,
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
})
