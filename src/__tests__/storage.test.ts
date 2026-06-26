import { beforeEach, describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  allDataKeys,
  currentStreak,
  exportAll,
  fromDateKey,
  importAll,
  isoWeekOf,
  autoBackup,
  closeSyncGate,
  listBackups,
  loadDay,
  loadLife,
  loadMeta,
  loadSettings,
  mondayOf,
  monthOf,
  nameStats,
  openSyncGate,
  recentNames,
  restoreBackup,
  saveDay,
  saveLife,
  saveSettings,
  saveWeek,
  setOnDataWrite,
  toDateKey,
} from '../storage'
import { defaultSettings } from '../types'
import { emptyDay, emptyWeek } from '../types'
import type { DayEntry } from '../types'

beforeEach(() => localStorage.clear())

describe('date utils', () => {
  it('toDateKey / fromDateKey round-trip in local time', () => {
    const d = new Date(2026, 5, 13) // 2026-06-13
    expect(toDateKey(d)).toBe('2026-06-13')
    expect(toDateKey(fromDateKey('2026-06-13'))).toBe('2026-06-13')
  })

  it('addDays handles month and year boundaries', () => {
    expect(addDays('2026-06-13', 1)).toBe('2026-06-14')
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-06-13', 7)).toBe('2026-06-20')
  })

  it('mondayOf returns the Monday of that week', () => {
    // 2026-06-13 is a Saturday → Monday is 2026-06-08
    expect(mondayOf('2026-06-13')).toBe('2026-06-08')
    // Monday maps to itself
    expect(mondayOf('2026-06-08')).toBe('2026-06-08')
    // Sunday maps back to that week's Monday
    expect(mondayOf('2026-06-14')).toBe('2026-06-08')
  })

  it('isoWeekOf is stable within a week and increments across weeks', () => {
    const monday = fromDateKey('2026-06-08')
    const sunday = fromDateKey('2026-06-14')
    const nextMonday = fromDateKey('2026-06-15')
    expect(isoWeekOf(monday)).toBe(isoWeekOf(sunday))
    expect(isoWeekOf(nextMonday)).toBe(isoWeekOf(monday) + 1)
  })

  it('monthOf / addMonths', () => {
    expect(monthOf('2026-06-13')).toBe('2026-06')
    expect(addMonths('2026-06', 1)).toBe('2026-07')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })
})

describe('day persistence + legacy migration', () => {
  it('saveDay / loadDay round-trips', () => {
    const d = emptyDay()
    d.tasks[0] = { text: '讀荷蘭文', target: 2, done: 1, actual: null, completed: false }
    d.score = 4
    saveDay('2026-06-13', d)
    const back = loadDay('2026-06-13')
    expect(back.tasks[0].text).toBe('讀荷蘭文')
    expect(back.score).toBe(4)
  })

  it('migrates v1 fixed fields into answers', () => {
    localStorage.setItem(
      'pp:day:2026-06-10',
      JSON.stringify({
        tasks: [],
        blocks: [],
        gratitude: '謝謝',
        intention: '專注',
        highlight: '交付影片',
      })
    )
    const d = loadDay('2026-06-10')
    expect(d.answers.m0).toBe('謝謝')
    expect(d.answers.m1).toBe('專注')
    expect(d.answers.e0).toBe('交付影片')
    expect(d.habitsDone).toEqual({})
  })
})

describe('nameStats — daily + planning aggregation', () => {
  it('aggregates days/sessions/minutes and counts planning appearances', () => {
    const mk = (text: string): DayEntry => {
      const d = emptyDay()
      d.tasks[0] = { text, target: 2, done: 2, actual: 2, completed: true }
      d.blocks = [{ id: 'b1', start: 540, end: 600, text, taskIndex: 0 }] // 60 min
      return d
    }
    saveDay('2026-06-12', mk('讀荷蘭文'))
    saveDay('2026-06-13', mk('讀荷蘭文'))

    // planning item with the same name (week plan)
    const w = emptyWeek()
    w.tasks[0] = { text: '讀荷蘭文', done: false, span: [0, 4] }
    saveWeek('2026-06-08', w)

    const stats = nameStats()
    const dutch = stats.find((s) => s.name === '讀荷蘭文')
    expect(dutch).toBeTruthy()
    expect(dutch!.days).toBe(2)
    expect(dutch!.sessions).toBe(4) // 2 done × 2 days
    expect(dutch!.minutes).toBe(120) // 60 × 2 days
    expect(dutch!.plans).toBe(1) // appears once in week plan
  })

  it('recentNames returns trimmed names', () => {
    const d = emptyDay()
    d.tasks[0] = { text: '重訓', target: 1, done: 1, actual: 1, completed: false }
    saveDay('2026-06-13', d)
    expect(recentNames()).toContain('重訓')
  })
})

describe('life persistence', () => {
  it('returns an empty life entry with 3 odyssey paths when nothing saved', () => {
    const life = loadLife()
    expect(life.northStar).toBe('')
    expect(life.odyssey).toHaveLength(3)
    expect(life.goals.length).toBeGreaterThan(0)
  })

  it('round-trips north star, goals and odyssey', () => {
    const life = loadLife()
    life.northStar = '成為中文界 AI 第二大腦代言人'
    life.goals[0] = { text: '出一本書', done: false, span: [0, 2] }
    life.odyssey[2] = { title: '不管錢與面子', body: '環球航海', excitement: 4 }
    saveLife(life)

    const back = loadLife()
    expect(back.northStar).toBe('成為中文界 AI 第二大腦代言人')
    expect(back.goals[0].span).toEqual([0, 2])
    expect(back.odyssey[2].excitement).toBe(4)
  })

  it('backfills missing odyssey paths from older saved data', () => {
    localStorage.setItem('pp:life', JSON.stringify({ northStar: 'x', odyssey: [{ title: 'A', body: '', excitement: 1 }] }))
    const life = loadLife()
    expect(life.odyssey).toHaveLength(3)
    expect(life.odyssey[0].title).toBe('A')
    expect(life.odyssey[2].title).toBe('不管錢與面子')
  })

  it('feeds life goals into nameStats planning counts', () => {
    const life = loadLife()
    life.goals[0] = { text: '寫小說', done: false }
    saveLife(life)
    const stat = nameStats().find((s) => s.name === '寫小說')
    expect(stat?.plans).toBe(1)
  })
})

describe('export / import', () => {
  it('round-trips all pp: data and excludes sync settings', () => {
    const d = emptyDay()
    d.score = 5
    saveDay('2026-06-13', d)
    localStorage.setItem('pp:sync', JSON.stringify({ token: 'secret' }))

    const json = exportAll()
    expect(json).not.toContain('secret') // sync settings excluded
    expect(allDataKeys()).toContain('pp:day:2026-06-13')

    localStorage.clear()
    const count = importAll(json)
    expect(count).toBeGreaterThan(0)
    expect(loadDay('2026-06-13').score).toBe(5)
  })

  it('importAll throws on malformed payload', () => {
    expect(() => importAll('{"nope":1}')).toThrow()
  })
})

describe('habit auto-recovery', () => {
  const dayWith = (habits: string[]): DayEntry => {
    const d = emptyDay()
    habits.forEach((h) => (d.habitsDone[h] = true))
    return d
  }

  it('rebuilds an empty habit list from day history once', () => {
    saveDay('2026-06-13', dayWith(['讀荷蘭文', '運動']))
    saveDay('2026-06-12', dayWith(['讀荷蘭文', '冥想']))
    // settings 的習慣清單被清空（模擬資料遺失）
    saveSettings({ ...defaultSettings(), habits: [] })

    const s = loadSettings()
    expect(new Set(s.habits)).toEqual(new Set(['讀荷蘭文', '運動', '冥想']))
    // 已持久化
    expect(new Set(loadSettings().habits)).toEqual(new Set(['讀荷蘭文', '運動', '冥想']))
  })

  it('does not resurrect habits the user later clears (only restores once)', () => {
    saveDay('2026-06-13', dayWith(['讀荷蘭文']))
    saveSettings({ ...defaultSettings(), habits: [] })
    loadSettings() // 第一次救援 → 補回 讀荷蘭文

    // 使用者刻意清空
    saveSettings({ ...defaultSettings(), habits: [] })
    expect(loadSettings().habits).toEqual([]) // 不再自動補回
  })

  it('does not sync the device-local restore flag', () => {
    saveDay('2026-06-13', dayWith(['讀荷蘭文']))
    saveSettings({ ...defaultSettings(), habits: [] })
    loadSettings()
    expect(allDataKeys()).not.toContain('pp:habitsAutoRestored')
  })
})

describe('sync gate (pull-before-write)', () => {
  it('defers meta bump + push while gate closed, flushes on open', () => {
    const pushed: string[] = []
    setOnDataWrite((k) => pushed.push(k))
    closeSyncGate()
    saveDay('2026-06-13', { ...emptyDay(), score: 4 })
    // 閘門關閉：localStorage 有寫入，但 meta 不動、push 不觸發
    expect(loadDay('2026-06-13').score).toBe(4)
    expect(loadMeta()['pp:day:2026-06-13']).toBeUndefined()
    expect(pushed).toEqual([])
    openSyncGate()
    // 打開後：補 bump meta + 觸發推送
    expect(loadMeta()['pp:day:2026-06-13']).toBeGreaterThan(0)
    expect(pushed).toContain('pp:day:2026-06-13')
    setOnDataWrite(null)
  })

  it('writes after gate opens bump meta normally', () => {
    closeSyncGate()
    openSyncGate()
    saveDay('2026-06-14', { ...emptyDay(), score: 2 })
    expect(loadMeta()['pp:day:2026-06-14']).toBeGreaterThan(0)
  })
})

describe('local backup safety net', () => {
  it('snapshots data and restores it after loss', () => {
    saveDay('2026-06-13', { ...emptyDay(), score: 5 })
    autoBackup('2026-06-13')
    const list = listBackups()
    expect(list.length).toBe(1)
    expect(list[0].date).toBe('2026-06-13')
    // 模擬資料遺失
    localStorage.removeItem('pp:day:2026-06-13')
    expect(loadDay('2026-06-13').score).not.toBe(5)
    const n = restoreBackup('2026-06-13')
    expect(n).toBeGreaterThan(0)
    expect(loadDay('2026-06-13').score).toBe(5)
  })

  it('only snapshots once per day', () => {
    saveDay('2026-06-13', { ...emptyDay(), score: 5 })
    autoBackup('2026-06-13')
    autoBackup('2026-06-13')
    expect(listBackups().length).toBe(1)
  })

  it('skips backup when there is no data', () => {
    autoBackup('2026-06-13')
    expect(listBackups().length).toBe(0)
  })

  it('keeps only the last 7 daily snapshots (newest first)', () => {
    for (let d = 1; d <= 10; d++) {
      const dk = `2026-06-${String(d).padStart(2, '0')}`
      saveDay(dk, { ...emptyDay(), score: 3 })
      autoBackup(dk)
    }
    const list = listBackups()
    expect(list.length).toBe(7)
    expect(list[0].date).toBe('2026-06-10')
    expect(list.some((b) => b.date === '2026-06-01')).toBe(false)
  })

  it('excludes backups from sync keys', () => {
    saveDay('2026-06-13', { ...emptyDay(), score: 5 })
    autoBackup('2026-06-13')
    expect(allDataKeys().some((k) => k.startsWith('pp:bk:'))).toBe(false)
    expect(allDataKeys()).not.toContain('pp:lastBackup')
  })
})

describe('currentStreak', () => {
  it('counts consecutive recorded days back from today', () => {
    saveDay('2026-06-13', emptyDay())
    saveDay('2026-06-12', emptyDay())
    saveDay('2026-06-11', emptyDay())
    // gap at 06-10
    saveDay('2026-06-09', emptyDay())
    expect(currentStreak('2026-06-13')).toBe(3)
  })
})
