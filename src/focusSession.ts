// 一段專注完成／放棄 → 塗圈 ＋ 把真實時段寫進時間軸。
//
// 為什麼抽出來、直接對 storage 操作：
//   1. 原本這段邏輯活在 DayView 註冊給 App 的 callback 裡。使用者計時中切到「週」或「月」
//      分頁時 DayView 沒有 mount，callback 是 null——鈴響了、慶祝動畫跑了，但那 25 分鐘
//      一格都沒記到。
//   2. 完成時間原本用 Date.now()：App 被 iOS 睡著、隔一小時才回前景，25 分鐘會被記成
//      84 分鐘。改用計時器自己的 endsAt（由 App 傳入）。
// 一段專注屬於「按下開始的那一天」，跟畫面上正在看哪一天無關。
//
// 寫入走 useStoredEntry 的 editStoredKey：跟畫面上的編輯同一套 owner 守衛與草稿機制。
// 直接 saveDay 會繞過兩件事——①另一個分頁換了帳號後替上一個人寫進新帳號的今天；
// ②配額滿時畫面留著的草稿，下次存檔整頁寫回會把剛記的格數抹掉（Codex 第 1 輪 #1/#2）。
import { syncGrove } from './plantCells'
import { type Task, emptyTask, newTaskId } from './types'
import { getDataOwner, loadDay, saveDay, toDateKey } from './storage'
import { editStoredKey } from './useStoredEntry'

export interface FocusSession {
  dateKey: string
  taskIndex: number
  /** 有 id 就以 id 為準：計時中如果使用者插入/刪除了一列，index 已經指到別人身上；
   *  今天有兩列同名任務時，文字也分不出來。 */
  taskId?: string
  /** 按下開始時這台裝置的資料主人。舊的計時狀態沒有這欄 → 當成「現在的主人」。 */
  owner?: string | null
  taskText: string
  startMs: number
  endMs: number
  focusMinutes: number
}

const toMin = (ms: number) => {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

const expected = (owner: string | null | undefined): string | null =>
  owner === undefined ? getDataOwner() : owner

/** 這段專注／放棄要記在哪一列？
 *  id 對得上 → 那一列。id 對不上（例如計時中從備份匯入，整份任務換了）→ **不能**退回 index：
 *  index 現在指到別件事，會把格數塗到它身上（Codex 第 3 輪 #1）。改用文字找，找不到就追加一列。
 *  沒有 id 的舊計時狀態才退回 index。回傳 -1 代表「要追加」。 */
const locate = (
  tasks: { id?: string; text: string }[],
  taskId: string | undefined,
  index: number,
  text: string
): number => {
  if (taskId) {
    const byId = tasks.findIndex((t) => t.id === taskId)
    if (byId >= 0) return byId
    const byText = tasks.findIndex((t) => t.text.trim() === text.trim() && text.trim())
    return byText >= 0 ? byText : -1
  }
  return index
}
const ensureRow = (tasks: Task[], at: number, taskId: string | undefined, text: string): number => {
  if (at >= 0) return at
  tasks.push({ ...emptyTask(), id: taskId ?? newTaskId(), text })
  return tasks.length - 1
}

/** 同一段計時只准記一次。兩個分頁都還原了同一個 ppl:timer，各自到點各自呼叫記錄，
 *  同一段時間就會累加兩格（Codex 第 1 輪 #3）。先搶到 ppl:timerDone 的才記。 */
/** 計時狀態（跟 FocusTimer 的 TimerState 同形狀；放這裡避免 FocusTimer ↔ focusSession 互相 import） */
export interface PersistedTimer {
  id?: string
  dateKey?: string
  taskIndex: number
  taskId?: string
  owner?: string | null
  taskText: string
  phase: 'focus' | 'break'
  endsAt: number
  pausedRemaining: number | null
  totalMs: number
  startedAt: number
}
export const TIMER_KEY = 'ppl:timer' // 裝置本機、不同步、不匯出（ppl: 前綴結構性排除）
export const loadTimer = (): PersistedTimer | null => {
  try {
    const raw = localStorage.getItem(TIMER_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as PersistedTimer
    if (typeof t?.endsAt !== 'number' || typeof t?.startedAt !== 'number') return null
    if (!t.dateKey) t.dateKey = toDateKey(new Date(t.startedAt)) // 舊版存的沒有這個欄位
    // 暫停中的計時原樣還原；跑著的如果已經過期超過一小時，當作那次沒收尾，丟掉。
    if (t.pausedRemaining === null && Date.now() - t.endsAt > 3_600_000) return null
    return t
  } catch {
    return null
  }
}
export const saveTimer = (t: PersistedTimer | null, prevId?: string) => {
  try {
    const next = t ? JSON.stringify(t) : null
    if (localStorage.getItem(TIMER_KEY) === next) return // 另一個分頁寫的同一份：不要再寫回去（乒乓）
    if (next) localStorage.setItem(TIMER_KEY, next)
    else {
      // 清掉磁碟上的計時只准清「自己剛才那一段」。舊帳號的分頁被 owner-change-blocked 擋下時
      // 會把本地 timer 設成 null；這時磁碟上可能已經是新帳號在另一分頁開的計時，
      // 不比對 id 就把人家的整段刪掉（Codex 第 8 輪 #1）。
      const disk = loadTimer()
      if (disk && disk.id && prevId && disk.id !== prevId) return
      localStorage.removeItem(TIMER_KEY)
    }
  } catch {
    /* 配額滿：計時照跑，只是被殺後救不回來 */
  }
}


/** 確認框（放棄／重新開始）回來之後，閉包裡的那段還算數嗎？
 *  只有當磁碟上有一份**更新**的計時（另一個分頁開了新段，或同一段已經進入別的階段）才算被取代。
 *  磁碟上沒有、或是比閉包那段還舊（配額滿時 saveTimer 存不進去，留著上一段）→ 不算：
 *  否則儲存空間一滿，開始的專注就再也放棄不了（Codex 第 7 輪 #1）。 */
export const supersededOnDisk = (mine: { id?: string; startedAt: number; phase: string }): boolean => {
  const disk = loadTimer()
  if (!disk || !disk.id || !mine.id) return false
  // 同一段：只有磁碟已經走到後面的階段（focus → break，另一分頁完成了它）才算。
  // 磁碟還停在 focus 而我已經在 break，是存失敗留下的殘影，不算（Codex 第 8 輪 #2）
  if (disk.id === mine.id) return mine.phase === 'focus' && disk.phase === 'break'
  return disk.startedAt > mine.startedAt // 別的分頁開了更新的一段；比我舊的是存失敗留下的殘影
}

const DONE_KEY = 'ppl:timerDone'
export const newTimerId = (): string => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

const claimSync = (timerId: string): boolean => {
  try {
    // 記最近 20 段，不是只記最後一段：T1 完成 → T2 完成 → T1 那個過期的放棄確認又能認領
    //（Codex 第 6 輪 #1）
    const raw = localStorage.getItem(DONE_KEY)
    const done: string[] = raw ? (raw.startsWith('[') ? (JSON.parse(raw) as string[]) : [raw]) : []
    if (done.includes(timerId)) return false
    localStorage.setItem(DONE_KEY, JSON.stringify([...done, timerId].slice(-20)))
    return true
  } catch {
    return true // 存不進去就寧可記（重複總比不記好）
  }
}
export const claimTimerCompletion = async (timerId: string | undefined): Promise<boolean> => {
  if (!timerId) return true // 舊的計時狀態沒有 id：照舊
  // localStorage 的 get→set 跨分頁不是原子的：兩個分頁同時到點可以交錯成都通過。
  // Web Locks（Safari 15.4+／Chrome 69+）才是跨分頁的真鎖；沒有的環境退回同步版。
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (locks?.request) {
    try {
      return await locks.request('yike:timer-done', () => claimSync(timerId))
    } catch {
      /* 鎖不可用：退回 */
    }
  }
  return claimSync(timerId)
}

/** 連續番茄鐘跨午夜：新的一段屬於「新的今天」，dateKey/taskId 不能沿用昨天的（Codex 第 3 輪 #3）。
 *  同一天就原樣回傳；換日了就在今天這一頁重新定位那件事（用文字），找不到就追加。 */
export const renewSegmentForToday = <T extends { dateKey?: string; taskIndex: number; taskId?: string; taskText: string; owner?: string | null }>(
  t: T,
  todayKey: string
): T => {
  if (t.dateKey === todayKey) return t
  // 換帳號途中：維持原樣，完成時 owner 守衛會擋。這要在這裡先分出來——
  // 下面存失敗也會回 false，但那時今天的草稿已經在 map 裡、新段仍該指向今天（Codex 第 4 輪 #2）
  if (getDataOwner() !== expected(t.owner)) return t
  const box: { at: number; id?: string } = { at: t.taskIndex, id: t.taskId }
  editStoredKey<ReturnType<typeof loadDay>>(
    `pp:day:${todayKey}`,
    () => loadDay(todayKey),
    (v) => saveDay(todayKey, v),
    (base) => {
      const tasks = base.tasks.slice()
      const found = tasks.findIndex((x) => x.text.trim() === t.taskText.trim() && t.taskText.trim())
      if (found >= 0) {
        if (!tasks[found].id) tasks[found] = { ...tasks[found], id: newTaskId() }
        box.at = found
        box.id = tasks[found].id
        return tasks[found] === base.tasks[found] ? base : { ...base, tasks }
      }
      const blank = tasks.findIndex((x) => !x.text.trim())
      const row = { ...(blank >= 0 ? tasks[blank] : emptyTask()), id: newTaskId(), text: t.taskText }
      if (blank >= 0) tasks[blank] = row
      else tasks.push(row)
      box.at = blank >= 0 ? blank : tasks.length - 1
      box.id = row.id
      return { ...base, tasks }
    },
    expected(t.owner)
  )
  // 存失敗也要換日：change 回呼已經跑過（今天的草稿含那一列，在 map 裡），box 是對的
  return { ...t, dateKey: todayKey, taskIndex: box.at, taskId: box.id }
}

/** editStoredKey 成功時已發 external-key-change；DayView 另外聽 external-day-change（date） */
const announceDay = (dateKey: string) =>
  window.dispatchEvent(new CustomEvent('yike:external-day-change', { detail: { date: dateKey } }))

export const recordFocusSession = (s: FocusSession): boolean => {
  const key = `pp:day:${s.dateKey}`
  const ok = editStoredKey<ReturnType<typeof loadDay>>(
    key,
    () => loadDay(s.dateKey),
    (v) => saveDay(s.dateKey, v),
    (prev) => {
      const tasks = prev.tasks.slice()
      const at = ensureRow(tasks, locate(tasks, s.taskId, s.taskIndex, s.taskText), s.taskId, s.taskText)
      const t = tasks[at]
      if (t) {
        const done = Math.min(t.done + 1, 16)
        tasks[at] = { ...t, done, actual: done, grove: syncGrove(t.grove, done, s.focusMinutes) }
      }
      // 真實起訖 → 分鐘（夾在時間軸 06:00–23:00 範圍內，最短 15 分鐘）
      const bStart = Math.max(6 * 60, Math.min(23 * 60 - 15, toMin(s.startMs)))
      const bEnd = Math.max(bStart + 15, Math.min(23 * 60, toMin(s.endMs)))
      const blocks = prev.blocks.slice()
      // 同任務、上一塊結尾相距 ≤6 分鐘 → 直接接長（連續番茄變一條）
      const tail = blocks.filter((b) => b.taskIndex === at).sort((x, y) => y.end - x.end)[0]
      if (tail && Math.abs(bStart - tail.end) <= 6) {
        tail.end = bEnd
      } else {
        blocks.push({
          id: `f${Date.now().toString(36)}`,
          start: bStart,
          end: bEnd,
          text: t?.text ?? s.taskText ?? '專注',
          taskIndex: at,
        })
      }
      return { ...prev, tasks, blocks }
    },
    expected(s.owner)
  )
  announceDay(s.dateKey)
  return ok
}

/** 計時中放棄（✕）→ 該任務記一棵枯樹。 */
export const recordAbandon = (
  dateKey: string,
  taskIndex: number,
  taskId?: string,
  owner?: string | null
): boolean => {
  const ok = editStoredKey<ReturnType<typeof loadDay>>(
    `pp:day:${dateKey}`,
    () => loadDay(dateKey),
    (v) => saveDay(dateKey, v),
    (prev) => {
      const tasks = prev.tasks.slice()
      const at = locate(tasks, taskId, taskIndex, '')
      const t = tasks[at]
      if (!t) return prev // 放棄＝枯樹，那件事已經不在今天就不追加
      tasks[at] = { ...t, withered: (t.withered ?? 0) + 1 }
      return { ...prev, tasks }
    },
    expected(owner)
  )
  announceDay(dateKey)
  return ok
}
