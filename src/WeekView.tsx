import { useEffect, useMemo, useState } from 'react'
import WeekGrid from './WeekGrid'
import { addDays, allDayKeys, fromDateKey, loadDay, loadWeek, saveWeek } from './storage'
import { WeekEntry } from './types'

interface Props {
  mondayKey: string
  onWeekChange: (mondayKey: string) => void
  onOpenDay: (dateKey: string) => void
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
    for (const field of [d.gratitude, d.intention, d.highlight, d.learned, d.remember]) {
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

export default function WeekView({ mondayKey, onWeekChange, onOpenDay }: Props) {
  const [week, setWeek] = useState<WeekEntry>(() => loadWeek(mondayKey))
  const [query, setQuery] = useState('')
  const hits = useMemo(() => searchAll(query), [query])

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
            <input value={t.text} onChange={(e) => updateTask(idx, { text: e.target.value })} />
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

        <WeekGrid mondayKey={mondayKey} query={query} onOpenDay={onOpenDay} />

        <h2 className="section-title" style={{ marginTop: 46 }}>
          Weekly Planning
        </h2>
        <p className="section-sub">設定方向，然後執行</p>

        <div className="label">本週意圖</div>
        <div className="line-input">
          <input
            value={week.intention}
            onChange={(e) => update({ intention: e.target.value })}
            placeholder="用一句話定調這一週的方向"
          />
        </div>

        {section('本週五大最重要任務', '如果這週只完成這五件事，你會滿意', 0, 5)}
        {section('次要任務', '完成上面的才做這些', 5, 10)}
        {section('額外任務', '行有餘力再做', 10, 15)}

        <h2 className="section-title" style={{ marginTop: 46 }}>
          Weekly Review
        </h2>
        <p className="section-sub">誠實是最好的策略</p>

        <div className="label">
          本週的勝利 <span className="hint">什麼進展順利？大小勝利都算</span>
        </div>
        <textarea
          className="line-area"
          rows={3}
          value={week.review.wins}
          onChange={(e) => updateReview('wins', e.target.value)}
        />

        <div className="label">
          哪些任務沒完成？ <span className="hint">下週重新承諾完成它們</span>
        </div>
        <textarea
          className="line-area"
          rows={3}
          value={week.review.notCompleted}
          onChange={(e) => updateReview('notCompleted', e.target.value)}
        />

        <div className="label">
          我學到了什麼？ <span className="hint">未來要怎麼運用？</span>
        </div>
        <textarea
          className="line-area"
          rows={3}
          value={week.review.learned}
          onChange={(e) => updateReview('learned', e.target.value)}
        />

        <div className="label">
          下週 <span className="hint">採取哪些行動確保下週高效？</span>
        </div>
        <textarea
          className="line-area"
          rows={3}
          value={week.review.nextWeek}
          onChange={(e) => updateReview('nextWeek', e.target.value)}
        />
      </div>
    </div>
  )
}
