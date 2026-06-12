import { useEffect, useRef, useState } from 'react'

export interface TimerState {
  taskIndex: number
  taskText: string
  phase: 'focus' | 'break'
  endsAt: number // epoch ms
  pausedRemaining: number | null // 暫停時剩餘 ms
  totalMs: number
  startedAt: number // 本段專注開始的 epoch ms（時間軸記錄用）
}

interface Props {
  timer: TimerState
  onUpdate: (t: TimerState | null) => void
  /** 一段專注完成：任務 index ＋ 真實起訖（ms），用來塗圈＋寫進時間軸 */
  onSessionDone: (taskIndex: number, startMs: number, endMs: number) => void
  breakMinutes: number
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

export default function FocusTimer({ timer, onUpdate, onSessionDone, breakMinutes }: Props) {
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

  useEffect(() => {
    if (remaining <= 0 && timer.pausedRemaining === null && !firedRef.current) {
      firedRef.current = true
      chime()
      if (timer.phase === 'focus') {
        onSessionDone(timer.taskIndex, timer.startedAt, Date.now())
        // 自動進入休息
        onUpdate({
          ...timer,
          phase: 'break',
          totalMs: breakMinutes * 60_000,
          endsAt: Date.now() + breakMinutes * 60_000,
          pausedRemaining: null,
        })
      } else {
        onUpdate(null)
      }
    }
  }, [remaining, timer, onUpdate, onSessionDone, breakMinutes])

  // 頁面標題倒數，切到別的分頁也看得到
  useEffect(() => {
    document.title = `${fmtClock(remaining)} ${timer.phase === 'focus' ? '專注中' : '休息'} — 一刻手帳`
    return () => {
      document.title = '一刻手帳 Yike'
    }
  }, [remaining, timer.phase])

  const paused = timer.pausedRemaining !== null
  const progress = Math.max(0, Math.min(1, 1 - remaining / timer.totalMs))
  const R = 23
  const C = 2 * Math.PI * R

  const togglePause = () =>
    onUpdate(
      paused
        ? { ...timer, endsAt: Date.now() + (timer.pausedRemaining ?? 0), pausedRemaining: null }
        : { ...timer, pausedRemaining: Math.max(0, timer.endsAt - Date.now()) }
    )

  const finishEarly = () => {
    chime()
    onSessionDone(timer.taskIndex, timer.startedAt, Date.now())
    onUpdate({
      ...timer,
      phase: 'break',
      totalMs: breakMinutes * 60_000,
      endsAt: Date.now() + breakMinutes * 60_000,
      pausedRemaining: null,
    })
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
          <button className="zen-stop" onClick={() => onUpdate(null)}>✕ 結束</button>
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
        <button title="全螢幕專注" onClick={(e) => { e.stopPropagation(); setZen(true) }}>
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
        <button className="stop" title="結束計時" onClick={(e) => { e.stopPropagation(); onUpdate(null) }}>
          ✕
        </button>
      </div>
    </div>
  )
}
