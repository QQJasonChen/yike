// 並發與重入：兩台裝置、以及同一台上重疊的 syncNow。
// Codex 兩輪都沒碰這塊，但它是「資料會不會不見」最常出事的地方。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = { getSession: vi.fn() }
type Row = { key: string; value: unknown; updated_at: string }
let server: Record<string, Row> = {}
let delayMs = 0
let trackUpsert: ((delta: number) => void) | null = null
let stuckUpsert = false

const from = vi.fn(() => ({
  select: async () => ({ data: Object.values(server), error: null }),
  upsert: (rows: { key: string; value: unknown }[]) => ({
    select: async () => {
      if (stuckUpsert) return new Promise(() => {}) as never // 永遠不回應
      trackUpsert?.(1)
      try {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      const out: { key: string; updated_at: string }[] = []
      for (const r of rows) {
        // 模擬 DB trigger：伺服器自己填時間戳
        const ts = new Date(Date.now() + out.length).toISOString()
        server[r.key] = { key: r.key, value: r.value, updated_at: ts }
        out.push({ key: r.key, updated_at: ts })
      }
      return { data: out, error: null }
      } finally {
        trackUpsert?.(-1)
      }
    },
  }),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth, from }) }))

import { __setSyncSlotTimeout, syncNow } from '../cloud'
import { loadDirty, loadDay, saveDay, setDataOwner } from '../storage'
import { DayEntry, emptyDay, emptyTask } from '../types'

const ME = 'me-uid'
const day = (t: string): DayEntry => ({ ...emptyDay(), tasks: [{ ...emptyTask(), text: t }] })

beforeEach(() => {
  localStorage.clear()
  server = {}; delayMs = 0; stuckUpsert = false
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: ME } } } })
  setDataOwner(ME)
})

describe('同一台裝置上重疊的同步', () => {
  it('兩個 syncNow 同時跑，不會把資料弄丟', async () => {
    saveDay('2026-09-01', day('內容 A'))
    delayMs = 20
    await Promise.all([syncNow(), syncNow()])
    expect(server['pp:day:2026-09-01']).toBeDefined()
    // 髒標記清乾淨或仍待推，兩者都可接受；不可接受的是資料不見
    expect((server['pp:day:2026-09-01'].value as DayEntry).tasks[0].text).toBe('內容 A')
  })

  it('同步進行中連續編輯三次，最後一版一定要留有待推標記或已經上去', async () => {
    saveDay('2026-09-01', day('v1'))
    delayMs = 30
    const p = syncNow()
    saveDay('2026-09-01', day('v2'))
    saveDay('2026-09-01', day('v3'))
    await p
    const stillDirty = loadDirty()['pp:day:2026-09-01'] !== undefined
    const onServer = (server['pp:day:2026-09-01']?.value as DayEntry)?.tasks[0].text
    // 要嘛已經是 v3，要嘛還標著待推——不能兩者皆非（那就是永遠上不去）
    expect(stillDirty || onServer === 'v3').toBe(true)
    expect(loadDay('2026-09-01').tasks[0].text).toBe('v3') // 本機一定是最新的
  })
})

describe('兩台裝置輪流同步', () => {
  it('B 的新內容不會被 A 的舊內容蓋掉', async () => {
    // A 裝置寫了並同步
    saveDay('2026-09-01', day('A 寫的'))
    await syncNow()
    const snapshot = JSON.stringify(localStorage)

    // B 裝置：乾淨的 localStorage，拉下來後改掉再推
    localStorage.clear()
    setDataOwner(ME)
    await syncNow()
    expect(loadDay('2026-09-01').tasks[0].text).toBe('A 寫的')
    saveDay('2026-09-01', day('B 後來改的'))
    await syncNow()
    expect((server['pp:day:2026-09-01'].value as DayEntry).tasks[0].text).toBe('B 後來改的')

    // A 裝置回來同步：不能把 B 的內容蓋回舊的
    localStorage.clear()
    for (const [k, v] of Object.entries(JSON.parse(snapshot) as Record<string, string>))
      localStorage.setItem(k, v)
    await syncNow()
    expect(loadDay('2026-09-01').tasks[0].text).toBe('B 後來改的')
    expect((server['pp:day:2026-09-01'].value as DayEntry).tasks[0].text).toBe('B 後來改的')
  })
})

describe('pull 不得蓋掉本機未上傳的編輯', () => {
  it('雲端有更新的版本，但本機這個 key 是髒的 → 保留本機、並把它推上去', async () => {
    // 先同步一次，讓 meta 對齊伺服器
    saveDay('2026-09-01', day('起始版'))
    await syncNow()
    // 別台裝置在雲端寫了更新的版本
    server['pp:day:2026-09-01'] = {
      key: 'pp:day:2026-09-01',
      value: day('別台裝置寫的（時間戳較新）'),
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    }
    // 這台裝置在離線時也改了同一天（髒的）
    saveDay('2026-09-01', day('我在這台剛寫的，還沒上傳'))
    expect(loadDirty()['pp:day:2026-09-01']).toBeGreaterThan(0)

    await syncNow()
    // 使用者剛打的字不能被無聲吃掉
    expect(loadDay('2026-09-01').tasks[0].text).toBe('我在這台剛寫的，還沒上傳')
    expect((server['pp:day:2026-09-01'].value as DayEntry).tasks[0].text).toBe(
      '我在這台剛寫的，還沒上傳'
    )
  })
})

describe('syncNow 必須序列化（兩個同步不得互相超車）', () => {
  it('任何時刻只能有一個同步在途', async () => {
    // 直接數「同時進行中的 upsert 數」。先前寫成比較完成順序，
    // 但 Promise 的解析順序在未序列化時也常常剛好是先進先出，
    // 那條斷言分辨不出對錯（拿掉序列化仍然綠）。改成量真正的重疊。
    let inFlight = 0
    let maxInFlight = 0
    trackUpsert = (delta) => {
      inFlight += delta
      maxInFlight = Math.max(maxInFlight, inFlight)
    }
    saveDay('2026-09-01', day('第一次'))
    delayMs = 40
    const a = syncNow()
    saveDay('2026-09-02', day('第二次'))
    const b = syncNow()
    await Promise.all([a, b])
    trackUpsert = null
    expect(maxInFlight).toBe(1) // 沒序列化的話會是 2
    expect((server['pp:day:2026-09-02'].value as DayEntry).tasks[0].text).toBe('第二次')
  })
})

describe('一個卡住的同步不得堵死之後所有同步', () => {
  it('前一次永遠 pending 時，後續同步仍然跑得起來', async () => {
    // stuckUpsert 讓 upsert 永遠不回應。不能用 mockReturnValueOnce：
    // 每次同步會呼叫 from() 兩次（select 一次、upsert 一次），Once 只吃掉第一次，
    // 根本卡不住——第一版證偽沒反轉就是因為這個。
    const SLOT_MS = 200
    __setSyncSlotTimeout(SLOT_MS)
    stuckUpsert = true
    saveDay('2026-09-01', day('卡住的那次'))
    const stuck = syncNow()
    void stuck.catch(() => {})
    await new Promise((r) => setTimeout(r, 10))

    // 讓出 queue 佔用的時間過去
    stuckUpsert = false
    await new Promise((r) => setTimeout(r, SLOT_MS + 100))

    saveDay('2026-09-02', day('後來的'))
    await syncNow()
    expect(server['pp:day:2026-09-02']).toBeDefined()
    __setSyncSlotTimeout(30_000)
  })
})
