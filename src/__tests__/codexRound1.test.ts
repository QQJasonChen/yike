// Codex 上架前互審第 1 輪的 DO-NOT-SHIP 發現，逐條釘住。
// 每一條都經過證偽：把原本的 bug 放回去，對應的斷言必須變紅。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = { getSession: vi.fn() }
let serverRows: { key: string; value: unknown; updated_at: string }[] = []
let savedRows: { key: string; updated_at: string }[] = []
let onUpsert: (() => void) | null = null
const from = vi.fn(() => ({
  select: async () => ({ data: serverRows, error: null }),
  upsert: () => ({
    select: async () => {
      onUpsert?.() // 模擬「等回應期間使用者又編輯了」
      return { data: savedRows, error: null }
    },
  }),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth, from }) }))

import { syncNow } from '../cloud'
import {
  autoBackup, clearAllLocalData, discardLocalForNewOwner, getOpenAIKey,
  listBackups, loadDirty, loadDay, saveDay, setDataOwner, setOpenAIKey,
} from '../storage'

const ME = 'me-uid'
const OTHER = 'other-uid'
const day = (mit: string) =>
  ({ mit, answers: {}, habitsDone: {}, tasks: [], focusSessions: [], score: null, mood: null }) as never

beforeEach(() => {
  localStorage.clear()
  serverRows = []; savedRows = []; onUpsert = null
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: ME } } } })
})

describe('Codex #1：同步途中再編輯，不能被當成已同步', () => {
  it('推送期間的編輯要保留髒標記（否則那筆內容永遠上不去）', async () => {
    setDataOwner(ME)
    saveDay('2026-09-01', day('第一版'))
    savedRows = [{ key: 'pp:day:2026-09-01', updated_at: '2026-09-01T10:00:00Z' }]
    // 在 upsert 等待回應的當下，使用者又改了同一天
    onUpsert = () => saveDay('2026-09-01', day('等回應時寫的第二版'))
    await syncNow()
    expect(loadDirty()['pp:day:2026-09-01']).toBeGreaterThan(0)
    expect(loadDay('2026-09-01').mit).toBe('等回應時寫的第二版')
  })

  it('推送期間沒被改過的，正常清掉標記', async () => {
    setDataOwner(ME)
    saveDay('2026-09-02', day('沒人動它'))
    savedRows = [{ key: 'pp:day:2026-09-02', updated_at: '2026-09-02T10:00:00Z' }]
    await syncNow()
    expect(loadDirty()['pp:day:2026-09-02']).toBeUndefined()
  })
})

describe('Codex #2：放棄本機資料前一定要有當下的快照', () => {
  it('今天已經備份過，仍要重照一張才清資料', () => {
    saveDay('2026-09-01', day('早上寫的'))
    autoBackup('2026-09-01') // 早上那張
    saveDay('2026-09-01', day('備份之後才寫的，最重要的一句'))
    discardLocalForNewOwner(OTHER)
    const snaps = listBackups()
    expect(snaps.length).toBeGreaterThan(0)
    const raw = localStorage.getItem('pp:bk:' + snaps[0].date)!
    expect(raw).toContain('備份之後才寫的，最重要的一句')
  })
})

describe('Codex #3：搬遷不能因為「已編輯過」而跳過歷史資料', () => {
  it('純本機使用者升級後先編輯、再首次登入，舊日記仍要全部上傳', async () => {
    // 升級前就存在的歷史（沒有 dirty、沒有 meta）
    saveDay('2026-08-01', day('升級前的舊日記'))
    localStorage.removeItem('ppl:dirty')
    localStorage.removeItem('ppl:dirtyMigrated')
    // 升級後先編輯了另一天 → 建立了 ppl:dirty
    saveDay('2026-09-01', day('升級後寫的'))
    expect(localStorage.getItem('ppl:dirty')).not.toBeNull()
    // 首次登入同步：伺服器全空
    setDataOwner(ME)
    savedRows = []
    const r = await syncNow()
    expect(r.pushed).toBe(2) // 舊日記也要一起上去，不能只推升級後那筆
  })
})

describe('Codex #4：放棄舊 owner 後要能拉得到新帳號的雲端資料', () => {
  it('清完本機後 dirty 也要清，否則 pull 會一直跳過那些 key', async () => {
    saveDay('2026-09-01', day('前一個人的日記'))
    setDataOwner(OTHER)
    expect(loadDirty()['pp:day:2026-09-01']).toBeGreaterThan(0)
    discardLocalForNewOwner(ME)
    expect(loadDirty()['pp:day:2026-09-01']).toBeUndefined()
    // 新帳號雲端有同一天的資料，必須拉得下來
    serverRows = [{ key: 'pp:day:2026-09-01', value: { mit: '我自己的雲端版' }, updated_at: '2026-09-01T12:00:00Z' }]
    const r = await syncNow()
    expect(r.pulled).toBe(1)
    expect(loadDay('2026-09-01').mit).toBe('我自己的雲端版')
  })
})

describe('Codex #5：清空裝置必須連 OpenAI 金鑰一起清', () => {
  it('金鑰不能留給下一個用這台裝置的人（它綁著信用卡）', () => {
    setOpenAIKey('sk-proj-USERS-CREDIT-CARD', 'gpt-4o-mini')
    saveDay('2026-09-01', day('資料'))
    clearAllLocalData()
    expect(getOpenAIKey()).toBe('')
    expect(JSON.stringify(localStorage)).not.toContain('sk-proj-USERS-CREDIT-CARD')
  })
})
