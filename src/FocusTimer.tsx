import { isTimerAbandoned, isTimerCompleted, loadTimer, newTimerId, resolveTaskId, supersededOnDisk } from './focusSession'
import { useCallback, useEffect, useRef, useState } from 'react'
import { focusLock } from './focusLock'
import { closeFloating, openFloating, pipSupported, setPipAuto } from './pip'

// Document Picture-in-Picture（Chrome/Edge 桌面）：開一個永遠置頂的小浮窗
interface DocumentPiP {
  requestWindow(opts?: { width?: number; height?: number }): Promise<Window>
  window: Window | null
}
declare global {
  interface Window {
    documentPictureInPicture?: DocumentPiP
  }
}

export interface TimerState {
  /** 這一段計時的身分：跨分頁去重用（兩個分頁各自到點各自記 → 記兩次） */
  id?: string
  /** 版本：本地每次操作 +1；同一段的落盤只准較新的贏（見 focusSession.saveTimer） */
  rev?: number
  /** 這段專注屬於哪一天。少了它，完成時只能猜「今天」——跨午夜、或計時中翻到別的日期，
   *  格數與時間塊就會記到錯的那一天。 */
  dateKey?: string
  taskIndex: number
  /** 這段專注屬於哪一件事。index 是畫面位置、text 在同名時分不出來，只有 id 認得出。 */
  taskId?: string
  /** 按下開始時的資料主人；完成時不一樣就不寫（另一個分頁換了帳號）。 */
  owner?: string | null
  taskText: string
  phase: 'focus' | 'break'
  endsAt: number // epoch ms
  pausedRemaining: number | null // 暫停時剩餘 ms
  totalMs: number
  startedAt: number // 本段專注開始的 epoch ms（時間軸記錄用）
}

/** false＝沒認領到（別的分頁記過了）；'retry'＝認領存不進去（配額滿），保留狀態稍後重試；
 *  { taskId }＝記到了這一列（匯入備份後 id 可能換了，下一段改帶它）；void／true＝記了。 */
export type DoneResult = void | boolean | 'retry' | { taskId?: string }
/** 認領存不進去後多久再自動試一次（使用者清空間後不必手動按） */
export const CLAIM_RETRY_MS = 10_000
interface Props {
  timer: TimerState
  onUpdate: (t: TimerState | null) => void
  /** 一段專注完成：任務 index ＋ 真實起訖（ms），用來塗圈＋寫進時間軸 */
  /** 回傳 false＝這段沒認領到（別的分頁已經完成或放棄了它）：不准推進休息，改採磁碟上的狀態。
   *  回傳 void／true＝照常進休息。 */
  onSessionDone: (taskIndex: number, startMs: number, endMs: number) => DoneResult | Promise<DoneResult>
  /** 計時中按 ✕ 放棄（focus 階段才算）：種樹主題記一棵枯樹 */
  /** 回傳 false＝這段沒認領到（別的分頁已經完成了它）：不准清掉，改採磁碟上的狀態。 */
  onAbandon: (taskIndex: number) => void | boolean | 'retry' | Promise<boolean | void | 'retry'>
  /** 種樹主題開著（放棄 confirm 的文案用） */
  treeStyle: boolean
  breakMinutes: number
  focusMinutes: number
  /** 連續番茄鐘：休息結束自動接下一段（使用者可在設定開關） */
  autoLoop: boolean
  /** 新的一段開始前讓 App 重新定位日期與任務（跨午夜時 dateKey/taskId 不能沿用昨天） */
  renewSegment?: (t: TimerState) => TimerState
  /** 認領失敗改採磁碟狀態時用這個，不走 onUpdate：onUpdate 會當成本地操作加版本，把別的分頁
   *  更新的暫停用同版本蓋回去（Codex 第 27 輪 #3）。沒給就退回 onUpdate。 */
  onAdoptDisk?: (t: TimerState | null) => void
  /** 專注時鎖住分心 App（僅原生 iOS 生效，其餘平台 no-op） */
  lockApps: boolean
}

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// 簡短完成鐘聲（Web Audio，免音檔）
const chime = () => {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    ;[523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.18)
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 1.1)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.18)
      osc.stop(ctx.currentTime + i * 0.18 + 1.2)
    })
  } catch {
    /* 無聲環境忽略 */
  }
  navigator.vibrate?.([200, 80, 200])
}

export default function FocusTimer({ timer, onUpdate, onSessionDone, onAbandon, treeStyle, breakMinutes, focusMinutes, autoLoop, lockApps , renewSegment, onAdoptDisk}: Props) {
  // 等認領（非同步）的這段時間畫面上的段可能已經換了（storage 事件採用了別的分頁的新段）：
  // 回呼回來要核對還是不是當初那段，不然舊放棄會把新段清掉（Codex 第 27 輪 #1）
  const latest = useRef(timer)
  latest.current = timer
  // 認領進行中的那段：第一次認領還沒回來又按「提前完成」（或手動完成跟到點回呼重疊），第二次認領
  // 失敗的回呼會把磁碟上還是 focus 的狀態採回來、跟第一次排入的 break 合併提交，break 從沒落盤，
  // 這段已認領卻永遠停在專注（Codex 第 32 輪）。同一段只准一次 in-flight。
  const inflight = useRef<string | null | undefined>(null)
  const adoptDisk = () => {
    const d = loadTimer() as TimerState | null
    const cur = latest.current
    // 階段不准往回：磁碟還停在 focus、畫面已排入 break（同一段）就不採用
    if (d && cur && d.id === cur.id && d.phase === 'focus' && cur.phase === 'break') return
    // 同一段、磁碟還是 focus、但已被認領完成（對方提前完成後在休息落盤前關掉）：採回 focus 會卡死
    //（完成／放棄都認領不到、重新開始被 done 守衛擋）。格已經記了，這裡替它推進休息（Codex 第 37 輪 #1）
    if (d && cur && d.id === cur.id && d.phase === 'focus' && isTimerCompleted(d.id)) {
      // 下一段要帶「現在」對應的列 id（匯入備份可能把 x 換成 y），跟成功路徑的 resolvedTaskId 同一回事（第 38 輪 #2）
      onUpdate(toBreak(cur, resolveTaskId(cur)))
      return
    }
    // 同段 focus、但已被認領為放棄（對方放棄後在清除落盤前關掉）：自己清掉，不然結束不了（第 38 輪 #1）
    if (d && cur && d.id === cur.id && d.phase === 'focus' && isTimerAbandoned(d.id)) {
      onUpdate(null)
      return
    }
    ;(onAdoptDisk ?? onUpdate)(d)
  }
  const toBreak = (cur: TimerState, taskId: string | undefined): TimerState => ({
    ...cur,
    taskId,
    phase: 'break',
    totalMs: breakMinutes * 60_000,
    endsAt: Date.now() + breakMinutes * 60_000,
    pausedRemaining: null,
  })
  const [, force] = useState(0)
  const [zen, setZen] = useState(false) // 預設底部小列；點列或 ⤢ 展開全螢幕
  const firedRef = useRef(false)

  const remaining =
    timer.pausedRemaining !== null ? timer.pausedRemaining : timer.endsAt - Date.now()

  useEffect(() => {
    firedRef.current = false
  }, [timer.endsAt, timer.phase])

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [])

  /** 完成這段：先認領（App 那邊跨分頁去重），認領到才進休息。認領失敗＝別的分頁已經完成或放棄了它，
   *  不能無條件寫入休息——A 放棄成功記了枯樹，B 的休息寫入會把 A 的清除擋掉、畫面採回休息，
   *  autoLoop 還會自己開下一段（Codex 第 25 輪 #1）。失敗就改採磁碟上的狀態。 */
  const complete = (endMs: number) => {
    const me = timer
    if (inflight.current === me.id) return
    inflight.current = me.id
    void Promise.resolve(onSessionDone(me.taskIndex, me.startedAt, endMs)).then((ok) => {
      if (inflight.current === me.id) inflight.current = null
      const cur = latest.current
      if (cur.id !== me.id) return // 等認領時這段已經換成別段：那段有自己的流程
      if (ok === 'retry') {
        // 認領存不進去：不進休息、不採磁碟（採回同段 firedRef 不會重設，會無聲停在 00:00）。
        // 過一會兒重設 firedRef 讓到點 effect 再跑一次，仍用原本的 endsAt 記錄（Codex 第 44 輪）
        window.setTimeout(() => {
          if (latest.current?.id !== me.id) return
          firedRef.current = false
          force((n) => n + 1)
        }, CLAIM_RETRY_MS)
        return
      }
      if (ok === false) {
        adoptDisk()
        return
      }
      // 從「現在」的狀態推進休息，不是認領前捕獲的那份：別的分頁可能暫停／恢復過（rev 更高），
      // 用舊快照寫會被版本守衛擋下、採回 focus，而這段已認領完成，永遠進不了休息（Codex 第 27 輪 #2）
      const resolvedTaskId = ok && typeof ok === 'object' && ok.taskId ? ok.taskId : cur.taskId
      onUpdate(toBreak(cur, resolvedTaskId))
    })
  }
  useEffect(() => {
    if (remaining <= 0 && timer.pausedRemaining === null && !firedRef.current) {
      firedRef.current = true
      chime()
      if (timer.phase === 'focus') {
        // 用 endsAt 不用 Date.now()：App 在 iOS 被睡著、隔一小時才回前景，
        // 25 分鐘會被記成 84 分鐘
        complete(timer.endsAt)
      } else if (autoLoop) {
        // 連續番茄鐘：休息結束自動接下一段專注（保留懸浮窗，省去回網頁按開始）
        const next: TimerState = {
          ...timer,
          id: newTimerId(), // 新的一段＝新的完成識別，否則第二段被當成「已記過」整段漏記
          phase: 'focus',
          totalMs: focusMinutes * 60_000,
          endsAt: Date.now() + focusMinutes * 60_000,
          pausedRemaining: null,
          startedAt: Date.now(),
        }
        onUpdate(renewSegment ? renewSegment(next) : next)
      } else {
        onUpdate(null)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- complete 每次 render 都是新函式；它用到的值都已列在這裡
  }, [remaining, timer, onUpdate, onSessionDone, breakMinutes, focusMinutes, autoLoop, renewSegment])

  // 頁面標題倒數，切到別的分頁也看得到
  useEffect(() => {
    document.title = `${fmtClock(remaining)} ${timer.phase === 'focus' ? '專注中' : '休息'} — 一刻手帳`
    return () => {
      document.title = '一刻手帳 Yike'
    }
  }, [remaining, timer.phase])

  // ---- 專注鎖：focus 階段鎖住分心 App，休息/結束自動解（僅原生 iOS 生效）----
  useEffect(() => {
    if (lockApps && timer.phase === 'focus') focusLock.start()
    else focusLock.stop()
  }, [lockApps, timer.phase])
  // 計時元件卸載（結束計時）一定解盾，避免殘留
  useEffect(() => () => { focusLock.stop() }, [])

  // ---- 置頂浮窗（Document Picture-in-Picture）----
  // 開窗：記住「要自動跳」偏好（手動關窗會在 pip.ts 內記成關閉）
  const summonFloating = () => {
    setPipAuto(true)
    openFloating()
  }
  // 計時結束 / 元件卸載時關閉浮窗
  useEffect(() => () => closeFloating(), [])

  const paused = timer.pausedRemaining !== null
  const progress = Math.max(0, Math.min(1, 1 - remaining / timer.totalMs))
  const R = 23
  const C = 2 * Math.PI * R

  const togglePause = useCallback(() =>
    onUpdate(
      paused
        ? { ...timer, endsAt: Date.now() + (timer.pausedRemaining ?? 0), pausedRemaining: null }
        : { ...timer, pausedRemaining: Math.max(0, timer.endsAt - Date.now()) }
    ), [paused, timer, onUpdate])

  // 空白鍵暫停/繼續（不在輸入框/文字區時）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault()
        togglePause()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [togglePause])

  const finishEarly = () => {
    chime()
    complete(Date.now())
  }

  // ✕ 結束：focus 階段＝放棄（種樹主題會枯一棵，先 confirm）；休息階段＝正常收工不記
  // 最新的 timer prop：confirm 框開著的期間，另一個分頁可能已經把這段完成、甚至開了新的一段。
  // 閉包裡的 timer 是舊的——確認後要重新核對是不是同一段，不然會把別人的新計時清掉
  //（Codex 第 5 輪 #2）。
  const stopTimer = () => {
    const target = timer
    if (target.phase === 'focus') {
      const msg = treeStyle
        ? '確定要放棄嗎？這段專注的小樹會枯掉。'
        : '確定要放棄這段專注嗎？會記下一次放棄。'
      if (!confirm(msg)) return
      // 原生 confirm 阻塞期間這個分頁的 storage 事件還沒處理，連 React prop 都是舊的——
      // 要讀磁碟上的 ppl:timer 當真相（Codex 第 6 輪 #1）。但磁碟上沒有／比較舊不算被取代，
      // 否則配額滿時開始的專注再也放棄不了（第 7 輪 #1）
      if (supersededOnDisk(target)) return // 這段已經不是當初要放棄的那段
      // 放棄也要等認領結果：A 提前完成、認領成功但休息還沒落盤，B 這時確認放棄——磁碟還是 focus，
      // supersededOnDisk 放行，但認領會失敗；無條件清掉會把 A 已完成的段刪了、休息倒數中斷
      //（Codex 第 26 輪）。認領失敗就改採磁碟上的狀態。
      if (inflight.current === target.id) return // 這段的完成／放棄認領還在路上
      inflight.current = target.id
      void Promise.resolve(onAbandon(target.taskIndex)).then((ok) => {
        if (inflight.current === target.id) inflight.current = null
        if (latest.current?.id !== target.id) return // 等認領時已經換成別段（B 重新開始了 T2）：別清
        if (ok === 'retry') return // 認領存不進去：計時留著，使用者清空間後再按一次（第 44 輪）
        if (ok === false) adoptDisk()
        else onUpdate(null)
      })
      return
    }
    onUpdate(null)
  }

  // 墨圈（與 app icon 同一筆）：弧長隨倒數慢慢畫滿
  const ZR = 150
  const ZC = 2 * Math.PI * ZR
  const arcMax = ZC * 0.86 // 留一個開口，畫滿 = 一段完成

  if (zen) {
    return (
      <div className={`zen ${timer.phase === 'break' ? 'zen-break' : ''}`}>
        <button className="zen-collapse" onClick={() => setZen(false)} title="收合，邊用邊計時">
          ⌄
        </button>

        <div className="zen-stage">
          <svg className="zen-enso" viewBox="0 0 400 400">
            <g transform="rotate(-100 200 200)">
              <circle cx="200" cy="200" r={ZR} fill="none" stroke="rgba(43,38,32,.1)"
                strokeWidth="40" strokeLinecap="round" strokeDasharray={`${arcMax} ${ZC}`} />
              <circle className="zen-enso-fg" cx="200" cy="200" r={ZR} fill="none"
                strokeWidth="40" strokeLinecap="round"
                strokeDasharray={`${arcMax} ${ZC}`}
                strokeDashoffset={arcMax * (1 - progress)} />
            </g>
            {progress >= 0.999 && <circle cx="200" cy="200" r="26" fill="#b8923e" className="zen-dot" />}
          </svg>
          <div className="zen-center">
            <div className="zen-clock">{fmtClock(remaining)}</div>
            <div className="zen-phase">
              {timer.phase === 'focus' ? (paused ? '已暫停' : '專注中') : '休息一下'}
            </div>
          </div>
        </div>

        {timer.phase === 'focus' && <div className="zen-task">{timer.taskText || '未命名任務'}</div>}
        {timer.phase === 'break' && <div className="zen-task">起來走走、喝口水——下一段更好。</div>}

        <div className="zen-actions">
          <button onClick={togglePause}>{paused ? '▶ 繼續' : '⏸ 暫停'}</button>
          {timer.phase === 'focus' && <button onClick={finishEarly}>✓ 提前完成</button>}
          {pipSupported() && (
            <button onClick={summonFloating} title="浮出置頂小窗，去別的分頁也看得到倒數">
              ⧉ 浮窗
            </button>
          )}
          <button className="zen-stop" onClick={stopTimer}>✕ 結束</button>
        </div>
      </div>
    )
  }

  return (
    <div className="timer-bar" onClick={() => setZen(true)} title="點擊展開全螢幕專注">
      <svg className={`timer-ring ${timer.phase === 'break' ? 'break-mode' : ''}`} viewBox="0 0 54 54">
        <circle className="ring-bg" cx="27" cy="27" r={R} />
        <circle
          className="ring-fg"
          cx="27"
          cy="27"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - progress)}
        />
      </svg>
      <div>
        <span className="timer-phase">
          {timer.phase === 'focus' ? 'FOCUS TIME' : '休息一下'}
          {paused ? '・已暫停' : ''}
        </span>
        <div className={`timer-clock ${timer.phase === 'break' ? 'break-mode' : ''}`}>
          {fmtClock(remaining)}
        </div>
      </div>
      {timer.phase === 'focus' && <div className="timer-task">{timer.taskText || '未命名任務'}</div>}
      <div className="timer-actions">
        {pipSupported() && (
          <button
            className="pip-action"
            title="浮出置頂小窗，去別的分頁也看得到倒數"
            onClick={(e) => { e.stopPropagation(); summonFloating() }}
          >
            ⧉
          </button>
        )}
        <button className="expand-action" title="全螢幕專注" onClick={(e) => { e.stopPropagation(); setZen(true) }}>
          ⤢
        </button>
        <button title={paused ? '繼續' : '暫停'} onClick={(e) => { e.stopPropagation(); togglePause() }}>
          {paused ? '▶' : '⏸'}
        </button>
        {timer.phase === 'focus' && (
          <button title="提前完成這個時段" onClick={(e) => { e.stopPropagation(); finishEarly() }}>
            ✓
          </button>
        )}
        <button className="stop" title="結束計時" onClick={(e) => { e.stopPropagation(); stopTimer() }}>
          ✕
        </button>
      </div>
    </div>
  )
}
