// 通用甘特引擎：任意欄數（週=7天、月=31天、年=12月）。
// 選取模型 = 格子集合 cells[]，支援不連續（1,3,5）與多段；連續格子自動併成一條橫條。
import { useRef, useState } from 'react'
import type { GanttTone } from './ganttTone'

export interface GanttRow {
  i: number
  text: string
  done: boolean
  cells?: number[] // 選取的欄 index（可不連續）
  tone?: GanttTone
}

interface Props {
  title: string
  hint: string
  emptyHint: string
  cols: { label: string; sub?: string; today?: boolean; active?: boolean }[]
  rows: GanttRow[]
  labelWidth?: number
  legend?: { tone: GanttTone; label: string }[]
  onCells: (rowIndex: number, cells: number[]) => void
}

/** 舊資料 span=[起,迄] → cells（向後相容用） */
export const spanToCells = (span?: [number, number] | null): number[] =>
  span ? Array.from({ length: span[1] - span[0] + 1 }, (_, k) => span[0] + k) : []

/** 連續格子併成 [起,迄] 段 */
const toRuns = (cells: number[]): [number, number][] => {
  const s = [...new Set(cells)].sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const c of s) {
    const last = runs[runs.length - 1]
    if (last && c === last[1] + 1) last[1] = c
    else runs.push([c, c])
  }
  return runs
}

export default function Gantt({ title, hint, emptyHint, cols, rows, labelWidth = 150, legend, onCells }: Props) {
  const [drag, setDrag] = useState<{ row: number; a: number; b: number; moved: boolean } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const n = cols.length
  const template = {
    gridTemplateColumns: `var(--g-label-w, ${labelWidth}px) repeat(${n}, 1fr)`,
  } as React.CSSProperties

  const colFromX = (clientX: number): number => {
    const grid = gridRef.current!
    const r = grid.getBoundingClientRect()
    const labelEl = grid.querySelector('.g-label') as HTMLElement | null
    const lw = labelEl ? labelEl.offsetWidth : labelWidth
    const colW = (r.width - lw) / n
    return Math.max(0, Math.min(n - 1, Math.floor((clientX - r.left - lw) / colW)))
  }

  const down = (row: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件略過 */
    }
    const d = colFromX(e.clientX)
    setDrag({ row, a: d, b: d, moved: false })
  }

  const move = (e: React.PointerEvent) => {
    if (!drag) return
    const d = colFromX(e.clientX)
    setDrag((cur) => (cur ? { ...cur, b: d, moved: cur.moved || d !== cur.a } : cur))
  }

  const up = () => {
    if (!drag) return
    const row = rows.find((r) => r.i === drag.row)
    const cur = new Set(row?.cells ?? [])
    const lo = Math.min(drag.a, drag.b)
    const hi = Math.max(drag.a, drag.b)
    if (lo === hi) {
      // 單格點一下 → toggle（這天加入或移除）
      if (cur.has(lo)) cur.delete(lo)
      else cur.add(lo)
    } else {
      // 拖一段 → 把這段全部加入
      for (let c = lo; c <= hi; c++) cur.add(c)
    }
    onCells(drag.row, [...cur].sort((a, b) => a - b))
    setDrag(null)
  }

  const dense = cols.length > 14
  const isTick = (c: { today?: boolean }, d: number) => d === 0 || (d + 1) % 5 === 0 || !!c.today

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
          點格子選／取消・拖一段一次選多天 →　像這樣
          <span className="g-demo" />
        </div>
      ) : (
        <div
          className={`gantt ${dense ? 'dense' : ''}`}
          ref={gridRef}
          onPointerMove={move}
          onPointerUp={up}
        >
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
            const cells = t.cells ?? []
            const runs = toRuns(cells)
            const dragOnThis = drag?.row === t.i && drag.moved
            const dLo = drag ? Math.min(drag.a, drag.b) : 0
            const dHi = drag ? Math.max(drag.a, drag.b) : 0
            return (
              <div key={t.i} className="g-row" style={template} onPointerDown={down(t.i)}>
                <div className={`g-label ${t.done ? 'done' : ''}`}>{t.text}</div>
                {cols.map((c, d) => (
                  <div key={d} className={`g-cell ${c.today ? 'today' : ''} ${c.active ? 'active' : ''}`} />
                ))}
                {runs.map(([s, e], ri) => (
                  <div
                    key={`${s}-${e}`}
                    className={`g-bar tone-${t.tone ?? 'ink'} ${t.done ? 'done' : ''}`}
                    style={{ gridColumn: `${s + 2} / ${e + 3}` }}
                    onDoubleClick={(ev) => {
                      ev.stopPropagation()
                      onCells(t.i, cells.filter((c) => c < s || c > e))
                    }}
                    title={`${t.text}（雙擊清除這段）`}
                  >
                    {ri === 0 ? t.text : ''}
                  </div>
                ))}
                {dragOnThis && (
                  <div
                    className="g-bar dragging"
                    style={{ gridColumn: `${dLo + 2} / ${dHi + 3}` }}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
