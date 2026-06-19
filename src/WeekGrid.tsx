import { useEffect, useRef, useState } from 'react'
import { TextField } from './fields'
import { addDays, fromDateKey, loadDay, saveDay, toDateKey } from './storage'
import { Block, DayEntry } from './types'

// 無印良品週間バーチカル式：7 天直欄 × 06:00–23:00 時間格
// 互動：空白拖曳＝建立（拖多長就多長）、拖橫條＝移動、拖底部把手＝改長度、單點橫條＝編輯。
const START_MIN = 6 * 60
const END_MIN = 23 * 60
const SLOT = 30
const SLOT_PX = 16

const minToY = (min: number) => ((min - START_MIN) / SLOT) * SLOT_PX
const fmt = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

let seq = 0
const newId = () => `wb${++seq}-${performance.now().toString(36)}`

const WD_EN = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

type Act =
  | { kind: 'create'; dayKey: string; a: number; b: number; moved: boolean }
  | { kind: 'move'; dayKey: string; id: string; downMin: number; origStart: number; dur: number; cur: number; moved: boolean }
  | { kind: 'resize'; dayKey: string; id: string; start: number; cur: number; moved: boolean }

interface Props {
  mondayKey: string
  query: string
  onOpenDay: (dateKey: string) => void
}

export default function WeekGrid({ mondayKey, query, onOpenDay }: Props) {
  const [entries, setEntries] = useState<Record<string, DayEntry>>({})
  const [editing, setEditing] = useState<{ dayKey: string; blockId: string } | null>(null)
  const [act, setAct] = useState<Act | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const bodyRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const todayKey = toDateKey(new Date())
  const dayKeys = Array.from({ length: 7 }, (_, i) => addDays(mondayKey, i))

  useEffect(() => {
    const map: Record<string, DayEntry> = {}
    for (const k of dayKeys) map[k] = loadDay(k)
    setEntries(map)
    setEditing(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mondayKey])

  const saveBlocks = (dayKey: string, blocks: Block[]) => {
    setEntries((prev) => {
      const entry = { ...(prev[dayKey] ?? loadDay(dayKey)), blocks }
      saveDay(dayKey, entry)
      return { ...prev, [dayKey]: entry }
    })
  }

  const updateBlock = (dayKey: string, id: string, patch: Partial<Block>) =>
    saveBlocks(
      dayKey,
      (entries[dayKey]?.blocks ?? []).map((b) => (b.id === id ? { ...b, ...patch } : b))
    )

  const removeBlock = (dayKey: string, id: string) => {
    saveBlocks(dayKey, (entries[dayKey]?.blocks ?? []).filter((b) => b.id !== id))
    setEditing(null)
  }

  // 滑鼠/觸控 Y → 對齊 30 分鐘的分鐘數
  const yToMin = (dayKey: string, clientY: number): number => {
    const el = bodyRefs.current[dayKey]
    if (!el) return START_MIN
    const r = el.getBoundingClientRect()
    const raw = START_MIN + ((clientY - r.top) / SLOT_PX) * SLOT
    return Math.max(START_MIN, Math.min(END_MIN, Math.round(raw / SLOT) * SLOT))
  }

  const capture = (e: React.PointerEvent) => {
    try {
      gridRef.current?.setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件略過 */
    }
  }

  const bodyDown = (dayKey: string) => (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.wk-block, .block-pop')) return
    e.preventDefault()
    capture(e)
    setEditing(null)
    const m = yToMin(dayKey, e.clientY)
    setAct({ kind: 'create', dayKey, a: m, b: m + SLOT, moved: false })
  }

  const blockDown = (dayKey: string, b: Block) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    capture(e)
    setAct({
      kind: 'move',
      dayKey,
      id: b.id,
      downMin: yToMin(dayKey, e.clientY),
      origStart: b.start,
      dur: b.end - b.start,
      cur: b.start,
      moved: false,
    })
  }

  const resizeDown = (dayKey: string, b: Block) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    capture(e)
    setAct({ kind: 'resize', dayKey, id: b.id, start: b.start, cur: b.end, moved: false })
  }

  const onMove = (e: React.PointerEvent) => {
    if (!act) return
    const m = yToMin(act.dayKey, e.clientY)
    if (act.kind === 'create') {
      setAct({ ...act, b: m, moved: act.moved || m !== act.a })
    } else if (act.kind === 'move') {
      const delta = m - act.downMin
      const ns = Math.max(START_MIN, Math.min(END_MIN - act.dur, act.origStart + delta))
      setAct({ ...act, cur: ns, moved: act.moved || ns !== act.origStart })
    } else {
      const ne = Math.max(act.start + SLOT, m)
      setAct({ ...act, cur: ne, moved: act.moved || ne !== act.cur })
    }
  }

  const onUp = () => {
    if (!act) return
    if (act.kind === 'create') {
      if (act.moved) {
        const lo = Math.min(act.a, act.b)
        const hi = Math.max(act.a, act.b)
        const nb: Block = { id: newId(), start: lo, end: Math.max(hi, lo + SLOT), text: '', taskIndex: null }
        saveBlocks(act.dayKey, [...(entries[act.dayKey]?.blocks ?? []), nb])
        setEditing({ dayKey: act.dayKey, blockId: nb.id })
      }
      // 純單點空白＝不建立（避免誤觸）
    } else if (act.kind === 'move') {
      if (act.moved) updateBlock(act.dayKey, act.id, { start: act.cur, end: act.cur + act.dur })
      else setEditing({ dayKey: act.dayKey, blockId: act.id }) // 單點＝編輯
    } else if (act.kind === 'resize') {
      if (act.moved) updateBlock(act.dayKey, act.id, { end: act.cur })
    }
    setAct(null)
  }

  const hours: number[] = []
  for (let m = START_MIN; m < END_MIN; m += 60) hours.push(m)

  const q = query.trim().toLowerCase()
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()

  return (
    <div className="wk-scroll">
      <div className="wk-grid" ref={gridRef} onPointerMove={onMove} onPointerUp={onUp}>
        <div className="wk-gutter">
          <div className="wk-head" />
          {hours.map((m) => (
            <div key={m} className="wk-hour">
              {Math.floor(m / 60)}
            </div>
          ))}
        </div>

        {dayKeys.map((k, di) => {
          const d = fromDateKey(k)
          const isToday = k === todayKey
          const blocks = entries[k]?.blocks ?? []
          const edit = editing?.dayKey === k ? blocks.find((b) => b.id === editing.blockId) : null
          const ghost =
            act?.kind === 'create' && act.dayKey === k && act.moved
              ? [Math.min(act.a, act.b), Math.max(act.a, act.b)]
              : null
          return (
            <div key={k} className={`wk-col ${isToday ? 'today' : ''}`}>
              <button className="wk-head" onClick={() => onOpenDay(k)} title="打開這一天">
                <span className="wk-daynum">{d.getDate()}</span> {WD_EN[di]}
              </button>
              <div
                className="wk-body"
                ref={(el) => (bodyRefs.current[k] = el)}
                onPointerDown={bodyDown(k)}
              >
                {Array.from({ length: (END_MIN - START_MIN) / SLOT }, (_, i) => (
                  <div key={i} className={`wk-cell ${i % 2 === 1 ? 'hour-end' : ''}`} />
                ))}

                {blocks.map((b) => {
                  const moving = act?.kind === 'move' && act.id === b.id
                  const resizing = act?.kind === 'resize' && act.id === b.id
                  const top = moving ? act.cur : b.start
                  const bottom = resizing ? act.cur : moving ? act.cur + act.dur : b.end
                  return (
                    <div
                      key={b.id}
                      className={`wk-block ${b.taskIndex !== null ? 'linked' : ''} ${
                        q && b.text.toLowerCase().includes(q) ? 'hit' : ''
                      } ${q && !b.text.toLowerCase().includes(q) ? 'dim' : ''} ${
                        moving || resizing ? 'dragging' : ''
                      }`}
                      style={{ top: minToY(top), height: minToY(bottom) - minToY(top) - 1 }}
                      onPointerDown={blockDown(k, b)}
                      title={`${fmt(b.start)}–${fmt(b.end)} ${b.text}`}
                    >
                      {b.text || '·'}
                      <span className="wk-resize" onPointerDown={resizeDown(k, b)} />
                    </div>
                  )
                })}

                {ghost && (
                  <div
                    className="wk-block dragging ghost"
                    style={{ top: minToY(ghost[0]), height: Math.max(SLOT_PX, minToY(ghost[1]) - minToY(ghost[0])) }}
                  >
                    {fmt(ghost[0])}
                  </div>
                )}

                {isToday && nowMin >= START_MIN && nowMin <= END_MIN && (
                  <div className="now-line wk-now" style={{ top: minToY(nowMin) }} />
                )}

                {edit && (
                  <div
                    className="block-pop wk-pop"
                    style={{ top: Math.max(0, minToY(edit.start) - 4) }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <TextField
                      autoFocus
                      list="yike-names"
                      placeholder="做什麼？"
                      value={edit.text}
                      onValue={(v) => updateBlock(k, edit.id, { text: v })}
                      onKeyDown={(e) => e.key === 'Enter' && setEditing(null)}
                    />
                    <div className="pop-actions">
                      <span className="pop-time">
                        {fmt(edit.start)}–{fmt(edit.end)}
                        <button
                          className="dur-btn"
                          title="縮短 30 分鐘"
                          onClick={() =>
                            edit.end - edit.start > SLOT &&
                            updateBlock(k, edit.id, { end: edit.end - SLOT })
                          }
                        >
                          −
                        </button>
                        <button
                          className="dur-btn"
                          title="延長 30 分鐘"
                          onClick={() =>
                            edit.end < END_MIN && updateBlock(k, edit.id, { end: edit.end + SLOT })
                          }
                        >
                          ＋
                        </button>
                      </span>
                      <span>
                        <button className="pop-del" onClick={() => removeBlock(k, edit.id)}>
                          刪除
                        </button>
                        {'　'}
                        <button onClick={() => setEditing(null)}>完成</button>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
