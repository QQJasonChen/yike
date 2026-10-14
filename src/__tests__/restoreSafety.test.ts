// 還原備份／從檔案匯入之前必須先照一張安全快照，照不成就不准動。
// 每日快照一天只照一張，早上照過之後寫的東西都不在裡面——使用者下午按
// 「還原昨天」，今天寫的就沒了，而且還原完會標 dirty 推上雲端把雲端那份也蓋掉。
import { beforeEach, describe, expect, it } from 'vitest'
import { DayEntry, emptyDay, emptyTask } from '../types'
import {
  autoBackup,
  exportAll,
  importAll,
  listBackups,
  loadDay,
  restoreBackup,
  saveDay,
  setDataOwner,
  toDateKey,
} from '../storage'

const BOB = 'bbbbbbbb-2222-2222-2222-222222222222'
const day = (mit: string): DayEntry => ({ ...emptyDay(), tasks: [{ ...emptyTask(), text: mit }] })
const todayKey = toDateKey(new Date())

beforeEach(() => {
  localStorage.clear()
  setDataOwner(BOB)
})

describe('restoreBackup 先照安全快照', () => {
  it('還原舊備份之後，今天的內容還救得回來', () => {
    saveDay('2026-09-01', day('昨天的'))
    expect(autoBackup('2026-09-01')).toBe(true)
    saveDay('2026-09-01', day('今天下午改過的')) // 早上快照之後的修改
    const old = listBackups().find((b) => !b.pre)!
    restoreBackup(old.id)
    expect(loadDay('2026-09-01').tasks[0].text).toBe('昨天的')
    // 安全快照存在、標成 pre、內容是還原前的現況
    const pre = listBackups().find((b) => b.pre)
    expect(pre).toBeTruthy()
    expect(pre!.date).toBe(todayKey)
    restoreBackup(pre!.id)
    expect(loadDay('2026-09-01').tasks[0].text).toBe('今天下午改過的')
  })

  it('安全快照存不下 → 丟錯，現有資料一個字都不動', () => {
    saveDay('2026-09-01', day('原本的'))
    expect(autoBackup('2026-09-01')).toBe(true)
    saveDay('2026-09-01', day('之後改的'))
    const old = listBackups().find((b) => !b.pre)!
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k.endsWith('~pre')) throw new DOMException('quota', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
    try {
      expect(() => restoreBackup(old.id)).toThrow('安全快照存不下')
    } finally {
      Storage.prototype.setItem = orig
    }
    expect(loadDay('2026-09-01').tasks[0].text).toBe('之後改的')
  })

  it('還原「今天」自己的快照：安全快照寫到別的 key，不會先把要還原的那份毀掉', () => {
    saveDay(todayKey, day('早上的'))
    expect(autoBackup(todayKey)).toBe(true)
    saveDay(todayKey, day('下午改壞了'))
    const daily = listBackups().find((b) => !b.pre)!
    restoreBackup(daily.id)
    expect(loadDay(todayKey).tasks[0].text).toBe('早上的') // 要還原的那份沒被覆蓋
    expect(listBackups().filter((b) => b.date === todayKey)).toHaveLength(2) // 每日 + pre
  })

  it('安全快照不佔每日 7 份的名額', () => {
    for (let d = 1; d <= 7; d++) {
      saveDay(`2026-09-0${d}`, day(`d${d}`))
      expect(autoBackup(`2026-09-0${d}`)).toBe(true)
    }
    expect(listBackups().filter((b) => !b.pre)).toHaveLength(7)
    restoreBackup(listBackups().find((b) => !b.pre)!.id) // 產生一份 pre
    // 輪替發生在「下一次每日快照」。pre 如果被算進名額，這裡會變成 6 份每日。
    saveDay('2026-09-08', day('d8'))
    expect(autoBackup('2026-09-08')).toBe(true)
    expect(listBackups().filter((b) => !b.pre)).toHaveLength(7)
    expect(listBackups().filter((b) => b.pre)).toHaveLength(1)
  })
})

describe('importAll 先照安全快照', () => {
  it('匯入覆蓋同名 key 之前有得後悔', () => {
    saveDay('2026-09-01', day('現在的'))
    const file = exportAll()
    saveDay('2026-09-01', day('匯入前又改了'))
    importAll(file)
    expect(loadDay('2026-09-01').tasks[0].text).toBe('現在的')
    const pre = listBackups().find((b) => b.pre)!
    restoreBackup(pre.id)
    expect(loadDay('2026-09-01').tasks[0].text).toBe('匯入前又改了')
  })

  it('安全快照存不下 → 匯入不執行', () => {
    saveDay('2026-09-01', day('現在的'))
    const file = exportAll()
    saveDay('2026-09-01', day('改了'))
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k.endsWith('~pre')) throw new DOMException('quota', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
    try {
      expect(() => importAll(file)).toThrow('安全快照存不下')
    } finally {
      Storage.prototype.setItem = orig
    }
    expect(loadDay('2026-09-01').tasks[0].text).toBe('改了')
  })
})
