import { useEffect, useState } from 'react'
import { addDays, fromDateKey, loadDay, saveDay, toDateKey } from './storage'
import { Block, DayEntry } from './types'

// 無印良品週間バーチカル式：7 天直欄 × 06:00–23:00 時間格
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

interface Props {
  mondayKey: string
  query: string
  onOpenDay: (dateKey: string) => void
}

export default function WeekGrid({ mondayKey, query, onOpenDay }: Props) {
  const [entries, setEntries] = useState<Record<string, DayEntry>>({})
  const [editing, setEditing] = useState<{ dayKey: string; blockId: string } | null>(null)
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

  const addBlock = (dayKey: string, e: React.MouseEvent<HTMLDivElement>) => {
    const col = e.currentTarget.getBoundingClientRect()
    const min = Math.min(
      END_MIN - SLOT,
      Math.max(START_MIN, START_MIN + Math.floor((e.clientY - col.top) / SLOT_PX) * SLOT)
    )
    const b: Block = { id: newId(), start: min, end: min + SLOT, text: '', taskIndex: null }
    saveBlocks(dayKey, [...(entries[dayKey]?.blocks ?? []), b])
    setEditing({ dayKey, blockId: b.id })
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

  const hours: number[] = []
  for (let m = START_MIN; m < END_MIN; m += 60) hours.push(m)

  const q = query.trim().toLowerCase()
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()

  return (
    <div className="wk-scroll">
      <div className="wk-grid">
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
          return (
            <div key={k} className={`wk-col ${isToday ? 'today' : ''}`}>
              <button className="wk-head" onClick={() => onOpenDay(k)} title="打開這一天">
                <span className="wk-daynum">{d.getDate()}</span> {WD_EN[di]}
              </button>
              <div className="wk-body" onClick={(e) => {
                if ((e.target as HTMLElement).closest('.wk-block, .block-pop')) return
                addBlock(k, e as React.MouseEvent<HTMLDivElement>)
              }}>
                {Array.from({ length: (END_MIN - START_MIN) / SLOT }, (_, i) => (
                  <div key={i} className={`wk-cell ${i % 2 === 1 ? 'hour-end' : ''}`} />
                ))}

                {blocks.map((b) => (
                  <div
                    key={b.id}
                    className={`wk-block ${b.taskIndex !== null ? 'linked' : ''} ${
                      q && b.text.toLowerCase().includes(q) ? 'hit' : ''
                    } ${q && !b.text.toLowerCase().includes(q) ? 'dim' : ''}`}
                    style={{ top: minToY(b.start), height: minToY(b.end) - minToY(b.start) - 1 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing({ dayKey: k, blockId: b.id })
                    }}
                    title={`${fmt(b.start)}–${fmt(b.end)} ${b.text}`}
                  >
                    {b.text || '·'}
                  </div>
                ))}

                {isToday && nowMin >= START_MIN && nowMin <= END_MIN && (
                  <div className="now-line wk-now" style={{ top: minToY(nowMin) }} />
                )}

                {edit && (
                  <div
                    className="block-pop wk-pop"
                    style={{ top: Math.max(0, minToY(edit.start) - 4) }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      autoFocus
                      placeholder="做什麼？"
                      value={edit.text}
                      onChange={(e) => updateBlock(k, edit.id, { text: e.target.value })}
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
