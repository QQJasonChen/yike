// 種樹專注（Forest 式）的格子狀態機——純函數，UI 與測試共用。
// 格序：小樹(done) → 枯樹(withered) → 生長中(sprout，計時時) → 種子。
// 超過 target 的樹開金花（沿方格模式的 gold 語意）；過去日期的種子渲染成枯褐（純視覺）。

import { MAX_SEGS } from './types'

export type CellKind = 'seed' | 'seedPast' | 'sprout' | 'tree' | 'gold' | 'withered'

export interface PlantOpts {
  target: number | null
  done: number
  withered: number
  /** 番茄鐘正在此任務上跑（focus 階段、今天） */
  growing: boolean
  /** 過去日期：剩餘種子渲染成枯褐 */
  isPast: boolean
}

export const plantCells = (opts: PlantOpts): CellKind[] => {
  const planned = opts.target ?? 0
  const w = opts.withered
  const growIdx = opts.growing ? opts.done + w : -1
  const count = Math.min(
    Math.max(planned, opts.done + w + (opts.growing ? 1 : 0), 1),
    MAX_SEGS + w // 枯樹佔格不吃掉種樹額度：上限隨枯樹數放寬
  )
  return Array.from({ length: count }, (_, i) => {
    if (i < opts.done) return planned > 0 && i >= planned ? 'gold' : 'tree'
    if (i < opts.done + w) return 'withered'
    if (i === growIdx) return 'sprout'
    return opts.isPast ? 'seedPast' : 'seed'
  })
}

/**
 * 點擊第 i 格（視覺 index）後 done 應變成多少。
 * 回 null = 點到枯樹格（語意是「清除枯樹」，由呼叫端把 withered - 1）。
 * 點已種的樹沿方格模式 toggle：點最後一棵 = 退一格。
 */
export const clickDone = (i: number, done: number, withered: number): number | null => {
  if (i < done) return done === i + 1 ? i : i + 1
  if (i < done + withered) return null
  return Math.min(MAX_SEGS, Math.max(0, i + 1 - withered))
}
