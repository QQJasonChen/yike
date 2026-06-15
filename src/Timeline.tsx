import { useEffect, useRef, useState } from 'react'
import { Block, RoutineItem } from './types'

// 時間軸範圍：06:00 – 23:00，每格 30 分鐘
const START_MIN = 6 * 60
const END_MIN = 23 * 60
const SLOT = 30
const SLOT_PX = 26 // 與 .tl-row 高度一致

const snap = (min: number) => Math.round(min / SLOT) * SLOT
const clampRange = (min: number) => Math.max(START_MIN, Math.min(END_MIN, min))
const minToY = (min: number) => ((min - START_MIN) / SLOT) * SLOT_PX
const fmt = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

let blockSeq = 0
const newId = () => `b${++blockSeq}-${performance.now().toString(36)}`

interface DragState {
  mode: 'create' | 'move' | 'resize'
  blockId?: string
  anchorMin: number // create: 起點；move: 指針與塊頂的偏移（分鐘）
  curStart: number
  curEnd: number
  origStart: number
  origEnd: number
}

interface Props {
  blocks: Block[]
  isToday: boolean
  routines: RoutineItem[]
  onChange: (blocks: Block[]) => void
  /** 長按／右鍵就地編輯 routine（寫回 Settings.routines） */
  onRoutinesChange: (routines: RoutineItem[]) => void
  /** 由 App 注入：任務拖放時呼叫，回傳時間軸的放置資訊 */
  dropRef: React.MutableRefObject<((clientX: number, clientY: number, text: string, taskIndex: number) => boolean) | null>
}

const ROUTINE_DURS = [30, 60, 90, 120, 180, 240, 300, 360]
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const fromHHMM = (s: string) => {
  const [h, mm] = s.split(':').map(Number)
  return (h || 0) * 60 + (mm || 0)
}
const durLabel = (d: number) => (d < 60 ? `${d} 分` : `${d / 60} 小時`)

export default function Timeline({ blocks, isToday, routines, onChange, onRoutinesChange, dropRef }: Props) {
  const [editRoutine, setEditRoutine] = useState<number | null>(null)
  const pressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false) // 拖拉結束後瀏覽器補發的 click 要吃掉
  const [drag, setDrag] = useState<DragState | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [nowMin, setNowMin] = useState(() => new Date().getHours() * 60 + new Date().getMinutes())

  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date()
      setNowMin(d.getHours() * 60 + d.getMinutes())
    }, 60_000)
    return () => clearInterval(t)
  }, [])

  // 提供給「任務拖入時間軸」使用
  useEffect(() => {
    dropRef.current = (clientX, clientY, text, taskIndex) => {
      const el = gridRef.current
      if (!el) return false
      const r = el.getBoundingClientRect()
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom)
        return false
      const min = clampRange(snap(START_MIN + ((clientY - r.top) / SLOT_PX) * SLOT))
      const start = Math.min(min, END_MIN - SLOT)
      onChange([
        ...blocks,
        { id: newId(), start, end: Math.min(start + 60, END_MIN), text, taskIndex },
      ])
      return true
    }
    return () => {
      dropRef.current = null
    }
  })

  const pointerMin = (clientY: number) => {
    const r = gridRef.current!.getBoundingClientRect()
    return clampRange(snap(START_MIN + ((clientY - r.top) / SLOT_PX) * SLOT))
  }

  // ---- 空白處拖拉新增（滑鼠）/ 點一下新增（通用） ----
  const onGridPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('tl-cell'))
      return
    if (e.pointerType === 'mouse') {
      e.preventDefault()
      const m = pointerMin(e.clientY)
      setEditId(null)
      setDrag({
        mode: 'create',
        anchorMin: m,
        curStart: m,
        curEnd: m + SLOT,
        origStart: m,
        origEnd: m,
      })
    }
  }

  const onGridClick = (e: React.MouseEvent) => {
    // 觸控/點擊：直接生出 30 分鐘塊（手機免拖拉，一指完成）
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (drag) return
    if (!(e.target as HTMLElement).classList.contains('tl-cell')) return
    const m = Math.min(pointerMin(e.clientY), END_MIN - SLOT)
    const b: Block = { id: newId(), start: m, end: m + SLOT, text: '', taskIndex: null }
    onChange([...blocks, b])
    setEditId(b.id)
  }

  // ---- 塊移動 / 縮放 ----
  const startBlockDrag = (e: React.PointerEvent, b: Block, mode: 'move' | 'resize') => {
    e.stopPropagation()
    e.preventDefault()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件或不支援時略過 */
    }
    const m = pointerMin(e.clientY)
    setDrag({
      mode,
      blockId: b.id,
      anchorMin: mode === 'move' ? m - b.start : 0,
      curStart: b.start,
      curEnd: b.end,
      origStart: b.start,
      origEnd: b.end,
    })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const m = pointerMin(e.clientY)
    setDrag((d) => {
      if (!d) return d
      if (d.mode === 'create') {
        const lo = Math.min(d.anchorMin, m)
        const hi = Math.max(d.anchorMin + SLOT, m + (m >= d.anchorMin ? SLOT : 0))
        return { ...d, curStart: lo, curEnd: Math.max(hi, lo + SLOT) }
      }
      if (d.mode === 'move') {
        const len = d.curEnd - d.curStart
        let start = clampRange(m - snap(d.anchorMin))
        start = Math.min(start, END_MIN - len)
        return { ...d, curStart: start, curEnd: start + len }
      }
      // resize
      return { ...d, curEnd: Math.max(d.curStart + SLOT, m) }
    })
  }

  const onPointerUp = () => {
    if (!drag) return
    if (drag.mode === 'create') {
      const b: Block = {
        id: newId(),
        start: drag.curStart,
        end: drag.curEnd,
        text: '',
        taskIndex: null,
      }
      onChange([...blocks, b])
      setEditId(b.id)
      suppressClick.current = true // 之後補發的 click 不要再建第二塊
    } else {
      const changed = drag.curStart !== drag.origStart || drag.curEnd !== drag.origEnd
      if (changed) {
        onChange(
          blocks.map((b) =>
            b.id === drag.blockId ? { ...b, start: drag.curStart, end: drag.curEnd } : b
          )
        )
        suppressClick.current = true // 真的有拖動才吃掉 click；原地點放仍可開編輯
      }
    }
    setDrag(null)
  }

  const updateBlock = (id: string, patch: Partial<Block>) =>
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)))

  const removeBlock = (id: string) => {
    onChange(blocks.filter((b) => b.id !== id))
    setEditId(null)
  }

  // 一鍵快填 routine：放在預設時間；若與既有塊重疊，往下找最近的空檔
  const addRoutine = (r: RoutineItem) => {
    const hit = (s: number, e: number) => blocks.some((b) => s < b.end && e > b.start)
    let start = r.start
    while (start + r.dur <= END_MIN && hit(start, start + r.dur)) start += SLOT
    if (start + r.dur > END_MIN) start = r.start // 放不下就回原位，使用者自行調整
    onChange([
      ...blocks,
      { id: newId(), start, end: Math.min(start + r.dur, END_MIN), text: `${r.emoji} ${r.label}`, taskIndex: null },
    ])
  }

  // chip：點一下帶入、長按（手機）/右鍵（電腦）就地編輯
  const startPress = (i: number) => {
    longPressed.current = false
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true
      setEditRoutine(i)
    }, 450)
  }
  const cancelPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }
  const chipClick = (r: RoutineItem) => {
    if (longPressed.current) {
      longPressed.current = false
      return // 長按已開編輯，不要又帶入
    }
    addRoutine(r)
  }
  const setRoutine = (i: number, patch: Partial<RoutineItem>) =>
    onRoutinesChange(routines.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const delRoutine = (i: number) => {
    onRoutinesChange(routines.filter((_, j) => j !== i))
    setEditRoutine(null)
  }

  const rows: number[] = []
  for (let m = START_MIN; m < END_MIN; m += SLOT) rows.push(m)

  const editing = editId ? blocks.find((b) => b.id === editId) : null

  return (
    <div className="timeline-wrap">
      <div className="timeline-head">
        <div className="label" style={{ marginTop: 0 }}>
          今日時間軸
        </div>
      </div>
      <div className="timeline-hint">點空格新增・拖拉移動・拉底部把手調長度</div>
      {routines.length > 0 && (
        <div className="tl-routines">
          {routines.map((r, i) => (
            <button
              key={i}
              className="tl-routine"
              onClick={() => chipClick(r)}
              onPointerDown={() => startPress(i)}
              onPointerUp={cancelPress}
              onPointerLeave={cancelPress}
              onPointerMove={cancelPress}
              onContextMenu={(e) => {
                e.preventDefault()
                setEditRoutine(i)
              }}
              title={`點一下帶入「${r.label}」（${fmt(r.start)} 起）・長按或右鍵編輯`}
            >
              <span className="tl-routine-emoji">{r.emoji}</span>
              {r.label}
            </button>
          ))}
        </div>
      )}

      {editRoutine !== null && routines[editRoutine] && (
        <div className="tl-routine-pop" onClick={() => setEditRoutine(null)}>
          <div className="tl-routine-edit" onClick={(e) => e.stopPropagation()}>
            <div className="tl-routine-edit-row">
              <input
                className="re-emoji"
                value={routines[editRoutine].emoji}
                maxLength={2}
                onChange={(e) => setRoutine(editRoutine, { emoji: e.target.value })}
              />
              <input
                className="re-label"
                value={routines[editRoutine].label}
                placeholder="名稱"
                onChange={(e) => setRoutine(editRoutine, { label: e.target.value })}
              />
            </div>
            <div className="tl-routine-edit-row">
              <input
                className="re-time"
                type="time"
                step={1800}
                value={hhmm(routines[editRoutine].start)}
                onChange={(e) => setRoutine(editRoutine, { start: fromHHMM(e.target.value) })}
              />
              <select
                className="re-dur"
                value={routines[editRoutine].dur}
                onChange={(e) => setRoutine(editRoutine, { dur: Number(e.target.value) })}
              >
                {ROUTINE_DURS.map((d) => (
                  <option key={d} value={d}>
                    {durLabel(d)}
                  </option>
                ))}
              </select>
            </div>
            <div className="tl-routine-edit-actions">
              <button className="re-del" onClick={() => delRoutine(editRoutine)}>
                刪除
              </button>
              <button className="re-done" onClick={() => setEditRoutine(null)}>
                完成
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        className="timeline"
        ref={gridRef}
        onPointerDown={onGridPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onGridClick}
      >
        {rows.map((m) => (
          <div key={m} className={`tl-row ${m % 60 === 0 ? 'hour' : 'half'}`}>
            <div className="tl-time">{m % 60 === 0 ? fmt(m) : ''}</div>
            <div className="tl-cell" />
          </div>
        ))}

        <div className="tl-blocks">
          {blocks.map((b) => {
            const isDragging = drag?.blockId === b.id
            const start = isDragging ? drag.curStart : b.start
            const end = isDragging ? drag.curEnd : b.end
            return (
              <div
                key={b.id}
                className={`tl-block ${b.taskIndex !== null ? 'linked' : ''} ${isDragging ? 'dragging' : ''} ${
                  end - start <= SLOT ? 'slim' : ''
                }`}
                style={{ top: minToY(start), height: minToY(end) - minToY(start) - 2 }}
                onPointerDown={(e) => startBlockDrag(e, b, 'move')}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => {
                  if (drag) {
                    onPointerUp()
                  } else {
                    e.stopPropagation()
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  if (suppressClick.current) {
                    suppressClick.current = false
                    return
                  }
                  setEditId(b.id)
                }}
              >
                <span className="tl-block-time">
                  {fmt(start)} – {fmt(end)}
                </span>
                {b.text || '（未命名）'}
                <div
                  className="tl-resize"
                  onPointerDown={(e) => startBlockDrag(e, b, 'resize')}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                />
              </div>
            )
          })}

          {drag?.mode === 'create' && (
            <div
              className="tl-ghost"
              style={{
                top: minToY(drag.curStart),
                height: minToY(drag.curEnd) - minToY(drag.curStart) - 2,
              }}
            />
          )}
        </div>

        {isToday && nowMin >= START_MIN && nowMin <= END_MIN && (
          <div className="now-line" style={{ top: minToY(nowMin) }} />
        )}

        {editing && (
          <div
            className="block-pop"
            style={{
              top: Math.min(minToY(editing.start), (END_MIN - START_MIN) / SLOT * SLOT_PX - 110),
              right: 0,
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              list="yike-names"
              placeholder="做什麼？例：上班、深度工作"
              value={editing.text}
              onChange={(e) => updateBlock(editing.id, { text: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && setEditId(null)}
            />
            <div className="pop-times">
              <select
                value={editing.start}
                onChange={(e) => {
                  const start = Number(e.target.value)
                  updateBlock(editing.id, {
                    start,
                    end: Math.max(editing.end, start + SLOT),
                  })
                }}
              >
                {rows.map((min) => (
                  <option key={min} value={min}>
                    {fmt(min)}
                  </option>
                ))}
              </select>
              <span>–</span>
              <select
                value={editing.end}
                onChange={(e) => updateBlock(editing.id, { end: Number(e.target.value) })}
              >
                {rows
                  .map((min) => min + SLOT)
                  .filter((min) => min > editing.start)
                  .map((min) => (
                    <option key={min} value={min}>
                      {fmt(min)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="pop-actions">
              <span />
              <span>
                <button className="pop-del" onClick={() => removeBlock(editing.id)}>
                  刪除
                </button>
                {'　'}
                <button onClick={() => setEditId(null)}>完成</button>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
