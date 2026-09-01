import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = { getSession: vi.fn(), signInWithPassword: vi.fn(), signUp: vi.fn() }
const from = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth, from }) }))

import { syncNow } from '../cloud'
import { autoBackup, getDataOwner, saveDay, setDataOwner } from '../storage'

const ALICE = 'aaaaaaaa-1111-1111-1111-111111111111'
const BOB = 'bbbbbbbb-2222-2222-2222-222222222222'

const sessionAs = (uid: string) =>
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: uid } } } })

const emptyServer = () =>
  from.mockReturnValue({
    select: async () => ({ data: [], error: null }),
    // upsert 現在會接 .select() 拿回伺服器指派的 updated_at
    upsert: () => ({ select: async () => ({ data: [], error: null }) }),
  })

const seedLocal = () =>
  saveDay('2026-09-01', {
    mit: 'alice 的私密日記',
    answers: {}, habitsDone: {}, tasks: [], focusSessions: [],
    score: null, mood: null,
  } as never)

beforeEach(() => {
  localStorage.clear()
  auth.getSession.mockReset(); from.mockReset()
  emptyServer()
})

describe('共用裝置：本機資料不能被推進別人的帳號', () => {
  it('本機資料已屬於 alice 時，bob 登入同步要直接擋下', async () => {
    seedLocal(); setDataOwner(ALICE)
    sessionAs(BOB)
    await expect(syncNow()).rejects.toThrow('device-owner-mismatch')
  })

  it('沒歸屬又有本機資料時，登入路徑（reject）要停下來問人，不能默默上傳', async () => {
    seedLocal()
    sessionAs(BOB)
    await expect(syncNow({ onUnclaimed: 'reject' })).rejects.toThrow('device-unclaimed-data')
    expect(getDataOwner()).toBeNull() // 還沒認領
  })

  it('背景同步（預設 claim）不打擾既有使用者，照常認領並同步', async () => {
    seedLocal()
    sessionAs(BOB)
    await expect(syncNow()).resolves.toMatchObject({ pulled: 0 })
    expect(getDataOwner()).toBe(BOB)
  })

  it('空白裝置上登入不會被問（沒有別人的資料可外洩）', async () => {
    sessionAs(BOB)
    await expect(syncNow({ onUnclaimed: 'reject' })).resolves.toBeTruthy()
    expect(getDataOwner()).toBe(BOB)
  })

  it('歸屬相符時照常同步', async () => {
    seedLocal(); setDataOwner(BOB)
    sessionAs(BOB)
    await expect(syncNow({ onUnclaimed: 'reject' })).resolves.toBeTruthy()
  })

  it('選擇不合併時，本機資料先進快照才清掉（要有得後悔）', async () => {
    seedLocal()
    autoBackup('2026-09-01')
    const { discardLocalForNewOwner } = await import('../storage')
    discardLocalForNewOwner(BOB)
    expect(getDataOwner()).toBe(BOB)
    expect(localStorage.getItem('pp:day:2026-09-01')).toBeNull()
    const snap = localStorage.getItem('pp:bk:2026-09-01')
    expect(snap).toBeTruthy()
    expect(snap!).toContain('alice 的私密日記')
  })
})
