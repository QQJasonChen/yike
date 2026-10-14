import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lazyQuery } from './supabaseMock'

const auth = { getSession: vi.fn() }
let download: unknown[] = []
let ranges: number[] = []
let sent: { key: string; value: unknown; client_rev: number }[] = []
let ack: unknown[] | null = null
let failSecondPage = false
const STAMP = '2026-09-07 00:23:35.897802+00'
const from = vi.fn(() => {
  const write = (rows: typeof sent) => ({ select: () => lazyQuery(async () => {
    sent.push(...rows)
    return { data: ack ?? rows.map((r) => ({ ...r, updated_at: STAMP })), error: null }
  }) })
  return {
    select: () => {
      let start = 0, end = 999
      const q = lazyQuery(async () => {
        ranges.push(start)
        return { data: download.slice(start, end + 1),
          error: failSecondPage && start > 0 ? { message: 'synthetic page failure' } : null }
      })
      q.range = (a, b) => { start = a; end = b; return q }
      return q
    },
    insert: write, upsert: write,
  }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth, from }) }))

import { syncNow, syncStatusMessage } from '../cloud'
import {
  allDataKeys, autoBackup, exportAll, importAll, inspectImport, isSyncDataKey, isSyncDataValue,
  isSyncTimestamp, listBackups, loadDay, loadDirty, loadMeta, markSynced, openSyncGate,
  restoreBackup, saveDay, setDataOwner, writeFromCloud,
} from '../storage'
import { pipAutoEnabled } from '../pip'
import { defaultSettings, emptyBizModel, emptyDay, emptyLife, emptyMonth, emptyQuarter, emptyTask, emptyWeek, emptyYear } from '../types'

const OWNER = 'synthetic-owner'
const DATE = '2026-10-14'
const KEY = `pp:day:${DATE}`
const day = (text: string) => ({ ...emptyDay(), tasks: [{ ...emptyTask(), text }] })
const row = (key: string, value: unknown, updated_at: unknown = STAMP) => ({ key, value, updated_at })
const snapshot = () => Object.fromEntries(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).sort().map((key) => [key, localStorage.getItem(key)]))
const forbidden = [
  'ppl:owner', 'ppl:openaiKey', 'ppl:deviceId', 'ppl:revSeq', 'ppl:gated', 'ppl:conflict:123:pp:day:2026-10-14',
  'pp:integrations', 'pp:sync', 'pp:bk:2026-10-14#synthetic-owner', 'pp:lastBackup', 'pp:cloudBound',
  'pp:habitsAutoRestored', 'sb-synthetic-auth-token', 'pp:unknown', 'outside:day', '__proto__',
]
const validData = () => ({
  [KEY]: day('valid diary'), 'pp:week:2026-10-12': emptyWeek(), 'pp:month:2026-10': emptyMonth(),
  'pp:quarter:2026-Q4': emptyQuarter(), 'pp:year:2026': emptyYear(), 'pp:life': emptyLife(),
  'pp:bizmodel': emptyBizModel(), 'pp:settings': defaultSettings(), 'pp:pipAuto': 0, 'pp:onboarded': 1,
})
const envelope = (data: Record<string, unknown>) => JSON.stringify({ app: 'inkday-planner', version: 1, owner: OWNER, data })

beforeEach(() => {
  vi.restoreAllMocks(); openSyncGate(); localStorage.clear(); setDataOwner(OWNER)
  localStorage.setItem('ppl:dirtyMigrated', '1')
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: OWNER } } } })
  download = []; ranges = []; sent = []; ack = null; failSecondPage = false
})

describe('actual syncNow treats own-UID rows as untrusted user data', () => {
  it('reserved rows cannot replace credentials, owner, snapshots, device state or metadata while a real day pulls', async () => {
    const protectedKeys = forbidden.filter((k) => k !== 'ppl:owner')
    for (const k of protectedKeys) localStorage.setItem(k, JSON.stringify('synthetic-local-sentinel'))
    localStorage.setItem('pp:meta', JSON.stringify({ 'pp:day:2026-10-13': 5000 }))
    localStorage.setItem('ppl:dirty', JSON.stringify({ 'pp:day:2026-10-13': 3 }))
    const before = new Map(forbidden.map((k) => [k, localStorage.getItem(k)]))
    download = [...forbidden, 'pp:meta', 'ppl:dirty', 'ppl:dirtyMigrated'].map((k) => row(k, 'hostile'))
    download.push(row(KEY, day('real allowed row')))
    const result = await syncNow()
    expect(result).toMatchObject({ pulled: 1, pushed: 0, ignored: forbidden.length + 3 })
    for (const k of forbidden) expect(localStorage.getItem(k)).toBe(before.get(k))
    expect(loadMeta()['pp:day:2026-10-13']).toBe(5000)
    expect(loadMeta()[KEY]).toBe(Date.parse(STAMP))
    expect(loadDirty()).toEqual({ 'pp:day:2026-10-13': 3 })
    expect(loadDay(DATE).tasks[0].text).toBe('real allowed row')
    expect(sent).toHaveLength(0)
    expect(syncStatusMessage(result)).toContain('已跳過')
    expect(syncStatusMessage(result)).not.toContain('已同步')
    expect(syncStatusMessage(result)).not.toContain('hostile')
  })

  it('dirty migration cannot turn local reserved or unknown namespaces into uploads', async () => {
    localStorage.removeItem('ppl:dirtyMigrated')
    for (const k of ['pp:unknown', 'pp:sync', 'pp:integrations', 'ppl:openaiKey']) localStorage.setItem(k, '{}')
    localStorage.setItem(KEY, JSON.stringify(day('legacy unsent')))
    download = [row('ppl:dirty', { 'pp:integrations': 100 }), row('pp:meta', { [KEY]: 9999999999999 })]
    expect(await syncNow()).toMatchObject({ pushed: 1, ignored: 2 })
    expect(sent.map((r) => r.key)).toEqual([KEY])
    expect(allDataKeys()).toEqual([KEY])
    expect(localStorage.getItem('pp:unknown')).toBe('{}')
    expect(loadDirty()).toEqual({})
  })

  it('1000 rejected rows do not stop pagination before a legitimate second-page row', async () => {
    download = Array.from({ length: 1000 }, (_, i) => row(`pp:unknown:${i}`, 'bad'))
    download.push(row(KEY, day('second page')))
    expect(await syncNow()).toMatchObject({ pulled: 1, ignored: 1000 })
    expect(ranges).toEqual([0, 1000])
    expect(loadDay(DATE).tasks[0].text).toBe('second page')
  })

  it('later-page failure occurs before local writes and dirty migration', async () => {
    localStorage.removeItem('ppl:dirtyMigrated')
    download = [row(KEY, day('not yet complete')), ...Array.from({ length: 1000 }, (_, i) => row(`pp:unknown:${i}`, 'bad'))]
    const before = snapshot(); failSecondPage = true
    await expect(syncNow()).rejects.toThrow('下載失敗')
    expect(snapshot()).toEqual(before)
    expect(sent).toHaveLength(0)
  })

  it('all current dimensions and harmless raw flags pass the actual pull path', async () => {
    const data = validData()
    download = Object.entries(data).map(([k, v]) => row(k, v))
    expect(await syncNow()).toMatchObject({ pulled: 10, pushed: 0 })
    for (const [k, v] of Object.entries(data)) expect(JSON.parse(localStorage.getItem(k)!)).toEqual(v)
    expect(pipAutoEnabled()).toBe(false)
  })

  it('malformed payload, key type and timestamps preserve the previous day and never set unsafe meta', async () => {
    writeFromCloud(KEY, day('safe existing'), Date.parse(STAMP))
    const before = snapshot()
    download = [row(KEY, { tasks: [{ text: 'bad', done: {} }] }), row(KEY, null), row(KEY, []),
      row(KEY, day('wrong time'), '0'), row(KEY, day('wrong type'), 123), row(KEY, day('invalid'), 'not a date'),
      { key: {}, value: day('wrong key'), updated_at: STAMP }, null]
    expect(await syncNow()).toMatchObject({ pulled: 0, pushed: 0, ignored: 8 })
    // sync itself may initialise a stable device ID, but no downloaded content or metadata changes.
    expect(localStorage.getItem(KEY)).toBe(before[KEY])
    expect(localStorage.getItem('pp:meta')).toBe(before['pp:meta'])
    expect(loadDirty()).toEqual({})
  })

  it.each(['not-a-date', '0', 123])('invalid ACK time %s keeps the sent draft pending', async (stamp) => {
    saveDay(DATE, day('pending'))
    const rev = loadDirty()[KEY]
    ack = [row(KEY, undefined, stamp), row('ppl:owner', undefined), row('pp:unknown', undefined)]
    expect(await syncNow()).toMatchObject({ pushed: 0, rejected: 1 })
    expect(loadDirty()[KEY]).toBe(rev)
    expect(loadMeta()[KEY]).toBeUndefined()
    expect(localStorage.getItem('ppl:owner')).toBe(OWNER)
    expect(loadDay(DATE).tasks[0].text).toBe('pending')
  })

  it('invalid local typed data stays local with its dirty marker rather than being uploaded', async () => {
    localStorage.setItem(KEY, JSON.stringify({ tasks: [{ text: 'bad numeric field', done: {} }] }))
    localStorage.setItem('ppl:dirty', JSON.stringify({ [KEY]: 5 }))
    const raw = localStorage.getItem(KEY)
    expect(await syncNow()).toMatchObject({ pushed: 0, ignored: 1 })
    expect(sent).toHaveLength(0)
    expect(loadDirty()[KEY]).toBe(5)
    expect(localStorage.getItem(KEY)).toBe(raw)
  })
})

describe('independent sink and typed data contract', () => {
  it.each(forbidden)('writeFromCloud refuses %s before touching any local state', (key) => {
    localStorage.setItem(key, 'synthetic sentinel')
    const before = snapshot()
    expect(() => writeFromCloud(key, day('hostile'), Date.parse(STAMP))).toThrow('cloud-data-not-allowed')
    expect(snapshot()).toEqual(before)
  })
  it.each([NaN, Infinity, 8640000000000001, 1.5])('writeFromCloud rejects invalid numeric server time %s', (time) => {
    const before = snapshot()
    expect(() => writeFromCloud(KEY, day('invalid time'), time)).toThrow()
    expect(snapshot()).toEqual(before)
  })
  it('markSynced itself rejects unknown keys and malformed times, preserving pending revisions', () => {
    localStorage.setItem('ppl:dirty', JSON.stringify({ [KEY]: 7, 'pp:unknown': 8 }))
    markSynced([{ key: KEY, updated_at: '0' }, { key: 'pp:unknown', updated_at: STAMP }], { [KEY]: 7, 'pp:unknown': 8 })
    expect(loadDirty()).toEqual({ [KEY]: 7, 'pp:unknown': 8 })
    expect(loadMeta()).toEqual({})
  })
  const invalidValues: [string, unknown][] = [
    [KEY, { tasks: [{ text: 'x', done: {} }] }], [KEY, { tasks: [{ text: 'x', target: '2' }] }],
    [KEY, { tasks: [{ text: 'x', actual: [] }] }], [KEY, { tasks: [{ text: 'x', withered: Infinity }] }],
    [KEY, { tasks: [{ text: 'x', grove: [NaN] }] }], [KEY, { habit: {} }], [KEY, { mood: [] }], [KEY, { score: '3' }],
    [KEY, { blocks: [{ text: 'x', start: 0, end: 30, taskIndex: {} }] }],
    [KEY, { blocks: [{ text: 'x', start: Infinity, end: 30 }] }],
    [KEY, { blocks: [{ text: 'x', start: 0, end: 30, notify: 'yes' }] }],
    [KEY, { blocks: [{ text: 'x', start: 0, end: 30, notifyLead: {} }] }],
    ['pp:week:2026-10-12', { tasks: [{ text: 'x', done: {} }] }],
    ['pp:month:2026-10', { priorities: [{ text: 'x', span: [0, '1'] }] }],
    ['pp:year:2026', { goals: [{ text: 'x', cells: [Infinity] }] }],
    ['pp:life', { startYear: {} }], ['pp:life', { odyssey: [{ title: 'x', body: 'x', confidence: {} }] }],
    ['pp:settings', { focusMinutes: Infinity }],
    ['pp:settings', { routines: [{ label: 'x', emoji: 'x', color: 'gold', start: NaN, dur: 60 }] }],
    ['pp:onboarded', 0], ['pp:pipAuto', 'false'],
  ]
  it.each(invalidValues)('typed fields in %s reject unsafe UI calculations', (key, value) => {
    expect(isSyncDataValue(key, value)).toBe(false)
    const before = snapshot()
    expect(() => writeFromCloud(key, value, Date.parse(STAMP))).toThrow()
    expect(snapshot()).toEqual(before)
  })
  it('legacy fixed answers, missing later fields, partial settings and raw-base64 ink remain supported', () => {
    const legacy = { gratitude: 'thanks', highlight: 'bright', tasks: [{ text: 'legacy task' }], ink: { png: 'rawbase64', drawing: '', fmt: 'pk' } }
    writeFromCloud(KEY, legacy, Date.parse(STAMP))
    writeFromCloud('pp:settings', { focusMinutes: 30, oldExtraField: { preserved: true } }, Date.parse(STAMP))
    expect(loadDay(DATE).answers).toMatchObject({ m0: 'thanks', e0: 'bright' })
    expect(loadDay(DATE).tasks[0].text).toBe('legacy task')
    expect(JSON.parse(localStorage.getItem('pp:settings')!).oldExtraField).toEqual({ preserved: true })
    expect(inspectImport(exportAll()).count).toBe(2)
  })
  it.each([null, {}, { png: 'rawbase64' }, { drawing: '' }])('legacy empty or partial ink %s does not discard an otherwise valid diary', async (ink) => {
    const value = { ...day('keep legacy ink day'), ink, inkAnswers: { m0: ink } }
    download = [row(KEY, value)]
    expect(await syncNow()).toMatchObject({ pulled: 1 })
    expect(loadDay(DATE).tasks[0].text).toBe('keep legacy ink day')
    expect(importAll(exportAll())).toBe(1)
    expect(autoBackup(DATE)).toBe(true)
    expect(restoreBackup(listBackups().find((b) => !b.pre)!.id)).toBe(1)
  })
  it.each(['2026-09-07 00:23:35.897802+00', '2026-09-07T00:23:35.897802+00:00', '2026-09-07T00:23:35.897Z'])('accepts real server timestamp %s without rewriting it', (stamp) => {
    expect(isSyncTimestamp(stamp)).toBe(true)
  })
  it.each(['0', '2026-02-30T00:00:00Z', '2026-09-07T24:00:00Z', '2026-09-07', 'not-a-date'])('refuses malformed or loose timestamp %s', (stamp) => {
    expect(isSyncTimestamp(stamp)).toBe(false)
  })
  it.each(['pp:day:0001-01-01', 'pp:week:0099-03-01', 'pp:day:2000-02-29', 'pp:year:9999', 'pp:month:2026-12'])('valid historical key %s keeps compatibility', (key) => {
    expect(isSyncDataKey(key)).toBe(true)
  })
  it.each(['pp:day:1900-02-29', 'pp:day:2026-02-30', 'pp:month:2026-13', 'pp:quarter:2026-Q5', 'pp:year:0000'])('invalid date/period key %s cannot address local storage', (key) => {
    expect(isSyncDataKey(key)).toBe(false)
  })
})

describe('normal app flags export/import and snapshot restore are self-consistent', () => {
  it.each([0, 1])('onboarded1 and pipAuto%s roundtrip through actual export/import and daily restore', (flag) => {
    localStorage.setItem('pp:onboarded', '1'); localStorage.setItem('pp:pipAuto', String(flag))
    saveDay(DATE, day('fresh-user diary'))
    const file = exportAll()
    expect(inspectImport(file).count).toBe(3)
    localStorage.removeItem('pp:onboarded'); localStorage.removeItem('pp:pipAuto'); localStorage.removeItem(KEY)
    expect(importAll(file)).toBe(3)
    expect(localStorage.getItem('pp:onboarded')).toBe('1')
    expect(pipAutoEnabled()).toBe(flag === 1)
    expect(autoBackup(DATE)).toBe(true)
    const id = listBackups().find((b) => !b.pre)!.id
    localStorage.setItem('pp:onboarded', '0'); localStorage.setItem('pp:pipAuto', String(1 - flag))
    saveDay(DATE, day('after snapshot'))
    expect(restoreBackup(id)).toBe(3)
    expect(localStorage.getItem('pp:onboarded')).toBe('1')
    expect(pipAutoEnabled()).toBe(flag === 1)
    expect(loadDay(DATE).tasks[0].text).toBe('fresh-user diary')
  })
  it.each([false, true])('legacy boolean pipAuto %s normalizes to the actual raw0/1 reader in pull and restore', async (flag) => {
    download = [row('pp:pipAuto', flag)]
    await syncNow()
    expect(localStorage.getItem('pp:pipAuto')).toBe(flag ? '1' : '0')
    expect(importAll(envelope({ 'pp:pipAuto': flag }))).toBe(1)
    expect(pipAutoEnabled()).toBe(flag)
    const id = '2026-10-13#synthetic-owner'
    localStorage.setItem(`pp:bk:${id}`, JSON.stringify({ __yike: 2, owner: OWNER, data: { 'pp:pipAuto': JSON.stringify(flag) } }))
    localStorage.setItem('pp:pipAuto', flag ? '0' : '1')
    expect(restoreBackup(id)).toBe(1)
    expect(pipAutoEnabled()).toBe(flag)
  })
})
