import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = { getSession: vi.fn() }
let upserted: unknown[] = []
type UpsertResult = {
  data: { key: string; updated_at: string }[] | null
  error: { message: string } | null
}
let savedRows: { key: string; updated_at: string }[] = []
let serverRows: { key: string; value: unknown; updated_at: string }[] = []
const from = vi.fn(() => ({
  select: async () => ({ data: serverRows, error: null }),
  upsert: (rows: unknown[]) => {
    upserted = rows
    return { select: async (): Promise<UpsertResult> => ({ data: savedRows, error: null }) }
  },
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth, from }) }))

import { syncNow } from '../cloud'
import { DayEntry, emptyDay, emptyTask } from '../types'
import { loadDirty, loadMeta, saveDay, setDataOwner } from '../storage'

const ME = 'cccccccc-3333-3333-3333-333333333333'
// MIT 是 tasks[0]，不是憑空的 mit 欄位（tsc 抓到我原本捏了一個不存在的屬性）
const day = (mit: string): DayEntry => ({ ...emptyDay(), tasks: [{ ...emptyTask(), text: mit }] })

beforeEach(() => {
  localStorage.clear()
  upserted = []; savedRows = []; serverRows = []
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: ME } } } })
  setDataOwner(ME)
})

describe('同步不再信任裝置時鐘', () => {
  it('上傳的 payload 不含 updated_at（由資料庫決定）', async () => {
    saveDay('2026-09-01', day('今天'))
    savedRows = [{ key: 'pp:day:2026-09-01', updated_at: '2026-09-01T10:00:00Z' }]
    await syncNow()
    expect(upserted.length).toBeGreaterThan(0)
    for (const row of upserted as Record<string, unknown>[]) {
      expect(row).not.toHaveProperty('updated_at')
    }
  })

  it('推成功後清掉髒標記，並把 meta 對齊伺服器時間戳', async () => {
    saveDay('2026-09-01', day('今天'))
    expect(loadDirty()['pp:day:2026-09-01']).toBeGreaterThan(0)
    savedRows = [{ key: 'pp:day:2026-09-01', updated_at: '2026-09-01T10:00:00Z' }]
    await syncNow()
    expect(loadDirty()['pp:day:2026-09-01']).toBeUndefined()
    expect(loadMeta()['pp:day:2026-09-01']).toBe(Date.parse('2026-09-01T10:00:00Z'))
  })

  it('裝置時鐘設成未來，本機編輯仍然推得上去（舊版會永遠卡住）', async () => {
    // 模擬先前被未來時間戳污染：伺服器那列的時間戳遠比本機新
    serverRows = [{ key: 'pp:day:2026-09-01', value: { ...emptyDay(), tasks: [{ ...emptyTask(), text: '雲端舊版' }] }, updated_at: '2030-01-01T00:00:00Z' }]
    await syncNow() // pull 下來，meta 變成 2030
    saveDay('2026-09-01', day('本機新寫的')) // 使用者現在編輯
    savedRows = [{ key: 'pp:day:2026-09-01', updated_at: '2026-09-01T10:00:00Z' }]
    const r = await syncNow()
    expect(r.pushed).toBe(1) // 舊的比時間戳邏輯這裡會是 0，資料永遠上不去
  })

  it('沒改過的 key 不會重複上傳', async () => {
    saveDay('2026-09-01', day('今天'))
    savedRows = [{ key: 'pp:day:2026-09-01', updated_at: '2026-09-01T10:00:00Z' }]
    await syncNow()
    upserted = []
    const r = await syncNow()
    expect(r.pushed).toBe(0)
    expect(upserted).toEqual([])
  })
})

describe('push 的失敗與邊界', () => {
  it('upsert 出錯時髒標記必須留著（否則這筆改動永遠上不去）', async () => {
    const { saveDay, loadDirty, setDataOwner } = await import('../storage')
    localStorage.clear()
    setDataOwner(ME)
    from.mockReturnValue({
      select: async () => ({ data: [], error: null }),
      upsert: () => ({ select: async (): Promise<UpsertResult> => ({ data: null, error: { message: '網路斷線' } }) }),
    })
    saveDay('2026-09-02', day('上傳會失敗'))
    await expect(syncNow()).rejects.toThrow('上傳失敗')
    expect(loadDirty()['pp:day:2026-09-02']).toBeGreaterThan(0)
  })

  it('upsert 成功但伺服器沒回內容時，髒標記仍要清掉（否則每次同步都重推）', async () => {
    const { saveDay, loadDirty, setDataOwner } = await import('../storage')
    localStorage.clear()
    setDataOwner(ME)
    from.mockReturnValue({
      select: async () => ({ data: [], error: null }),
      upsert: () => ({ select: async (): Promise<UpsertResult> => ({ data: [], error: null }) }), // 成功但回空
    })
    saveDay('2026-09-03', day('伺服器沒回內容'))
    await syncNow()
    expect(loadDirty()['pp:day:2026-09-03']).toBeUndefined()
  })
})
