// 一段專注屬於「按下開始的那一天」與「按下開始的那個人」。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { claimTimerCompletion, isTimerEnded, loadTimer, newTimerId, recordAbandon, recordFocusSession, renewSegmentForToday, saveTimer, shouldAdoptDiskTimer, supersededOnDisk } from '../focusSession'
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
    saveTimer(null, { ...seg2('alice-0', ALICE), startedAt: NOW2 + 1 }) // Alice 的分頁被 owner-change-blocked → setTimer(null)
    expect(localStorage.getItem('ppl:timer')).not.toBeNull()
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).id).toBe('bob-1')
  })
  it('清的是自己那段 → 照刪', () => {
    saveTimer(seg2('mine', BOB))
    saveTimer(null, seg2('mine', BOB))
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
    saveTimer(null, null)
    expect(localStorage.getItem('ppl:timer')).not.toBeNull()
  })
})

describe('舊格式計時（沒有 id）', () => {
  it('載入時給一個由 startedAt 決定的 id，之後清得掉、認領得了', async () => {
    const NOW5 = Date.now()
    localStorage.setItem('ppl:timer', JSON.stringify({
      taskIndex: 0, taskText: 'x', phase: 'focus', endsAt: NOW5 + 60_000, pausedRemaining: 30_000, totalMs: 1, startedAt: NOW5 - 60_000,
    }))
    const t = loadTimer()!
    expect(t.id).toBe(`legacy-${NOW5 - 60_000}`)
    expect(loadTimer()!.id).toBe(t.id) // 另一個分頁算出來一樣
    saveTimer(null, t)
    expect(localStorage.getItem('ppl:timer')).toBeNull()
    expect(await claimTimerCompletion(t.id)).toBe(true)
    expect(await claimTimerCompletion(t.id)).toBe(false)
  })
})

describe('被別的分頁結束的段不能復活', () => {
  it('B 放棄（刪掉）T1 → A 暫停的舊 effect 再寫 T1 → 磁碟仍空', () => {
    const NOW6 = Date.now()
    const t = { id: 'T1', owner: BOB, rev: 1, startedAt: NOW6 - 60_000, phase: 'focus' as const, taskIndex: 0, taskText: 'x', endsAt: NOW6 + 20 * 60_000, pausedRemaining: null, totalMs: 1 }
    saveTimer(t)
    saveTimer(null, t) // B 放棄
    saveTimer({ ...t, rev: 2, pausedRemaining: 999 }) // A 的舊 effect
    expect(localStorage.getItem('ppl:timer')).toBeNull()
  })
})

describe('落盤走跨分頁鎖', () => {
  it('有 navigator.locks 就在鎖裡做「檢查＋寫入」；沒有就同步寫', async () => {
    const NOW7 = Date.now()
    const t = { id: 'T1', owner: BOB, rev: 1, startedAt: NOW7 - 60_000, phase: 'focus' as const, taskIndex: 0, taskText: 'x', endsAt: NOW7 + 20 * 60_000, pausedRemaining: null, totalMs: 1 }
    const request = vi.fn(async (_name: string, cb: () => unknown) => cb())
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
    try {
      await saveTimer(t)
      expect(request).toHaveBeenCalledWith('yike:timer', expect.any(Function))
      expect(JSON.parse(localStorage.getItem('ppl:timer')!).id).toBe('T1')
    } finally {
      Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    }
    // 沒有鎖的環境：同步寫
    await saveTimer({ ...t, rev: 2, pausedRemaining: 5 })
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).rev).toBe(2)
  })
})

describe('id 不見了（還原備份洗掉）且同名多列', () => {
  it('原 index 的文字對得上就記在原 index，不跳到第一個同名列', () => {
    saveDay('2026-09-03', { ...emptyDay(), tasks: [{ ...emptyTask(), text: '回信' }, { ...emptyTask(), text: '回信' }] })
    expect(session({ taskId: 'gone-id', taskIndex: 1, taskText: '回信' })).toBe(true)
    const d = loadDay('2026-09-03')
    expect(d.tasks[0].done).toBe(0)
    expect(d.tasks[1].done).toBe(1)
  })
})

describe('isTimerEnded', () => {
  it('被清掉的段在墓碑裡', () => {
    const NOW8 = Date.now()
    saveTimer({ id: 'E1', owner: BOB, startedAt: NOW8 - 1000, phase: 'focus', taskIndex: 0, taskText: 'x', endsAt: NOW8 + 60_000, pausedRemaining: null, totalMs: 1 })
    expect(isTimerEnded('E1')).toBe(false)
    saveTimer(null, { id: 'E1', owner: BOB, startedAt: NOW8 - 1000, phase: 'focus', taskIndex: 0, taskText: 'x', endsAt: NOW8 + 60_000, pausedRemaining: null, totalMs: 1 })
    expect(isTimerEnded('E1')).toBe(true)
    expect(isTimerEnded(undefined)).toBe(false)
  })
})

describe('storage 事件要不要採用（shouldAdoptDiskTimer）', () => {
  const t = (id: string) => ({ id, startedAt: Date.now(), phase: 'focus' as const, taskIndex: 0, taskText: 'x', endsAt: Date.now() + 60_000, pausedRemaining: null, totalMs: 1 })
  it('排隊中的舊刪除（刪的是 T1）不能清掉本地剛開始的 T2', () => {
    expect(shouldAdoptDiskTimer(null, JSON.stringify(t('T1')), t('T2'), undefined)).toBe(false)
  })
  it('刪的就是我這段 → 跟著清', () => {
    expect(shouldAdoptDiskTimer(null, JSON.stringify(t('T2')), t('T2'), undefined)).toBe(true)
  })
  it('本地沒計時 → 磁碟空就空', () => {
    expect(shouldAdoptDiskTimer(null, JSON.stringify(t('T1')), null, undefined)).toBe(true)
  })
  it('磁碟上的段是本地剛結束的或墓碑裡的 → 不採用', () => {
    expect(shouldAdoptDiskTimer(t('E'), null, null, 'E')).toBe(false)
    saveTimer(t('G')); saveTimer(null, t('G'))
    expect(shouldAdoptDiskTimer(t('G'), null, null, undefined)).toBe(false)
    expect(shouldAdoptDiskTimer(t('H'), null, null, undefined)).toBe(true)
  })
})

describe('放棄時 id 不見了（還原備份）→ 靠文字找', () => {
  it('同名列照記枯樹', () => {
    saveDay('2026-09-03', { ...emptyDay(), tasks: [{ ...emptyTask(), text: '回信' }] })
    expect(recordAbandon('2026-09-03', 0, 'gone', BOB, '回信')).toBe(true)
    expect(loadDay('2026-09-03').tasks[0].withered).toBe(1)
  })
})


describe('Codex 第 15 輪', () => {
  const NOW9 = Date.now()
  const mk = (id: string, offset: number, rev = 1) => ({ id, owner: BOB, rev, startedAt: NOW9 + offset, phase: 'focus' as const, taskIndex: 0, taskText: 'x', endsAt: NOW9 + offset + 60_000, pausedRemaining: null, totalMs: 1 })
  it('#1 排隊中的舊事件（A 暫停 T1）不能把本地剛開始的 T2 倒退回 T1', () => {
    expect(shouldAdoptDiskTimer(mk('T1', -60_000), null, mk('T2', 0), undefined)).toBe(false)
    expect(shouldAdoptDiskTimer(mk('T2', 0, 1), null, mk('T2', 0, 2), undefined)).toBe(false) // 同段較舊版本
    expect(shouldAdoptDiskTimer(mk('T3', 1000), null, mk('T2', 0), undefined)).toBe(true) // 真的更新的段
  })
  it('#2 T2 存失敗、磁碟留著更舊的 T1 → 放棄 T2 時連 T1 殘影一起清，兩個都進墓碑', () => {
    saveTimer(mk('T1', -60_000))
    // T2 從來沒存成功（假裝配額滿），現在放棄 T2
    saveTimer(null, mk('T2', 0))
    expect(localStorage.getItem('ppl:timer')).toBeNull()
    expect(isTimerEnded('T2')).toBe(true)
    expect(isTimerEnded('T1')).toBe(true)
  })
  it('磁碟上是別人更新的段 → 不碰，但自己那段仍留墓碑', () => {
    saveTimer(mk('NEW', 1000))
    saveTimer(null, mk('OLD', 0))
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).id).toBe('NEW')
    expect(isTimerEnded('OLD')).toBe(true)
  })
})

describe('Codex 第 16 輪：落盤與還原都要核對主人', () => {
  const NOW = Date.now()
  const mk = (id: string, owner: string | null | undefined, offset = 0) => {
    const t: ReturnType<typeof loadTimer> & object = {
      id, startedAt: NOW + offset, phase: 'focus' as const, taskIndex: 0, taskText: '私人任務',
      endsAt: NOW + offset + 25 * 60_000, pausedRemaining: null, totalMs: 25 * 60_000,
    }
    if (owner !== undefined) t.owner = owner
    return t
  }
  it('#1 A 暫停的落盤排在換帳號之後才拿到鎖 → 不寫回：磁碟留空、B 開新頁看不到 A 的任務', () => {
    setDataOwner(ALICE)
    const tA = { ...mk('A-1', ALICE), pausedRemaining: 600_000 }
    // 另一分頁換成 Bob、清掉 ppl:timer（磁碟空白、沒有墓碑）
    setDataOwner(BOB)
    localStorage.removeItem('ppl:timer')
    saveTimer(tA) // A 的 callback 這時才拿到鎖
    expect(localStorage.getItem('ppl:timer')).toBeNull()
    expect(loadTimer()).toBeNull()
  })
  it('#1 還原入口也看主人：磁碟上是 A 的段，現在主人是 B → loadTimer 回 null', () => {
    localStorage.setItem('ppl:timer', JSON.stringify(mk('A-2', ALICE)))
    expect(loadTimer()).toBeNull()
    setDataOwner(ALICE)
    expect(loadTimer()?.id).toBe('A-2')
  })
  it('舊版沒有 owner 欄的計時照常還原（相容）', () => {
    localStorage.setItem('ppl:timer', JSON.stringify(mk('old', undefined)))
    expect(loadTimer()?.id).toBe('old')
    saveTimer({ ...mk('old', undefined), pausedRemaining: 1 })
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).pausedRemaining).toBe(1)
  })
  it('#2 時鐘回撥：Bob 新開的段比 Alice 的舊 → 清 Alice 的殘影時不能把 Bob 當殘影刪掉', () => {
    saveTimer(mk('bob-new', BOB, -3_600_000)) // 系統時間回撥一小時後 Bob 開的
    setDataOwner(ALICE)
    saveTimer(null, mk('alice-old', ALICE, 0)) // Alice 分頁喚醒、owner-change 清空本地 timer
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).id).toBe('bob-new')
    expect(isTimerEnded('bob-new')).toBe(false)
    expect(isTimerEnded('alice-old')).toBe(true)
  })
  it('#2 同一個主人、比我舊的殘影才一起清（第 15 輪行為保留）', () => {
    saveTimer(mk('T1', BOB, -60_000))
    saveTimer(null, mk('T2', BOB, 0))
    expect(localStorage.getItem('ppl:timer')).toBeNull()
    expect(isTimerEnded('T1')).toBe(true)
  })
})

describe('Codex 第 17 輪：時鐘回撥後重新開始', () => {
  const NOW = Date.now()
  const mk = (id: string, offset: number, extra: Partial<{ pausedRemaining: number | null }> = {}) => ({
    id, owner: BOB, startedAt: NOW + offset, phase: 'focus' as const, taskIndex: 0, taskText: 'x',
    endsAt: NOW + offset + 25 * 60_000, pausedRemaining: null, totalMs: 25 * 60_000, ...extra,
  })
  it('T1 暫停中 → 時鐘回撥 5 分鐘 → 確認重新開始 T2（prev=T1）→ 磁碟是 T2、T1 進墓碑', () => {
    saveTimer(mk('T1', 0, { pausedRemaining: 600_000 }))
    saveTimer(mk('T2', -5 * 60_000), mk('T1', 0, { pausedRemaining: 600_000 }))
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).id).toBe('T2')
    expect(isTimerEnded('T1')).toBe(true)
    saveTimer(null, mk('T2', -5 * 60_000)) // 放棄 T2 也要能清
    expect(localStorage.getItem('ppl:timer')).toBeNull()
  })
  it('磁碟上是別的分頁開的更新段（不是 prev）→ 照舊不准蓋', () => {
    saveTimer(mk('T3', 1000))
    saveTimer(mk('T2', -5 * 60_000), mk('T1', 0))
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).id).toBe('T3')
  })
  it('T2 存失敗、磁碟留著進了墓碑的 T1 → 不算被取代、重開不還原 T1、放棄 T2 能清', () => {
    localStorage.setItem('ppl:timer', JSON.stringify(mk('T1', 0)))
    localStorage.setItem('ppl:timerEnded', JSON.stringify(['T1']))
    expect(supersededOnDisk(mk('T2', -5 * 60_000))).toBe(false)
    expect(loadTimer()).toBeNull()
    saveTimer(null, mk('T2', -5 * 60_000))
    expect(localStorage.getItem('ppl:timer')).toBeNull()
  })
  it('另一分頁收到 T2 事件：本地 T1 已在墓碑 → 就算 T2 的 startedAt 比較小也採用', () => {
    localStorage.setItem('ppl:timerEnded', JSON.stringify(['T1']))
    expect(shouldAdoptDiskTimer(mk('T2', -5 * 60_000), null, mk('T1', 0), undefined)).toBe(true)
  })
})

describe('Codex 第 18 輪：舊分頁的過期放棄確認不能刪掉回撥後的新段', () => {
  const NOW = Date.now()
  const mk = (id: string, offset: number) => ({
    id, owner: BOB, startedAt: NOW + offset, phase: 'focus' as const, taskIndex: 0, taskText: 'x',
    endsAt: NOW + offset + 25 * 60_000, pausedRemaining: null, totalMs: 25 * 60_000,
  })
  it('A 重新開始 T2（比 T1 舊）後，B 接受對 T1 的過期放棄 → T1 已進墓碑算被取代', () => {
    saveTimer(mk('T1', 0))
    saveTimer(mk('T2', -5 * 60_000), mk('T1', 0))
    expect(supersededOnDisk(mk('T1', 0))).toBe(true)
  })
  it('就算 B 沒檢查就 saveTimer(null, T1)：T1 早在墓碑 → 只准刪自己，T2 不動、不進墓碑', () => {
    saveTimer(mk('T1', 0))
    saveTimer(mk('T2', -5 * 60_000), mk('T1', 0))
    saveTimer(null, mk('T1', 0))
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).id).toBe('T2')
    expect(isTimerEnded('T2')).toBe(false)
  })
  it('磁碟上還是我自己這段（即使已在墓碑）→ 照刪', () => {
    saveTimer(mk('T1', 0))
    localStorage.setItem('ppl:timerEnded', JSON.stringify(['T1']))
    saveTimer(null, mk('T1', 0))
    expect(localStorage.getItem('ppl:timer')).toBeNull()
  })
})

describe('Codex 第 19 輪：過期的放棄不能刪掉同一段已進休息的狀態', () => {
  const NOW = Date.now()
  const mk = (phase: 'focus' | 'break', rev: number) => ({
    id: 'T1', owner: BOB, rev, startedAt: NOW - 60_000, phase, taskIndex: 0, taskText: 'x',
    endsAt: NOW + 20 * 60_000, pausedRemaining: null, totalMs: 25 * 60_000,
  })
  it('B 提前完成（break rev2）先落盤 → A 的舊放棄（prev=focus rev1）→ 不刪、不立墓碑', () => {
    saveTimer(mk('focus', 1))
    saveTimer(mk('break', 2))
    saveTimer(null, mk('focus', 1))
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).phase).toBe('break')
    expect(isTimerEnded('T1')).toBe(false)
    saveTimer(mk('break', 3)) // B 後續的寫入還能進
    expect(JSON.parse(localStorage.getItem('ppl:timer')!).rev).toBe(3)
  })
  it('磁碟還在 focus → 放棄照刪；休息中放棄休息（prev=break）也照刪', () => {
    saveTimer(mk('focus', 1))
    saveTimer(null, mk('focus', 1))
    expect(localStorage.getItem('ppl:timer')).toBeNull()
    localStorage.clear()
    saveTimer(mk('break', 2))
    saveTimer(null, mk('break', 2))
    expect(localStorage.getItem('ppl:timer')).toBeNull()
  })
})

describe('Codex 第 20 輪：配額滿時墓碑要在刪掉計時之後還立得起來', () => {
  const NOW = Date.now()
  const mk = (rev: number, extra: Partial<{ pausedRemaining: number | null }> = {}) => ({
    id: 'T1', owner: BOB, rev, startedAt: NOW - 60_000, phase: 'focus' as const, taskIndex: 0, taskText: 'x',
    endsAt: NOW + 20 * 60_000, pausedRemaining: null, totalMs: 25 * 60_000, ...extra,
  })
  /** 假的配額：只要 ppl:timer 還在，ppl:timerEnded 就塞不進去（刪掉計時才有空間） */
  const fullUntilTimerRemoved = () => {
    const real = Storage.prototype.setItem // 先抓原本的，spy 裝上去之後 prototype 上就是 mock 自己
    return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === 'ppl:timerEnded' && this.getItem('ppl:timer') !== null) throw new DOMException('quota', 'QuotaExceededError')
      return real.call(this, k, v)
    })
  }
  it('A 放棄：墓碑先失敗 → 刪掉計時後補立 → B 排隊中的暫停寫入被擋、重開不復活', () => {
    saveTimer(mk(1))
    const spy = fullUntilTimerRemoved()
    try {
      saveTimer(null, mk(1))
      expect(localStorage.getItem('ppl:timer')).toBeNull()
      expect(isTimerEnded('T1')).toBe(true)
      saveTimer(mk(2, { pausedRemaining: 5000 })) // B 的舊寫入
      expect(localStorage.getItem('ppl:timer')).toBeNull()
      expect(loadTimer()).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('Codex 第 21 輪：重新開始時墓碑立不起來也要立', () => {
  const NOW = Date.now()
  const mk = (id: string, offset: number) => ({
    id, owner: BOB, startedAt: NOW + offset, phase: 'focus' as const, taskIndex: 0, taskText: 'x',
    endsAt: NOW + offset + 25 * 60_000, pausedRemaining: null, totalMs: 25 * 60_000,
  })
  it('配額滿：B 重新開始 T2（比 T1 舊）→ T1 仍進墓碑 → A 對 T1 的過期放棄擋下、T2 留著', () => {
    saveTimer(mk('T1', 0))
    const real = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === 'ppl:timerEnded' && this.getItem('ppl:timer') !== null) throw new DOMException('quota', 'QuotaExceededError')
      return real.call(this, k, v)
    })
    try {
      saveTimer(mk('T2', -5 * 60_000), mk('T1', 0))
      expect(JSON.parse(localStorage.getItem('ppl:timer')!).id).toBe('T2')
      expect(isTimerEnded('T1')).toBe(true)
      expect(supersededOnDisk(mk('T1', 0))).toBe(true)
      saveTimer(null, mk('T1', 0))
      expect(JSON.parse(localStorage.getItem('ppl:timer')!).id).toBe('T2')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('Codex 第 22 輪', () => {
  const NOW = Date.now()
  const mk = (id: string, phase: 'focus' | 'break', rev: number, offset = -60_000) => ({
    id, owner: BOB, rev, startedAt: NOW + offset, phase, taskIndex: 0, taskText: 'x',
    endsAt: NOW + 20 * 60_000, pausedRemaining: null, totalMs: 25 * 60_000,
  })
  it('#1 A 確認重新開始 T1 → 拿到鎖前 B 提前完成把 T1 寫成 break → 不換、T1 不進墓碑', () => {
    saveTimer(mk('T1', 'focus', 1))
    saveTimer(mk('T1', 'break', 2))
    saveTimer(mk('T2', 'focus', 1, 0), mk('T1', 'focus', 1))
    const disk = JSON.parse(localStorage.getItem('ppl:timer')!)
    expect(disk.id).toBe('T1')
    expect(disk.phase).toBe('break')
    expect(isTimerEnded('T1')).toBe(false)
  })
  it('#2 到點認領：這段已在墓碑 → 不准記；放棄路徑（沒帶 unlessEnded）照舊能認領', async () => {
    localStorage.setItem('ppl:timerEnded', JSON.stringify(['T1']))
    expect(await claimTimerCompletion('T1', { unlessEnded: true })).toBe(false)
    expect(await claimTimerCompletion('T1')).toBe(true)
    expect(await claimTimerCompletion('T9', { unlessEnded: true })).toBe(true)
  })
})

describe('Codex 第 23 輪', () => {
  const NOW = Date.now()
  const mk = (id: string, phase: 'focus' | 'break', rev: number, offset = -60_000) => ({
    id, owner: BOB, rev, startedAt: NOW + offset, phase, taskIndex: 0, taskText: 'x',
    endsAt: NOW + 20 * 60_000, pausedRemaining: null, totalMs: 25 * 60_000,
  })
  it('#1 等鎖期間被立了墓碑 → 鎖內再查，不准認領', async () => {
    const nav = navigator as Navigator & { locks?: unknown }
    const orig = nav.locks
    Object.defineProperty(nav, 'locks', {
      configurable: true,
      value: {
        request: async (_n: string, cb: () => unknown) => {
          localStorage.setItem('ppl:timerEnded', JSON.stringify(['T1'])) // B 在我等鎖時把 T1 立墓碑
          return cb()
        },
      },
    })
    try {
      expect(await claimTimerCompletion('T1', { unlessEnded: true })).toBe(false)
    } finally {
      Object.defineProperty(nav, 'locks', { configurable: true, value: orig })
    }
  })
  it('#2 saveTimer 回報結果：被磁碟上的休息狀態擋下 → rejected；正常 → written；同一份 → noop', async () => {
    saveTimer(mk('T1', 'focus', 1))
    saveTimer(mk('T1', 'break', 2))
    expect(await saveTimer(mk('T2', 'focus', 1, 0), mk('T1', 'focus', 1))).toBe('rejected')
    localStorage.clear()
    setDataOwner(BOB) // clear 連 ppl:owner 一起清了；主人不同本來就該 rejected
    expect(await saveTimer(mk('T1', 'focus', 1))).toBe('written')
    expect(await saveTimer(mk('T1', 'focus', 1))).toBe('noop')
    expect(await saveTimer(null, mk('T1', 'focus', 1))).toBe('written')
    // 過期放棄：磁碟是已進休息的同一段 → rejected（上面放棄過的 T1 已進墓碑，重來一組）
    localStorage.clear()
    setDataOwner(BOB)
    saveTimer(mk('T1', 'break', 2))
    expect(await saveTimer(null, mk('T1', 'focus', 1))).toBe('rejected')
  })
})
