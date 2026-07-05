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

// 褐色分岔樹幹（茂密樹與櫻花共用；canopy 由各自疊上去）
const OakTrunk = () => (
  <path
    d="M8 15.4 V8.4 M8 10.8 Q6 9.8 5.2 7.8 M8 9.6 Q10 8.8 10.8 7"
    stroke="#7a5334"
    strokeWidth="1.6"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
)

/** 50 分 · 茂密樹：粗褐色分岔幹 + 寬大蓬鬆綠冠（橡樹式，比松樹壯得多） */
const Lush = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="5" r="4.4" fill="currentColor" fillOpacity="0.9" />
    <circle cx="4.3" cy="6.2" r="2.9" fill="currentColor" fillOpacity="0.78" />
    <circle cx="11.7" cy="6.2" r="2.9" fill="currentColor" fillOpacity="0.78" />
    <circle cx="5.8" cy="3" r="2.5" fill="currentColor" fillOpacity="0.95" />
    <circle cx="10.2" cy="3" r="2.5" fill="currentColor" fillOpacity="0.95" />
    <circle cx="8" cy="2.2" r="2.3" fill="currentColor" />
    <OakTrunk />
  </svg>
)

/** 120 分 · 大櫻花：粗褐色分岔幹 + 寬大粉紅花冠 + 深粉花簇 + 飄落花瓣（原創扁平 icon） */
const Cherry = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="5" r="4.4" fill="#f2a6c2" />
    <circle cx="4.3" cy="6.2" r="2.9" fill="#ef9bba" />
    <circle cx="11.7" cy="6.2" r="2.9" fill="#ef9bba" />
    <circle cx="5.8" cy="3" r="2.5" fill="#f7bcd2" />
    <circle cx="10.2" cy="3" r="2.5" fill="#f7bcd2" />
    <circle cx="8" cy="2.2" r="2.3" fill="#f9c6da" />
    <circle cx="6.2" cy="4.4" r="0.85" fill="#dd7ba0" />
    <circle cx="9.8" cy="4.4" r="0.85" fill="#dd7ba0" />
    <circle cx="8" cy="6.2" r="0.85" fill="#dd7ba0" />
    <OakTrunk />
    <ellipse cx="12.6" cy="11.4" rx="0.9" ry="1.4" fill="#f2a6c2" transform="rotate(35 12.6 11.4)" />
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

/** 成長圖例：灰苗 → 松樹/茂密樹/櫻花（依專注時長）→ 枯樹。設定頁展示用。 */
export const PlantLegend = () => {
  const items: { node: ReactNode; cls: string; label: string }[] = [
    { node: <Seedling />, cls: 'seed', label: '還沒種' },
    { node: <Pine />, cls: 'tree', label: '25 分 松樹' },
    { node: <Lush />, cls: 'tree', label: '50 分 茂密樹' },
    { node: <Cherry />, cls: 'cherry', label: '120 分 櫻花' },
    { node: <Withered />, cls: 'withered', label: '放棄枯萎' },
  ]
  return (
    <div className="plant-legend">
      {items.map((it) => (
        <div key={it.label} className="plant-legend-item">
          <span className={`plant-cell ${it.cls}`}>{it.node}</span>
          <span className="plant-legend-label">{it.label}</span>
        </div>
      ))}
    </div>
  )
}

export const PLANT_TITLES: Record<CellKind, string> = {
  seed: '小苗——專注結束就長成樹（越久種越大棵）',
  seedPast: '沒長大的小苗（過去的日子）',
  sprout: '澆水中——專注結束就長成樹',
  tree: '完成的一段專注',
  gold: '超標的一段——多種的一棵',
  withered: '中途放棄枯掉的一棵，點一下清除',
}
