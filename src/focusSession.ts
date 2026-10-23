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
    const want = text.trim()
    // id 不見了（還原備份把剛補的 id 洗掉）：原 index 那一列文字對得上就是它——同名多列時
    // 不能跳到第一個相符的（Codex 第 13 輪 #1）
    if (want && tasks[index]?.text.trim() === want) return index
    const byText = tasks.findIndex((t) => t.text.trim() === want && want)
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
  /** 這一段的版本：本地每一次操作（暫停／恢復／進休息）+1，從 storage 事件收進來的不加。
   *  同一段的落盤只准版本較新的贏——A 收到「暫停」還沒落盤、B 已「恢復」存進去，
   *  A 的舊 effect 不能再把暫停寫回去（Codex 第 10 輪 #2）。 */
  rev?: number
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
/** 這段計時是不是這台裝置「現在的主人」的？舊版存的沒有 owner 欄 → 當成現在的主人（相容）。
 *  有欄位就逐字比：A 按下開始、另一分頁換成 B 之後，A 的段對 B 來說是別人的（Codex 第 16 輪 #1）。 */
const ownedByCurrent = (t: { owner?: string | null }): boolean =>
  t.owner === undefined || (t.owner ?? null) === (getDataOwner() ?? null)
/** 磁碟上現在放著哪一段（不管是誰的）。內部比較用：決定「碰不碰它」要看到別人的段才行。 */
const readDiskTimer = (): PersistedTimer | null => {
  try {
    const raw = localStorage.getItem(TIMER_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as PersistedTimer
    if (typeof t?.endsAt !== 'number' || typeof t?.startedAt !== 'number') return null
    if (!t.dateKey) t.dateKey = toDateKey(new Date(t.startedAt)) // 舊版存的沒有這個欄位
    // 舊版存的沒有 id：給一個由 startedAt 決定的（同一段在每個分頁算出來都一樣），
    // 否則 prevId 永遠是 undefined、清不掉，claim(undefined) 又永遠成功 → 同段放棄兩次（Codex 第 11 輪 #1）
    if (!t.id) t.id = `legacy-${t.startedAt}`
    // 舊版存的沒有 owner：還原時就釘死成「現在的主人」（含 null），不留 undefined 讓它隨換帳號漂移——
    // A 還原舊計時、開著放棄確認框，另一分頁換成 B，A 確認時 expected(undefined) 取到 B，
    // 主人檢查變成 B===B，B 的任務被記一次枯萎（Codex 第 29 輪）
    if (t.owner === undefined) t.owner = getDataOwner()
    // 過期（跑著的、endsAt 超過一小時）的段**這裡不過濾**：它還在磁碟上、它的分頁可能還開著確認框，
    // 蓋掉它時要留得到墓碑；過期只是畫面不還原的理由（見 loadTimer）（Codex 第 25 輪 #2）
    return t
  } catch {
    return null
  }
}
/** 還原給畫面用的：只還原現在這個主人的段。A 暫停的段還留在磁碟、B 換帳號後開新頁，
 *  不能把 A 的任務文字亮給 B 看（Codex 第 16 輪 #1）。 */
export const loadTimer = (): PersistedTimer | null => {
  const t = readDiskTimer()
  if (!t || !ownedByCurrent(t)) return null
  // 暫停中的計時原樣還原；跑著的如果已經過期超過一小時，當作那次沒收尾，不還原
  if (t.pausedRemaining === null && Date.now() - t.endsAt > 3_600_000) return null
  // 進了墓碑的段不還原：T2 存失敗（配額滿）時磁碟留著被取代的 T1，重開不能把 T1 復活（Codex 第 17 輪）
  if (isTimerEnded(t.id)) return null
  return t
}
/** 落盤的結果：written＝寫了；noop＝磁碟本來就一樣或沒東西好刪；
 *  rejected＝磁碟上的狀態贏了（更新的段、同段後面的階段、已進墓碑、主人換了）——畫面要改採磁碟
 *  （Codex 第 23 輪 #2：鎖內拒寫但畫面還跑著沒落盤的新段，重開就還原舊的）；
 *  failed＝配額滿，計時照跑。 */
export type SaveResult = 'written' | 'noop' | 'rejected' | 'failed'
/** 真正寫磁碟的那段：檢查＋寫入要在同一把跨分頁鎖裡（見下）。 */
const writeTimerSync = (t: PersistedTimer | null, prev?: PersistedTimer | null): SaveResult => {
  const prevId = prev?.id
  try {
    const next = t ? JSON.stringify(t) : null
    if (localStorage.getItem(TIMER_KEY) === next) return 'noop' // 另一個分頁寫的同一份：不要再寫回去（乒乓）
    if (next && t) {
      // 非空寫入也要看磁碟：A 暫停 T1 的落盤 effect 還沒跑，B 已經開了 T2 存進去，
      // A 的舊 effect 再寫就把 T2 蓋回 T1，B 收到 storage 事件後 T2 消失（Codex 第 9 輪）。
      // 磁碟上是更新的一段就不寫；A 隨後會從 storage 事件拿到 T2。
      // 磁碟上那段正是我確認過要換掉的（prev）：這是「重新開始」，不是被取代——時鐘回撥後
      // T2 的 startedAt 會比 T1 小，只比時間會把自己剛確認的替換當成「磁碟比較新」而拒寫，
      // 畫面跑 T2、磁碟留 T1，放棄也被同一判斷擋下（Codex 第 17 輪）。先把 T1 送進墓碑再寫。
      const disk0 = readDiskTimer()
      const replacingOwn = !!prev?.id && prev.id !== t.id && disk0?.id === prev.id
      // 要換掉的那段磁碟上已經走到休息（另一分頁在我確認的空檔提前完成了它）：過期的確認
      // 不准中斷它的休息——跟清除分支同一條鎖內規則（Codex 第 22 輪 #1）
      if (replacingOwn && prev!.phase === 'focus' && disk0!.phase === 'break') return 'rejected'
      if (!replacingOwn && supersededOnDisk(t)) return 'rejected'
      if (t.id && endedIds().includes(t.id)) return 'rejected' // 這段已經被別的分頁結束了，不准復活
      // 寫入當下再核對一次主人：A 暫停的落盤排在鎖後面，等它拿到鎖時另一分頁已經換成 B、
      // 把 ppl:timer 刪了，磁碟空白又沒墓碑，前面的檢查全放行 → A 的任務文字寫回 B 的裝置
      //（Codex 第 16 輪 #1）。主人換了就不寫。
      if (!ownedByCurrent(t)) return 'rejected'
      // 同一段：階段只准往前（focus → break）。往前的寫入不看版本——A 認領完成後用舊快照寫休息，
      // B 中間暫停／恢復過 rev 更高，擋下來這段就永遠進不了休息；往後的（B 排隊中的舊 focus）
      // 不管版本多高都不准（Codex 第 27 輪 #2）。同階段才比版本（暫停 vs 恢復這種交錯）。
      if (disk0 && disk0.id && disk0.id === t.id) {
        if (disk0.phase === 'break' && t.phase === 'focus') return 'rejected'
        if (disk0.phase === t.phase && (disk0.rev ?? 0) > (t.rev ?? 0)) return 'rejected'
      }
      // 蓋掉磁碟上另一段——不管是我確認要換的 prev，還是別的分頁留下的較舊段（autoLoop 兩頁各生一段、
      // 我的較新）——都先替它留墓碑：否則那段的分頁等確認框回來時磁碟已空、它沒進墓碑，
      // supersededOnDisk 放行，多記一次放棄（Codex 第 24 輪）。
      // 墓碑立不起來（配額滿）就先把要換掉的那段刪了騰空間再立（Codex 第 21 輪）
      if (disk0?.id && disk0.id !== t.id) {
        if (!markEnded(disk0.id)) {
          localStorage.removeItem(TIMER_KEY)
          ensureEnded([disk0.id])
        }
      }
      localStorage.setItem(TIMER_KEY, next)
      return 'written'
    } else {
      // 從來沒落盤過自己的計時（prevId 沒值）就什麼都不刪：A 開啟時沒計時、首次 effect 還沒跑，
      // B 已經開了新段存進去，A 的 saveTimer(null, undefined) 不能把它刪掉（Codex 第 10 輪 #1）
      if (!prevId) return 'noop'
      // 我這段早就被（別的分頁的重新開始）送進墓碑了 → 這是過期的放棄確認：只准刪「還是我這段」
      // 的磁碟，別碰其他段——否則時鐘回撥後 A 重新開始的 T2 比 T1 舊，會被當殘影清掉（Codex 第 18 輪）
      const alreadyEnded = isTimerEnded(prevId)
      const disk = readDiskTimer()
      // 同一段但磁碟已經走到休息（另一分頁在我確認放棄的空檔提前完成了它）：這段已經記過一格、
      // 正在休息倒數，過期的放棄不准刪也不准立墓碑——立了 B 後續的寫入全被擋（Codex 第 19 輪）。
      // 跟 supersededOnDisk 同一條規則，只是搬進鎖內。
      if (disk && disk.id === prevId && prev?.phase === 'focus' && disk.phase === 'break') return 'rejected'
      if (alreadyEnded && disk && disk.id !== prevId) return 'rejected'
      // 磁碟上是別人更新的一段 → 不碰（自己仍留墓碑）。是比我舊的殘影（我這段從來沒存成功，
      // 例如配額滿）→ 一起清掉，否則重開會把被取代的舊段復活（Codex 第 15 輪 #2）。
      // 「殘影」只限同一個主人的段：別的帳號的段再舊也不碰——系統時鐘回撥時 Bob 新開的段
      // 會比 Alice 的舊，比時間就會把 Bob 合法的計時當殘影刪掉（Codex 第 16 輪 #2）
      const toMark = [prevId]
      let removeDisk = true
      if (disk && disk.id && disk.id !== prevId && !isTimerEnded(disk.id)) {
        if (!prev || disk.startedAt >= prev.startedAt) removeDisk = false
        else if ((disk.owner ?? null) !== (prev.owner ?? null)) removeDisk = false
        else toMark.push(disk.id)
      }
      // 先刪再立墓碑：配額滿時墓碑存不進去、計時卻刪掉了，排隊中的舊寫入（B 的暫停）會把
      // 剛放棄的段寫回剛釋出的空間，磁碟空白、沒墓碑、版本沒對象，守衛全放行（Codex 第 20 輪）。
      // 刪掉計時騰出空間後再立；還是不行就把墓碑縮成只剩這幾個 id（比一段計時小得多）。
      if (removeDisk) localStorage.removeItem(TIMER_KEY)
      ensureEnded(toMark)
      return removeDisk ? 'written' : 'rejected'
    }
  } catch {
    return 'failed' /* 配額滿：計時照跑，只是被殺後救不回來 */
  }
}

/** 計時狀態落地。「檢查磁碟 → 寫入」必須是同一個原子步驟：A 檢查完、還沒寫，B 寫好 T2，
 *  A 再寫就把 T2 蓋掉（Codex 第 12 輪）。跨分頁唯一的真鎖是 Web Locks；沒有的環境
 *  （jsdom、很舊的瀏覽器）退回同步版——同一個分頁裡 JS 本來就是序列的。
 *  回傳 Promise 但呼叫端不必等它。 */
export const saveTimer = (t: PersistedTimer | null, prev?: PersistedTimer | null): Promise<SaveResult> => {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (locks?.request) {
    return locks
      .request('yike:timer', () => writeTimerSync(t, prev))
      .then((r) => r as SaveResult)
      .catch(() => writeTimerSync(t, prev))
  }
  return Promise.resolve(writeTimerSync(t, prev))
}


/** 確認框（放棄／重新開始）回來之後，閉包裡的那段還算數嗎？
 *  只有當磁碟上有一份**更新**的計時（另一個分頁開了新段，或同一段已經進入別的階段）才算被取代。
 *  磁碟上沒有、或是比閉包那段還舊（配額滿時 saveTimer 存不進去，留著上一段）→ 不算：
 *  否則儲存空間一滿，開始的專注就再也放棄不了（Codex 第 7 輪 #1）。 */
export const supersededOnDisk = (mine: { id?: string; startedAt: number; phase: string }): boolean => {
  const disk = readDiskTimer() // 別人的段也算「被取代」：不能蓋掉它
  if (!mine.id) return false
  if (isTimerEnded(mine.id)) return true // 我這段已經被別的分頁結束／換掉：確認框是過期的（Codex 第 18 輪）
  if (!disk || !disk.id) return false
  if (isTimerEnded(disk.id)) return false // 磁碟上是已結束的殘影（我換掉它但自己存失敗），不算
  // 同一段：只有磁碟已經走到後面的階段（focus → break，另一分頁完成了它）才算。
  // 磁碟還停在 focus 而我已經在 break，是存失敗留下的殘影，不算（Codex 第 8 輪 #2）
  if (disk.id === mine.id) return mine.phase === 'focus' && disk.phase === 'break'
  return disk.startedAt > mine.startedAt // 別的分頁開了更新的一段；比我舊的是存失敗留下的殘影
}

/** 已結束（被清掉）的段。磁碟空了之後 supersededOnDisk／rev 都沒有比較對象，
 *  A 暫停的舊 effect 會把 B 剛放棄的 T1 復活（Codex 第 11 輪 #2）。 */
export const ENDED_KEY = 'ppl:timerEnded'
const endedIds = (): string[] => {
  try {
    const raw = localStorage.getItem(ENDED_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}
export const isTimerEnded = (id: string | undefined): boolean => !!id && endedIds().includes(id)

/** storage 事件收到的磁碟狀態要不要採用？
 *  - 磁碟上有一段：不是本地剛結束的、也不在墓碑裡才採用。
 *  - 磁碟空了（刪除事件）：只有「刪掉的是我現在這段」才跟著清。排隊中的舊刪除（A 的休息段
 *    T1 結束）不能把 B 剛開始、還沒落盤的 T2 清掉（Codex 第 14 輪 #1）。刪了誰看 e.oldValue。 */
export const shouldAdoptDiskTimer = (
  disk: PersistedTimer | null,
  oldValueJson: string | null,
  local: { id?: string; startedAt?: number; rev?: number; phase?: string } | null,
  endedLocally: string | undefined
): boolean => {
  if (disk) {
    if (disk.id === endedLocally || isTimerEnded(disk.id)) return false
    // 本地這段已經被（自己或別的分頁）送進墓碑 → 磁碟上那段就算 startedAt 比較小也採用：
    // 時鐘回撥後重新開始的 T2 比 T1「舊」（Codex 第 17 輪）
    if (local?.id && isTimerEnded(local.id)) return true
    // 比本地舊的事件不採用：B 剛開始 T2 還沒落盤，排隊中的舊事件（A 暫停 T1）會把畫面倒退回 T1，
    // 而自己的 T2 落盤不會對自己發事件，畫面就停在 T1（Codex 第 15 輪 #1）
    if (local?.id && disk.id !== local.id && typeof local.startedAt === 'number' && disk.startedAt < local.startedAt) return false
    if (local?.id && disk.id === local.id) {
      // 同一段：跟寫入端同一條規則——階段只准往前。磁碟已進休息就採用，不管 rev（B 暫停恢復多次
      // rev 很高，A 完成寫的 break rev 較低，B 拒收就永遠停在暫停的專注、專注鎖也不解）（Codex 第 28 輪）；
      // 磁碟還在 focus 而本地已 break 的舊事件不採用；同階段才比 rev
      if (disk.phase === 'break' && local.phase === 'focus') return true
      if (disk.phase === 'focus' && local.phase === 'break') return false
      if ((disk.rev ?? 0) < (local.rev ?? 0)) return false
    }
    return true
  }
  if (!local) return true
  let oldId: string | undefined
  try {
    oldId = oldValueJson ? (JSON.parse(oldValueJson) as { id?: string }).id : undefined
  } catch {
    oldId = undefined
  }
  return !oldId || oldId === local.id
}
/** 一定要把這幾個 id 立進墓碑：正常追加失敗（配額滿）就把墓碑縮成只剩這幾個（幾十 bytes）。
 *  呼叫前先把能刪的計時刪掉騰空間。連這樣都塞不進去＝這台裝置什麼都存不了，只能放棄。 */
const ensureEnded = (ids: string[]) => {
  if (ids.every(markEnded)) return
  try {
    localStorage.setItem(ENDED_KEY, JSON.stringify(ids))
  } catch {
    /* 連幾十 bytes 都塞不進去 */
  }
}
const markEnded = (id: string): boolean => {
  try {
    localStorage.setItem(ENDED_KEY, JSON.stringify([...endedIds(), id].slice(-20)))
    return true
  } catch {
    return false // 配額滿：呼叫端決定要不要用更小的形式再試
  }
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
export const claimTimerCompletion = async (
  timerId: string | undefined,
  opts: { unlessEnded?: boolean } = {}
): Promise<boolean> => {
  if (!timerId) return true // 舊的計時狀態沒有 id：照舊
  // 到點完成時：這段已經被別的分頁放棄／換掉（進了墓碑）就不准記。A 重新開始、T1 的墓碑立成
  // 功但 T2 存失敗，磁碟還是 T1，B 沒收到刪除事件繼續倒數，到點會替已放棄的段塗格（Codex 第 22 輪 #2）。
  // 放棄路徑不用這個：自己的 saveTimer(null) 會先立墓碑，再查就永遠認領不到。
  if (opts.unlessEnded && isTimerEnded(timerId)) return false
  // localStorage 的 get→set 跨分頁不是原子的：兩個分頁同時到點可以交錯成都通過。
  // Web Locks（Safari 15.4+／Chrome 69+）才是跨分頁的真鎖；沒有的環境退回同步版。
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (locks?.request) {
    try {
      // 鎖內再查一次墓碑：等鎖的這段時間別的分頁可能剛用另一把鎖（yike:timer）把我這段立了墓碑
      //（Codex 第 23 輪 #1）
      return await locks.request('yike:timer-done', () =>
        opts.unlessEnded && isTimerEnded(timerId) ? false : claimSync(timerId)
      )
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
  owner?: string | null,
  taskText = ''
): boolean => {
  const ok = editStoredKey<ReturnType<typeof loadDay>>(
    `pp:day:${dateKey}`,
    () => loadDay(dateKey),
    (v) => saveDay(dateKey, v),
    (prev) => {
      const tasks = prev.tasks.slice()
      const at = locate(tasks, taskId, taskIndex, taskText) // 還原備份洗掉 id 時靠文字找（Codex 第 14 輪 #2）
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
