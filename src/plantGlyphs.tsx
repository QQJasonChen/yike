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
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
)

/** 種子：微彎地平線 + 一粒實心籽 */
const Seed = () => (
  <G>
    <path d="M3 12.6 Q8 11.8 13 12.6" />
    <ellipse cx="8" cy="10.4" rx="1.7" ry="2.1" fill="currentColor" stroke="none" />
  </G>
)

/** 生長中小芽：短莖 + 左右兩片葉（計時中，配澆水動畫） */
const Sprout = () => (
  <G>
    <path d="M3.4 13 Q8 12.2 12.6 13" />
    <path d="M8 12.6 V8.6" />
    <path d="M8 10.6 Q5.6 10.2 5 7.8 Q7.4 8 8 10.6Z" />
    <path d="M8 9.4 Q10.4 9 11 6.8 Q8.6 7 8 9.4Z" />
  </G>
)

/** 墨綠小樹：主幹 + 兩枝 + 筆觸樹冠 */
const Tree = () => (
  <G>
    <path d="M3.4 13.2 Q8 12.4 12.6 13.2" />
    <path d="M8 13 V6.4" />
    <path d="M8 9.6 Q6.4 9 5.4 7.4" />
    <path d="M8 8.4 Q9.8 7.8 10.8 6.2" />
    <path d="M8 6.6 Q5.2 6.2 4.6 3.9 Q7.4 3.2 8.6 5.2 Q10.9 4.4 11.6 6.2 Q10 7.6 8 6.6Z" />
  </G>
)

/** 燙金小花：直莖 + 五瓣 + 實心花心（超標的那段） */
const GoldBloom = () => (
  <G>
    <path d="M3.4 13.2 Q8 12.4 12.6 13.2" />
    <path d="M8 13 Q7.6 10 8 7.6" />
    <path d="M8 11 Q9.8 10.6 10.6 9.4" />
    <path d="M8 5.4 a1.7 1.7 0 0 1 2 1.4 a1.7 1.7 0 0 1 -0.8 2.2 a1.7 1.7 0 0 1 -2.4 0 a1.7 1.7 0 0 1 -0.8 -2.2 a1.7 1.7 0 0 1 2 -1.4Z" />
    <circle cx="8" cy="6.9" r="1" fill="currentColor" stroke="none" />
  </G>
)

/** 枯樹：彎折主幹 + 兩根下垂禿枝 */
const Withered = () => (
  <G>
    <path d="M3.4 13.2 Q8 12.4 12.6 13.2" />
    <path d="M8.4 13 Q8.8 10.4 7.2 8.4 Q6.2 7 7 5" />
    <path d="M7.6 9.6 Q5.8 9.4 5 10.4" />
    <path d="M7.4 7.2 Q9.2 6.6 10 7.4" />
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
