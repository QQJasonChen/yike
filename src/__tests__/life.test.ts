import { beforeEach, describe, expect, it } from 'vitest'
import { loadLife, saveLife } from '../storage'

// 奧德賽儀表板欄位是後加的（resources/confidence/coherence/questions）——
// 這裡保證「已填過的舊資料」在新版讀寫下一個字都不會掉。

const LEGACY_LIFE = {
  northStar: '中文界 AI 第二大腦',
  goals: [{ text: '旗艦課上線', done: false }],
  startYear: 2026,
  odyssey: [
    { title: '現在這條路', body: '已填的五年想像，很長很重要的一段話', excitement: 4 },
    { title: '如果它消失了', body: '', excitement: 0 },
    { title: '不管錢與面子', body: '回台灣開工作室', excitement: 5 },
  ],
  odysseyOpen: true,
}

describe('loadLife 奧德賽舊資料相容', () => {
  beforeEach(() => localStorage.clear())

  it('舊 shape（只有 title/body/excitement）完整保留，新欄位補預設', () => {
    localStorage.setItem('pp:life', JSON.stringify(LEGACY_LIFE))
    const life = loadLife()
    expect(life.northStar).toBe('中文界 AI 第二大腦')
    expect(life.odyssey[0].title).toBe('現在這條路')
    expect(life.odyssey[0].body).toBe('已填的五年想像，很長很重要的一段話')
    expect(life.odyssey[0].excitement).toBe(4)
    expect(life.odyssey[2].body).toBe('回台灣開工作室')
    expect(life.odyssey[2].excitement).toBe(5)
    // 新欄位自動補預設
    expect(life.odyssey[0].resources).toBe(0)
    expect(life.odyssey[0].confidence).toBe(0)
    expect(life.odyssey[0].coherence).toBe(0)
    expect(life.odyssey[0].questions).toBe('')
  })

  it('填了新欄位後 round-trip，舊欄位一個不掉', () => {
    localStorage.setItem('pp:life', JSON.stringify(LEGACY_LIFE))
    const life = loadLife()
    life.odyssey[0] = { ...life.odyssey[0], resources: 3, questions: '簽證怎麼辦？' }
    saveLife(life)
    const again = loadLife()
    expect(again.odyssey[0].body).toBe('已填的五年想像，很長很重要的一段話')
    expect(again.odyssey[0].excitement).toBe(4)
    expect(again.odyssey[0].resources).toBe(3)
    expect(again.odyssey[0].questions).toBe('簽證怎麼辦？')
    expect(again.odyssey[2].body).toBe('回台灣開工作室')
  })

  it('完全沒存過 → 給三條預設路，不炸', () => {
    const life = loadLife()
    expect(life.odyssey).toHaveLength(3)
    expect(life.odyssey[0].title).toBe('現在這條路')
    expect(life.odyssey[0].questions).toBe('')
  })
})
