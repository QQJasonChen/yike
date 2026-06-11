import { useEffect, useRef, useState } from 'react'

export interface TimerState {
  taskIndex: number
  taskText: string
  phase: 'focus' | 'break'
  endsAt: number // epoch ms
  pausedRemaining: number | null // 暫停時剩餘 ms
  totalMs: number
}

interface Props {
  timer: TimerState
  onUpdate: (t: TimerState | null) => void
  onSessionDone: (taskIndex: number) => void
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
        onSessionDone(timer.taskIndex)
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
    document.title = `${fmtClock(remaining)} ${timer.phase === 'focus' ? '專注中' : '休息'} — 生產力手帳`
    return () => {
      document.title = '每日生產力手帳'
    }
  }, [remaining, timer.phase])

  const paused = timer.pausedRemaining !== null
  const progress = Math.max(0, Math.min(1, 1 - remaining / timer.totalMs))
  const R = 23
  const C = 2 * Math.PI * R

  return (
    <div className="timer-bar">
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
        <button
          title={paused ? '繼續' : '暫停'}
          onClick={() =>
            onUpdate(
              paused
                ? { ...timer, endsAt: Date.now() + (timer.pausedRemaining ?? 0), pausedRemaining: null }
                : { ...timer, pausedRemaining: Math.max(0, timer.endsAt - Date.now()) }
            )
          }
        >
          {paused ? '▶' : '⏸'}
        </button>
        {timer.phase === 'focus' && (
          <button
            title="提前完成這個時段"
            onClick={() => {
              chime()
              onSessionDone(timer.taskIndex)
              onUpdate({
                ...timer,
                phase: 'break',
                totalMs: breakMinutes * 60_000,
                endsAt: Date.now() + breakMinutes * 60_000,
                pausedRemaining: null,
              })
            }}
          >
            ✓
          </button>
        )}
        <button className="stop" title="結束計時" onClick={() => onUpdate(null)}>
          ✕
        </button>
      </div>
    </div>
  )
}
