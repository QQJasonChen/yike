import { useRef, useState } from 'react'
import { Task } from './types'

// 分段進度環：目標數把圓拆成等份，完成的段填墨色
const polar = (deg: number, r = 10.5): [number, number] => {
  const rad = ((deg - 90) * Math.PI) / 180
  return [14 + r * Math.cos(rad), 14 + r * Math.sin(rad)]
}

const segPath = (i: number, n: number): string => {
  const span = 360 / n
  const gap = n > 1 ? Math.min(14, span * 0.18) : 0.01
  const a0 = i * span + gap / 2
  const a1 = (i + 1) * span - gap / 2
  const [x0, y0] = polar(a0)
  const [x1, y1] = polar(a1)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A 10.5 10.5 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

interface Props {
  index: number
  task: Task
  onChange: (t: Task) => void
  onStartFocus: () => void
  isRunning: boolean
  /** 把任務拖到時間軸：放開時回報座標，由 App 轉交 Timeline */
  onDropToTimeline: (clientX: number, clientY: number) => void
}

export default function TaskRow({
  index,
  task,
  onChange,
  onStartFocus,
  isRunning,
  onDropToTimeline,
}: Props) {
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)

  const cycleTarget = () => {
    const next = task.target === null ? 1 : task.target >= 5 ? null : task.target + 1
    onChange({ ...task, target: next })
  }

  const setDone = (n: number) => {
    const done = Math.max(0, Math.min(5, n))
    onChange({ ...task, done, actual: done > 0 ? done : null })
  }

  const toggleDone = () => {
    onChange({
      ...task,
      completed: !task.completed,
      actual: !task.completed && task.done > 0 ? task.done : task.actual,
    })
  }

  // ---- 拖到時間軸（pointer 事件，桌機手機通用） ----
  const onHandleDown = (e: React.PointerEvent) => {
    if (!task.text.trim()) return
    e.preventDefault()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件或不支援時略過 */
    }
    dragging.current = true
    setGhost({ x: e.clientX, y: e.clientY })
  }
  const onHandleMove = (e: React.PointerEvent) => {
    if (dragging.current) setGhost({ x: e.clientX, y: e.clientY })
  }
  const onHandleUp = (e: React.PointerEvent) => {
    if (!dragging.current) return
    dragging.current = false
    setGhost(null)
    onDropToTimeline(e.clientX, e.clientY)
  }

  return (
    <div className={`task-row ${task.completed ? 'done-task' : ''}`}>
      <span className="task-num">{index + 1}.</span>
      <div className="task-text line-input" style={{ borderBottom: 'none' }}>
        <input
          placeholder={index === 0 ? '今天就算只做成這一件，也值得了' : ''}
          value={task.text}
          onChange={(e) => onChange({ ...task, text: e.target.value })}
        />
      </div>

      <span
        className="drag-handle"
        title="拖到時間軸排程"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
      >
        ⠿
      </span>

      {/* 分段進度環：目標 N → 圓分 N 等份，完成幾段填幾段 */}
      <div className="focus-track">
        {task.done > 0 && (
          <button className="tally-minus" onClick={() => setDone(task.done - 1)} title="退回一段">
            −
          </button>
        )}
        <button
          className="pie-btn"
          onClick={() => setDone(Math.min(5, task.done + 1))}
          title="完成一段（30 分鐘）"
        >
          <svg className="pie" viewBox="0 0 28 28">
            {(() => {
              const segs = task.target ?? 5
              const filled = Math.min(task.done, segs)
              return Array.from({ length: segs }, (_, i) => (
                <path key={i} d={segPath(i, segs)} className={i < filled ? 'pg-done' : 'pg-rest'} />
              ))
            })()}
            {task.target !== null && task.done >= task.target && <circle cx="14" cy="14" r="3.6" className="pg-dot" />}
          </svg>
        </button>
        <button className="tally-chip" onClick={cycleTarget} title="點擊設定目標段數（每段 30 分鐘）">
          {task.done}<span>/</span>{task.target ?? '–'}
        </button>
      </div>

      <button
        className={`task-play ${isRunning ? 'running' : ''}`}
        onClick={onStartFocus}
        title="開始 Focus Time"
        disabled={!task.text.trim()}
      >
        {isRunning ? '◉' : '▶'}
      </button>

      <button className={`task-check ${task.completed ? 'on' : ''}`} onClick={toggleDone} title="完成任務">
        ✓
      </button>

      {ghost && (
        <div className="task-ghost" style={{ left: ghost.x, top: ghost.y }}>
          {task.text}
        </div>
      )}
    </div>
  )
}
