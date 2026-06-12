// 本週甘特圖：週計畫任務 × 七天橫軸，拖拉畫出起訖橫條（輕量專案管理）
import { useRef, useState } from 'react'
import { addDays, toDateKey } from './storage'
import { WeekEntry } from './types'

const WD = ['一', '二', '三', '四', '五', '六', '日']

interface Props {
  mondayKey: string
  week: WeekEntry
  onSpan: (taskIndex: number, span: [number, number] | null) => void
}

export default function GanttWeek({ mondayKey, week, onSpan }: Props) {
  const [drag, setDrag] = useState<{ row: number; a: number; b: number } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const todayKey = toDateKey(new Date())
  const todayCol = Array.from({ length: 7 }, (_, i) => addDays(mondayKey, i)).indexOf(todayKey)

  const rows = week.tasks
    .map((t, i) => ({ ...t, i }))
    .filter((t) => t.text.trim())
    .slice(0, 10)

  if (rows.length === 0) return null

  const dayFromX = (clientX: number): number => {
    const el = gridRef.current!
    const r = el.getBoundingClientRect()
    const label = 150
    const colW = (r.width - label) / 7
    return Math.max(0, Math.min(6, Math.floor((clientX - r.left - label) / colW)))
  }

  const down = (row: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch { /* 合成事件略過 */ }
    const d = dayFromX(e.clientX)
    setDrag({ row, a: d, b: d })
  }

  const move = (e: React.PointerEvent) => {
    if (!drag) return
    const d = dayFromX(e.clientX)
    setDrag((cur) => (cur ? { ...cur, b: d } : cur))
  }

  const up = () => {
    if (!drag) return
    onSpan(drag.row, [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)])
    setDrag(null)
  }

  return (
    <div className="gantt-wrap">
      <div className="label">
        本週甘特 <span className="hint">在任務的列上拖出起訖・雙擊橫條清除</span>
      </div>
      <div className="gantt" ref={gridRef} onPointerMove={move} onPointerUp={up}>
        <div className="g-row g-head">
          <div className="g-label" />
          {WD.map((w, d) => {
            const k = addDays(mondayKey, d)
            return (
              <div key={d} className={`g-day ${d === todayCol ? 'today' : ''}`}>
                {w}
                <span>{Number(k.slice(8, 10))}</span>
              </div>
            )
          })}
        </div>
        {rows.map((t) => {
          const span: [number, number] | null | undefined =
            drag?.row === t.i ? [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)] : t.span
          return (
            <div key={t.i} className="g-row" onPointerDown={down(t.i)}>
              <div className={`g-label ${t.done ? 'done' : ''}`}>{t.text}</div>
              {Array.from({ length: 7 }, (_, d) => (
                <div key={d} className={`g-cell ${d === todayCol ? 'today' : ''}`} />
              ))}
              {span && (
                <div
                  className={`g-bar ${t.done ? 'done' : ''} ${drag?.row === t.i ? 'dragging' : ''}`}
                  style={{
                    gridColumn: `${span[0] + 2} / ${span[1] + 3}`,
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    onSpan(t.i, null)
                  }}
                  title={`${t.text}（雙擊清除）`}
                >
                  {t.text}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
