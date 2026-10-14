import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lazyQuery, type DbError } from './supabaseMock'

type Row = { key: string; value: unknown; updated_at: string; client_rev?: number }
type Sent = Row & { client_id: string; base_updated_at?: string }
const auth = { getSession: vi.fn() }
let server = new Map<string, Row>()
let ranges: [number, number][] = []
let writes: { mode: 'insert' | 'upsert'; rows: Sent[] }[] = []
let onPull: (() => void) | null = null
let onWrite: (() => void) | null = null
let writeError: DbError | null = null
let staleRevision = false
let failSecondPage = false
let tick = 0

const from = vi.fn(() => {
  const write = (mode: 'insert' | 'upsert', rows: Sent[]) => ({ select: () => lazyQuery(async () => {
    writes.push({ mode, rows })
    const callback = onWrite; onWrite = null; callback?.()
    if (writeError) return { data: [], error: writeError }
    if (mode === 'insert' && rows.some((r) => server.has(r.key)))
      return { data: [], error: { code: '23505', message: 'unique conflict' } }
    const accepted: Row[] = []
    for (const row of rows) {
      const current = server.get(row.key)
      if (mode === 'upsert' && current && row.base_updated_at !== current.updated_at) continue
      if (staleRevision) {
        accepted.push({ ...row, client_rev: row.client_rev! + 1 })
        continue
      }
      const saved = { key: row.key, value: row.value,
        updated_at: new Date(Date.parse('2030-01-01T00:00:00Z') + ++tick).toISOString(),
        client_rev: row.client_rev }
      server.set(row.key, saved); accepted.push(saved)
    }
    return { data: accepted, error: null }
  }) })
  return {
    select: () => {
      let start = 0, end = 999
      const q = lazyQuery(async () => {
        ranges.push([start, end])
        const data = [...server.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(start, end + 1)
        const callback = onPull; onPull = null; callback?.()
        return { data, error: failSecondPage && start > 0 ? { message: 'page failed' } : null }
      })
      q.range = (a, b) => { start = a; end = b; return q }
      return q
    },
    insert: (rows: Sent[]) => write('insert', rows),
    upsert: (rows: Sent[]) => write('upsert', rows),
  }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth, from }) }))

import { syncNow, syncStatusMessage } from '../cloud'
import {
  addDays, closeSyncGate, discardLocalForNewOwner, exportConflictAsFile, isGated, listConflicts, loadDay, loadDirty,
  loadMeta, openSyncGate, saveDay, setDataOwner, setOnWriteError,
} from '../storage'
import { emptyDay, emptyTask } from '../types'
const ME = 'test-owner-a'
const OTHER = 'test-owner-b'
const DATE = '2026-09-01'
const KEY = `pp:day:${DATE}`
const STAMP = '2026-09-01T10:00:00.123100+00:00'
const day = (text: string) => ({ ...emptyDay(), tasks: [{ ...emptyTask(), text }] })
const seed = (text = 'canonical', stamp = STAMP) => server.set(KEY, { key: KEY, value: day(text), updated_at: stamp })

beforeEach(() => {
  vi.restoreAllMocks()
  openSyncGate(); localStorage.clear(); setDataOwner(ME)
  localStorage.setItem('ppl:dirtyMigrated', '1')
  setOnWriteError(null)
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: ME } } } })
  server = new Map(); ranges = []; writes = []; tick = 0
  onPull = null; onWrite = null; writeError = null; staleRevision = false; failSecondPage = false
})

describe('完整下載與帳號隔離', () => {
  it('換帳號清掉上一人記憶體gate，新owner同key雲端列仍能拉下來', async () => {
    closeSyncGate(); saveDay(DATE, day('A gated'))
    discardLocalForNewOwner(OTHER)
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: OTHER } } } })
    seed('B remote')
    expect(await syncNow()).toMatchObject({ pulled: 1, pushed: 0 })
    expect(loadDay(DATE).tasks[0].text).toBe('B remote')
    expect(isGated(KEY)).toBe(false)
  })
  it.each([1000, 1401])('完整下載 %i 列，包含第1000列之後的記錄', async (count) => {
    for (let i = 0; i < count; i++) {
      const date = addDays('2020-01-01', i)
      const key = `pp:day:${date}`
      server.set(key, { key, value: day(`row-${i}`), updated_at: STAMP })
    }
    const result = await syncNow()
    expect(result.pulled).toBe(count)
    expect(ranges).toEqual([[0, 999], [1000, 1999]])
    expect(loadDay(addDays('2020-01-01', count - 1)).tasks[0].text).toBe(`row-${count - 1}`)
    expect(writes).toHaveLength(0)
  })
  it('後續頁下載失敗，不落地不完整下載，也不推送', async () => {
    for (let i = 0; i < 1001; i++) {
      const key = `pp:day:${addDays('2020-01-01', i)}`
      server.set(key, { key, value: day('remote'), updated_at: STAMP })
    }
    failSecondPage = true
    await expect(syncNow()).rejects.toThrow('下載失敗')
    expect(localStorage.getItem('pp:day:2020-01-01')).toBeNull()
    expect(writes).toHaveLength(0)
  })
  it.each([OTHER, null])('等待下載時owner改成 %s，上一人資料不落地', async (owner) => {
    seed(); onPull = () => owner ? setDataOwner(owner) : localStorage.removeItem('ppl:owner')
    await expect(syncNow()).rejects.toThrow('owner-changed-mid-sync')
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(writes).toHaveLength(0)
  })
  it('下載中換owner後，連新owner的dirty搬遷狀態也不修改', async () => {
    seed()
    onPull = () => {
      setDataOwner(OTHER)
      localStorage.removeItem('ppl:dirtyMigrated')
      saveDay('2026-09-02', day('B pending'))
    }
    await expect(syncNow()).rejects.toThrow('owner-changed-mid-sync')
    expect(localStorage.getItem('ppl:dirtyMigrated')).toBeNull()
    expect(loadDirty()['pp:day:2026-09-02']).toBe(1)
    expect(loadDay('2026-09-02').tasks[0].text).toBe('B pending')
  })
  it('等待推送時換人，不清新帳號的dirty標記', async () => {
    saveDay(DATE, day('A local'))
    onWrite = () => { setDataOwner(OTHER); saveDay(DATE, day('B local')) }
    await expect(syncNow()).rejects.toThrow('owner-changed-mid-sync')
    expect(loadDay(DATE).tasks[0].text).toBe('B local')
    expect(loadDirty()[KEY]).toBeGreaterThan(0)
  })
})

describe('CAS、確認版號與衝突副本', () => {
  it('傳回原始微秒timestamp作CAS，已知key只走upsert', async () => {
    seed(); await syncNow(); saveDay(DATE, day('edit')); await syncNow()
    const sent = writes[0]
    expect(sent.mode).toBe('upsert')
    expect(sent.rows[0].base_updated_at).toBe(STAMP)
    expect(sent.rows[0].client_id).toBeTruthy()
    expect(sent.rows[0].client_rev).toBeGreaterThan(0)
    expect(sent.rows[0]).not.toHaveProperty('updated_at')
  })
  it('新key使用insert且不把CAS哨兵寫入資料庫', async () => {
    saveDay(DATE, day('new')); await syncNow()
    expect(writes[0].mode).toBe('insert')
    expect(writes[0].rows[0]).not.toHaveProperty('base_updated_at')
  })
  it('pull後別裝置改了canonical列，CAS拒寫保留dirty與新雲端值', async () => {
    seed(); await syncNow(); saveDay(DATE, day('local pending'))
    onWrite = () => seed('concurrent remote', '2026-09-01T10:00:00.123900+00:00')
    const result = await syncNow()
    expect(result).toMatchObject({ pushed: 0, rejected: 1 })
    expect(loadDirty()[KEY]).toBeGreaterThan(0)
    expect(server.get(KEY)!.value).toEqual(day('concurrent remote'))
    expect(loadDay(DATE).tasks[0].text).toBe('local pending')
  })
  it('首次insert遇到同key併發新增，唯一鍵拒寫且不清dirty', async () => {
    saveDay(DATE, day('local new')); onWrite = () => seed('remote new')
    expect(await syncNow()).toMatchObject({ pushed: 0, rejected: 1 })
    expect(loadDirty()[KEY]).toBeGreaterThan(0)
    expect(server.get(KEY)!.value).toEqual(day('remote new'))
  })
  it('回傳其他client_rev不算接受，dirty及gate都留著', async () => {
    closeSyncGate(); saveDay(DATE, day('gated edit')); staleRevision = true
    expect(await syncNow()).toMatchObject({ pushed: 0, rejected: 1 })
    expect(isGated(KEY)).toBe(true)
    expect(server.has(KEY)).toBe(false)
  })
  it('回應只確認較早的gate版本，等待時新編輯仍受gate保護', async () => {
    closeSyncGate(); saveDay(DATE, day('sent draft'))
    onWrite = () => saveDay(DATE, day('newer draft'))
    expect(await syncNow()).toMatchObject({ pushed: 1 })
    expect(server.get(KEY)!.value).toEqual(day('sent draft'))
    expect(loadDay(DATE).tasks[0].text).toBe('newer draft')
    expect(isGated(KEY)).toBe(true)
  })
  it('同毫秒不同微秒的remote版保留為副本，本機dirty版繼續上傳', async () => {
    seed('base'); await syncNow()
    saveDay(DATE, day('local pending'))
    seed('other device', '2026-09-01T10:00:00.123900+00:00')
    const result = await syncNow()
    expect(result).toMatchObject({ conflicts: 1, pushed: 1 })
    expect(loadDay(DATE).tasks[0].text).toBe('local pending')
    expect(server.get(KEY)!.value).toEqual(day('local pending'))
    const files = listConflicts().map((c) => JSON.parse(exportConflictAsFile(c.id)))
    expect(files.some((file) => file.data[KEY].tasks[0].text === 'other device')).toBe(true)
  })
  it('副本存不下，不覆蓋remote且回報held，dirty仍保留', async () => {
    seed('base'); await syncNow(); saveDay(DATE, day('pending'))
    seed('remote new', '2026-09-01T10:00:00.123900+00:00')
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) {
      if (key.startsWith('ppl:conflict:')) throw new DOMException('quota', 'QuotaExceededError')
      original.call(this, key, value)
    })
    expect(await syncNow()).toMatchObject({ pushed: 0, held: 1, conflicts: 0 })
    expect(writes).toHaveLength(0)
    expect(loadDirty()[KEY]).toBeGreaterThan(0)
    expect(server.get(KEY)!.value).toEqual(day('remote new'))
  })
})

describe('伺服器配額拒絕不遺失本機草稿', () => {
  it.each([
    ['YIKE_JOURNAL_RECORD_LIMIT', '單筆'],
    ['YIKE_JOURNAL_ACCOUNT_LIMIT', '帳號'],
    ['YIKE_JOURNAL_CAPACITY_LIMIT', '容量'],
  ])('%s 在insert/upsert都保留原資料與待推標記', async (code, label) => {
    for (const known of [false, true]) {
      localStorage.clear(); setDataOwner(ME); localStorage.setItem('ppl:dirtyMigrated', '1')
      server.clear(); writeError = null
      if (known) { seed(); await syncNow() }
      saveDay(DATE, day('retained draft'))
      const dirty = loadDirty()[KEY], meta = loadMeta()[KEY]
      writeError = { message: `${code}: synthetic quota`, code: 'P0001' }
      await expect(syncNow()).rejects.toThrow(label)
      expect(loadDay(DATE).tasks[0].text).toBe('retained draft')
      expect(loadDirty()[KEY]).toBe(dirty)
      expect(loadMeta()[KEY]).toBe(meta)
    }
  })
})

describe('同步狀態不把未確認上傳說成完成', () => {
  it.each([{ rejected: 1, held: 0 }, { rejected: 0, held: 1 }])('拒寫或副本儲存失敗必須提示仍在本機', (pending) => {
    const message = syncStatusMessage({ pulled: 1, pushed: 0, conflicts: 0, ...pending })
    expect(message).toContain('未上傳')
    expect(message).toContain('資料仍在這台裝置')
    expect(message).not.toContain('已同步')
  })
  it('已完成但曾保留另一裝置版本時，提示檢查副本', () => {
    expect(syncStatusMessage({ pulled: 0, pushed: 1, conflicts: 1, held: 0, rejected: 0 }))
      .toContain('雲端衝突副本')
  })
})
