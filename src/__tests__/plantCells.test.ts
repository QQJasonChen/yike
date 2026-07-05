import { beforeEach, describe, expect, it } from 'vitest'
import { clickDone, plantCells } from '../plantCells'
import { loadSettings } from '../storage'

const base = { target: null, done: 0, withered: 0, growing: false, isPast: false }

describe('plantCells 狀態機', () => {
  it('空任務至少 1 顆種子', () => {
    expect(plantCells(base)).toEqual(['seed'])
  })

  it('target 4 done 2 → 樹樹種種', () => {
    expect(plantCells({ ...base, target: 4, done: 2 })).toEqual(['tree', 'tree', 'seed', 'seed'])
  })

  it('超過 target 的樹開金花；無 target 全樹無金花', () => {
    expect(plantCells({ ...base, target: 2, done: 3 })).toEqual(['tree', 'tree', 'gold'])
    expect(plantCells({ ...base, done: 2 })).toEqual(['tree', 'tree'])
  })

  it('枯樹排在樹後、佔格會撐大 count', () => {
    expect(plantCells({ ...base, target: 3, done: 1, withered: 1 })).toEqual(['tree', 'withered', 'seed'])
    expect(plantCells({ ...base, target: 2, done: 2, withered: 1 })).toEqual(['tree', 'tree', 'withered'])
  })

  it('計時中：sprout 在 done+withered 位置；格子已滿會臨時多長一格', () => {
    expect(plantCells({ ...base, target: 3, done: 1, growing: true })).toEqual(['tree', 'sprout', 'seed'])
    expect(plantCells({ ...base, target: 2, done: 2, growing: true })).toEqual(['tree', 'tree', 'sprout'])
    expect(plantCells({ ...base, target: 3, done: 1, withered: 1, growing: true })).toEqual([
      'tree',
      'withered',
      'sprout',
    ])
  })

  it('過去日期：剩餘種子變 seedPast，樹與枯樹不變', () => {
    expect(plantCells({ ...base, target: 3, done: 1, withered: 1, isPast: true })).toEqual([
      'tree',
      'withered',
      'seedPast',
    ])
  })

  it('上限 16 棵樹；枯樹佔格不吃掉種樹額度', () => {
    expect(plantCells({ ...base, target: 16, done: 16 })).toHaveLength(16)
    expect(plantCells({ ...base, target: 16, done: 16, withered: 2 })).toHaveLength(18) // 16 樹 + 2 枯
    expect(plantCells({ ...base, target: 30, done: 0 })).toHaveLength(16) // target 超上限截斷
  })
})

describe('clickDone 點擊語意', () => {
  it('點已種的樹：toggle（點最後一棵退一格）', () => {
    expect(clickDone(1, 2, 0)).toBe(1) // 點第 2 棵（最後）→ 退到 1
    expect(clickDone(0, 2, 0)).toBe(1) // 點第 1 棵 → 到 1
  })

  it('點枯樹格 → null（呼叫端清除 withered）', () => {
    expect(clickDone(1, 1, 2)).toBeNull()
    expect(clickDone(2, 1, 2)).toBeNull()
  })

  it('點種子：扣掉枯樹佔位後 +1', () => {
    expect(clickDone(3, 1, 2)).toBe(2) // 視覺第 4 格 - 2 枯樹 = done 2
    expect(clickDone(0, 0, 0)).toBe(1)
  })

  it('clamp 上限 16', () => {
    expect(clickDone(20, 16, 0)).toBe(16)
  })
})

describe('focusStyle 設定', () => {
  beforeEach(() => localStorage.clear())

  it('預設是種樹；舊 settings 資料自動補上', () => {
    expect(loadSettings().focusStyle).toBe('tree')
    localStorage.setItem('pp:settings', JSON.stringify({ focusMinutes: 30 })) // 舊資料無 focusStyle
    const s = loadSettings()
    expect(s.focusStyle).toBe('tree')
    expect(s.focusMinutes).toBe(30)
  })
})
