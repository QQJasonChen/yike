import { useEffect, useMemo, useRef, useState } from 'react'
import Gantt, { tierTone } from './Gantt'
import MiniCal from './MiniCal'
import TaskRow from './TaskRow'
import Timeline from './Timeline'
import { TimerState } from './FocusTimer'
import { quoteForDate } from './quotes'
import { dayToMarkdown } from './exportMd'
import { addDays, loadDay, loadWeek, mondayOf, saveDay, saveWeek, toDateKey } from './storage'
import { DayEntry, Settings, Task, WeekEntry } from './types'

const WEEKDAYS_EN = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']

/** ISO 週數＋週內進度（週一 .0 → 週日 .9），例：W24.6 */
const weekDecimal = (d: Date): string => {
  const dow = (d.getDay() + 6) % 7 // Mon=0..Sun=6
  const monday = new Date(d)
  monday.setDate(d.getDate() - dow)
  const jan4 = new Date(monday.getFullYear(), 0, 4)
  const jan4Mon = new Date(jan4)
  jan4Mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7))
  // 用「天數四捨五入」避免日光節約時間的 1 小時誤差
  let week = Math.round((monday.getTime() - jan4Mon.getTime()) / 86400000) / 7 + 1
  if (week < 1) week = 52
  return `W${week}.${Math.round((dow / 7) * 10)}`
}
const MOODS = ['😖', '🙁', '😐', '🙂', '😄']

interface Props {
  dateKey: string
  onDateChange: (key: string) => void
  timer: TimerState | null
  onStartFocus: (taskIndex: number, taskText: string) => void
  settings: Settings
  onSettingsChange: (s: Settings) => void
  /** 計時器完成一個時段時，由 App 呼叫塗圈 */
  registerSessionSink: (fn: (taskIndex: number, startMs: number, endMs: number) => void) => void
}

export default function DayView({
  dateKey,
  onDateChange,
  timer,
  onStartFocus,
  settings,
  onSettingsChange,
  registerSessionSink,
}: Props) {
  const [entry, setEntry] = useState<DayEntry>(() => loadDay(dateKey))
  // 本週甘特（聚焦：今天對到本週計畫的哪件事）
  const [weekEntry, setWeekEntry] = useState<WeekEntry>(() => loadWeek(mondayOf(dateKey)))
  const [copied, setCopied] = useState(false)
  const [rolloverDone, setRolloverDone] = useState(false)
  const [addingHabit, setAddingHabit] = useState(false)
  const [newHabit, setNewHabit] = useState('')

  const addHabit = () => {
    const name = newHabit.trim()
    if (name && !settings.habits.includes(name) && settings.habits.length < 8)
      onSettingsChange({ ...settings, habits: [...settings.habits, name] })
    setNewHabit('')
    setAddingHabit(false)
  }
  const todayKey = toDateKey(new Date())

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(
        dayToMarkdown(dateKey, entry, settings.morningQs, settings.eveningQs)
      )
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('複製失敗，請改用「回顧」頁的匯出 JSON')
    }
  }

  // 昨日未完成任務 → 一鍵帶入今天
  const yesterdayUnfinished = useMemo(() => {
    if (dateKey !== todayKey) return []
    const prev = loadDay(addDays(dateKey, -1))
    const todayTexts = new Set(entry.tasks.map((t) => t.text.trim()).filter(Boolean))
    return prev.tasks.filter((t) => t.text.trim() && !t.completed && !todayTexts.has(t.text.trim()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, todayKey, rolloverDone])

  const rollover = () => {
    setEntry((prev) => {
      const tasks = prev.tasks.slice()
      let qi = 0
      for (let i = 0; i < tasks.length && qi < yesterdayUnfinished.length; i++) {
        if (!tasks[i].text.trim()) {
          const src = yesterdayUnfinished[qi++]
          tasks[i] = { text: src.text, target: src.target, done: 0, actual: null, completed: false }
        }
      }
      const next = { ...prev, tasks }
      saveDay(dateKey, next)
      return next
    })
    setRolloverDone(true)
  }
  const isToday = dateKey === todayKey
  const dropRef = useRef<((x: number, y: number, text: string, taskIndex: number) => boolean) | null>(null)

  // 換日期時重新載入
  useEffect(() => {
    setEntry(loadDay(dateKey))
    setWeekEntry(loadWeek(mondayOf(dateKey)))
  }, [dateKey])

  // 任何修改即時存檔（零儲存按鈕）
  const update = (patch: Partial<DayEntry>) => {
    setEntry((prev) => {
      const next = { ...prev, ...patch }
      saveDay(dateKey, next)
      return next
    })
  }

  const updateTask = (i: number, t: Task) => {
    const tasks = entry.tasks.slice()
    tasks[i] = t
    update({ tasks })
  }

  const setAnswer = (id: string, v: string) =>
    update({ answers: { ...entry.answers, [id]: v } })

  const MORNING_PLACEHOLDERS: Record<number, string> = {
    0: '今天想感謝的人事物⋯',
    1: '用現在式宣告：例「我是一個說到做到的人」「我是冷靜出手的創作者」',
    2: '一個小實驗：例「最難的事排第一段專注」「先錄影再回訊息」',
  }

  // Focus Timer 完成時段 → 塗圈 ＋ 把真實時段自動寫進右邊時間軸
  useEffect(() => {
    registerSessionSink((taskIndex, startMs, endMs) => {
      setEntry((prev) => {
        const tasks = prev.tasks.slice()
        const t = tasks[taskIndex]
        if (t) {
          const done = Math.min(t.done + 1, 8)
          tasks[taskIndex] = { ...t, done, actual: done }
        }
        // 真實起訖 → 分鐘（夾在時間軸 06:00–23:00 範圍內，最短 15 分鐘）
        const toMin = (ms: number) => {
          const dd = new Date(ms)
          return dd.getHours() * 60 + dd.getMinutes()
        }
        let bStart = Math.max(6 * 60, Math.min(23 * 60 - 15, toMin(startMs)))
        let bEnd = Math.max(bStart + 15, Math.min(23 * 60, toMin(endMs)))
        const blocks = prev.blocks.slice()
        // 同任務、上一塊結尾相距 ≤6 分鐘 → 直接接長（連續番茄變一條）
        const tail = blocks
          .filter((b) => b.taskIndex === taskIndex)
          .sort((x, y) => y.end - x.end)[0]
        if (tail && Math.abs(bStart - tail.end) <= 6) {
          tail.end = bEnd
        } else {
          blocks.push({
            id: `f${Date.now().toString(36)}`,
            start: bStart,
            end: bEnd,
            text: t?.text ?? '專注',
            taskIndex,
          })
        }
        const next = { ...prev, tasks, blocks }
        saveDay(todayKey, next)
        return next
      })
    })
  }, [registerSessionSink, todayKey])

  const d = new Date(
    Number(dateKey.slice(0, 4)),
    Number(dateKey.slice(5, 7)) - 1,
    Number(dateKey.slice(8, 10))
  )
  const quote = quoteForDate(dateKey)

  const sectionLabel = (i: number) =>
    i === 0 ? (
      <div className="label" key={`l${i}`}>
        <span className="star">★</span> 最重要任務
        <span className="hint">最不舒服、最常拖延的那一件</span>
      </div>
    ) : i === 1 ? (
      <div className="label" key={`l${i}`}>
        次要任務 <span className="hint">完成它們會讓今天更好</span>
      </div>
    ) : i === 3 ? (
      <div className="label" key={`l${i}`}>
        額外任務 <span className="hint">先做完上面的再說</span>
      </div>
    ) : null

  return (
    <div className="page">
      <div className="page-inner">
        <div className="day-head">
          <div className="day-title">
            <span className="day-weekday">{WEEKDAYS_EN[d.getDay()]}</span>
            <span className="day-date">
              {d.getMonth() + 1} 月 {d.getDate()} 日 {d.getFullYear()}
              <span className="week-no">・{weekDecimal(d)}</span>
            </span>
          </div>
          <div className="day-nav">
            <button
              className="today-btn"
              onClick={copyMarkdown}
              title="複製這一天的 Markdown，可直接貼到 Heptabase / Notion"
            >
              {copied ? '✓ 已複製' : '⧉ MD'}
            </button>
            <button onClick={() => onDateChange(addDays(dateKey, -1))} title="前一天">
              ‹
            </button>
            {!isToday && (
              <button className="today-btn" onClick={() => onDateChange(todayKey)}>
                回到今天
              </button>
            )}
            <button onClick={() => onDateChange(addDays(dateKey, 1))} title="後一天">
              ›
            </button>
          </div>
        </div>

        <div className="quote">
          「{quote.text}」<span className="author">— {quote.author}</span>
        </div>

        {weekEntry.tasks.some((t) => t.text.trim()) && (
          <Gantt
            title="本週甘特"
            hint="今天該推進哪件事？金色欄＝今天・可直接拖拉調整"
            emptyHint=""
            legend={[
              { tone: 'ink', label: '五大' },
              { tone: 'gold', label: '次要' },
              { tone: 'sage', label: '額外' },
            ]}
            cols={Array.from({ length: 7 }, (_, wd) => {
              const k = addDays(mondayOf(dateKey), wd)
              return {
                label: ['一', '二', '三', '四', '五', '六', '日'][wd],
                sub: String(Number(k.slice(8, 10))),
                today: k === todayKey,
                active: k === dateKey,
              }
            })}
            rows={weekEntry.tasks
              .map((t, i) => ({ ...t, i, tone: tierTone(i) }))
              .filter((t) => t.text.trim())}
            onSpan={(i, span) => {
              const tasks = weekEntry.tasks.slice()
              tasks[i] = { ...tasks[i], span }
              const next = { ...weekEntry, tasks }
              saveWeek(mondayOf(dateKey), next)
              setWeekEntry(next)
            }}
          />
        )}

        <div className="day-grid">
          <div>
            {settings.morningQs.map((q, i) => (
              <span key={`m${i}`}>
                <div className="label" style={i === 0 ? { marginTop: 0 } : undefined}>
                  {q}
                </div>
                <div className="line-input">
                  <input
                    value={entry.answers[`m${i}`] ?? ''}
                    onChange={(e) => setAnswer(`m${i}`, e.target.value)}
                    placeholder={MORNING_PLACEHOLDERS[i] ?? ''}
                  />
                </div>
              </span>
            ))}

            {yesterdayUnfinished.length > 0 && (
              <div className="rollover">
                <span>
                  昨天有 <b>{yesterdayUnfinished.length}</b> 件未完成：
                  {yesterdayUnfinished.map((t) => t.text).join('、').slice(0, 40)}
                </span>
                <span>
                  <button className="rollover-btn" onClick={rollover}>
                    帶入今天 →
                  </button>
                  <button className="rollover-dismiss" onClick={() => setRolloverDone(true)} title="忽略">
                    ✕
                  </button>
                </span>
              </div>
            )}

            {entry.tasks.map((t, i) => (
              <span key={i}>
                {sectionLabel(i)}
                <TaskRow
                  index={i}
                  task={t}
                  onChange={(nt) => updateTask(i, nt)}
                  isRunning={timer?.phase === 'focus' && timer.taskIndex === i && isToday}
                  onStartFocus={() => onStartFocus(i, t.text)}
                  onDropToTimeline={(x, y) => {
                    const landed = dropRef.current?.(x, y, t.text, i)
                    if (!landed && t.text.trim()) {
                      // 沒掉在時間軸上（手機時間軸在下方搆不到）→ 自動排進下一個空檔
                      const now = new Date()
                      const nowMin = now.getHours() * 60 + now.getMinutes()
                      const dur = Math.min(120, 30 * Math.max(1, (t.target ?? 1) - t.done))
                      let start = Math.max(6 * 60, Math.ceil(nowMin / 30) * 30)
                      const blocks = entry.blocks
                      const overlaps = (s0: number, e0: number) =>
                        blocks.some((b) => s0 < b.end && e0 > b.start)
                      while (start + dur <= 23 * 60 && overlaps(start, start + dur)) start += 30
                      if (start + dur > 23 * 60) start = Math.max(6 * 60, 23 * 60 - dur)
                      update({
                        blocks: [
                          ...blocks,
                          {
                            id: `a${Date.now().toString(36)}`,
                            start,
                            end: start + dur,
                            text: t.text,
                            taskIndex: i,
                          },
                        ],
                      })
                    }
                  }}
                />
                {i === 0 && isToday && t.text.trim() && !t.completed && !timer && (
                  <div className="mit-focus-row">
                    <button
                      className="mit-focus"
                      onClick={() => onStartFocus(0, t.text)}
                      title="開始專注（番茄鐘）"
                      aria-label="開始專注"
                    >
                      <svg className="mit-tomato" viewBox="0 0 32 32" aria-hidden="true">
                        {/* 葉冠 */}
                        <path
                          d="M16 4 L17.3 7.2 L20.8 7.5 L18.1 9.7 L18.9 13 L16 11.2 L13.1 13 L13.9 9.7 L11.2 7.5 L14.7 7.2 Z"
                          fill="#6aa345"
                        />
                        <rect x="15.2" y="2.4" width="1.6" height="3.4" rx="0.8" fill="#4a7a30" />
                        {/* 果身 */}
                        <ellipse cx="16" cy="19.5" rx="10.5" ry="9.6" fill="#e2503a" />
                        <path
                          d="M16 10.2c4.6 0 8.4 3.5 9.3 8-2.6.9-6 1.4-9.3 1.4s-6.7-.5-9.3-1.4c.9-4.5 4.7-8 9.3-8z"
                          fill="#ec6347"
                        />
                        {/* 反光 */}
                        <ellipse cx="11.6" cy="16" rx="2.6" ry="1.7" fill="#fff" opacity="0.5" />
                      </svg>
                    </button>
                    <select
                      className="mit-len"
                      value={settings.focusMinutes}
                      title="一段專注的長度（會記住）"
                      onChange={(e) =>
                        onSettingsChange({ ...settings, focusMinutes: Number(e.target.value) })
                      }
                    >
                      {[15, 20, 25, 30, 35, 40, 45, 50].map((m) => (
                        <option key={m} value={m}>
                          {m} 分
                        </option>
                      ))}
                    </select>
                    <span className="mit-focus-sub">
                      結束自動刻一筆{t.target ? `・目標 ${t.target}` : ''}
                    </span>
                  </div>
                )}
              </span>
            ))}

            {settings.eveningQs.map((q, i) => (
              <span key={`e${i}`}>
                <div className="label">{q}</div>
                <div className="line-input">
                  <input
                    value={entry.answers[`e${i}`] ?? ''}
                    onChange={(e) => setAnswer(`e${i}`, e.target.value)}
                    placeholder={i === 0 ? '今天最棒的時刻⋯' : ''}
                  />
                </div>
              </span>
            ))}

            <div className="eval-bar">
              <div className="eval-row habits-row">
                <span className="eval-label">習慣</span>
                {settings.habits.map((h) => (
                  <button
                    key={h}
                    className={`habit-chip ${entry.habitsDone[h] ? 'on' : ''}`}
                    onClick={() =>
                      update({ habitsDone: { ...entry.habitsDone, [h]: !entry.habitsDone[h] } })
                    }
                  >
                    {entry.habitsDone[h] ? '✓ ' : ''}
                    {h}
                  </button>
                ))}
                {addingHabit ? (
                  <input
                    autoFocus
                    className="habit-add-input"
                    placeholder="習慣名稱，Enter 確認"
                    value={newHabit}
                    onChange={(e) => setNewHabit(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addHabit()}
                    onBlur={addHabit}
                  />
                ) : (
                  settings.habits.length < 8 && (
                    <button className="habit-chip ghost" onClick={() => setAddingHabit(true)}>
                      ＋ 新增
                    </button>
                  )
                )}
              </div>
              <div className="eval-row">
                <div className="eval-group" title="今日心情">
                  <span className="eval-label">心情</span>
                  {MOODS.map((m, i) => (
                    <button
                      key={i}
                      className={`mood-btn ${entry.mood === i + 1 ? 'on' : ''}`}
                      onClick={() => update({ mood: entry.mood === i + 1 ? null : i + 1 })}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <div className="eval-group" title="今天的生產力 1-5 分">
                  <span className="eval-label">評分</span>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      className={`score-btn ${entry.score === n ? 'on celebrate' : ''}`}
                      onClick={() => update({ score: entry.score === n ? null : n })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="day-side">
            <MiniCal
              year={d.getFullYear()}
              month={d.getMonth() + 1}
              selectedDay={dateKey}
              onPick={onDateChange}
            />
            <Timeline
              blocks={entry.blocks}
              isToday={isToday}
              onChange={(blocks) => update({ blocks })}
              dropRef={dropRef}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
