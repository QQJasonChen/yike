import { beforeEach, describe, expect, it } from 'vitest'
import { buildWidgetSnapshot } from '../widgetSync'

// widget 快照組裝：MIT/塗圈/時間軸/本週 的形狀正確，且空資料不炸。

const day = (mit: string, blocks: { start: number; end: number; text: string; color?: string }[]) => ({
  tasks: [
    { text: mit, target: 4, done: 2, actual: null, completed: false },
    { text: '次要任務', target: 2, done: 1, actual: null, completed: true },
    { text: '', target: null, done: 0, actual: null, completed: false },
    { text: '', target: null, done: 0, actual: null, completed: false },
    { text: '', target: null, done: 0, actual: null, completed: false },
  ],
  blocks: blocks.map((b, i) => ({ id: `b${i}`, taskIndex: null, ...b })),
  answers: {},
  mood: null,
  score: null,
  habit: false,
  habitsDone: {},
})

describe('buildWidgetSnapshot', () => {
  beforeEach(() => localStorage.clear())

  it('完全沒資料：回空快照不炸', () => {
    const s = buildWidgetSnapshot('2026-07-05')
    expect(s.date).toBe('2026-07-05')
    expect(s.mit).toBe('')
    expect(s.tasks).toEqual([])
    expect(s.blocks).toEqual([])
    expect(s.week).toHaveLength(7)
  })

  it('MIT/任務/時間軸正確進快照，時間塊按開始時間排序、color 轉 hex', () => {
    localStorage.setItem(
      'pp:day:2026-07-05',
      JSON.stringify(
        day('錄影片', [
          { start: 840, end: 900, text: '下午段', color: 'sage' },
          { start: 540, end: 660, text: '早上段', color: 'indigo' },
        ])
      )
    )
    const s = buildWidgetSnapshot('2026-07-05')
    expect(s.mit).toBe('錄影片')
    expect(s.tasks).toHaveLength(2) // 空白任務被濾掉
    expect(s.tasks[0]).toEqual({ text: '錄影片', done: 2, target: 4, completed: false })
    expect(s.blocks.map((b) => b.text)).toEqual(['早上段', '下午段']) // 排序
    expect(s.blocks[0].color).toMatch(/^#[0-9a-f]{6}$/i) // hex
  })

  it('week 從週一起算 7 天，含每天 MIT 與塊數', () => {
    // 2026-07-05 是週日 → 該週週一是 2026-06-29
    localStorage.setItem('pp:day:2026-06-29', JSON.stringify(day('週一的事', [{ start: 540, end: 600, text: 'x' }])))
    const s = buildWidgetSnapshot('2026-07-05')
    expect(s.week[0].date).toBe('2026-06-29')
    expect(s.week[0].mit).toBe('週一的事')
    expect(s.week[0].blockCount).toBe(1)
    expect(s.week[6].date).toBe('2026-07-05')
  })
})
