import { useRef, useState } from 'react'
import { Task } from './types'

// 「正」五畫的線段座標（筆順：上橫、中豎、右橫、左豎、底橫）
const ZHENG_STROKES: [number, number, number, number][] = [
  [3, 4, 21, 4],
  [12, 4, 12, 20],
  [12.5, 12, 20, 12],
  [5.5, 9.5, 5.5, 20],
  [3, 20, 21, 20],
]

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

      {/* 正字記號：一刻一畫，五刻成正（取代 v1.2 的圈圈追蹤） */}
      <div className="focus-track">
        {task.done > 0 && (
          <button className="tally-minus" onClick={() => setDone(task.done - 1)} title="刻回一筆">
            −
          </button>
        )}
        <button
          className="zheng-btn"
          onClick={() => setDone(Math.min(5, task.done + 1))}
          title="刻一筆（一段 30 分鐘）"
        >
          <svg className="zheng" viewBox="0 0 24 24">
            {ZHENG_STROKES.map((p, i) => (
              <line
                key={i}
                x1={p[0]}
                y1={p[1]}
                x2={p[2]}
                y2={p[3]}
                className={
                  i < task.done ? 'zs-done' : task.target !== null && i < task.target ? 'zs-target' : 'zs-ghost'
                }
              />
            ))}
          </svg>
        </button>
        <button className="tally-chip" onClick={cycleTarget} title="點擊設定目標刻數（每刻 30 分鐘）">
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
