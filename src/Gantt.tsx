// 通用甘特引擎：任意欄數（週=7天、月=31天、年=12月）。
// 選取模型 = 格子集合 cells[]，支援不連續（1,3,5）與多段；連續格子自動併成一條橫條。
import { useLayoutEffect, useRef, useState } from 'react'
import type { GanttTone } from './ganttTone'

/** 名稱欄「展開全文」狀態，每張甘特（以 title 區分）各自記住。localStorage 不可用時退回預設收合。 */
const EXPAND_KEY = (title: string) => `yike.gantt.labelsExpanded.${title}`
const readExpanded = (title: string): boolean => {
  try {
    return localStorage.getItem(EXPAND_KEY(title)) === '1'
  } catch {
    return false
  }
}
const writeExpanded = (title: string, v: boolean) => {
  try {
    if (v) localStorage.setItem(EXPAND_KEY(title), '1')
    else localStorage.removeItem(EXPAND_KEY(title))
  } catch {
    /* 存不了就只在這次畫面有效 */
  }
}
/** 兩次點擊／輕觸間隔多短算雙擊 */
const DOUBLE_TAP_MS = 300

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
  collapsible?: boolean // 標題可點擊收合（時程 tab 用）
  defaultOpen?: boolean // collapsible 時的預設展開狀態
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

export default function Gantt({
  title,
  hint,
  emptyHint,
  cols,
  rows,
  labelWidth = 150,
  legend,
  collapsible = false,
  defaultOpen = true,
  onCells,
}: Props) {
  const [open, setOpen] = useState(collapsible ? defaultOpen : true)
  const [drag, setDrag] = useState<{ row: number; a: number; b: number; moved: boolean } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(() => readExpanded(title))
  const [truncated, setTruncated] = useState(false)
  const lastTap = useRef(Number.NEGATIVE_INFINITY)
  const n = cols.length

  // 有任何名稱被「…」截斷時才顯示「雙擊名稱看全文」提示
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid || expanded) {
      setTruncated(false)
      return
    }
    const labels = grid.querySelectorAll<HTMLElement>('.g-row:not(.g-head) .g-label')
    setTruncated([...labels].some((el) => el.scrollWidth > el.clientWidth + 1))
  }, [expanded, open, rows, labelWidth])

  const toggleExpanded = () =>
    setExpanded((v) => {
      writeExpanded(title, !v)
      return !v
    })

  // 名稱欄：雙擊（滑鼠）或兩下輕觸（手機）→ 整張甘特的名稱一起展開／收合。
  // 統一用 pointerup 計時，不靠 dblclick（iOS 觸控不會送 dblclick，部分 Android 會，兩條路並用會重複切換）。
  const labelDown = (e: React.PointerEvent) => {
    // 不讓點名稱冒泡成「點第一格」或開始拖曳
    e.stopPropagation()
  }
  const labelUp = (e: React.PointerEvent) => {
    e.stopPropagation()
    const now = e.timeStamp || Date.now()
    if (now - lastTap.current <= DOUBLE_TAP_MS) {
      lastTap.current = Number.NEGATIVE_INFINITY
      e.preventDefault()
      toggleExpanded()
    } else {
      lastTap.current = now
    }
  }
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
        {collapsible ? (
          <button className="g-collapse" onClick={() => setOpen((o) => !o)}>
            <span className="g-caret">{open ? '▾' : '▸'}</span>
            <span className="g-title">{title}</span>
            {!open && rows.length > 0 && <span className="g-count">{rows.length}</span>}
          </button>
        ) : (
          <span className="g-title">{title}</span>
        )}
        {open && legend && rows.length > 0 && (
          <span className="g-legend">
            {legend.map((l) => (
              <span key={l.tone}>
                <i className={`g-dot tone-${l.tone}`} />
                {l.label}
              </span>
            ))}
          </span>
        )}
        {open && (rows.length ? hint : emptyHint) && (
          <span className="hint">{rows.length ? hint : emptyHint}</span>
        )}
        {open && rows.length > 0 && (truncated || expanded) && (
          <span className="hint g-expand-hint">{expanded ? '雙擊名稱收合' : '名稱被截斷？雙擊名稱看全文'}</span>
        )}
      </div>
      {!open ? null : rows.length === 0 ? (
        <div className="gantt g-empty">
          點格子選／取消・拖一段一次選多天 →　像這樣
          <span className="g-demo" />
        </div>
      ) : (
        <div
          className={`gantt ${dense ? 'dense' : ''} ${expanded ? 'g-expanded' : ''}`}
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
                <div
                  className={`g-label ${t.done ? 'done' : ''}`}
                  title={expanded ? undefined : `${t.text}（雙擊名稱展開全部）`}
                  onPointerDown={labelDown}
                  onPointerUp={labelUp}
                >
                  {t.text}
                </div>
                {cols.map((c, d) => (
                  <div key={d} className={`g-cell ${c.today ? 'today' : ''} ${c.active ? 'active' : ''}`} />
                ))}
                {runs.map(([s, e]) => (
                  <div
                    key={`${s}-${e}`}
                    className={`g-bar tone-${t.tone ?? 'ink'} ${t.done ? 'done' : ''}`}
                    style={{ gridColumn: `${s + 2} / ${e + 3}` }}
                    onDoubleClick={(ev) => {
                      ev.stopPropagation()
                      onCells(t.i, cells.filter((c) => c < s || c > e))
                    }}
                    title={`${t.text}（雙擊清除這段）`}
                  />
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
