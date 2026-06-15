import { useEffect, useMemo, useState } from 'react'
import { TextField } from './fields'
import Gantt from './Gantt'
import { allDayKeys, loadDay, loadYear, saveYear, toDateKey } from './storage'
import { YearEntry } from './types'

// Year at a Glance：一頁看整年（12 欄 × 31 列熱力格 + 年度目標 + 每月主題）
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

interface Props {
  year: number
  onYearChange: (y: number) => void
  onOpenDay: (dateKey: string) => void
}

export default function YearView({ year, onYearChange, onOpenDay }: Props) {
  const [entry, setEntry] = useState<YearEntry>(() => loadYear(String(year)))
  const [editing, setEditing] = useState<{ key: string; mi: number; top: number } | null>(null)
  const todayKey = toDateKey(new Date())

  useEffect(() => {
    setEntry(loadYear(String(year)))
    setEditing(null)
  }, [year])

  // 點格子外側關閉 popover
  useEffect(() => {
    if (!editing) return
    const dismiss = (e: MouseEvent) => {
      const pop = document.querySelector('.yr-pop')
      if (pop && pop.contains(e.target as Node)) return
      setEditing(null)
    }
    // nextTick 避免與開啟 popover 的同一個 click 互相抵消
    const id = setTimeout(() => document.addEventListener('click', dismiss), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('click', dismiss)
    }
  }, [editing])

  const setNote = (key: string, text: string) => {
    setEntry((prev) => {
      const notes = { ...prev.notes }
      if (text) notes[key] = text
      else delete notes[key]
      const next = { ...prev, notes }
      saveYear(String(year), next)
      return next
    })
  }

  const update = (patch: Partial<YearEntry>) => {
    setEntry((prev) => {
      const next = { ...prev, ...patch }
      saveYear(String(year), next)
      return next
    })
  }

  // 該年每一天的評分與 MIT（熱力格用）
  const dayMap = useMemo(() => {
    const map = new Map<string, { score: number | null; mit: string }>()
    for (const k of allDayKeys()) {
      if (!k.startsWith(`${year}-`)) continue
      const d = loadDay(k)
      map.set(k, { score: d.score, mit: d.tasks[0]?.text ?? '' })
    }
    return map
  }, [year])

  const recordedCount = dayMap.size

  return (
    <div className="page">
      <div className="page-inner">
        <div className="day-head">
          <div />
          <div className="day-nav">
            <button onClick={() => onYearChange(year - 1)} title="前一年">
              ‹
            </button>
            <button onClick={() => onYearChange(year + 1)} title="後一年">
              ›
            </button>
          </div>
        </div>

        <h2 className="section-title">{year}</h2>
        <p className="section-sub">One Year at a Glance — 一頁，看見一整年</p>

        <div className="label">年度三大目標</div>
        {entry.goals.map((g, i) => (
          <div key={i} className={`week-task-row ${g.done ? 'done' : ''}`}>
            <span className="task-num">{i + 1}.</span>
            <TextField
              list="yike-names"
              value={g.text}
              placeholder={i === 0 ? '今年就算只完成這一件，也值得了' : ''}
              onValue={(v) => {
                const goals = entry.goals.slice()
                goals[i] = { ...g, text: v }
                update({ goals })
              }}
            />
            <button
              className={`week-check ${g.done ? 'on' : ''}`}
              onClick={() => {
                const goals = entry.goals.slice()
                goals[i] = { ...g, done: !g.done }
                update({ goals })
              }}
            >
              ✓
            </button>
          </div>
        ))}

        <Gantt
          title="年度甘特"
          hint="在目標的列上拖出起訖月・雙擊清除"
          emptyHint="先寫下年度三大目標，這裡就會出現可拖拉的時程列"
          cols={Array.from({ length: 12 }, (_, mi) => ({
            label: `${mi + 1}月`,
            today: year === new Date().getFullYear() && mi === new Date().getMonth(),
          }))}
          rows={entry.goals.map((g, i) => ({ ...g, i })).filter((g) => g.text.trim())}
          onSpan={(i, span) => {
            const goals = entry.goals.slice()
            goals[i] = { ...goals[i], span }
            update({ goals })
          }}
        />

        <div className="label">
          整年一覽{' '}
          <span className="hint">
            {recordedCount} 天有記錄・顏色＝生產力分數・點格子寫一句話或跳入那天
          </span>
        </div>
        <div className="yr-scroll">
          <div className="yr-grid">
            {MONTHS.map((mName, mi) => {
              const m = mi + 1
              const daysInMonth = new Date(year, m, 0).getDate()
              return (
                <div key={m} className="yr-col">
                  <div className="yr-mhead">{mName}</div>
                  {Array.from({ length: 31 }, (_, di) => {
                    const d = di + 1
                    if (d > daysInMonth) return <div key={d} className="yr-cell void" />
                    const k = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                    const rec = dayMap.get(k)
                    const note = entry.notes[k]
                    const lv = rec ? (rec.score ?? 0) : -1
                    return (
                      <button
                        key={d}
                        className={`yr-cell lv${lv} ${k === todayKey ? 'today' : ''} ${note ? 'noted' : ''}`}
                        title={`${m}/${d}${note ? `：${note}` : ''}${rec?.mit ? `｜${rec.mit}` : ''}`}
                        onClick={(e) =>
                          setEditing({ key: k, mi, top: (e.currentTarget as HTMLElement).offsetTop })
                        }
                      >
                        <span className="yr-d">{d}</span>
                        {note && <span className="yr-note">{note}</span>}
                      </button>
                    )
                  })}

                  {editing && editing.mi === mi && (
                    <div
                      className="block-pop yr-pop"
                      style={{
                        top: Math.max(28, editing.top - 8),
                        ...(mi < 6 ? { left: 2 } : { right: 2 }),
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <TextField
                        autoFocus
                        placeholder="這天的一句話（生日、死線、里程碑⋯）"
                        value={entry.notes[editing.key] ?? ''}
                        onValue={(v) => setNote(editing.key, v)}
                        onKeyDown={(e) => e.key === 'Enter' && setEditing(null)}
                      />
                      <div className="pop-actions">
                        <span className="pop-time">
                          {Number(editing.key.slice(5, 7))}/{Number(editing.key.slice(8, 10))}
                        </span>
                        <span>
                          <button className="pop-del" onClick={() => onOpenDay(editing.key)}>
                            打開這天 →
                          </button>
                          {'　'}
                          <button onClick={() => setEditing(null)}>完成</button>
                        </span>
                      </div>
                    </div>
                  )}
                  <TextField
                    className="yr-focus"
                    placeholder="主題"
                    title={`${mName}主題`}
                    value={entry.monthFocus[mi]}
                    onValue={(v) => {
                      const monthFocus = entry.monthFocus.slice()
                      monthFocus[mi] = v
                      update({ monthFocus })
                    }}
                  />
                </div>
              )
            })}
          </div>
        </div>

        <div className="yr-legend">
          <span>無記錄</span>
          <i className="yr-swatch lv-1" />
          <i className="yr-swatch lv0" />
          <i className="yr-swatch lv1" />
          <i className="yr-swatch lv2" />
          <i className="yr-swatch lv3" />
          <i className="yr-swatch lv4" />
          <i className="yr-swatch lv5" />
          <span>5 分</span>
        </div>
      </div>
    </div>
  )
}
