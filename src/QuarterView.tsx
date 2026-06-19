import { useEffect, useState } from 'react'
import { TextArea, TextField } from './fields'
import Gantt, { spanToCells } from './Gantt'
import HabitHeatmap from './HabitHeatmap'
import PeriodSummary from './PeriodSummary'
import {
  addQuarters,
  loadQuarter,
  loadYear,
  mondayOf,
  saveQuarter,
  saveYear,
  toDateKey,
} from './storage'
import { QuarterEntry, Settings, YearEntry } from './types'

const Q_CN = ['第一季', '第二季', '第三季', '第四季']

interface Props {
  quarterKey: string // YYYY-Qn
  onQuarterChange: (k: string) => void
  settings: Settings
}

const pad = (n: number) => String(n).padStart(2, '0')

export default function QuarterView({ quarterKey, onQuarterChange, settings }: Props) {
  const [entry, setEntry] = useState<QuarterEntry>(() => loadQuarter(quarterKey))
  const [yearEntry, setYearEntry] = useState<YearEntry>(() => loadYear(quarterKey.slice(0, 4)))
  const todayKey = toDateKey(new Date())

  useEffect(() => {
    setEntry(loadQuarter(quarterKey))
    setYearEntry(loadYear(quarterKey.slice(0, 4)))
  }, [quarterKey])

  const update = (patch: Partial<QuarterEntry>) => {
    setEntry((prev) => {
      const next = { ...prev, ...patch }
      saveQuarter(quarterKey, next)
      return next
    })
  }

  const [y, q] = quarterKey.split('-Q').map(Number)
  const startMonth = (q - 1) * 3 + 1
  const months = [startMonth, startMonth + 1, startMonth + 2]
  const lastMonth = startMonth + 2
  // 本季每一天的 key（總結用）
  const dayKeys: string[] = []
  for (const mm of months) {
    const dim = new Date(y, mm, 0).getDate()
    for (let d = 1; d <= dim; d++) dayKeys.push(`${y}-${pad(mm)}-${pad(d)}`)
  }
  // 熱力圖：顯示整年（到年底那一週，回看 53 週）
  const endMonday = mondayOf(`${y}-12-31`)

  return (
    <div className="page">
      <div className="page-inner">
        <div className="day-head">
          <div />
          <div className="day-nav">
            <button onClick={() => onQuarterChange(addQuarters(quarterKey, -1))} title="上一季">
              ‹
            </button>
            <button onClick={() => onQuarterChange(addQuarters(quarterKey, 1))} title="下一季">
              ›
            </button>
          </div>
        </div>

        <h2 className="section-title">Q{q}</h2>
        <p className="section-sub">{y} 年・{Q_CN[q - 1]}（{startMonth}–{lastMonth} 月）</p>

        <div className="label">本季優先事項</div>
        {entry.priorities.map((p, i) => (
          <div key={i} className={`week-task-row ${p.done ? 'done' : ''}`}>
            <span className="task-num">{i + 1}.</span>
            <TextField
              list="yike-names"
              value={p.text}
              placeholder={i === 0 ? '這一季最想推進的一件事' : ''}
              onValue={(v) => {
                const priorities = entry.priorities.slice()
                priorities[i] = { ...p, text: v }
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
          title="本季甘特"
          hint="點一月＝選/取消・拖曳＝一次選連續多月・雙擊橫條清那段"
          emptyHint="先寫下本季優先事項，這裡就會出現可拖拉的時程列"
          labelWidth={130}
          cols={months.map((mm) => ({
            label: `${mm}月`,
            today: `${y}-${pad(mm)}` === todayKey.slice(0, 7),
          }))}
          rows={entry.priorities
            .map((p, i) => ({ ...p, i, cells: p.cells ?? spanToCells(p.span) }))
            .filter((p) => p.text.trim())}
          onCells={(i, cells) => {
            const priorities = entry.priorities.slice()
            priorities[i] = { ...priorities[i], cells, span: null }
            update({ priorities })
          }}
        />

        <Gantt
          title="年度目標進度"
          hint="這一季在推進哪個年度目標？金色帶＝本季的月份"
          emptyHint="到「年」頁寫下年度三大目標並拖出起訖月，這裡就能對照本季與年目標"
          labelWidth={130}
          cols={Array.from({ length: 12 }, (_, mi) => ({
            label: `${mi + 1}月`,
            today: `${y}-${pad(mi + 1)}` === todayKey.slice(0, 7),
            active: months.includes(mi + 1),
          }))}
          rows={yearEntry.goals
            .map((g, i) => ({ ...g, i, cells: g.cells ?? spanToCells(g.span) }))
            .filter((g) => g.text.trim())}
          onCells={(i, cells) => {
            const goals = yearEntry.goals.slice()
            goals[i] = { ...goals[i], cells, span: null }
            const next = { ...yearEntry, goals }
            saveYear(quarterKey.slice(0, 4), next)
            setYearEntry(next)
          }}
        />

        {settings.habits.length > 0 && (
          <>
            <div className="label" style={{ marginTop: 22 }}>
              習慣熱力圖 <span className="hint">整年・一格一天・愈深愈完整</span>
            </div>
            <HabitHeatmap endMonday={endMonday} weeks={53} habits={settings.habits} />
          </>
        )}

        <div className="label">本季亮點</div>
        <TextArea
          className="line-area"
          rows={3}
          value={entry.highlights}
          onValue={(v) => update({ highlights: v })}
          placeholder="這一季最值得記住的時刻⋯"
        />

        <PeriodSummary
          title="本季總結"
          periodLabel={`${y} 年 ${Q_CN[q - 1]}`}
          dayKeys={dayKeys}
        />
      </div>
    </div>
  )
}
