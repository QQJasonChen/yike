import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { user_id: string; key: string; value: unknown; updated_at: string }
type PullQuery = {
  eq: (column: string, value: string) => PullQuery
  order: (column: string, options?: unknown) => PullQuery
  range: (from: number, to: number) => PullQuery
  abortSignal: (signal: AbortSignal) => Promise<{ data: Row[]; error: null }>
}

const A = 'synthetic-owner-a'
const B = 'synthetic-owner-b'
const auth = { getSession: vi.fn() }
let requestUser = A
let rows: Row[] = []
let pullCount = 0
let switchBeforePull: number | null = null
let queries: { requestUser: string; pinnedUser: string | null; from: number; to: number }[] = []
const writes = vi.fn(() => { throw new Error('This pull-only scenario must not write journal rows') })

const from = vi.fn(() => ({
  select: () => {
    let start = 0
    let end = 999
    let pinnedUser: string | null = null
    const query: PullQuery = {
      eq: (column, value) => {
        if (column === 'user_id') pinnedUser = value
        return query
      },
      order: () => query,
      range: (first, last) => { start = first; end = last; return query },
      abortSignal: async () => {
        // Each HTTP request uses the current Auth JWT. It can differ from the
        // getSession snapshot that syncNow captured before awaiting a request.
        if (pullCount++ === switchBeforePull) requestUser = B
        queries.push({ requestUser, pinnedUser, from: start, to: end })
        const visible = rows.filter(row => row.user_id === requestUser &&
          (pinnedUser === null || row.user_id === pinnedUser))
        visible.sort((left, right) => left.key.localeCompare(right.key))
        return { data: visible.slice(start, end + 1), error: null }
      },
    }
    return query
  },
  insert: writes,
  upsert: writes,
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth, from }) }))

import { syncNow } from '../cloud'
import { addDays, allDataKeys, getDataOwner, openSyncGate, setDataOwner } from '../storage'
import { emptyDay, emptyTask } from '../types'

const seed = (uid: string, count: number) => {
  for (let index = 0; index < count; index++) {
    rows.push({
      user_id: uid,
      key: `pp:day:${addDays('2020-01-01', index)}`,
      value: { ...emptyDay(), tasks: [{ ...emptyTask(), text: `${uid}:record-${index}` }] },
      updated_at: '2026-10-15T20:00:00.123100+00:00',
    })
  }
}

const assertNoOtherAccountData = () => {
  expect(getDataOwner()).toBe(A)
  for (const key of allDataKeys()) expect(localStorage.getItem(key)).not.toContain(B)
  expect(writes).not.toHaveBeenCalled()
}

beforeEach(() => {
  openSyncGate()
  localStorage.clear()
  setDataOwner(A)
  localStorage.setItem('ppl:dirtyMigrated', '1')
  rows = []
  requestUser = A
  pullCount = 0
  switchBeforePull = null
  queries = []
  writes.mockClear()
  from.mockClear()
  auth.getSession.mockImplementation(async () => ({
    data: { session: { user: { id: requestUser } } },
  }))
})

describe('sync Auth request identity remains within the captured account', () => {
  it('does not download B when the JWT changes after capturing A but the local owner is still A', async () => {
    seed(B, 1)
    switchBeforePull = 0

    await syncNow()

    expect(queries[0].requestUser).toBe(B)
    assertNoOtherAccountData()
    expect(localStorage.getItem('pp:day:2020-01-01')).toBeNull()
  })

  it('does not mix B into a long-lived A account when only the second page uses the new JWT', async () => {
    seed(A, 1401)
    seed(B, 1401)
    switchBeforePull = 1

    await syncNow()

    expect(queries.map(query => query.requestUser)).toEqual([A, B])
    assertNoOtherAccountData()
    expect(localStorage.getItem(`pp:day:${addDays('2020-01-01', 1400)}`)).toBeNull()
  }, 30_000)

  it('still downloads every page for a normal unchanged A session', async () => {
    seed(A, 1401)
    seed(B, 1401)

    const result = await syncNow()

    expect(result).toMatchObject({ pulled: 1401, pushed: 0 })
    expect(queries.map(({ from, to }) => [from, to])).toEqual([[0, 999], [1000, 1999]])
    expect(localStorage.getItem(`pp:day:${addDays('2020-01-01', 1400)}`)).toContain(`${A}:record-1400`)
    assertNoOtherAccountData()
  }, 30_000)
})
