import { beforeEach, describe, expect, it } from 'vitest'
import {
  autoBackup,
  daysSinceExport,
  exportBackupAsFile,
  importAll,
  listBackups,
  markExported,
  saveDay,
} from '../storage'

const DAY = '2026-08-29'

beforeEach(() => {
  localStorage.clear()
})

describe('備份匯出：帶離這台裝置', () => {
  const seed = () => {
    saveDay(DAY, {
      mit: '把備份做完',
      answers: { m0: '今天想清楚了一件事' },
      habitsDone: {},
      tasks: [],
      focusSessions: [],
      score: null,
      mood: null,
    } as never)
    autoBackup(DAY)
  }

  it('匯出的檔案能原封不動匯回來（往返不掉資料）', () => {
    seed()
    const [b] = listBackups()
    expect(b).toBeDefined()

    const file = exportBackupAsFile(b.date)
    const parsed = JSON.parse(file) as { app: string; backupOf: string; data: Record<string, unknown> }
    expect(parsed.app).toBe('inkday-planner')
    expect(parsed.backupOf).toBe(b.date)

    // 清光模擬「換手機／清瀏覽器資料」，再從檔案救回來
    localStorage.clear()
    const n = importAll(file)
    expect(n).toBeGreaterThan(0)
    expect(JSON.parse(localStorage.getItem(`pp:day:${DAY}`)!).mit).toBe('把備份做完')
  })

  it('找不到的日期要明確報錯，不是回一個空檔讓人以為有備份', () => {
    expect(() => exportBackupAsFile('1999-01-01')).toThrow('找不到該備份')
  })

  it('沒匯出過回 null；匯出後歸零', () => {
    expect(daysSinceExport()).toBeNull()
    markExported()
    expect(daysSinceExport()).toBe(0)
  })
})
