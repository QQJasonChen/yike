import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  autoBackup, claimDeviceFor, clearForLogout, exportAll, exportBackupAsFile, exportConflictAsFile,
  importAll, inspectImport, listBackups, listConflicts, loadDay, loadDirty, loadMeta,
  restoreBackup, saveDay, setDataOwner, setOnDataWrite, stampLegacyBackupOwners,
  writeFromCloud,
} from '../storage'
import { defaultSettings, emptyBizModel, emptyDay, emptyLife, emptyMonth, emptyQuarter, emptyTask, emptyWeek, emptyYear } from '../types'

const A = 'aaaaaaaa-1111-1111-1111-111111111111'
const B = 'bbbbbbbb-2222-2222-2222-222222222222'
const DAY = '2026-10-14'
const KEY = `pp:day:${DAY}`
const day = (text: string) => ({ ...emptyDay(), tasks: [{ ...emptyTask(), text }] })
const envelope = (data: Record<string, unknown>, owner: string | null = A) =>
  JSON.stringify({ app: 'inkday-planner', version: 1, owner, data })

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  setDataOwner(A)
  setOnDataWrite(null)
})

describe('備份整批寫入與 merge', () => {
  it('UUID前8碼相同的兩帳號同日快照也各自保留，不互相覆蓋', () => {
    const first = 'aaaaaaaa-1111-1111-1111-111111111111'
    const second = 'aaaaaaaa-2222-2222-2222-222222222222'
    setDataOwner(first)
    saveDay(DAY, day('first owner'))
    autoBackup(DAY)
    const id = listBackups()[0].id
    const original = localStorage.getItem(`pp:bk:${id}`)
    clearForLogout()
    setDataOwner(second)
    saveDay(DAY, day('second owner'))
    autoBackup(DAY)
    expect(listBackups()).toHaveLength(1)
    expect(listBackups()[0].id).not.toBe(id)
    expect(localStorage.getItem(`pp:bk:${id}`)).toBe(original)
    setDataOwner(first)
    expect(exportBackupAsFile(listBackups()[0].id)).toContain('first owner')
  })
  it('還原快照保留快照外的雲端與離線記錄，不留下缺資料但 meta 已知的洞', () => {
    saveDay(DAY, day('快照內'))
    autoBackup(DAY)
    const id = listBackups()[0].id
    writeFromCloud('pp:day:2026-10-15', day('雲端新的一天'), 5000)
    saveDay('2026-10-16', day('還沒同步的新一天'))
    restoreBackup(id)
    expect(loadDay('2026-10-15').tasks[0].text).toBe('雲端新的一天')
    expect(loadDay('2026-10-16').tasks[0].text).toBe('還沒同步的新一天')
    expect(loadMeta()['pp:day:2026-10-15']).toBe(5000)
    expect(loadDirty()[KEY]).toBeGreaterThan(0)
    expect(listBackups().some((b) => b.pre)).toBe(true)
  })

  for (const action of ['import', 'restore'] as const) {
    it(`${action} 第二筆寫入失敗，第一筆回復、原資料與 dirty 不變，且不通知同步`, () => {
      const key2 = 'pp:day:2026-10-15'
      saveDay(DAY, day('備份一'))
      saveDay('2026-10-15', day('備份二'))
      autoBackup(DAY)
      const id = listBackups()[0].id
      const file = exportAll()
      saveDay(DAY, day('現況一'))
      saveDay('2026-10-15', day('現況二'))
      const before = [localStorage.getItem(KEY), localStorage.getItem(key2)]
      const dirty = localStorage.getItem('ppl:dirty')
      const notify = vi.fn()
      setOnDataWrite(notify)
      const orig = Storage.prototype.setItem
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
        if (k === key2) throw new DOMException('quota', 'QuotaExceededError')
        orig.call(this, k, v)
      })
      expect(() => action === 'import' ? importAll(file) : restoreBackup(id)).toThrow('原資料已保留')
      expect([localStorage.getItem(KEY), localStorage.getItem(key2)]).toEqual(before)
      expect(localStorage.getItem('ppl:dirty')).toBe(dirty)
      expect(notify).not.toHaveBeenCalled()
      expect(localStorage.getItem('ppl:restoreStaging')).toBeNull()
      expect(listBackups().some((b) => b.pre)).toBe(true)
    })
  }

  it('dirty 標記寫不下時資料也回復，不能顯示還原成功', () => {
    saveDay(DAY, day('現況'))
    const original = localStorage.getItem(KEY)
    const orig = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === 'ppl:dirty') throw new DOMException('quota', 'QuotaExceededError')
      orig.call(this, k, v)
    })
    expect(() => importAll(envelope({ [KEY]: day('匯入值') }))).toThrow('原資料已保留')
    expect(localStorage.getItem(KEY)).toBe(original)
  })

  it('復原暫存本身寫不下時，還沒有改動任何現用資料', () => {
    saveDay(DAY, day('現況'))
    const before = localStorage.getItem(KEY)
    const orig = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === 'ppl:restoreStaging') throw new DOMException('quota', 'QuotaExceededError')
      orig.call(this, k, v)
    })
    expect(() => importAll(envelope({ [KEY]: day('匯入') }))).toThrow()
    expect(localStorage.getItem(KEY)).toBe(before)
  })
})

describe('備份檔驗證與帳號預覽', () => {
  it('八個手帳維度與PIP設定的有效JSON能從空白裝置原值還原', () => {
    const data = {
      [KEY]: day('測試資料'), 'pp:week:2026-10-12': emptyWeek(),
      'pp:month:2026-10': emptyMonth(), 'pp:quarter:2026-Q4': emptyQuarter(),
      'pp:year:2026': emptyYear(), 'pp:life': emptyLife(),
      'pp:bizmodel': emptyBizModel(), 'pp:settings': defaultSettings(), 'pp:pipAuto': 1,
    }
    localStorage.clear()
    expect(importAll(envelope(data))).toBe(9)
    for (const [key, value] of Object.entries(data))
      expect(JSON.parse(localStorage.getItem(key)!)).toEqual(value)
  })
  it.each([
    { app: 'other', version: 1, data: { [KEY]: day('錯app') } },
    { app: 'inkday-planner', version: 999, data: { [KEY]: day('錯version') } },
    { app: 'inkday-planner', version: 1, data: { [KEY]: { tasks: null } } },
    { app: 'inkday-planner', version: 1, data: { 'pp:integrations': { token: 'FAKE' } } },
    { app: 'inkday-planner', version: 1, data: { 'pp:cloudBound': '1' } },
    { app: 'inkday-planner', version: 1, data: { 'ppl:owner': B } },
    { app: 'inkday-planner', version: 1, data: { 'pp:unknown': {} } },
  ])('拒絕不合法整份輸入，不產生部分匯入', (file) => {
    saveDay(DAY, day('原資料'))
    const before = localStorage.getItem(KEY)
    expect(() => importAll(JSON.stringify(file))).toThrow()
    expect(localStorage.getItem(KEY)).toBe(before)
    expect(listBackups()).toHaveLength(0)
  })

  it('不同 owner 的檔案需要明確確認，取消不改資料；同意後不改裝置owner', () => {
    saveDay(DAY, day('A的資料'))
    autoBackup(DAY)
    const file = exportBackupAsFile(listBackups()[0].id)
    setDataOwner(B)
    expect(inspectImport(file)).toMatchObject({ sourceOwner: A, currentOwner: B, count: 1, requiresOwnerConfirmation: true })
    expect(() => importAll(file)).toThrow('backup-owner-confirmation-required')
    expect(listBackups()).toHaveLength(0)
    expect(importAll(file, { confirmOwnerChange: true })).toBe(1)
    expect(localStorage.getItem('ppl:owner')).toBe(B)
  })

  it('舊version1檔沒有owner可讀取，但登入狀態先要求確認目的帳號', () => {
    const file = JSON.stringify({ app: 'inkday-planner', version: 1, data: { [KEY]: day('舊檔') } })
    expect(inspectImport(file).requiresOwnerConfirmation).toBe(true)
    expect(() => importAll(file)).toThrow('backup-owner-confirmation-required')
    expect(importAll(file, { confirmOwnerChange: true })).toBe(1)
  })
})

describe('legacy 衝突副本隔離', () => {
  const id = 'ppl:conflict:123:pp:day:2026-10-14'
  it('在原owner仍在時蓋章；登出後、另一人登入都看不到或匯不出', () => {
    localStorage.setItem(id, JSON.stringify(day('legacy A')))
    expect(listConflicts()).toHaveLength(0)
    expect(() => exportConflictAsFile(id)).toThrow('不屬於')
    stampLegacyBackupOwners()
    expect(listConflicts()).toHaveLength(1)
    expect(JSON.parse(exportConflictAsFile(id)).owner).toBe(A)
    clearForLogout()
    expect(listConflicts()).toHaveLength(0)
    setDataOwner(B)
    expect(listConflicts()).toHaveLength(0)
    expect(() => exportConflictAsFile(id)).toThrow('不屬於')
    expect(localStorage.getItem(id)).toContain('legacy A')
  })
  it('原owner已不在的legacy副本保持原檔隔離，不猜成下一個人的', () => {
    localStorage.clear()
    localStorage.setItem(id, JSON.stringify(day('未知原owner')))
    stampLegacyBackupOwners()
    claimDeviceFor(B)
    stampLegacyBackupOwners(true) // 下一次啟動仍不能把隔離中的舊副本認成B的
    expect(listConflicts()).toHaveLength(0)
    expect(localStorage.getItem(id)).toContain('未知原owner')
    expect(() => exportConflictAsFile(id)).toThrow('不屬於')
  })
  it('未知legacy不會被匿名autoBackup當成自己的副本一起匯出', () => {
    localStorage.clear()
    saveDay(DAY, day('本機自己的'))
    localStorage.setItem(id, JSON.stringify(day('UNKNOWN PRIVATE SENTINEL')))
    stampLegacyBackupOwners()
    autoBackup(DAY)
    expect(exportBackupAsFile(listBackups()[0].id)).not.toContain('UNKNOWN PRIVATE SENTINEL')
    expect(localStorage.getItem(id)).toContain('UNKNOWN PRIVATE SENTINEL')
  })
  it('明確owner=null的新格式本機副本可以跟著本機資料認領', () => {
    localStorage.clear()
    localStorage.setItem(id, JSON.stringify({ __yike: 2, owner: null, value: day('本機副本') }))
    claimDeviceFor(A)
    expect(listConflicts()).toHaveLength(1)
    expect(JSON.parse(exportConflictAsFile(id)).owner).toBe(A)
  })
  it('legacy蓋章遇到quota時不設旗標，原blob保留、下次可重試', () => {
    localStorage.setItem(id, JSON.stringify(day('quota fixture')))
    const raw = localStorage.getItem(id)
    const orig = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === id) throw new DOMException('quota', 'QuotaExceededError')
      orig.call(this, k, v)
    })
    stampLegacyBackupOwners()
    expect(localStorage.getItem(id)).toBe(raw)
    expect(localStorage.getItem('ppl:conflictOwnerMigrated')).toBeNull()
    expect(listConflicts()).toHaveLength(0)
    spy.mockRestore()
    stampLegacyBackupOwners()
    expect(listConflicts()).toHaveLength(1)
    expect(localStorage.getItem('ppl:conflictOwnerMigrated')).toBe('1')
  })
})

describe('未知legacy快照隔離', () => {
  it('v2格式缺owner也保持隔離，不能當匿名備份列出或匯出', () => {
    localStorage.clear()
    localStorage.setItem(`pp:bk:${DAY}`, JSON.stringify({ __yike: 2, data: { [KEY]: JSON.stringify(day('UNKNOWN V2')) } }))
    expect(listBackups()).toHaveLength(0)
    expect(() => exportBackupAsFile(DAY)).toThrow('不屬於')
    stampLegacyBackupOwners()
    claimDeviceFor(B)
    stampLegacyBackupOwners(true)
    expect(listBackups()).toHaveLength(0)
    expect(localStorage.getItem(`pp:bk:${DAY}`)).toContain('UNKNOWN V2')
  })
  it('匿名啟動、同日備份、claim及下一次啟動，都不覆蓋或認領原owner不明的快照', () => {
    localStorage.clear()
    const key = `pp:bk:${DAY}`
    const raw = JSON.stringify({ [KEY]: JSON.stringify(day('UNKNOWN BACKUP SENTINEL')) })
    localStorage.setItem(key, raw)
    stampLegacyBackupOwners()
    expect(listBackups()).toHaveLength(0)
    expect(() => exportBackupAsFile(DAY)).toThrow('不屬於')
    saveDay(DAY, day('自己的新記錄'))
    autoBackup(DAY)
    expect(localStorage.getItem(key)).toBe(raw)
    const own = listBackups()[0]
    expect(exportBackupAsFile(own.id)).not.toContain('UNKNOWN BACKUP SENTINEL')
    claimDeviceFor(B)
    stampLegacyBackupOwners(true)
    expect(localStorage.getItem(key)).toBe(raw)
    expect(listBackups()).toHaveLength(1)
    expect(() => exportBackupAsFile(DAY)).toThrow('不屬於')
  })
})
