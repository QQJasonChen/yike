// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { applyWidgetAction } from '../widgetSync'
import { emptyDay, type DayEntry } from '../types'

const dayWith = (tasks: Partial<DayEntry['tasks'][number]>[]): DayEntry => ({
  ...emptyDay(),
  tasks: tasks.map((t) => ({
    text: '',
    target: null,
    done: 0,
    actual: null,
    completed: false,
    ...t,
  })) as DayEntry['tasks'],
})

describe('applyWidgetAction', () => {
  it('toggleMit 翻轉第一個任務的 completed', () => {
    const day = dayWith([{ text: '錄影片', completed: false }])
    const out = applyWidgetAction(day, { type: 'toggleMit', date: '2026-07-29' })
    expect(out.tasks[0].completed).toBe(true)
    const back = applyWidgetAction(out, { type: 'toggleMit', date: '2026-07-29' })
    expect(back.tasks[0].completed).toBe(false)
  })

  it('tick 讓第一個任務 done +1，並同步 actual', () => {
    const day = dayWith([{ text: '錄影片', done: 2, target: 4 }])
    const out = applyWidgetAction(day, { type: 'tick', date: '2026-07-29', taskIndex: 0 })
    expect(out.tasks[0].done).toBe(3)
    expect(out.tasks[0].actual).toBe(3)
  })

  it('tick 沒設 target 也能塗', () => {
    const day = dayWith([{ text: '散步', done: 0, target: null }])
    const out = applyWidgetAction(day, { type: 'tick', date: '2026-07-29' })
    expect(out.tasks[0].done).toBe(1)
  })

  it('tick 塗到 MAX_SEGS(16) 封頂，不會爆格', () => {
    let day = dayWith([{ text: '衝刺', done: 16, target: 8 }])
    day = applyWidgetAction(day, { type: 'tick', date: '2026-07-29' })
    expect(day.tasks[0].done).toBe(16)
  })

  it('空任務清單時原樣回傳、不炸', () => {
    const day = dayWith([])
    expect(applyWidgetAction(day, { type: 'toggleMit', date: '2026-07-29' }).tasks).toHaveLength(0)
    expect(applyWidgetAction(day, { type: 'tick', date: '2026-07-29' }).tasks).toHaveLength(0)
  })

  it('不變動原物件（純函數）', () => {
    const day = dayWith([{ text: '錄影片', done: 1, completed: false }])
    const snapshot = JSON.stringify(day)
    applyWidgetAction(day, { type: 'tick', date: '2026-07-29' })
    applyWidgetAction(day, { type: 'toggleMit', date: '2026-07-29' })
    expect(JSON.stringify(day)).toBe(snapshot)
  })
})
