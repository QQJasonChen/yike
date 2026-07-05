// 種樹主題的墨風手繪 SVG（細線條，跟 DayView 的手繪番茄同為 inline SVG 家族）。
// 全部 stroke=currentColor，顏色交給 CSS（.plant-cell.{kind} 的 color）。

import { ReactNode } from 'react'
import { CellKind } from './plantCells'

const G = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
)

/** 雙葉小苗：短莖 + 左右兩片填色葉。種子（咖啡色）與生長中（綠色澆水）共用同一形狀 */
const Seedling = () => (
  <G>
    <path d="M8 14 V8" strokeWidth="1.7" />
    <path d="M8 10.6 Q4.6 10.2 3.8 6.4 Q7.4 6.8 8 10.6Z" fill="currentColor" fillOpacity="0.5" />
    <path d="M8 9 Q11.4 8.4 12.2 4.8 Q8.6 5.4 8 9Z" fill="currentColor" fillOpacity="0.5" />
  </G>
)

/** 松樹 🌲：粗幹 + 三層填色三角樹冠——長成後夠大夠綠 */
const Tree = () => (
  <G>
    <rect x="7.1" y="12.6" width="1.8" height="2.4" rx="0.4" fill="currentColor" stroke="none" />
    <path d="M8 7.6 L12.4 13 L3.6 13 Z" fill="currentColor" fillOpacity="0.72" />
    <path d="M8 4.4 L11.4 9.2 L4.6 9.2 Z" fill="currentColor" fillOpacity="0.82" />
    <path d="M8 1.6 L10.6 5.8 L5.4 5.8 Z" fill="currentColor" fillOpacity="0.92" />
  </G>
)

/** 燙金松樹 + 頂上一顆金星（超標的那段） */
const GoldTree = () => (
  <G>
    <rect x="7.1" y="12.6" width="1.8" height="2.4" rx="0.4" fill="currentColor" stroke="none" />
    <path d="M8 8 L12.4 13 L3.6 13 Z" fill="currentColor" fillOpacity="0.7" />
    <path d="M8 5 L11.4 9.4 L4.6 9.4 Z" fill="currentColor" fillOpacity="0.82" />
    <path d="M8 2.6 L10.4 6.2 L5.6 6.2 Z" fill="currentColor" fillOpacity="0.92" />
    <path d="M8 0.6 L8.7 2.1 L10.3 2.2 L9.1 3.3 L9.5 4.9 L8 4 L6.5 4.9 L6.9 3.3 L5.7 2.2 L7.3 2.1 Z"
      fill="currentColor" stroke="none" />
  </G>
)

/** 枯樹：彎折粗幹 + 下垂禿枝，明顯的「死掉了」 */
const Withered = () => (
  <G>
    <path d="M8.6 14.4 Q9.2 11 7.2 8.6 Q5.8 7 6.8 4" strokeWidth="1.9" />
    <path d="M7.4 10.2 Q5 9.8 4 11.2" strokeWidth="1.6" />
    <path d="M7 6.6 Q9.4 5.8 10.6 6.8" strokeWidth="1.6" />
    <path d="M6.8 4 Q6 3 4.8 2.8" strokeWidth="1.4" />
  </G>
)

export const PLANT_GLYPHS: Record<CellKind, ReactNode> = {
  seed: <Seedling />,
  seedPast: <Seedling />,
  sprout: <Seedling />,
  tree: <Tree />,
  gold: <GoldTree />,
  withered: <Withered />,
}

export const PLANT_TITLES: Record<CellKind, string> = {
  seed: '小苗——完成一段 30 分鐘就會長成松樹',
  seedPast: '沒長大的小苗（過去的日子）',
  sprout: '澆水中——專注結束就長成松樹',
  tree: '完成的一段專注',
  gold: '超標的一段——金星松樹',
  withered: '中途放棄枯掉的一棵，點一下清除',
}
