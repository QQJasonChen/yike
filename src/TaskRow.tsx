import { useRef, useState } from 'react'
import { Task } from './types'

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
    const next = task.target === null ? 1 : task.target >= 6 ? null : task.target + 1
    onChange({ ...task, target: next })
  }

  const tapCircle = (i: number) => {
    // 點第 i 顆：若它已是最後一顆填滿的 → 退回；否則填到 i+1
    const next = task.done === i + 1 ? i : i + 1
    onChange({ ...task, done: next, actual: next > 0 ? next : null })
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

      <div className="focus-track">
        <button className={`ft-box ${task.target === null ? 'empty' : ''}`} onClick={cycleTarget} title="預估格數（每格 30 分鐘）">
          {task.target ?? '▢'}
        </button>
        <div className="ft-circles">
          {Array.from({ length: 5 }, (_, i) => (
            <button
              key={i}
              className={`ft-circle ${i < task.done ? 'filled' : ''} ${i >= 5 ? 'overflow-dot' : ''}`}
              onClick={() => tapCircle(i)}
              title={`第 ${i + 1} 個 30 分鐘`}
            />
          ))}
        </div>
        <span className="ft-box actual" title="實際格數">
          {task.actual ?? ''}
        </span>
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
