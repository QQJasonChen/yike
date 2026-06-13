// 通用甘特引擎：任意欄數（週=7天、月=31天、年=12月），拖拉畫起訖橫條
import { useRef, useState } from 'react'

export type GanttTone = 'ink' | 'gold' | 'sage'

/** 週任務層級 → 顏色：1–5 最重要、6–10 次要、11–15 額外 */
export const tierTone = (i: number): GanttTone => (i < 5 ? 'ink' : i < 10 ? 'gold' : 'sage')

export interface GanttRow {
  i: number
  text: string
  done: boolean
  span?: [number, number] | null
  /** 橫條顏色（任務層級）：ink=最重要、gold=次要、sage=額外 */
  tone?: GanttTone
}

interface Props {
  title: string
  hint: string
  emptyHint: string
  cols: { label: string; sub?: string; today?: boolean; active?: boolean }[]
  rows: GanttRow[]
  labelWidth?: number
  /** 顏色圖例（例：墨＝五大任務） */
  legend?: { tone: GanttTone; label: string }[]
  onSpan: (rowIndex: number, span: [number, number] | null) => void
}

export default function Gantt({ title, hint, emptyHint, cols, rows, labelWidth = 150, legend, onSpan }: Props) {
  const [drag, setDrag] = useState<{ row: number; a: number; b: number } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const n = cols.length
  // 標籤欄寬度走 CSS 變數（手機用 clamp 隨螢幕縮放），桌機 fallback 用 labelWidth
  const template = {
    gridTemplateColumns: `var(--g-label-w, ${labelWidth}px) repeat(${n}, 1fr)`,
  } as React.CSSProperties

  const colFromX = (clientX: number): number => {
    const grid = gridRef.current!
    const r = grid.getBoundingClientRect()
    // 量實際渲染後的標籤欄寬，CSS 縮放後拖拉命中才會準
    const labelEl = grid.querySelector('.g-label') as HTMLElement | null
    const lw = labelEl ? labelEl.offsetWidth : labelWidth
    const colW = (r.width - lw) / n
    return Math.max(0, Math.min(n - 1, Math.floor((clientX - r.left - lw) / colW)))
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

  // 欄位很多時（月＝30/31 欄）標成「密集」：手機只顯示每 5 天的刻度，桌機照常全顯
  const dense = cols.length > 14
  const isTick = (c: { today?: boolean }, d: number) =>
    d === 0 || (d + 1) % 5 === 0 || !!c.today

  return (
    <div className="gantt-wrap">
      <div className="label gantt-head">
        <span className="g-title">{title}</span>
        {legend && rows.length > 0 && (
          <span className="g-legend">
            {legend.map((l) => (
              <span key={l.tone}>
                <i className={`g-dot tone-${l.tone}`} />
                {l.label}
              </span>
            ))}
          </span>
        )}
        {(rows.length ? hint : emptyHint) && (
          <span className="hint">{rows.length ? hint : emptyHint}</span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="gantt g-empty">
          在任務的列上橫向一拖，畫出起訖 →　像這樣
          <span className="g-demo" />
        </div>
      ) : (
        <div className={`gantt ${dense ? 'dense' : ''}`} ref={gridRef} onPointerMove={move} onPointerUp={up}>
          <div className="g-row g-head" style={template}>
            <div className="g-label" />
            {cols.map((c, d) => (
              <div
                key={d}
                className={`g-day ${c.today ? 'today' : ''} ${c.active ? 'active' : ''} ${dense && isTick(c, d) ? 'tick' : ''}`}
              >
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
                  <div key={d} className={`g-cell ${c.today ? 'today' : ''} ${c.active ? 'active' : ''}`} />
                ))}
                {span && (
                  <div
                    className={`g-bar tone-${t.tone ?? 'ink'} ${t.done ? 'done' : ''} ${drag?.row === t.i ? 'dragging' : ''}`}
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
