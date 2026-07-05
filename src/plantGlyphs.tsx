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

/** 雙葉小苗：矮短莖 + 兩片小葉，綠色。種下與生長中共用（生長中另加澆水動畫）。
 *  刻意畫矮，讓後面長成的樹在對比下明顯更高大。 */
const Seedling = () => (
  <G>
    <path d="M8 14 V10.6" strokeWidth="1.7" />
    <path d="M8 12 Q5.6 11.8 5 9.4 Q7.4 9.6 8 12Z" fill="currentColor" fillOpacity="0.55" />
    <path d="M8 11 Q10.4 10.6 11 8.4 Q8.6 8.8 8 11Z" fill="currentColor" fillOpacity="0.55" />
  </G>
)

/** 25 分 · 松樹：粗幹 + 三層三角樹冠（中等） */
const Pine = () => (
  <G>
    <rect x="7.2" y="12.6" width="1.6" height="2.4" rx="0.4" fill="currentColor" stroke="none" />
    <path d="M8 7.8 L11.8 13 L4.2 13 Z" fill="currentColor" fillOpacity="0.72" />
    <path d="M8 4.8 L11 9.2 L5 9.2 Z" fill="currentColor" fillOpacity="0.82" />
    <path d="M8 2.2 L10.2 6 L5.8 6 Z" fill="currentColor" fillOpacity="0.92" />
  </G>
)

/** 50 分 · 茂密樹：更寬更高、四層樹冠，明顯比松樹壯 */
const Lush = () => (
  <G>
    <rect x="7.1" y="13" width="1.8" height="2.2" rx="0.4" fill="currentColor" stroke="none" />
    <path d="M8 9 L13.4 13.4 L2.6 13.4 Z" fill="currentColor" fillOpacity="0.68" />
    <path d="M8 6.2 L12.4 10.4 L3.6 10.4 Z" fill="currentColor" fillOpacity="0.78" />
    <path d="M8 3.6 L11.4 7.6 L4.6 7.6 Z" fill="currentColor" fillOpacity="0.88" />
    <path d="M8 1.2 L10.2 4.8 L5.8 4.8 Z" fill="currentColor" fillOpacity="0.96" />
  </G>
)

/** 120 分 · 大櫻花：褐幹 + 粉紅蓬鬆花冠 + 幾點深粉花簇（固定色，最華麗） */
const Cherry = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="7.1" y="10" width="1.8" height="5" rx="0.5" fill="#8a5a3c" />
    <path d="M7.8 12 Q6 11.4 5 12.4" stroke="#8a5a3c" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    <path d="M8.2 11 Q10.2 10.4 11.2 11.4" stroke="#8a5a3c" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    <circle cx="8" cy="5.4" r="4.2" fill="#f0a9c4" />
    <circle cx="4.9" cy="6.6" r="2.6" fill="#eda0be" />
    <circle cx="11.1" cy="6.6" r="2.6" fill="#eda0be" />
    <circle cx="8" cy="3.4" r="2.4" fill="#f5b8ce" />
    <circle cx="6.4" cy="4.6" r="0.7" fill="#d97ba3" />
    <circle cx="9.4" cy="5" r="0.7" fill="#d97ba3" />
    <circle cx="8" cy="6.8" r="0.7" fill="#d97ba3" />
  </svg>
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

export type TreeTier = 'pine' | 'lush' | 'cherry'

/** 依專注時長選樹種（門檻制：100 分還算 50 分那階） */
export const treeGlyph = (tier: TreeTier): ReactNode =>
  tier === 'cherry' ? <Cherry /> : tier === 'lush' ? <Lush /> : <Pine />

export const TIER_NAME: Record<TreeTier, string> = {
  pine: '松樹',
  lush: '茂密樹',
  cherry: '櫻花樹',
}

/** 非樹狀態的圖示（樹/金星狀態由 treeGlyph 依時長決定） */
export const PLANT_GLYPHS: Partial<Record<CellKind, ReactNode>> = {
  seed: <Seedling />,
  seedPast: <Seedling />,
  sprout: <Seedling />,
  withered: <Withered />,
}

export const PLANT_TITLES: Record<CellKind, string> = {
  seed: '小苗——專注結束就長成樹（越久種越大棵）',
  seedPast: '沒長大的小苗（過去的日子）',
  sprout: '澆水中——專注結束就長成樹',
  tree: '完成的一段專注',
  gold: '超標的一段——加碼的樹（金星）',
  withered: '中途放棄枯掉的一棵，點一下清除',
}
