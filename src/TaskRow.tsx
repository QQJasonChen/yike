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

  const setDone = (n: number) => {
    const done = Math.max(0, Math.min(8, n))
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
          list="yike-names"
          placeholder={index === 0 ? '今天就算只做成這一件，也值得了' : ''}
          value={task.text}
          onChange={(e) => onChange({ ...task, text: e.target.value })}
        />
      </div>

      <span
        className="drag-handle"
        title="點一下＝排進下一個空檔；拖到時間軸＝排在指定時間"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
      >
        ⠿
      </span>

      {/* 稿紙方格：一格＝一段 30 分鐘。塗滿＝完成，金格＝超標，＋−直接調整預期 */}
      <div className="focus-track sq-track">
        <div className="sq-row">
          {(() => {
            const planned = task.target ?? 0
            const count = Math.max(planned, task.done, 1)
            return Array.from({ length: count }, (_, i) => (
              <button
                key={i}
                className={`sq ${i < task.done ? (planned > 0 && i >= planned ? 'gold' : 'fill') : ''}`}
                title={`第 ${i + 1} 段（30 分鐘）`}
                onClick={() => setDone(task.done === i + 1 ? i : i + 1)}
              />
            ))
          })()}
        </div>
        <span className="sq-adj">
          <button
            title="少排一段"
            onClick={() => {
              const cur = task.target ?? Math.max(task.done, 1)
              onChange({ ...task, target: cur > 1 ? cur - 1 : null })
            }}
          >
            −
          </button>
          <button
            title="多排一段"
            onClick={() => {
              const cur = task.target ?? Math.max(task.done, 1)
              onChange({ ...task, target: Math.min(8, cur + 1) })
            }}
          >
            ＋
          </button>
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
