// 時程 tab：把週/月/季/年的甘特集中在一處，用週期切換；每張甘特可收合。
// 資料沿用各層的 localStorage entry，與對應分頁即時共用。
import { useEffect, useState } from 'react'
import Gantt, { spanToCells } from './Gantt'
import { tierTone } from './ganttTone'
import {
  addDays,
  addMonths,
  addQuarters,
  fromDateKey,
  loadMonth,
  loadQuarter,
  loadWeek,
  loadYear,
  mondayOf,
  monthOf,
  quarterOf,
  saveMonth,
  saveQuarter,
  saveWeek,
  saveYear,
  toDateKey,
} from './storage'
import { MonthEntry, QuarterEntry, WeekEntry, YearEntry } from './types'

const pad = (n: number) => String(n).padStart(2, '0')
const Q_CN = ['第一季', '第二季', '第三季', '第四季']

const weekNumber = (mondayKey: string): number => {
  const d = fromDateKey(mondayKey)
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const jan4Monday = new Date(jan4)
  jan4Monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7))
  const diff = Math.round((d.getTime() - jan4Monday.getTime()) / 86_400_000)
  if (diff < 0) return weekNumber(`${d.getFullYear() - 1}-12-28`)
  return Math.floor(diff / 7) + 1
}
const fmtRange = (mondayKey: string) => {
  const mon = fromDateKey(mondayKey)
  const sun = fromDateKey(addDays(mondayKey, 6))
  return `${mon.getMonth() + 1}/${mon.getDate()} – ${sun.getMonth() + 1}/${sun.getDate()}`
}

type Period = 'week' | 'month' | 'quarter' | 'year'
const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: '週' },
  { key: 'month', label: '月' },
  { key: 'quarter', label: '季' },
  { key: 'year', label: '年' },
]

export default function ScheduleView() {
  const todayKey = toDateKey(new Date())
  const [period, setPeriod] = useState<Period>('week')
  const [weekKey, setWeekKey] = useState(() => mondayOf(todayKey))
  const [monthKey, setMonthKey] = useState(() => monthOf(todayKey))
  const [quarterKey, setQuarterKey] = useState(() => quarterOf(todayKey))
  const [yearNum, setYearNum] = useState(() => Number(todayKey.slice(0, 4)))

  const [week, setWeek] = useState<WeekEntry>(() => loadWeek(weekKey))
  const [month, setMonth] = useState<MonthEntry>(() => loadMonth(monthKey))
  const [quarter, setQuarter] = useState<QuarterEntry>(() => loadQuarter(quarterKey))
  const [year, setYear] = useState<YearEntry>(() => loadYear(String(yearNum)))

  useEffect(() => setWeek(loadWeek(weekKey)), [weekKey])
  useEffect(() => setMonth(loadMonth(monthKey)), [monthKey])
  useEffect(() => setQuarter(loadQuarter(quarterKey)), [quarterKey])
  useEffect(() => setYear(loadYear(String(yearNum))), [yearNum])
  // 切到某週期時重載，吃到其他分頁的編輯
  useEffect(() => {
    setWeek(loadWeek(weekKey))
    setMonth(loadMonth(monthKey))
    setQuarter(loadQuarter(quarterKey))
    setYear(loadYear(String(yearNum)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  const saveW = (e: WeekEntry) => {
    saveWeek(weekKey, e)
    setWeek(e)
  }
  const saveM = (e: MonthEntry) => {
    saveMonth(monthKey, e)
    setMonth(e)
  }
  const saveQ = (e: QuarterEntry) => {
    saveQuarter(quarterKey, e)
    setQuarter(e)
  }
  const saveY = (e: YearEntry) => {
    saveYear(String(yearNum), e)
    setYear(e)
  }

  // 各週期的導覽與標題
  const nav: Record<Period, { prev: () => void; next: () => void; title: string; sub: string }> = {
    week: {
      prev: () => setWeekKey(addDays(weekKey, -7)),
      next: () => setWeekKey(addDays(weekKey, 7)),
      title: `Week ${weekNumber(weekKey)}`,
      sub: fmtRange(weekKey),
    },
    month: {
      prev: () => setMonthKey(addMonths(monthKey, -1)),
      next: () => setMonthKey(addMonths(monthKey, 1)),
      title: `${Number(monthKey.slice(5, 7))} 月`,
      sub: `${monthKey.slice(0, 4)} 年`,
    },
    quarter: {
      prev: () => setQuarterKey(addQuarters(quarterKey, -1)),
      next: () => setQuarterKey(addQuarters(quarterKey, 1)),
      title: `Q${quarterKey.split('-Q')[1]}`,
      sub: `${quarterKey.slice(0, 4)} 年・${Q_CN[Number(quarterKey.split('-Q')[1]) - 1]}`,
    },
    year: {
      prev: () => setYearNum(yearNum - 1),
      next: () => setYearNum(yearNum + 1),
      title: String(yearNum),
      sub: '一年的時程一覽',
    },
  }
  const cur = nav[period]

  const [y, m] = monthKey.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const [qy, qn] = quarterKey.split('-Q').map(Number)
  const qStartMonth = (qn - 1) * 3 + 1
  const qMonths = [qStartMonth, qStartMonth + 1, qStartMonth + 2]

  // 12 個月欄（年度目標進度共用），active 標示傳入的月份集合
  const monthCols = (activeMonths: number[], yr: number) =>
    Array.from({ length: 12 }, (_, mi) => ({
      label: `${mi + 1}月`,
      today: `${yr}-${pad(mi + 1)}` === todayKey.slice(0, 7),
      active: activeMonths.includes(mi + 1),
    }))

  const yearGoalGantt = (activeMonths: number[], yr: number) => (
    <Gantt
      title="年度目標進度"
      hint="這段時間在推進哪個年度目標？金色帶＝目前"
      emptyHint="到「年」寫下年度目標並拖出起訖月，這裡就能對照"
      labelWidth={130}
      collapsible
      defaultOpen={false}
      cols={monthCols(activeMonths, yr)}
      rows={year.goals
        .map((g, i) => ({ ...g, i, cells: g.cells ?? spanToCells(g.span) }))
        .filter((g) => g.text.trim())}
      onCells={(i, cells) => {
        const goals = year.goals.slice()
        goals[i] = { ...goals[i], cells, span: null }
        saveY({ ...year, goals })
      }}
    />
  )

  return (
    <div className="page">
      <div className="page-inner">
        <div className="sched-tabs">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={period === p.key ? 'active' : ''}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="day-head" style={{ marginTop: 6 }}>
          <div />
          <div className="day-nav">
            <button onClick={cur.prev} title="上一個">
              ‹
            </button>
            <button onClick={cur.next} title="下一個">
              ›
            </button>
          </div>
        </div>
        <h2 className="section-title">{cur.title}</h2>
        <p className="section-sub">{cur.sub}</p>

        {period === 'week' && (
          <Gantt
            title="本週甘特"
            hint="點一天＝選/取消（可不連續）・拖曳＝連續多天・雙擊橫條清那段"
            emptyHint="到「本週」頁寫下五大任務，這裡就會出現可拖拉的時程列"
            legend={[
              { tone: 'ink', label: '五大' },
              { tone: 'gold', label: '次要' },
              { tone: 'sage', label: '額外' },
            ]}
            cols={Array.from({ length: 7 }, (_, d) => {
              const k = addDays(weekKey, d)
              return {
                label: ['一', '二', '三', '四', '五', '六', '日'][d],
                sub: String(Number(k.slice(8, 10))),
                today: k === todayKey,
              }
            })}
            rows={week.tasks
              .map((t, i) => ({ ...t, i, tone: tierTone(i), cells: t.cells ?? spanToCells(t.span) }))
              .filter((t) => t.text.trim())}
            onCells={(i, cells) => {
              const tasks = week.tasks.slice()
              tasks[i] = { ...tasks[i], cells, span: null }
              saveW({ ...week, tasks })
            }}
          />
        )}

        {period === 'month' && (
          <>
            <Gantt
              title="本月甘特"
              hint="點一天＝選/取消（可不連續）・拖曳＝連續多天・雙擊橫條清那段"
              emptyHint="到「本月」頁寫下優先事項，這裡就會出現可拖拉的時程列"
              labelWidth={130}
              cols={Array.from({ length: daysInMonth }, (_, d) => ({
                label: String(d + 1),
                today: `${monthKey}-${pad(d + 1)}` === todayKey,
              }))}
              rows={month.priorities
                .map((p, i) => ({ ...p, i, cells: p.cells ?? spanToCells(p.span) }))
                .filter((p) => p.text.trim())}
              onCells={(i, cells) => {
                const priorities = month.priorities.slice()
                priorities[i] = { ...priorities[i], cells, span: null }
                saveM({ ...month, priorities })
              }}
            />
            {yearGoalGantt([m], y)}
          </>
        )}

        {period === 'quarter' && (
          <>
            <Gantt
              title="本季甘特"
              hint="點一月＝選/取消・拖曳＝連續多月・雙擊橫條清那段"
              emptyHint="到「季」頁寫下季度優先事項，這裡就會出現可拖拉的時程列"
              labelWidth={130}
              cols={qMonths.map((mm) => ({
                label: `${mm}月`,
                today: `${qy}-${pad(mm)}` === todayKey.slice(0, 7),
              }))}
              rows={quarter.priorities
                .map((p, i) => ({ ...p, i, cells: p.cells ?? spanToCells(p.span) }))
                .filter((p) => p.text.trim())}
              onCells={(i, cells) => {
                const priorities = quarter.priorities.slice()
                priorities[i] = { ...priorities[i], cells, span: null }
                saveQ({ ...quarter, priorities })
              }}
            />
            {yearGoalGantt(qMonths, qy)}
          </>
        )}

        {period === 'year' && (
          <Gantt
            title="年度甘特"
            hint="點一月＝選/取消・拖曳＝連續多月・雙擊橫條清那段"
            emptyHint="到「年」頁寫下年度目標，這裡就會出現可拖拉的時程列"
            cols={Array.from({ length: 12 }, (_, mi) => ({
              label: `${mi + 1}月`,
              today: yearNum === new Date().getFullYear() && mi === new Date().getMonth(),
            }))}
            rows={year.goals
              .map((g, i) => ({ ...g, i, cells: g.cells ?? spanToCells(g.span) }))
              .filter((g) => g.text.trim())}
            onCells={(i, cells) => {
              const goals = year.goals.slice()
              goals[i] = { ...goals[i], cells, span: null }
              saveY({ ...year, goals })
            }}
          />
        )}
      </div>
    </div>
  )
}
