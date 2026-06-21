import { useEffect, useMemo, useState } from 'react'
import { TextArea, TextField } from './fields'
import Gantt, { spanToCells } from './Gantt'
import { tierTone } from './ganttTone'
import HabitWeek from './HabitWeek'
import MiniCal from './MiniCal'
import PeriodSummary from './PeriodSummary'
import WeekGrid from './WeekGrid'
import {
  addDays,
  allDayKeys,
  fromDateKey,
  loadDay,
  loadWeek,
  mondayOf,
  saveWeek,
  toDateKey,
} from './storage'
import { Settings, WeekEntry } from './types'

interface Props {
  mondayKey: string
  onWeekChange: (mondayKey: string) => void
  onOpenDay: (dateKey: string) => void
  settings: Settings
  onSettingsChange: (s: Settings) => void
}

interface SearchHit {
  dateKey: string
  kind: '任務' | '時間塊' | '反思'
  text: string
  time?: string
}

const fmtMin = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** 全域搜尋：任務、時間塊、反思欄位 */
const searchAll = (query: string): SearchHit[] => {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  for (const k of allDayKeys()) {
    const d = loadDay(k)
    d.tasks.forEach((t) => {
      if (t.text.toLowerCase().includes(q)) hits.push({ dateKey: k, kind: '任務', text: t.text })
    })
    d.blocks.forEach((b) => {
      if (b.text.toLowerCase().includes(q))
        hits.push({ dateKey: k, kind: '時間塊', text: b.text, time: `${fmtMin(b.start)}–${fmtMin(b.end)}` })
    })
    for (const field of Object.values(d.answers)) {
      if (field && field.toLowerCase().includes(q))
        hits.push({ dateKey: k, kind: '反思', text: field })
    }
    if (hits.length > 30) break
  }
  return hits.slice(0, 30)
}

const fmtRange = (mondayKey: string) => {
  const mon = fromDateKey(mondayKey)
  const sun = fromDateKey(addDays(mondayKey, 6))
  return `${mon.getMonth() + 1}/${mon.getDate()} – ${sun.getMonth() + 1}/${sun.getDate()}, ${sun.getFullYear()}`
}

/** ISO 週數（無印手帳的 week N） */
const weekNumber = (mondayKey: string): number => {
  const d = fromDateKey(mondayKey)
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const jan4Monday = new Date(jan4)
  jan4Monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7))
  const diff = Math.round((d.getTime() - jan4Monday.getTime()) / 86_400_000)
  if (diff < 0) return weekNumber(`${d.getFullYear() - 1}-12-28`)
  return Math.floor(diff / 7) + 1
}

export default function WeekView({ mondayKey, onWeekChange, onOpenDay, settings, onSettingsChange }: Props) {
  const [week, setWeek] = useState<WeekEntry>(() => loadWeek(mondayKey))
  const [query, setQuery] = useState('')
  const hits = useMemo(() => searchAll(query), [query])
  // 本週時程表：手機預設收起（避免又長又難滑），桌機展開
  const [showGrid, setShowGrid] = useState(
    () => !(typeof window !== 'undefined' && window.matchMedia('(max-width: 560px)').matches)
  )

  useEffect(() => {
    setWeek(loadWeek(mondayKey))
  }, [mondayKey])

  const update = (patch: Partial<WeekEntry>) => {
    setWeek((prev) => {
      const next = { ...prev, ...patch }
      saveWeek(mondayKey, next)
      return next
    })
  }

  const updateTask = (i: number, patch: Partial<{ text: string; done: boolean }>) => {
    const tasks = week.tasks.slice()
    tasks[i] = { ...tasks[i], ...patch }
    update({ tasks })
  }

  const updateReview = (k: keyof WeekEntry['review'], v: string) =>
    update({ review: { ...week.review, [k]: v } })

  const section = (title: string, hint: string, from: number, to: number) => (
    <>
      <div className="label">
        {title} <span className="hint">{hint}</span>
      </div>
      {week.tasks.slice(from, to).map((t, i) => {
        const idx = from + i
        return (
          <div key={idx} className={`week-task-row ${t.done ? 'done' : ''}`}>
            <span className="task-num">{idx + 1}.</span>
            <TextField
              list="yike-names"
              value={t.text}
              onValue={(v) => updateTask(idx, { text: v })}
            />
            <button
              className={`week-check ${t.done ? 'on' : ''}`}
              onClick={() => updateTask(idx, { done: !t.done })}
            >
              ✓
            </button>
          </div>
        )
      })}
    </>
  )

  return (
    <div className="page">
      <div className="page-inner">
        <div className="day-head">
          <div />
          <div className="day-nav">
            <button onClick={() => onWeekChange(addDays(mondayKey, -7))} title="上一週">
              ‹
            </button>
            <button onClick={() => onWeekChange(addDays(mondayKey, 7))} title="下一週">
              ›
            </button>
          </div>
        </div>
        <h2 className="section-title">Week {weekNumber(mondayKey)}</h2>
        <p className="section-sub">{fmtRange(mondayKey)}</p>

        <div className="mc-strip">
          {[-1, 0, 1].map((off) => {
            const base = fromDateKey(mondayKey)
            const m = new Date(base.getFullYear(), base.getMonth() + off, 1)
            return (
              <MiniCal
                key={off}
                year={m.getFullYear()}
                month={m.getMonth() + 1}
                weekOf={mondayKey}
                onPick={onOpenDay}
              />
            )
          })}
        </div>

        <div className="wk-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 搜尋所有記錄（任務、時間塊、反思）⋯"
          />
        </div>
        {query.trim() && (
          <div className="wk-results">
            {hits.length === 0 && <p className="wk-noresult">沒有找到「{query}」</p>}
            {hits.map((h, i) => (
              <button key={i} className="hist-row" onClick={() => onOpenDay(h.dateKey)}>
                <span className="hist-date">{h.dateKey.slice(5).replace('-', '/')}</span>
                <span className="wk-kind">{h.kind}</span>
                <span className="hist-mit">{h.text}</span>
                {h.time && <span className="hist-score">{h.time}</span>}
              </button>
            ))}
          </div>
        )}

        <button className="wk-grid-toggle" onClick={() => setShowGrid((v) => !v)}>
          <span className="g-caret">{showGrid ? '▾' : '▸'}</span>
          本週時程表
          <span className="hint">{showGrid ? '' : '點開排時間塊'}</span>
        </button>
        {showGrid && (
          <>
            <div className="wk-grid-nav">
              <button onClick={() => onWeekChange(addDays(mondayKey, -7))} title="上一週">
                ‹
              </button>
              <span className="wk-grid-range">{fmtRange(mondayKey)}</span>
              {mondayKey !== mondayOf(toDateKey(new Date())) && (
                <button
                  className="wk-today-jump"
                  onClick={() => onWeekChange(mondayOf(toDateKey(new Date())))}
                >
                  本週
                </button>
              )}
              <button onClick={() => onWeekChange(addDays(mondayKey, 7))} title="下一週">
                ›
              </button>
            </div>
            <WeekGrid mondayKey={mondayKey} query={query} onOpenDay={onOpenDay} />
          </>
        )}

        <HabitWeek mondayKey={mondayKey} settings={settings} onSettingsChange={onSettingsChange} />

        <Gantt
          title="本週甘特"
          hint="點一天＝選/取消（可挑不連續如一·三·五）・拖曳＝一次選連續多天・雙擊橫條清那段"
          emptyHint="在下方「本週主要任務」寫下任務，這裡就會出現可拖拉的時程列"
          legend={[
            { tone: 'ink', label: '主要' },
            { tone: 'gold', label: '次要' },
            { tone: 'sage', label: '額外' },
          ]}
          cols={Array.from({ length: 7 }, (_, d) => {
            const k = addDays(mondayKey, d)
            return {
              label: ['一', '二', '三', '四', '五', '六', '日'][d],
              sub: String(Number(k.slice(8, 10))),
              today: k === toDateKey(new Date()),
            }
          })}
          rows={week.tasks
            .map((t, i) => ({ ...t, i, tone: tierTone(i), cells: t.cells ?? spanToCells(t.span) }))
            .filter((t) => t.text.trim())}
          onCells={(i, cells) => {
            const tasks = week.tasks.slice()
            tasks[i] = { ...tasks[i], cells, span: null }
            update({ tasks })
          }}
        />

        <h2 className="section-title" style={{ marginTop: 46 }}>
          Weekly Planning
        </h2>
        <p className="section-sub">設定方向，然後執行</p>

        <div className="label">本週意圖</div>
        <div className="line-input">
          <TextField
            value={week.intention}
            onValue={(v) => update({ intention: v })}
            placeholder="一句話定調這週：方向、或身分宣言「這週我是一個＿＿的人」"
          />
        </div>

        {section('本週主要任務', '如果這週只完成這五件事，你會滿意', 0, 5)}
        {section('次要任務', '完成上面的才做這些', 5, 10)}
        {section('額外任務', '行有餘力再做', 10, 15)}

        <PeriodSummary
          title="本週總結"
          periodLabel={`Week ${weekNumber(mondayKey)}（${fmtRange(mondayKey)}）`}
          dayKeys={Array.from({ length: 7 }, (_, i) => addDays(mondayKey, i))}
        />

        <h2 className="section-title" style={{ marginTop: 46 }}>
          Weekly Review
        </h2>
        <p className="section-sub">誠實是最好的策略</p>

        <div className="label">
          本週的勝利 <span className="hint">什麼進展順利？大小勝利都算</span>
        </div>
        <TextArea
          className="line-area"
          rows={3}
          value={week.review.wins}
          onValue={(v) => updateReview('wins', v)}
        />

        <div className="label">
          哪些任務沒完成？ <span className="hint">下週重新承諾完成它們</span>
        </div>
        <TextArea
          className="line-area"
          rows={3}
          value={week.review.notCompleted}
          onValue={(v) => updateReview('notCompleted', v)}
        />

        <div className="label">
          我學到了什麼？ <span className="hint">未來要怎麼運用？</span>
        </div>
        <TextArea
          className="line-area"
          rows={3}
          value={week.review.learned}
          onValue={(v) => updateReview('learned', v)}
        />

        <div className="label">
          下週 <span className="hint">採取哪些行動確保下週高效？</span>
        </div>
        <TextArea
          className="line-area"
          rows={3}
          value={week.review.nextWeek}
          onValue={(v) => updateReview('nextWeek', v)}
        />
      </div>
    </div>
  )
}
