import { useEffect, useMemo, useState } from 'react'
import MiniCal from './MiniCal'
import Gantt from './Gantt'
import PeriodSummary from './PeriodSummary'
import { addMonths, loadDay, loadMonth, saveMonth, toDateKey } from './storage'
import { DayEntry, MonthEntry } from './types'

const MOODS = ['😖', '🙁', '😐', '🙂', '😄']
const MONTHS_EN = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]
const WD = ['一', '二', '三', '四', '五', '六', '日']

interface Props {
  monthKey: string // YYYY-MM
  onMonthChange: (k: string) => void
  onOpenDay: (dateKey: string) => void
}

export default function MonthView({ monthKey, onMonthChange, onOpenDay }: Props) {
  const [entry, setEntry] = useState<MonthEntry>(() => loadMonth(monthKey))
  const todayKey = toDateKey(new Date())

  useEffect(() => {
    setEntry(loadMonth(monthKey))
  }, [monthKey])

  const update = (patch: Partial<MonthEntry>) => {
    setEntry((prev) => {
      const next = { ...prev, ...patch }
      saveMonth(monthKey, next)
      return next
    })
  }

  const [y, m] = monthKey.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const firstOffset = (new Date(y, m - 1, 1).getDay() + 6) % 7 // 週一開始

  // 整月每日資料（亮點用：MIT、心情、評分）
  const days = useMemo(() => {
    const map = new Map<number, DayEntry>()
    for (let d = 1; d <= daysInMonth; d++) {
      const k = `${monthKey}-${String(d).padStart(2, '0')}`
      if (localStorage.getItem(`pp:day:${k}`)) map.set(d, loadDay(k))
    }
    return map
  }, [monthKey, daysInMonth])

  const cells: (number | null)[] = [
    ...Array.from({ length: firstOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="page">
      <div className="page-inner">
        <div className="day-head">
          <div />
          <div className="day-nav">
            <button onClick={() => onMonthChange(addMonths(monthKey, -1))} title="上個月">
              ‹
            </button>
            <button onClick={() => onMonthChange(addMonths(monthKey, 1))} title="下個月">
              ›
            </button>
          </div>
        </div>

        <div className="yr-strip">
          {Array.from({ length: 12 }, (_, i) => (
            <MiniCal
              key={i}
              micro
              year={y}
              month={i + 1}
              current={i + 1 === m}
              onPick={onOpenDay}
              onPickMonth={() => onMonthChange(`${y}-${String(i + 1).padStart(2, '0')}`)}
            />
          ))}
        </div>

        <h2 className="section-title">{MONTHS_EN[m - 1]}</h2>
        <p className="section-sub">{y} 年 {m} 月</p>

        <div className="mo-grid">
          {WD.map((w) => (
            <div key={w} className="mo-wd">
              {w}
            </div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={`b${i}`} className="mo-cell blank" />
            const k = `${monthKey}-${String(d).padStart(2, '0')}`
            const e = days.get(d)
            const isToday = k === todayKey
            return (
              <button
                key={k}
                className={`mo-cell ${isToday ? 'today' : ''}`}
                onClick={() => onOpenDay(k)}
                title={e?.tasks[0]?.text || ''}
              >
                <span className="mo-daynum">{d}</span>
                <span className="mo-meta">
                  {e?.mood ? MOODS[e.mood - 1] : ''}
                  {e?.score ? <em>{e.score}</em> : ''}
                </span>
                {e?.tasks[0]?.text && <span className="mo-mit">{e.tasks[0].text}</span>}
              </button>
            )
          })}
        </div>

        <PeriodSummary
          title="本月總結"
          periodLabel={`${y} 年 ${m} 月`}
          dayKeys={Array.from({ length: daysInMonth }, (_, i) =>
            `${monthKey}-${String(i + 1).padStart(2, '0')}`
          )}
        />

        <div className="label">本月優先事項</div>
        {entry.priorities.map((p, i) => (
          <div key={i} className={`week-task-row ${p.done ? 'done' : ''}`}>
            <span className="task-num">{i + 1}.</span>
            <input
              list="yike-names"
              value={p.text}
              onChange={(e) => {
                const priorities = entry.priorities.slice()
                priorities[i] = { ...p, text: e.target.value }
                update({ priorities })
              }}
            />
            <button
              className={`week-check ${p.done ? 'on' : ''}`}
              onClick={() => {
                const priorities = entry.priorities.slice()
                priorities[i] = { ...p, done: !p.done }
                update({ priorities })
              }}
            >
              ✓
            </button>
          </div>
        ))}

        <Gantt
          title="本月甘特"
          hint="在事項的列上拖出起訖日・雙擊清除"
          emptyHint="先寫下本月優先事項，這裡就會出現可拖拉的時程列"
          labelWidth={130}
          cols={Array.from({ length: daysInMonth }, (_, d) => ({
            label: String(d + 1),
            today: `${monthKey}-${String(d + 1).padStart(2, '0')}` === todayKey,
          }))}
          rows={entry.priorities.map((p, i) => ({ ...p, i })).filter((p) => p.text.trim())}
          onSpan={(i, span) => {
            const priorities = entry.priorities.slice()
            priorities[i] = { ...priorities[i], span }
            update({ priorities })
          }}
        />

        <div className="label">本月亮點</div>
        <textarea
          className="line-area"
          rows={3}
          value={entry.highlights}
          onChange={(e) => update({ highlights: e.target.value })}
          placeholder="這個月最值得記住的時刻⋯"
        />
      </div>
    </div>
  )
}
