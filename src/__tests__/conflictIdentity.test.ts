import { beforeEach, describe, expect, it } from 'vitest'
import { exportAll, exportConflictAsFile, listConflicts, saveConflictCopy, setDataOwner } from '../storage'
import { emptyDay, emptyTask } from '../types'
const KEY = 'pp:day:2026-09-01'
const STAMP = 1788256800123
const day = (text: string) => ({ ...emptyDay(), tasks: [{ ...emptyTask(), text }] })
beforeEach(() => { localStorage.clear(); setDataOwner('owner-a') })

describe('衝突副本ID碰撞不會丟掉不同版本或跨帳號重用', () => {
  it('同一毫秒不同內容都保留，而且顯示真正timestamp', () => {
    expect(saveConflictCopy(KEY, day('version one'), STAMP)).toBe(true)
    expect(saveConflictCopy(KEY, day('version two'), STAMP)).toBe(true)
    const conflicts = listConflicts()
    expect(conflicts).toHaveLength(2)
    expect(conflicts.map((c) => c.at)).toEqual([STAMP, STAMP])
    expect(conflicts.map((c) => JSON.parse(exportConflictAsFile(c.id)).data[KEY].tasks[0].text).sort())
      .toEqual(['version one', 'version two'])
    expect(exportAll()).toContain('version one')
    expect(exportAll()).toContain('version two')
  })
  it('同帳號、timestamp、內容完全一致才去重', () => {
    saveConflictCopy(KEY, day('one'), STAMP)
    saveConflictCopy(KEY, day('two'), STAMP)
    saveConflictCopy(KEY, day('two'), STAMP)
    expect(listConflicts()).toHaveLength(2)
  })
  it('另一帳號已佔相同ID，不當成已保存且不覆蓋原副本', () => {
    saveConflictCopy(KEY, day('private A'), STAMP)
    const original = listConflicts()[0].id
    const raw = localStorage.getItem(original)
    setDataOwner('owner-b')
    saveConflictCopy(KEY, day('private B'), STAMP)
    expect(localStorage.getItem(original)).toBe(raw)
    expect(listConflicts()).toHaveLength(1)
    expect(JSON.parse(exportConflictAsFile(listConflicts()[0].id)).data[KEY].tasks[0].text).toBe('private B')
    expect(() => exportConflictAsFile(original)).toThrow('不屬於')
    setDataOwner('owner-a')
    expect(listConflicts()).toHaveLength(1)
  })
  it('沒有owner的舊副本保留隔離，新副本改用新ID', () => {
    const id = `ppl:conflict:${STAMP}:${KEY}`
    localStorage.setItem(id, JSON.stringify(day('unknown legacy')))
    const raw = localStorage.getItem(id)
    saveConflictCopy(KEY, day('current'), STAMP)
    expect(localStorage.getItem(id)).toBe(raw)
    expect(listConflicts()).toHaveLength(1)
    expect(listConflicts()[0].id).not.toBe(id)
    expect(exportAll()).not.toContain('unknown legacy')
  })
  it('宣稱v2卻缺owner欄位，也不能當匿名owner公開匯出', () => {
    localStorage.clear()
    const id = `ppl:conflict:${STAMP}:${KEY}`
    localStorage.setItem(id, JSON.stringify({ __yike: 2, value: day('unknown v2') }))
    expect(listConflicts()).toHaveLength(0)
    expect(exportAll()).not.toContain('unknown v2')
    expect(() => exportConflictAsFile(id)).toThrow('不屬於')
  })
  it('上一版明確owner副本仍能以IDtimestamp去重及顯示', () => {
    const id = `ppl:conflict:${STAMP}:${KEY}`
    localStorage.setItem(id, JSON.stringify({ __yike: 2, owner: 'owner-a', value: day('old owned') }))
    expect(saveConflictCopy(KEY, day('old owned'), STAMP)).toBe(true)
    expect(listConflicts()).toEqual([{ id, key: KEY, at: STAMP }])
  })
})
