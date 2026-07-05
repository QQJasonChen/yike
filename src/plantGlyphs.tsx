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

/** 種子：飽滿的一大粒（實心）＋ 冒出的小芽尖——一眼看出「這裡種了東西」 */
const Seed = () => (
  <G>
    <ellipse cx="8" cy="10.2" rx="3.1" ry="3.9" fill="currentColor" stroke="none" />
    <path d="M8 6.2 Q7.6 4.6 6.2 3.9" strokeWidth="1.7" />
    <path d="M8 6.2 Q8.6 5 10 4.6" strokeWidth="1.7" />
  </G>
)

/** 生長中小芽：短莖 + 左右兩片填色葉（計時中，配澆水動畫） */
const Sprout = () => (
  <G>
    <path d="M8 14 V8.2" strokeWidth="1.7" />
    <path d="M8 10.6 Q4.8 10.2 4 6.6 Q7.4 7 8 10.6Z" fill="currentColor" fillOpacity="0.45" />
    <path d="M8 9 Q11.2 8.4 12 5.2 Q8.6 5.6 8 9Z" fill="currentColor" fillOpacity="0.45" />
  </G>
)

/** 小樹：粗幹 + 大片填色樹冠——夠大夠綠，一格一棵有實體感 */
const Tree = () => (
  <G>
    <path d="M8 14.4 V8" strokeWidth="1.9" />
    <path d="M8 11 Q6.6 10.4 5.8 9" />
    <path d="M8 6.8 Q3.6 6.6 3 3.4 Q6 1.6 8.6 3.4 Q11.6 1.8 13 3.8 Q12.4 6.8 8 6.8Z"
      fill="currentColor" fillOpacity="0.55" />
    <path d="M4.6 8.8 Q2.6 8.2 2.6 6.2 Q4.8 5.8 5.8 7.4 Q5.6 8.6 4.6 8.8Z"
      fill="currentColor" fillOpacity="0.4" />
    <path d="M11.4 8.8 Q13.4 8.2 13.4 6.2 Q11.2 5.8 10.2 7.4 Q10.4 8.6 11.4 8.8Z"
      fill="currentColor" fillOpacity="0.4" />
  </G>
)

/** 燙金小花：直莖 + 填色五瓣 + 花心（超標的那段） */
const GoldBloom = () => (
  <G>
    <path d="M8 14.4 Q7.6 11 8 8.6" strokeWidth="1.7" />
    <path d="M8 11.4 Q10 11 10.8 9.6" />
    <path d="M8 2.4 a2.6 2.6 0 0 1 3 2.1 a2.6 2.6 0 0 1 -1.2 3.4 a2.6 2.6 0 0 1 -3.6 0 a2.6 2.6 0 0 1 -1.2 -3.4 a2.6 2.6 0 0 1 3 -2.1Z"
      fill="currentColor" fillOpacity="0.5" />
    <circle cx="8" cy="5.4" r="1.5" fill="currentColor" stroke="none" />
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
  seed: <Seed />,
  seedPast: <Seed />,
  sprout: <Sprout />,
  tree: <Tree />,
  gold: <GoldBloom />,
  withered: <Withered />,
}

export const PLANT_TITLES: Record<CellKind, string> = {
  seed: '種子——完成一段 30 分鐘就會長成小樹',
  seedPast: '未發芽的種子（過去的日子）',
  sprout: '澆水中——專注結束就長成小樹',
  tree: '完成的一段專注',
  gold: '超標的一段——開出金花',
  withered: '中途放棄枯掉的一棵，點一下清除',
}
