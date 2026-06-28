import { useEffect, useState } from 'react'
import { NameField, TextArea } from './fields'
import HabitHeatmap from './HabitHeatmap'
import PeriodSummary from './PeriodSummary'
import { addQuarters, loadQuarter, mondayOf, saveQuarter } from './storage'
import { QuarterEntry, Settings } from './types'

const Q_CN = ['第一季', '第二季', '第三季', '第四季']

interface Props {
  quarterKey: string // YYYY-Qn
  onQuarterChange: (k: string) => void
  settings: Settings
}

const pad = (n: number) => String(n).padStart(2, '0')

export default function QuarterView({ quarterKey, onQuarterChange, settings }: Props) {
  const [entry, setEntry] = useState<QuarterEntry>(() => loadQuarter(quarterKey))

  useEffect(() => {
    setEntry(loadQuarter(quarterKey))
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
            <NameField
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
