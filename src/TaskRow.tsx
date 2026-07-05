import { useRef, useState } from 'react'
import { NameField } from './fields'
import { clickDone, plantCells, syncGrove, treeTier } from './plantCells'
import { PLANT_GLYPHS, PLANT_TITLES, treeGlyph } from './plantGlyphs'
import { MAX_SEGS, Task } from './types'

interface Props {
  index: number
  task: Task
  onChange: (t: Task) => void
  onStartFocus: () => void
  isRunning: boolean
  /** Focus 塗格風格：種樹（Forest 式）／稿紙方格 */
  focusStyle: 'tree' | 'grid'
  /** 目前選定的專注時長（分）：手動點格種樹時記進 grove，決定樹種 */
  focusMinutes: number
  /** 過去日期：種樹模式下未發芽種子渲染成枯褐 */
  isPast: boolean
  /** 把任務拖到時間軸：放開時回報座標，由 App 轉交 Timeline */
  onDropToTimeline: (clientX: number, clientY: number) => void
  /** Enter 鍵按下：由 DayView 決定聚焦下一個輸入框 */
  onEnterKey?: () => void
}

export default function TaskRow({
  index,
  task,
  onChange,
  onStartFocus,
  isRunning,
  focusStyle,
  focusMinutes,
  isPast,
  onDropToTimeline,
  onEnterKey,
}: Props) {
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)
  const withered = task.withered ?? 0

  const setDone = (n: number) => {
    const done = Math.max(0, Math.min(MAX_SEGS, n))
    // grove 對齊 done：手動新種的樹用目前選定時長決定樹種
    onChange({ ...task, done, actual: done > 0 ? done : null, grove: syncGrove(task.grove, done, focusMinutes) })
  }

  /** 第 i 棵樹的圖示（依 grove 記的分鐘數選樹種；沒記到就當松樹） */
  const treeAt = (i: number) => treeGlyph(treeTier(task.grove?.[i] ?? 25))

  /** 種樹模式點格：枯樹格＝清除（改過自新），其他照 clickDone 語意 */
  const onPlantClick = (i: number) => {
    const next = clickDone(i, task.done, withered)
    if (next === null) onChange({ ...task, withered: Math.max(0, withered - 1) })
    else setDone(next)
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
        <NameField
          className="task-name"
          placeholder={index === 0 ? '今天就算只做成這一件，也值得了' : ''}
          value={task.text}
          onValue={(v) => onChange({ ...task, text: v })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnterKey?.() } }}
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

      {/* Focus 塗格：一格＝一段 30 分鐘。種樹模式＝種子→小樹（超標金花、放棄枯萎）；方格模式＝原稿紙格 */}
      <div className="focus-track sq-track">
        <div className="sq-row">
          {focusStyle === 'tree'
            ? plantCells({
                target: task.target,
                done: task.done,
                withered,
                growing: isRunning,
                isPast: isPast && task.text.trim() !== '', // 沒寫過的任務不算「殘留」
              }).map((kind, i) => (
                <button
                  key={i}
                  className={`plant-cell ${kind}`}
                  title={PLANT_TITLES[kind]}
                  onClick={() => onPlantClick(i)}
                >
                  {kind === 'sprout' && <span className="plant-drop" />}
                  {kind === 'gold' && <span className="plant-star">★</span>}
                  {kind === 'tree' || kind === 'gold' ? treeAt(i) : PLANT_GLYPHS[kind]}
                </button>
              ))
            : (() => {
                const planned = task.target ?? 0
                const count = Math.max(planned, task.done + withered, 1)
                return Array.from({ length: count }, (_, i) => {
                  const isWither = i >= task.done && i < task.done + withered
                  return (
                    <button
                      key={i}
                      className={`sq ${
                        isWither ? 'wither' : i < task.done ? (planned > 0 && i >= planned ? 'gold' : 'fill') : ''
                      }`}
                      title={isWither ? PLANT_TITLES.withered : `第 ${i + 1} 段（30 分鐘）`}
                      onClick={() => onPlantClick(i)}
                    />
                  )
                })
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
              onChange({ ...task, target: Math.min(MAX_SEGS, cur + 1) })
            }}
          >
            ＋
          </button>
        </span>
      </div>

      <button
        className={`task-play ${isRunning ? 'running' : ''}`}
        onClick={onStartFocus}
        title={task.text.trim() ? '開始番茄鐘專注' : '先寫下這格任務，才能開始番茄鐘'}
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
