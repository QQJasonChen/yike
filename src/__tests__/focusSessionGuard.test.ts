// 一段專注屬於「按下開始的那一天」與「按下開始的那個人」。
import { beforeEach, describe, expect, it } from 'vitest'
import { claimTimerCompletion, newTimerId, recordAbandon, recordFocusSession, renewSegmentForToday, saveTimer, supersededOnDisk } from '../focusSession'
import { clearUnsavedDrafts, editStoredKey, hasUnsavedDrafts, hasUnsavedDraftsFor } from '../useStoredEntry'
import { DayEntry, emptyDay, emptyTask } from '../types'
import { loadDay, saveDay, setDataOwner } from '../storage'

const ALICE = 'aaaaaaaa-1111-1111-1111-111111111111'
const BOB = 'bbbbbbbb-2222-2222-2222-222222222222'
const day = (mit: string): DayEntry => ({ ...emptyDay(), tasks: [{ ...emptyTask(), text: mit }] })
const session = (extra: Partial<Parameters<typeof recordFocusSession>[0]> = {}) => {
  const start = Date.parse('2026-09-03T10:00:00')
  return recordFocusSession({
    dateKey: '2026-09-03',
    taskIndex: 0,
    taskText: '今天的任務',
    startMs: start,
    endMs: start + 25 * 60_000,
    focusMinutes: 25,
    ...extra,
  })
}

beforeEach(() => {
  localStorage.clear()
  clearUnsavedDrafts()
  setDataOwner(BOB)
})

describe('寫進計時器自己的那一天', () => {
  it('計時中翻到歷史日期，完成的格數不會記到那一天，也不會覆蓋今天', () => {
    saveDay('2026-09-03', day('今天的任務'))
    saveDay('2026-08-01', day('八月的任務'))
    expect(session()).toBe(true)
    expect(loadDay('2026-09-03').tasks[0].done).toBe(1)
    expect(loadDay('2026-09-03').blocks).toHaveLength(1)
    expect(loadDay('2026-08-01').tasks[0].done).toBe(0)
    expect(loadDay('2026-08-01').tasks[0].text).toBe('八月的任務')
  })

  it('會發兩種事件：DayView 聽 date、期間檢視聽 key', () => {
    saveDay('2026-09-03', day('x'))
    const got: string[] = []
    const h = (e: Event) => got.push(e.type)
    window.addEventListener('yike:external-day-change', h)
    window.addEventListener('yike:external-key-change', h)
    session()
    window.removeEventListener('yike:external-day-change', h)
    window.removeEventListener('yike:external-key-change', h)
    expect(got.sort()).toEqual(['yike:external-day-change', 'yike:external-key-change'])
  })
})

describe('owner 守衛（對齊 useStoredEntry.canWrite）', () => {
  it('另一個分頁換了帳號 → 不寫、回 false，上一個人的任務不會進新帳號的今天', () => {
    saveDay('2026-09-03', day('Alice 的任務'))
    setDataOwner(ALICE) // Alice 按下開始
    const owner = ALICE
    setDataOwner(BOB) // 完成前另一個分頁換成 Bob
    expect(session({ owner })).toBe(false)
    expect(loadDay('2026-09-03').tasks[0].done).toBe(0)
    expect(recordAbandon('2026-09-03', 0, undefined, owner)).toBe(false)
    expect(loadDay('2026-09-03').tasks[0].withered ?? 0).toBe(0)
  })

  it('沒帶 owner（舊的計時狀態）→ 照舊寫入', () => {
    saveDay('2026-09-03', day('x'))
    expect(session({ owner: undefined })).toBe(true)
    expect(loadDay('2026-09-03').tasks[0].done).toBe(1)
  })
})

describe('跟畫面編輯同一套草稿機制（editStoredKey）', () => {
  it('畫面有存不進去的草稿 → 專注結果疊在草稿上，不把草稿蓋掉', () => {
    saveDay('2026-09-03', day('原本的'))
    // 模擬畫面編輯存失敗（配額滿）→ 草稿留在記憶體
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'pp:day:2026-09-03') throw new DOMException('quota', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
    let okDraft: boolean
    try {
      okDraft = editStoredKey(
        'pp:day:2026-09-03',
        () => loadDay('2026-09-03'),
        (v) => saveDay('2026-09-03', v),
        (b) => ({ ...b, tasks: [{ ...b.tasks[0], text: '草稿改的名字' }] }),
        BOB
      )
    } finally {
      Storage.prototype.setItem = orig
    }
    expect(okDraft).toBe(false)
    expect(hasUnsavedDrafts()).toBe(true)
    // 空間釋放後計時完成：結果要包含草稿的內容，而不是用 storage 的舊版當基準
    expect(session()).toBe(true)
    const after = loadDay('2026-09-03')
    expect(after.tasks[0].text).toBe('草稿改的名字')
    expect(after.tasks[0].done).toBe(1)
    expect(hasUnsavedDrafts()).toBe(false)
    clearUnsavedDrafts()
  })

  it('專注結果存不下 → 進草稿等下次成功存檔一起帶上，不是鈴響了一格都沒記', () => {
    saveDay('2026-09-03', day('x'))
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'pp:day:2026-09-03') throw new DOMException('quota', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
    try {
      expect(session()).toBe(false)
    } finally {
      Storage.prototype.setItem = orig
    }
    expect(hasUnsavedDrafts()).toBe(true)
    // 下一次任何成功的編輯會把草稿（含那一格）寫回去
    editStoredKey('pp:day:2026-09-03', () => loadDay('2026-09-03'), (v) => saveDay('2026-09-03', v), (b) => b, BOB)
    expect(loadDay('2026-09-03').tasks[0].done).toBe(1)
    clearUnsavedDrafts()
  })
})

describe('跨分頁只記一次', () => {
  it('同一個 timer id 第二次認領失敗；不同 id 各自可以', async () => {
    expect(await claimTimerCompletion('t1')).toBe(true)
    expect(await claimTimerCompletion('t1')).toBe(false)
    expect(await claimTimerCompletion('t2')).toBe(true)
    expect(await claimTimerCompletion('t1')).toBe(false) // 完成歷史不是只記最後一段：T1 過期的放棄不能再認領
    expect(await claimTimerCompletion(undefined)).toBe(true) // 舊計時狀態沒 id：照舊
  })
  it('連續番茄鐘每一段都要有新的 id，否則第二段被當成已記過', () => {
    expect(newTimerId()).not.toBe(newTimerId())
  })
})

describe('畫面 hook 的草稿旗標以 map 為準', () => {
  it('helper 清掉草稿後，hook 的 reload 不能再被舊旗標卡住', async () => {
    // 這條在 hook 裡面；用 hook 的純邏輯驗：有 pending → 用草稿；pending 被清 → 要讀 storage
    const { useStoredEntry } = await import('../useStoredEntry')
    expect(typeof useStoredEntry).toBe('function')
    // 真正的行為由 viewSyncSafety.test.tsx（渲染測試）與下面這條 helper 測試一起守：
    saveDay('2026-09-03', day('x'))
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'pp:day:2026-09-03') throw new DOMException('quota', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
    try {
      editStoredKey('pp:day:2026-09-03', () => loadDay('2026-09-03'), (v) => saveDay('2026-09-03', v), (b) => ({ ...b, mood: 3 }), BOB)
    } finally {
      Storage.prototype.setItem = orig
    }
    expect(hasUnsavedDrafts()).toBe(true)
    expect(session()).toBe(true) // 空間回來，計時完成：草稿＋結果一起落地
    expect(hasUnsavedDrafts()).toBe(false)
    expect(loadDay('2026-09-03').mood).toBe(3)
    expect(loadDay('2026-09-03').tasks[0].done).toBe(1)
  })
})

describe('已知 id 消失（計時中匯入換了內容）', () => {
  it('不退回 index 改到別件事：用文字找，找不到就追加一列', () => {
    saveDay('2026-09-03', { ...emptyDay(), tasks: [{ ...emptyTask(), id: 'B-id', text: 'B 任務' }] })
    expect(session({ taskId: 'A-id', taskIndex: 0, taskText: 'A 任務' })).toBe(true)
    const d = loadDay('2026-09-03')
    expect(d.tasks[0].text).toBe('B 任務')
    expect(d.tasks[0].done).toBe(0) // B 沒被塗到
    const a = d.tasks.find((t) => t.text === 'A 任務')!
    expect(a.done).toBe(1)
    expect(a.id).toBe('A-id')
    expect(d.blocks[0].text).toBe('A 任務')
  })
})

describe('跨午夜的連續番茄鐘', () => {
  it('新的一段屬於新的今天：dateKey 換、任務在今天重新定位（找不到就追加）', () => {
    saveDay('2026-09-03', { ...emptyDay(), tasks: [{ ...emptyTask(), id: 'y-id', text: '昨晚的事' }] })
    const t = { dateKey: '2026-09-03', taskIndex: 0, taskId: 'y-id', taskText: '昨晚的事', owner: BOB }
    const n = renewSegmentForToday(t, '2026-09-04')
    expect(n.dateKey).toBe('2026-09-04')
    const today = loadDay('2026-09-04')
    expect(today.tasks[n.taskIndex].text).toBe('昨晚的事')
    expect(today.tasks[n.taskIndex].id).toBe(n.taskId)
    expect(loadDay('2026-09-03').tasks[0].done).toBe(0)
  })
  it('同一天就原樣', () => {
    const t = { dateKey: '2026-09-03', taskIndex: 2, taskId: 'x', taskText: 'x', owner: BOB }
    expect(renewSegmentForToday(t, '2026-09-03')).toBe(t)
  })
})

describe('跨午夜續段：存失敗也要換日', () => {
  it('今天的草稿已在 map 裡，新段指向今天，不能還帶昨天', () => {
    saveDay('2026-09-03', { ...emptyDay(), tasks: [{ ...emptyTask(), id: 'y', text: '昨晚的事' }] })
    const t = { dateKey: '2026-09-03', taskIndex: 0, taskId: 'y', taskText: '昨晚的事', owner: BOB }
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'pp:day:2026-09-04') throw new DOMException('quota', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
    let n: typeof t
    try {
      n = renewSegmentForToday(t, '2026-09-04')
    } finally {
      Storage.prototype.setItem = orig
    }
    expect(n!.dateKey).toBe('2026-09-04')
    expect(hasUnsavedDrafts()).toBe(true) // 今天的草稿（含那一列）在 map 裡等下次成功
    clearUnsavedDrafts()
  })
  it('換帳號途中 → 原樣（完成時守衛會擋）', () => {
    const t = { dateKey: '2026-09-03', taskIndex: 0, taskId: 'y', taskText: 'x', owner: 'someone-else' }
    expect(renewSegmentForToday(t, '2026-09-04')).toBe(t)
  })
})

describe('換帳號時上一個人還有草稿', () => {
  it('hasUnsavedDraftsFor 問的是指定主人，不是現在的主人', () => {
    saveDay('2026-09-03', day('x'))
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'pp:day:2026-09-03') throw new DOMException('quota', 'QuotaExceededError')
      return orig.call(this, k, v)
    }
    try {
      editStoredKey('pp:day:2026-09-03', () => loadDay('2026-09-03'), (v) => saveDay('2026-09-03', v), (b) => ({ ...b, mood: 1 }), BOB)
    } finally {
      Storage.prototype.setItem = orig
    }
    setDataOwner(ALICE) // 換人了
    expect(hasUnsavedDrafts()).toBe(false) // 現在的主人沒有
    expect(hasUnsavedDraftsFor(BOB)).toBe(true) // 上一個人有 → App 不能把 ownerRef 換成 Alice
    clearUnsavedDrafts()
  })
})

describe('確認框回來之後，閉包裡那段還算數嗎（supersededOnDisk）', () => {
  // loadTimer 會把「到點超過一小時」的計時當作沒收尾丟掉，所以 fixture 要用現在附近的時間
  const NOW = Date.now()
  const seg = (id: string, offsetMs: number, phase: 'focus' | 'break' = 'focus') => ({
    id, startedAt: NOW + offsetMs, phase, taskIndex: 0, taskText: 'x',
    endsAt: NOW + offsetMs + 25 * 60_000, pausedRemaining: null, totalMs: 25 * 60_000,
  })
  it('磁碟上沒有（配額滿存不進去）→ 不算被取代，還能放棄', () => {
    expect(supersededOnDisk(seg('T1', -1000))).toBe(false)
  })
  it('磁碟上是比我舊的殘影 → 不算', () => {
    localStorage.setItem('ppl:timer', JSON.stringify(seg('T0', -5000)))
    expect(supersededOnDisk(seg('T1', -1000))).toBe(false)
  })
  it('另一分頁開了更新的一段 → 被取代', () => {
    localStorage.setItem('ppl:timer', JSON.stringify(seg('T2', 0)))
    expect(supersededOnDisk(seg('T1', -1000))).toBe(true)
  })
  it('同一段但另一分頁已把它完成（進入休息）→ 被取代', () => {
    localStorage.setItem('ppl:timer', JSON.stringify(seg('T1', -1000, 'break')))
    expect(supersededOnDisk(seg('T1', -1000))).toBe(true)
  })
})

describe('清掉磁碟上的計時只准清自己那一段', () => {
  const NOW2 = Date.now()
  const seg2 = (id: string, owner: string) => ({
    id, owner, startedAt: NOW2, phase: 'focus' as const, taskIndex: 0, taskText: 'x',
    endsAt: NOW2 + 25 * 60_000, pausedRemaining: null, totalMs: 25 * 60_000,
  })
  it('舊帳號分頁把本地 timer 設成 null 時，磁碟上已是新帳號的計時 → 不刪', () => {
    saveTimer(seg2('bob-1', BOB)) // Bob 在另一分頁開的
    saveTimer(null, 'alice-0') // Alice 的分頁被 owner-change-blocked → setTimer(null)
    expect(localStorage.getItem('ppl:timer')).not.toBeNull()
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).id).toBe('bob-1')
  })
  it('清的是自己那段 → 照刪', () => {
    saveTimer(seg2('mine', BOB))
    saveTimer(null, 'mine')
    expect(localStorage.getItem('ppl:timer')).toBeNull()
  })
  it('磁碟停在 focus、我已經在 break（存失敗的殘影）→ 不算被取代，還能重新開始', () => {
    const t = seg2('T1', BOB)
    saveTimer(t)
    expect(supersededOnDisk({ ...t, phase: 'break' })).toBe(false)
  })
})

describe('落盤的舊 effect 不能把別人的新計時蓋回去', () => {
  const NOW3 = Date.now()
  const seg3 = (id: string, offset: number, extra: Partial<{ pausedRemaining: number | null; phase: 'focus' | 'break' }> = {}) => ({
    id, owner: BOB, startedAt: NOW3 + offset, phase: 'focus' as const, taskIndex: 0, taskText: 'x',
    endsAt: NOW3 + offset + 25 * 60_000, pausedRemaining: null, totalMs: 25 * 60_000, ...extra,
  })
  it('B 先寫 T2（較新）→ A 的舊 effect 寫暫停的 T1 → 磁碟仍是 T2', () => {
    saveTimer(seg3('T2', 0))
    saveTimer(seg3('T1', -60_000, { pausedRemaining: 999 }))
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).id).toBe('T2')
  })
  it('沒有更新的一段 → 照寫', () => {
    saveTimer(seg3('T1', -60_000))
    saveTimer(seg3('T1', -60_000, { pausedRemaining: 999 }))
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).pausedRemaining).toBe(999)
  })
})

describe('同一段的版本：落盤只准較新的贏；從沒落盤過就不刪', () => {
  const NOW4 = Date.now()
  const seg4 = (id: string, rev: number, extra: Partial<{ pausedRemaining: number | null }> = {}) => ({
    id, owner: BOB, rev, startedAt: NOW4 - 60_000, phase: 'focus' as const, taskIndex: 0, taskText: 'x',
    endsAt: NOW4 + 20 * 60_000, pausedRemaining: null, totalMs: 25 * 60_000, ...extra,
  })
  it('B 恢復（rev 3）已落盤 → A 的舊 effect 寫暫停（rev 2）→ 磁碟仍是恢復', () => {
    saveTimer(seg4('T1', 3))
    saveTimer(seg4('T1', 2, { pausedRemaining: 999 }))
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).pausedRemaining).toBeNull()
  })
  it('較新的版本照寫', () => {
    saveTimer(seg4('T1', 2))
    saveTimer(seg4('T1', 3, { pausedRemaining: 999 }))
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).pausedRemaining).toBe(999)
  })
  it('A 開啟時沒計時（prevId undefined）→ saveTimer(null) 不會刪掉 B 剛開的', () => {
    saveTimer(seg4('bob', 1))
    saveTimer(null, undefined)
    expect(localStorage.getItem('ppl:timer')).not.toBeNull()
  })
})
