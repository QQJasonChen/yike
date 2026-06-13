// 甘特橫條顏色：依任務層級分色（與元件分檔，讓 Gantt.tsx 只導出元件）
export type GanttTone = 'ink' | 'gold' | 'sage'

/** 週任務層級 → 顏色：1–5 最重要、6–10 次要、11–15 額外 */
export const tierTone = (i: number): GanttTone => (i < 5 ? 'ink' : i < 10 ? 'gold' : 'sage')
