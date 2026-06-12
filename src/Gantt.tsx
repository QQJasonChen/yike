// 通用甘特引擎：任意欄數（週=7天、月=31天、年=12月），拖拉畫起訖橫條
import { useRef, useState } from 'react'

export interface GanttRow {
  i: number
  text: string
  done: boolean
  span?: [number, number] | null
}

interface Props {
  title: string
  hint: string
  emptyHint: string
  cols: { label: string; sub?: string; today?: boolean }[]
  rows: GanttRow[]
  labelWidth?: number
  onSpan: (rowIndex: number, span: [number, number] | null) => void
}

export default function Gantt({ title, hint, emptyHint, cols, rows, labelWidth = 150, onSpan }: Props) {
  const [drag, setDrag] = useState<{ row: number; a: number; b: number } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const n = cols.length
  const template = { gridTemplateColumns: `${labelWidth}px repeat(${n}, 1fr)` }

  const colFromX = (clientX: number): number => {
    const r = gridRef.current!.getBoundingClientRect()
    const colW = (r.width - labelWidth) / n
    return Math.max(0, Math.min(n - 1, Math.floor((clientX - r.left - labelWidth) / colW)))
  }

  const down = (row: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch { /* 合成事件略過 */ }
    const d = colFromX(e.clientX)
    setDrag({ row, a: d, b: d })
  }

  const move = (e: React.PointerEvent) => {
    if (!drag) return
    const d = colFromX(e.clientX)
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
        {title} <span className="hint">{rows.length ? hint : emptyHint}</span>
      </div>
      {rows.length === 0 ? (
        <div className="gantt g-empty">
          在任務的列上橫向一拖，畫出起訖 →　像這樣
          <span className="g-demo" />
        </div>
      ) : (
        <div className="gantt" ref={gridRef} onPointerMove={move} onPointerUp={up}>
          <div className="g-row g-head" style={template}>
            <div className="g-label" />
            {cols.map((c, d) => (
              <div key={d} className={`g-day ${c.today ? 'today' : ''}`}>
                {c.label}
                {c.sub && <span>{c.sub}</span>}
              </div>
            ))}
          </div>
          {rows.map((t) => {
            const span: [number, number] | null | undefined =
              drag?.row === t.i ? [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)] : t.span
            return (
              <div key={t.i} className="g-row" style={template} onPointerDown={down(t.i)}>
                <div className={`g-label ${t.done ? 'done' : ''}`}>{t.text}</div>
                {cols.map((c, d) => (
                  <div key={d} className={`g-cell ${c.today ? 'today' : ''}`} />
                ))}
                {span && (
                  <div
                    className={`g-bar ${t.done ? 'done' : ''} ${drag?.row === t.i ? 'dragging' : ''}`}
                    style={{ gridColumn: `${span[0] + 2} / ${span[1] + 3}` }}
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
      )}
    </div>
  )
}
